import { timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { handleBotUpdate } from './bot.js'
import { createCasting, findCasting } from './castingRepository.js'
import {
  getCastingWorkspace,
  inviteCandidatesToCasting,
  listCastingPageWithCounts,
  manageCasting,
  publishCasting,
} from './castingManagementService.js'
import { applyCastingAndProfileDecision } from './castingDecisionService.js'
import {
  findCastingParticipation,
  removeCastingParticipant,
} from './castingParticipationRepository.js'
import { setCastingApplicationStatus } from './castingParticipationService.js'
import {
  enqueueCastingOutboxEvent,
  listCastingOutboxEvents,
} from './castingOutboxRepository.js'
import { startCastingOutboxProcessor } from './castingOutboxProcessor.js'
import {
  getCastingChannelConfig,
  recordCastingChannelHealth,
  updateCastingChannelConfig,
} from './castingChannelRepository.js'
import { assertHostedConfiguration, config, getConfigStatus } from './config.js'
import { readAuditEvents, recordAuditEvent } from './auditLog.js'
import {
  candidateMessagingChatId,
  findCandidate,
  getBroadcastDryRun,
  isCandidateEligibleForMessaging,
  isCandidateReachableForDirectMessage,
  listCandidateFilterFacets,
  listCandidatePage,
  listCandidates,
  updateCandidateMetadata,
  updateCandidateStatus,
} from './candidateRepository.js'
import { candidateDecisionMessage } from './candidateDecisionMessages.js'
import {
  assignCandidateLabel,
  createCandidateComment,
  createProfileLabel,
  deleteCandidateComment,
  deleteProfileLabel,
  enrichCandidatesForAdmin,
  listCustomTaxonomyValues,
  localCandidateIdsForLabels,
  listProfileLabels,
  moderateCustomTaxonomyValue,
  profileChanges,
  registerCandidateCustomValues,
  removeCandidateLabel,
  renameProfileLabel,
  sanitizeCandidateProfilePatch,
  updateCandidateComment,
} from './profileManagementRepository.js'
import { requireAdminWebToken, requireSuperAdminWebToken } from './security.js'
import { talentTaxonomy } from './taxonomy.js'
import { telegramProvider } from './telegramProvider.js'
import {
  claimTelegramDelivery,
  completeTelegramDelivery,
  failTelegramDelivery,
} from './telegramDeliveryRepository.js'
import {
  claimTelegramUpdate,
  completeTelegramUpdate,
  releaseTelegramUpdate,
  withTelegramUserLock,
} from './telegramUpdateRepository.js'
import { readCandidateMedia, readCandidatePhoto } from './photoStorage.js'
import {
  authenticateAdminWebToken,
  clearAdminSession,
  setAdminSession,
} from './webAuth.js'

const LOGO_PATH = '/favicon.svg'

async function readJson(request) {
  if (request.body) {
    if (Buffer.isBuffer(request.body)) {
      return JSON.parse(request.body.toString('utf8'))
    }

    if (typeof request.body === 'string') {
      return JSON.parse(request.body)
    }

    return request.body
  }

  const chunks = []

  for await (const chunk of request) {
    chunks.push(chunk)
  }

  const raw = Buffer.concat(chunks).toString('utf8')

  if (!raw) {
    return {}
  }

  return JSON.parse(raw)
}

function sendJson(response, statusCode, body) {
  const timing = response.__faceTiming
  const serializationStartedAt = performance.now()
  const payload = JSON.stringify(body, null, 2)
  if (timing) {
    timing.phases.serialize = performance.now() - serializationStartedAt
    timing.phases.app = performance.now() - timing.startedAt
    response.setHeader('server-timing', formatServerTiming(timing.phases))
  }
  response.writeHead(statusCode, {
    'access-control-allow-headers': 'content-type, x-face-admin-token',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-origin': 'http://127.0.0.1:8787',
    'cache-control': 'no-store, private',
    'content-type': 'application/json',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  response.end(payload)
}

function formatServerTiming(phases = {}) {
  return Object.entries(phases)
    .filter(([, duration]) => Number.isFinite(duration) && duration >= 0)
    .map(([name, duration]) => `${name.replace(/[^a-zA-Z0-9_-]/g, '_')};dur=${duration.toFixed(2)}`)
    .join(', ')
}

function startResponseTiming(response) {
  if (!response.__faceTiming) {
    response.__faceTiming = {
      phases: {},
      startedAt: performance.now(),
    }
  }
  return response.__faceTiming
}

async function withResponseTiming(response, phase, task) {
  const timing = startResponseTiming(response)
  const startedAt = performance.now()
  try {
    return await task()
  } finally {
    timing.phases[phase] = (timing.phases[phase] ?? 0) + performance.now() - startedAt
  }
}

function safeRouteName(method, pathname) {
  const route = pathname
    .replace(
      /^\/api\/candidates\/(?!query(?:\/|$)|export\.csv(?:\/|$))[^/]+/,
      '/api/candidates/:candidateId',
    )
    .replace(/^\/api\/castings\/[^/]+/, '/api/castings/:castingId')
    .replace(/^\/candidate-profile\/[^/]+/, '/candidate-profile/:candidateId')
  return `${method} ${route}`
}

function adminAuditFields(admin) {
  return {
    actor: admin.id,
    actorName: admin.name,
    actorRole: admin.role,
  }
}

function hasValidTelegramWebhookSecret(request) {
  const expected = config.telegramWebhookSecret
  const received = request.headers['x-telegram-bot-api-secret-token']

  if (!expected || typeof received !== 'string') {
    return false
  }

  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)

  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
}

function sendHtml(response, statusCode, content, options = {}) {
  const timing = response.__faceTiming
  if (timing) {
    timing.phases.app = performance.now() - timing.startedAt
    response.setHeader('server-timing', formatServerTiming(timing.phases))
  }
  response.writeHead(statusCode, {
    'cache-control': options.cacheControl ?? 'no-store, private',
    'content-type': 'text/html; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  response.end(content)
}

function sendCsv(response, filename, content) {
  response.writeHead(200, {
    'access-control-allow-headers': 'content-type, x-face-admin-token',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-origin': 'http://127.0.0.1:8787',
    'cache-control': 'no-store, private',
    'content-disposition': `attachment; filename="${filename}"`,
    'content-type': 'text/csv; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  response.end(content)
}

function sendImage(response, content, request) {
  sendMedia(response, content, 'image/jpeg', request)
}

function sendMedia(response, content, contentType, request) {
  const total = content.length
  const rangeHeader = request?.headers?.range

  if (rangeHeader) {
    const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/)
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0
      const end = match[2] ? parseInt(match[2], 10) : total - 1
      const safeStart = Math.max(0, Math.min(start, total - 1))
      const safeEnd = Math.max(safeStart, Math.min(end, total - 1))
      const chunk = content.slice(safeStart, safeEnd + 1)
      response.writeHead(206, {
        'accept-ranges': 'bytes',
        'cache-control': 'no-store, private',
        'content-length': chunk.length,
        'content-range': `bytes ${safeStart}-${safeEnd}/${total}`,
        'content-type': contentType,
      })
      response.end(chunk)
      return
    }
  }

  response.writeHead(200, {
    'accept-ranges': 'bytes',
    'cache-control': 'no-store, private',
    'content-length': total,
    'content-type': contentType,
  })
  response.end(content)
}

function sendNotFound(response) {
  sendJson(response, 404, { error: 'Route not found' })
}

function staticContentType(pathname) {
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
  }[extname(pathname)] ?? 'application/octet-stream'
}

async function sendStaticFile(response, pathname) {
  const filePath = resolve(process.cwd(), 'dist', pathname.replace(/^\/+/, ''))
  const distRoot = resolve(process.cwd(), 'dist')

  if (!filePath.startsWith(distRoot)) {
    sendNotFound(response)
    return
  }

  try {
    const content = await readFile(filePath)
    response.writeHead(200, {
      'cache-control': pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600, stale-while-revalidate=86400',
      'content-type': staticContentType(pathname),
    })
    response.end(content)
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendNotFound(response)
      return
    }

    throw error
  }
}

function csvValue(value) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function candidatesToCsv(candidates) {
  const columns = [
    'id',
    'status',
    'name',
    'age',
    'city',
    'district',
    'gender',
    'appearance',
    'hair',
    'facialHair',
    'glasses',
    'tattoos',
    'braces',
    'height',
    'weight',
    'playableAge',
    'role',
    'skills',
    'performanceTalents',
    'sportsTalents',
    'physicalSkills',
    'languageSkills',
    'rating',
    'skillsMediaPath',
    'experience',
    'experienceLevel',
    'availability',
    'phone',
    'instagram',
    'guardianContact',
    'telegramUserId',
    'telegramUsername',
    'submittedByTelegramChatId',
    'submittedByTelegramFirstName',
    'submittedByTelegramUserId',
    'submittedByTelegramUsername',
    'submissionMode',
    'photoFileId',
    'photoPath',
    'portraitPhotoPath',
    'fullBodyPhotoPath',
    'closeShotPhotoPath',
    'leftProfilePhotoPath',
    'rightProfilePhotoPath',
    'introVideoPath',
    'introVideoDuration',
    'createdAt',
    'updatedAt',
  ]

  const rows = candidates.map((candidate) => {
    return columns.map((column) => csvValue(csvCandidateValue(candidate[column]))).join(',')
  })

  return ['\uFEFF' + columns.join(','), ...rows].join('\n')
}

function csvCandidateValue(value) {
  if (Array.isArray(value)) {
    return value.join('; ')
  }

  return value
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function profileField(label, value) {
  return `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '-')}</strong></div>`
}

function listText(value) {
  return Array.isArray(value) ? value.join(', ') : value
}

function candidateProfileHtml(candidate) {
  const mediaUrl = (kind) => `/api/candidates/${encodeURIComponent(candidate.id)}/media/${kind}`
  const submittedBy = candidate.submittedByTelegramUsername
    ? `@${candidate.submittedByTelegramUsername}`
    : candidate.submittedByTelegramFirstName ?? candidate.submittedByTelegramUserId
  const media = [
    ['fullBodyPhotoPath', 'fullBodyPhoto', 'Фото в полный рост'],
    ['closeShotPhotoPath', 'closeShotPhoto', 'Фото ближе'],
    ['leftProfilePhotoPath', 'leftProfilePhoto', 'Левый профиль'],
    ['rightProfilePhotoPath', 'rightProfilePhoto', 'Правый профиль'],
    ['portraitPhotoPath', 'portraitPhoto', 'Портрет'],
  ]
    .filter(([field]) => candidate[field] || (field === 'portraitPhotoPath' && candidate.photoPath))
    .map(([, kind, label]) => {
      return `<figure><img src="${mediaUrl(kind)}" alt="${escapeHtml(label)}"><figcaption>${escapeHtml(label)}</figcaption></figure>`
    })
    .join('')
  const video = candidate.introVideoPath
    ? `<figure class="videoTile"><video controls src="${mediaUrl('introVideo')}"></video><figcaption>Интро-видео</figcaption></figure>`
    : ''

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(candidate.name)} · FACE Production</title>
  <link rel="icon" type="image/svg+xml" href="${LOGO_PATH}">
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #152033; background: #f4f7fb; }
    body { margin: 0; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px; display: grid; gap: 20px; }
    .top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    h1 { margin: 0; font-size: 34px; line-height: 1.1; }
    .muted { margin: 6px 0 0; color: #63748d; font-weight: 700; }
    .status { padding: 8px 12px; border-radius: 999px; background: #fef3c7; color: #92400e; font-weight: 850; }
    .media { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    figure { margin: 0; display: grid; gap: 7px; }
    img, video { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; border-radius: 8px; background: #e8edf5; border: 1px solid #d7e0ec; }
    video { aspect-ratio: 16 / 10; }
    .videoTile { grid-column: span 2; }
    figcaption { color: #63748d; font-size: 13px; font-weight: 850; }
    .facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .fact { display: grid; gap: 5px; padding: 13px; border: 1px solid #d7e0ec; border-radius: 8px; background: #fff; }
    .fact span { color: #63748d; font-size: 12px; font-weight: 850; text-transform: uppercase; }
    .fact strong { color: #152033; overflow-wrap: anywhere; }
    .back { color: #1b6ca8; font-weight: 850; text-decoration: none; }
    .msgBox { display: grid; gap: 10px; padding: 16px; border: 1px solid #d7e0ec; border-radius: 8px; background: #fff; }
    .msgBox h3 { margin: 0; font-size: 16px; }
    .msgBox textarea { width: 100%; min-height: 80px; border: 1px solid #d7e0ec; border-radius: 8px; padding: 10px; font: inherit; color: #152033; background: #fff; resize: vertical; box-sizing: border-box; }
    .msgBox button { min-height: 38px; border: 0; border-radius: 8px; padding: 0 16px; background: #1b6ca8; color: #fff; font-weight: 850; cursor: pointer; }
    .msgBox button:disabled { opacity: .55; cursor: not-allowed; }
    .msgBox .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .msgBox .result { color: #166534; font-weight: 800; }
    .msgBox .err { color: #9f1239; font-weight: 800; }
    @media (max-width: 840px) { main { padding: 18px; } .media, .facts { grid-template-columns: 1fr 1fr; } .videoTile { grid-column: 1 / -1; } }
    @media (max-width: 560px) { .media, .facts { grid-template-columns: 1fr; } .top { display: grid; } }
  </style>
</head>
<body>
  <main>
    <a class="back" href="/">Назад к панели</a>
    <section class="top">
      <div>
        <h1>${escapeHtml(candidate.name)}</h1>
        <p class="muted">${escapeHtml(candidate.id)} · ${escapeHtml(candidate.city)} · ${escapeHtml(candidate.age)} лет</p>
      </div>
      <span class="status">${escapeHtml(candidate.status)}</span>
    </section>
    <section class="media">${media}${video}</section>
    <section class="facts">
      ${profileField('Тип анкеты', candidate.submissionMode === 'friend' ? 'За друга' : 'Личная')}
      ${profileField('Заполнил', candidate.submissionMode === 'friend' ? submittedBy : '-')}
      ${profileField('Телефон', candidate.phone)}
      ${profileField('Telegram кандидата', candidate.telegramUsername ? `@${candidate.telegramUsername}` : candidate.telegramUserId)}
      ${profileField('Пол', candidate.gender)}
      ${profileField('Рейтинг', candidate.rating)}
      ${profileField('Рост', candidate.height)}
      ${profileField('Вес', candidate.weight)}
      ${profileField('Внешность', listText(candidate.appearance))}
      ${profileField('Сценические таланты', listText(candidate.performanceTalents))}
      ${profileField('Спорт', listText(candidate.sportsTalents))}
      ${profileField('Физические навыки', listText(candidate.physicalSkills))}
      ${profileField('Языки', listText(candidate.languageSkills))}
      ${profileField('Навыки', candidate.skills)}
      ${profileField('Источник', candidate.source)}
    </section>
    <section class="msgBox">
      <h3>Написать в Telegram</h3>
      <textarea id="msgText" placeholder="Сообщение кандидату..."></textarea>
      <div class="row">
        <button id="msgSend">Отправить</button>
        <span id="msgResult"></span>
      </div>
    </section>
    <script>
      (function() {
        var candidateId = ${JSON.stringify(candidate.id)};
        var operationId = '';
        document.getElementById('msgText').oninput = function() { operationId = ''; };
        document.getElementById('msgSend').onclick = async function() {
          var btn = document.getElementById('msgSend');
          var result = document.getElementById('msgResult');
          var text = document.getElementById('msgText').value.trim();
          if (!text) { result.className = 'err'; result.textContent = 'Введите текст'; return; }
          btn.disabled = true;
          result.className = '';
          result.textContent = '...';
          try {
            operationId = operationId || ('candidate-' + crypto.randomUUID());
            var resp = await fetch('/api/candidates/' + encodeURIComponent(candidateId) + '/message', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ operationId: operationId, text: text })
            });
            var data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Ошибка');
            document.getElementById('msgText').value = '';
            operationId = '';
            result.className = 'result';
            result.textContent = 'Отправлено ✓';
          } catch(e) {
            result.className = 'err';
            result.textContent = e.message;
          } finally {
            btn.disabled = false;
          }
        };
      })();
    </script>
  </main>
</body>
</html>`
}

export function candidateAdminHtml() {
  const taxonomy = JSON.stringify({
    appearance: talentTaxonomy.appearance,
    languageSkills: talentTaxonomy.languages,
    performanceTalents: talentTaxonomy.performance,
    physicalSkills: talentTaxonomy.physical,
    sportsTalents: talentTaxonomy.sports,
  })

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FACE Production · Кандидаты</title>
  <link rel="icon" type="image/svg+xml" href="${LOGO_PATH}">
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #152033; background: #f4f7fb; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    button, input, select { font: inherit; }
    textarea { width: 100%; min-height: 92px; resize: vertical; border: 1px solid #d7e0ec; border-radius: 8px; padding: 10px; font: inherit; color: #152033; background: #fff; }
    .login { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .loginCard, .panel, .detail, .filters { border: 1px solid #d7e0ec; border-radius: 8px; background: #fff; }
    .loginCard { width: min(420px, 100%); display: grid; gap: 14px; padding: 26px; box-shadow: rgba(15, 23, 42, 0.08) 0 18px 40px; }
    .loginCard h1, h2, h3 { margin: 0; }
    .loginCard input, .filterGrid input, .filterGrid select, .search { width: 100%; min-height: 40px; border: 1px solid #d7e0ec; border-radius: 8px; padding: 0 10px; background: #fff; color: #152033; }
    .app { min-height: 100vh; display: grid; grid-template-columns: 260px minmax(0, 1fr); }
    .sidebar { padding: 24px; background: #111827; color: #e5e7eb; display: grid; align-content: start; gap: 24px; }
    .brand { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 12px; align-items: center; }
    .mark { width: 44px; height: 44px; border-radius: 8px; background: #24a19c; color: #fff; display: grid; place-items: center; font-weight: 900; }
    .logoMark { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; display: block; background: #fff; }
    .nav { min-height: 42px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border: 0; border-radius: 8px; background: transparent; color: #cbd5e1; font-weight: 800; cursor: pointer; text-align: left; }
    .nav.active { background: #243246; color: #fff; }
    .workspace { min-width: 0; display: grid; align-content: start; gap: 18px; padding: 22px 26px 34px; }
    .topbar { min-height: 62px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
    .primary, .secondary, .danger { min-height: 38px; border: 0; border-radius: 8px; padding: 0 13px; font-weight: 850; cursor: pointer; }
    .primary { background: #1b6ca8; color: #fff; }
    .secondary { background: #e8edf5; color: #152033; }
    .danger { background: #fff1f2; color: #be123c; }
    .primary:disabled, .secondary:disabled, .danger:disabled { opacity: .55; cursor: not-allowed; }
    .queryActivity { min-height: 34px; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 10px; border: 1px solid #bae6fd; border-radius: 8px; background: #f0f9ff; color: #075985; font-size: 13px; font-weight: 800; }
    .queryActivity[hidden] { display: none; }
    .queryActivity.error { border-color: #fecdd3; background: #fff1f2; color: #9f1239; }
    .queryActivity button { min-height: 28px; border: 0; border-radius: 6px; padding: 0 9px; background: currentColor; color: #fff; font-weight: 850; cursor: pointer; }
    .pagination { display: flex; justify-content: center; padding: 12px; }
    .filters { display: grid; gap: 14px; padding: 16px; }
    .filterSection { display: grid; gap: 10px; padding: 12px; border: 1px solid #d7e0ec; border-radius: 8px; background: #f8fafc; }
    .filterToggle { min-height: 38px; width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 0; background: transparent; color: #152033; font-weight: 900; text-transform: uppercase; cursor: pointer; padding: 0; text-align: left; }
    .filterToggle span { color: #63748d; font-size: 12px; }
    .sectionTitle { margin: 0; color: #152033; font-size: 13px; font-weight: 900; text-transform: uppercase; }
    .filterGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; align-items: start; }
    .rangeGrid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
    .filterGrid label, .rangeGrid label, .filterField { display: grid; gap: 5px; color: #63748d; font-size: 12px; font-weight: 850; text-transform: uppercase; }
    .filterGrid select[multiple] { min-height: 96px; padding: 8px; }
    .filterLabel { color: #63748d; font-size: 12px; font-weight: 850; text-transform: uppercase; }
    .choiceGroup { min-height: 40px; max-height: 128px; overflow: auto; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 6px; padding: 8px; border: 1px solid #d7e0ec; border-radius: 8px; background: #fff; }
    .choice { min-height: 28px; border: 1px solid #d7e0ec; border-radius: 999px; padding: 0 9px; background: #f8fafc; color: #334155; font-size: 12px; font-weight: 850; cursor: pointer; text-transform: none; }
    .choice.active { border-color: #1b6ca8; background: #dbeafe; color: #1e3a8a; }
    .choice.clear.active { border-color: #24a19c; background: #d1fae5; color: #065f46; }
    .small { font-size: 12px; align-self: center; }
    .mediaFilters { display: flex; flex-wrap: wrap; gap: 7px; }
    .layout { min-width: 0; }
    .panel { overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 13px 14px; border-bottom: 1px solid #d7e0ec; text-align: left; vertical-align: middle; }
    th { color: #63748d; font-size: 12px; text-transform: uppercase; }
    tr { cursor: pointer; }
    tr.selected { background: #eff6ff; }
    td strong { display: block; color: #111827; }
    td span { color: #63748d; font-size: 13px; }
    .status { display: inline-flex; align-items: center; min-height: 25px; padding: 0 9px; border-radius: 999px; font-size: 12px; font-weight: 850; white-space: nowrap; }
    .pending { background: #fef3c7; color: #92400e; }
    .approved { background: #dcfce7; color: #166534; }
    .rejected { background: #ffe4e6; color: #9f1239; }
    .drawerOverlay { position: fixed; inset: 0; z-index: 30; display: grid; justify-items: end; background: rgba(15, 23, 42, .2); }
    .drawerOverlay[hidden] { display: none; }
    .detail { width: min(560px, calc(100vw - 24px)); max-height: calc(100vh - 24px); margin: 12px; overflow-y: auto; display: grid; align-content: start; gap: 16px; padding: 16px; box-shadow: rgba(15, 23, 42, .18) 0 20px 60px; }
    .drawerTop { display: flex; justify-content: flex-end; }
    .iconButton { width: 38px; min-height: 38px; border: 0; border-radius: 8px; background: #e8edf5; color: #152033; font-size: 22px; font-weight: 900; cursor: pointer; line-height: 1; }
    .profileHead { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 12px; align-items: center; }
    .avatar, .photo { width: 56px; height: 56px; border-radius: 8px; object-fit: cover; background: #fee2e2; display: grid; place-items: center; color: #991b1b; font-weight: 900; font-size: 22px; }
    .muted { color: #63748d; margin: 4px 0 0; }
    .media { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    figure { margin: 0; display: grid; gap: 6px; }
    figure img, figure video { width: 100%; aspect-ratio: 4 / 5; border-radius: 8px; object-fit: cover; background: #e8edf5; border: 1px solid #d7e0ec; }
    figure video { aspect-ratio: 16 / 10; }
    .videoTile { grid-column: 1 / -1; }
    figcaption { color: #63748d; font-size: 12px; font-weight: 850; }
    .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
    .fact { display: grid; gap: 4px; padding: 10px; border-radius: 8px; background: #f4f7fb; }
    .fact span { color: #63748d; font-size: 12px; font-weight: 850; }
    .fact strong { overflow-wrap: anywhere; }
    .notice { padding: 12px 14px; border: 1px solid #bae6fd; border-radius: 8px; background: #f0f9ff; color: #075985; font-weight: 800; }
    .ratingBox { display: grid; gap: 8px; padding: 12px; border: 1px solid #d7e0ec; border-radius: 8px; background: #fff; }
    .ratingStars { color: #f59e0b; font-size: 22px; letter-spacing: 1px; }
    .ratingControls { display: grid; grid-template-columns: minmax(0, 1fr) 76px; gap: 8px; align-items: center; }
    .ratingControls input[type="range"] { width: 100%; }
    .ratingValue { min-height: 34px; display: grid; place-items: center; border-radius: 8px; background: #f4f7fb; font-weight: 900; }
    .profileSection { display: grid; gap: 10px; padding: 12px; border: 1px solid #d7e0ec; border-radius: 8px; background: #fff; }
    .profileSection h4 { margin: 0; color: #152033; }
    .profileSection input, .profileSection select { width: 100%; min-height: 38px; border: 1px solid #d7e0ec; border-radius: 8px; padding: 0 10px; background: #fff; color: #152033; }
    .editGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
    .editGrid label { display: grid; gap: 5px; color: #63748d; font-size: 12px; font-weight: 850; }
    .editGrid .wide { grid-column: 1 / -1; }
    .labelList { display: flex; flex-wrap: wrap; gap: 7px; }
    .labelPill { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 9px; border-radius: 999px; background: #e0f2fe; color: #075985; font-size: 12px; font-weight: 850; }
    .labelPill button { border: 0; background: transparent; color: inherit; cursor: pointer; font-weight: 900; }
    .inlineForm { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
    .commentList { display: grid; gap: 8px; }
    .commentCard { display: grid; gap: 6px; padding: 10px; border-radius: 8px; background: #f8fafc; border: 1px solid #e2e8f0; }
    .commentCard p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .commentMeta { color: #63748d; font-size: 12px; }
    .moderationList { display: grid; gap: 8px; }
    .moderationItem { display: grid; gap: 7px; padding: 10px; border-radius: 8px; background: #fffbeb; border: 1px solid #fde68a; }
    .moderationItem.approvedValue { background: #f0fdf4; border-color: #bbf7d0; }
    .miniButton { min-height: 30px; border: 0; border-radius: 7px; padding: 0 9px; background: #e8edf5; color: #152033; font-size: 12px; font-weight: 850; cursor: pointer; }
    .postPage { display: grid; gap: 14px; }
    .postPanel, .postCard { border: 1px solid #d7e0ec; border-radius: 8px; background: #fff; box-shadow: rgba(15, 23, 42, .04) 0 10px 26px; }
    .postPanel { display: grid; gap: 12px; padding: 16px; }
    .sectionHeader { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
    .sectionHeader h3, .postCard h3 { margin: 0; }
    .statRow { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .statPill { min-height: 32px; display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; border-radius: 999px; background: #f1f5f9; color: #334155; font-weight: 850; }
    .recipientToolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid #d7e0ec; border-radius: 8px; background: #f8fafc; }
    .recipientList { max-height: 260px; overflow: auto; display: grid; gap: 8px; padding-right: 4px; }
    .recipientItem { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px; border: 1px solid #d7e0ec; border-radius: 8px; background: #fff; }
    .recipientItem strong { display: block; color: #111827; }
    .recipientMeta { color: #63748d; font-size: 13px; overflow-wrap: anywhere; }
    .telegramBadge { min-height: 26px; display: inline-flex; align-items: center; border-radius: 999px; padding: 0 8px; background: #e0f2fe; color: #075985; font-size: 12px; font-weight: 900; }
    .telegramBadge.missing { background: #f1f5f9; color: #64748b; }
    .postGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; }
    .postCard { display: grid; gap: 12px; padding: 16px; }
    .postCard textarea { min-height: 136px; }
    .castingPage { display: grid; gap: 14px; }
    .castingToolbar, .castingHeader, .castingTabs, .castingDecisionRow { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
    .castingToolbar, .castingHeader { justify-content: space-between; }
    .castingGrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .castingCard { display: grid; gap: 10px; padding: 15px; border: 1px solid #d7e0ec; border-radius: 8px; background: #fff; }
    .castingCard h3, .castingCard p { margin: 0; }
    .castingCard button { justify-self: start; }
    .castingStatus { display: inline-flex; width: fit-content; min-height: 26px; align-items: center; padding: 0 9px; border-radius: 999px; background: #e8edf5; color: #334155; font-size: 12px; font-weight: 900; }
    .castingStatus.published, .castingStatus.active { background: #dcfce7; color: #166534; }
    .castingStatus.closed { background: #e0f2fe; color: #075985; }
    .castingStatus.cancelled { background: #ffe4e6; color: #9f1239; }
    .castingCounts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; }
    .castingCount { display: grid; gap: 3px; padding: 9px; border-radius: 8px; background: #f4f7fb; }
    .castingCount strong { font-size: 18px; }
    .castingCount span { color: #63748d; font-size: 11px; }
    .castingForm { display: grid; gap: 12px; padding: 16px; border: 1px solid #d7e0ec; border-radius: 8px; background: #fff; }
    .castingForm input, .castingFilters input, .castingFilters select { width: 100%; min-height: 40px; border: 1px solid #d7e0ec; border-radius: 8px; padding: 0 10px; background: #fff; color: #152033; }
    .castingTabs { border-bottom: 1px solid #d7e0ec; }
    .castingTab { min-height: 42px; border: 0; border-bottom: 3px solid transparent; background: transparent; color: #63748d; font-weight: 850; cursor: pointer; }
    .castingTab.active { border-bottom-color: #1b6ca8; color: #1b6ca8; }
    .castingFilters { display: grid; grid-template-columns: minmax(180px, 2fr) repeat(2, minmax(130px, 1fr)); gap: 9px; }
    .castingCandidateList { display: grid; gap: 8px; }
    .castingCandidate { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 11px; border: 1px solid #d7e0ec; border-radius: 8px; background: #fff; }
    .castingCandidate.disabled { background: #f8fafc; color: #64748b; }
    .castingCandidate strong { display: block; }
    .castingCandidate button { justify-self: end; }
    .castingBadge { display: inline-flex; min-height: 24px; align-items: center; padding: 0 8px; border-radius: 999px; background: #e0f2fe; color: #075985; font-size: 11px; font-weight: 900; }
    .castingBadge.applied { background: #fef3c7; color: #92400e; }
    .castingBadge.invited { background: #ede9fe; color: #5b21b6; }
    .castingMessage { display: grid; gap: 9px; padding: 12px; border: 1px solid #d7e0ec; border-radius: 8px; background: #f8fafc; }
    .castingEmpty { min-height: 160px; display: grid; place-items: center; text-align: center; color: #63748d; }
    .composerDates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .composerDates label { display: grid; gap: 5px; color: #63748d; font-size: 12px; font-weight: 850; text-transform: uppercase; }
    .composerDates input { width: 100%; min-height: 40px; border: 1px solid #d7e0ec; border-radius: 8px; padding: 0 10px; background: #fff; color: #152033; }
    .selectCell { width: 42px; }
    .empty { min-height: 220px; display: grid; place-items: center; padding: 24px; color: #63748d; text-align: center; }
    .langRow { display: flex; gap: 6px; flex-wrap: wrap; padding: 4px 0; }
    .langBtn { min-height: 30px; border: 1px solid #374151; border-radius: 6px; background: transparent; color: #9ca3af; font-size: 11px; font-weight: 900; cursor: pointer; padding: 0 8px; }
    .langBtn.active { border-color: #24a19c; background: #24a19c; color: #fff; }
    .loginCard .langRow { justify-content: center; margin-top: 4px; }
    .loginCard .langBtn { border-color: #d7e0ec; color: #63748d; background: #f4f7fb; }
    .loginCard .langBtn.active { border-color: #1b6ca8; background: #1b6ca8; color: #fff; }
    @media (max-width: 1180px) { .filterGrid, .postGrid, .castingGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .rangeGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 900px) { .postGrid { grid-template-columns: 1fr; } .sectionHeader { display: grid; } .statRow { justify-content: flex-start; } }
    @media (max-width: 760px) { .app { grid-template-columns: 1fr; } .sidebar { padding: 16px; } .filterGrid, .rangeGrid, .facts, .media, .composerDates, .editGrid, .castingGrid, .castingFilters, .castingCounts { grid-template-columns: 1fr; } .editGrid .wide { grid-column: auto; } .workspace { padding: 18px; } .topbar { display: grid; } .recipientItem, .castingCandidate { grid-template-columns: 24px minmax(0, 1fr); } .recipientItem .telegramBadge, .castingCandidate button { grid-column: 2; justify-self: start; } }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    (function () {
      var root = document.getElementById('root');
      var authenticated = false;
	      var candidates = [];
	      var castings = [];
	      var candidateFacets = { cities: [], genders: [], sources: [] };
	      var candidatePageInfo = { hasMore: false, limit: 100, nextOffset: 0, offset: 0 };
		      var castingPageInfo = { hasMore: false, limit: 50, nextOffset: 0, offset: 0 };
		      var castingsLoaded = false;
		      var queryBusy = false;
		      var queryError = '';
		      var candidateQueryController = null;
		      var castingQueryController = null;
		      var searchDebounceTimer = null;
	      var mutationInFlight = new Set();
	      var loadedCandidateScope = '';
	      var castingWorkspace = null;
	      var selectedCastingId = '';
	      var castingView = 'list';
	      var castingTab = 'applications';
	      var invitationView = 'invite';
	      var castingSelection = [];
	      var castingFilters = { q: '', city: '', gender: '' };
	      var castingDraft = { title: '', body: '', startsAt: '', endsAt: '' };
	      var castingNotice = '';
      var customValues = [];
      var labels = [];
      var currentAdmin = null;
      var activePage = 'pending';
      var filtered = [];
      var selectedIds = [];
      var selectionMode = 'auto';
      var selectedId = '';
      var editingProfileId = '';
      var draftMessages = {};
      var draftRatings = {};
      var deliveryOperations = { bulk: '', casting: '', candidates: {} };
      var postDraft = {
        bulkText: '',
        castingBody: '',
        castingEnd: '',
        castingStart: '',
        castingTitle: ''
      };
      var lastInteractionAt = 0;
      function newOperationId(prefix) {
        return prefix + '-' + crypto.randomUUID();
      }
      var filterSections = {
        additional: false,
        main: true,
        media: false,
        talents: false
      };
      var filters = {
        q: '', status: [], city: [], gender: [], source: [],
        ageMin: '', ageMax: '', heightMin: '', heightMax: '', weightMin: '', weightMax: '',
        createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '',
        performance: [], sports: [], physical: [], languages: [], appearance: [],
        customValues: [], labels: [],
        media: {}
      };
      var lang = localStorage.getItem('face-admin-lang') || 'ru';
      var translations = {
        ru: {
          adminCode: 'Код администратора', age: 'Возраст', ageFrom: 'Возраст от', ageTo: 'Возраст до',
          all: 'Все', allMedia: 'Все медиа', appearance: 'Внешность', approve: 'Одобрить', approved: 'Активно',
          brand: 'Платформа талантов', candidate: 'Кандидат', candidatesPage: 'Кандидаты',
          castingBodyPlaceholder: 'Описание проекта, кого ищем, условия, адрес, контакт.',
          castingEnd: 'Конец', castingPostLabel: 'Кастинг-пост', castingStart: 'Старт',
          castingTitlePlaceholder: 'Название кастинга', city: 'Город', clearFilters: 'Сбросить фильтры',
          closeShotPhoto: 'Фото ближе', createSend: 'Создать и отправить', createdAt: 'Создан',
          createdFrom: 'Создан от', createdTo: 'Создан до', deselect: 'Снять выбор',
          export: 'Экспорт всей базы', filledBy: 'Заполнил', filter_additional: 'Дополнительные фильтры',
          filter_main: 'Основные фильтры', filter_media: 'Медиа', filter_talents: 'Таланты и внешность',
          forFriend: 'За друга', found: 'Найдено', foundShort: 'Найдено:', fullBodyPhoto: 'Полный рост',
          gender: 'Пол', hasTelegram: 'Telegram', height: 'Рост', heightFrom: 'Рост от', heightTo: 'Рост до',
          hide: 'Скрыть', introVideo: 'Видео', languages: 'Языки', leftProfile: 'Левый профиль',
          login: 'Войти', logout: 'Выйти',
          media: 'Медиа', messagePlaceholder: 'Написать кандидату или отправителю анкеты',
          messageRecipients: 'Получатели', messageSelected: 'Сообщение выбранным',
          messageTelegram: 'Сообщение в Telegram', messageText: 'Текст сообщения', newCasting: 'Новый кастинг',
          noApplications: 'Нет заявок на проверку', noMedia: 'Медиа не загружено',
          noRecipients: 'Нет одобренных кандидатов',
          noResults: 'Нет кандидатов по текущим фильтрам', noTelegram: 'Нет Telegram',
          confirmCandidateConsent: 'Подтвердить согласие кандидата', confirmGuardianConsent: 'Подтвердить согласие опекуна',
          consentPending: 'Нужно вручную подтвердить согласие перед одобрением.',
          openProfile: 'Открыть профиль', pendingPage: 'Заявки', pendingStatus: 'На проверке',
          performance: 'Сценические таланты', personal: 'Личная', phone: 'Телефон',
          physical: 'Физические навыки', portrait: 'Портрет',
          postsOnly: 'Посты отправляются только одобренным кандидатам.', postsPage: 'Посты',
          ratingLabel: 'Рейтинг заявки', rating: 'Рейтинг', refresh: 'Обновить',
          loading: 'Обновление…', retry: 'Повторить', loadMore: 'Показать ещё',
          loadFailed: 'Не удалось обновить данные.', loadedResults: 'Загружено',
          sending: 'Отправка…', saving: 'Сохранение…',
          regularPost: 'Обычный пост', reject: 'Отклонить', rejected: 'Отклонен',
          recipientsAllApproved: 'Ниже показаны все одобренные кандидаты',
          resultNote_others: 'Результаты сортируются по рейтингу',
          rightProfile: 'Правый профиль', saveRating: 'Сохранить рейтинг',
          search: 'Поиск: имя, телефон, Telegram, ID', selectAll: 'Выбрать всех',
          selected: 'Выбрано', selectedShort: 'Выбрано:', send: 'Отправить', sendPost: 'Отправить пост',
          show: 'Показать', source: 'Источник', sports: 'Спорт', status: 'Статус',
          telegramCandidate: 'Telegram кандидата', title: 'Консоль MVP', type: 'Тип анкеты',
          updatedAt: 'Обновлен', updatedFrom: 'Обновлен от', updatedTo: 'Обновлен до',
          weight: 'Вес', weightFrom: 'Вес от', weightTo: 'Вес до',
          addComment: 'Добавить комментарий', addLabel: 'Добавить метку', adminLabels: 'Метки',
          approveCustom: 'Сделать официальным', cancel: 'Отмена', comments: 'Внутренние комментарии',
          customValues: 'Пользовательские значения', deleteAction: 'Удалить', editComment: 'Изменить',
          editProfile: 'Редактировать профиль', mergeCustom: 'Объединить', newComment: 'Внутренняя заметка',
          newLabel: 'Новая метка', removeLabel: 'Убрать', renameCustom: 'Переименовать',
	          saveProfile: 'Сохранить профиль', profileDetails: 'Данные профиля',
	          castingsPage: 'Кастинги', createCasting: 'Создать кастинг', editCasting: 'Редактировать',
	          publishCasting: 'Опубликовать', closeCasting: 'Закрыть', cancelCasting: 'Отменить кастинг',
	          draft: 'Черновик', published: 'Опубликован', closed: 'Закрыт', cancelled: 'Отменен',
	          applicationsTab: 'Заявки', castingCandidatesTab: 'Кандидаты', invitationsTab: 'Приглашения',
	          inviteView: 'Пригласить', awaitingView: 'Ожидают ответа', inviteSelected: 'Пригласить выбранных',
	          appliedBadge: 'Уже подал заявку', invitedBadge: 'Уже приглашен', awaitingBadge: 'Ожидает',
	          castingMessage: 'Сообщение по кастингу', acceptCasting: 'Принять на кастинг',
	          rejectCasting: 'Отклонить с кастинга', profileDecision: 'Решение по профилю',
	          keepProfile: 'Не менять профиль', approveProfile: 'Одобрить профиль', rejectProfile: 'Отклонить профиль',
	          saveDraft: 'Сохранить черновик', castingDetailsUnavailable: 'Детали кастинга пока недоступны.',
	          applicationsCount: 'Заявки', candidatesCount: 'Кандидаты', invitationsCount: 'Приглашения', awaitingCount: 'Ожидают',
	          queuedDelivery: 'В очереди', deliveryIssues: 'Проблемы доставки', channelUnconfigured: 'Telegram-канал не настроен',
	          removeFromCasting: 'Убрать из кастинга', cancelInvitation: 'Отменить приглашение',
	          participantRemoved: 'Кандидат убран из кастинга', invitationCancelled: 'Приглашение отменено',
	        },
        uz: {
          adminCode: 'Admin kodi', age: 'Yosh', ageFrom: 'Yosh dan', ageTo: 'Yosh gacha',
          all: 'Barchasi', allMedia: 'Barcha media', appearance: "Ko'rinish", approve: 'Tasdiqlash',
          approved: 'Faol', brand: 'Talent platformasi', candidate: 'Nomzod', candidatesPage: 'Nomzodlar',
          castingBodyPlaceholder: "Loyiha tavsifi, kimni qidiramiz, shartlar, manzil, aloqa.",
          castingEnd: 'Tugash', castingPostLabel: 'Kasting post', castingStart: 'Boshlanish',
          castingTitlePlaceholder: 'Kasting nomi', city: 'Shahar', clearFilters: 'Filtrlarni tozalash',
          closeShotPhoto: 'Yaqinroq foto', createSend: 'Yaratish va yuborish', createdAt: 'Yaratilgan',
          createdFrom: 'Yaratilgan dan', createdTo: 'Yaratilgan gacha', deselect: "Tanlovni bekor qilish",
          export: "Ma'lumotlar bazasini eksport", filledBy: "To'ldirgan",
          filter_additional: "Qo'shimcha filtrlar", filter_main: 'Asosiy filtrlar',
          filter_media: 'Media', filter_talents: "Talantlar va ko'rinish", forFriend: "Do'st uchun",
          found: 'Topildi', foundShort: 'Topildi:', fullBodyPhoto: "To'liq bo'y",
          gender: 'Jins', hasTelegram: 'Telegram', height: "Bo'y", heightFrom: "Bo'y dan",
          heightTo: "Bo'y gacha", hide: 'Yashirish', introVideo: 'Video', languages: 'Tillar',
          leftProfile: 'Chap profil', login: 'Kirish', logout: 'Chiqish', media: 'Media',
          messagePlaceholder: "Nomzodga yoki ariza yuboruvchiga yozing",
          messageRecipients: "Qabul qiluvchilar", messageSelected: "Tanlanganlarga xabar",
          messageTelegram: 'Telegram xabar', messageText: 'Xabar matni', newCasting: 'Yangi kasting',
          noApplications: "Tekshirish uchun arizalar yo'q", noMedia: 'Media yuklanmagan',
          noRecipients: "Tasdiqlangan nomzodlar yo'q",
          noResults: "Joriy filtrlarga mos nomzodlar yo'q", noTelegram: "Telegram yo'q",
          confirmCandidateConsent: 'Nomzod roziligini tasdiqlash', confirmGuardianConsent: 'Vasiy roziligini tasdiqlash',
          consentPending: 'Tasdiqlashdan oldin rozilikni qo‘lda tekshiring.',
          openProfile: "Profilni ochish", pendingPage: 'Arizalar', pendingStatus: "Tekshiruvda",
          performance: 'Sahna talantlari', personal: 'Shaxsiy', phone: 'Telefon',
          physical: "Jismoniy ko'nikmalar", portrait: 'Portret',
          postsOnly: "Postlar faqat tasdiqlangan nomzodlarga yuboriladi.", postsPage: 'Postlar',
          ratingLabel: 'Ariza reytingi', rating: 'Reyting', refresh: 'Yangilash',
          loading: 'Yangilanmoqda…', retry: 'Qayta urinish', loadMore: "Ko‘proq ko‘rsatish",
          loadFailed: "Ma’lumotlarni yangilab bo‘lmadi.", loadedResults: 'Yuklandi',
          sending: 'Yuborilmoqda…', saving: 'Saqlanmoqda…',
          regularPost: 'Oddiy post', reject: 'Rad etish', rejected: 'Rad etildi',
          recipientsAllApproved: "Quyida barcha tasdiqlangan nomzodlar ko'rsatilgan",
          resultNote_others: "Natijalar reyting bo'yicha saralanadi", rightProfile: "O'ng profil",
          saveRating: 'Reytingni saqlash', search: "Qidirish: ism, telefon, Telegram, ID",
          selectAll: "Barchasini tanlash", selected: 'Tanlangan', selectedShort: 'Tanlangan:',
          send: 'Yuborish', sendPost: 'Post yuborish', show: "Ko'rsatish", source: 'Manba',
          sports: 'Sport', status: 'Holat', telegramCandidate: 'Nomzod Telegram', title: 'MVP konsoli',
          type: 'Ariza turi', updatedAt: 'Yangilangan', updatedFrom: "Yangilangan dan",
          updatedTo: "Yangilangan gacha", weight: 'Vazn', weightFrom: 'Vazn dan', weightTo: 'Vazn gacha',
          addComment: "Izoh qo‘shish", addLabel: "Yorliq qo‘shish", adminLabels: 'Yorliqlar',
          approveCustom: 'Rasmiy variant qilish', cancel: 'Bekor qilish', comments: 'Ichki izohlar',
          customValues: 'Maxsus qiymatlar', deleteAction: "O‘chirish", editComment: 'Tahrirlash',
          editProfile: 'Profilni tahrirlash', mergeCustom: 'Birlashtirish', newComment: 'Ichki izoh',
          newLabel: 'Yangi yorliq', removeLabel: 'Olib tashlash', renameCustom: 'Nomini o‘zgartirish',
	          saveProfile: 'Profilni saqlash', profileDetails: "Profil ma'lumotlari",
	          castingsPage: 'Kastinglar', createCasting: 'Kasting yaratish', editCasting: 'Tahrirlash',
	          publishCasting: 'E’lon qilish', closeCasting: 'Yopish', cancelCasting: 'Bekor qilish',
	          draft: 'Qoralama', published: 'E’lon qilingan', closed: 'Yopilgan', cancelled: 'Bekor qilingan',
	          applicationsTab: 'Arizalar', castingCandidatesTab: 'Nomzodlar', invitationsTab: 'Takliflar',
	          inviteView: 'Taklif qilish', awaitingView: 'Javob kutilmoqda', inviteSelected: 'Tanlanganlarni taklif qilish',
	          appliedBadge: 'Ariza topshirgan', invitedBadge: 'Taklif qilingan', awaitingBadge: 'Kutilmoqda',
	          castingMessage: 'Kasting bo‘yicha xabar', acceptCasting: 'Kastingga qabul qilish',
	          rejectCasting: 'Kastingdan rad etish', profileDecision: 'Profil qarori',
	          keepProfile: 'Profilni o‘zgartirmaslik', approveProfile: 'Profilni tasdiqlash', rejectProfile: 'Profilni rad etish',
	          saveDraft: 'Qoralamani saqlash', castingDetailsUnavailable: 'Kasting tafsilotlari hozircha mavjud emas.',
	          applicationsCount: 'Arizalar', candidatesCount: 'Nomzodlar', invitationsCount: 'Takliflar', awaitingCount: 'Kutilmoqda',
	          queuedDelivery: 'Navbatga qo‘yildi', deliveryIssues: 'Yetkazib berish muammolari', channelUnconfigured: 'Telegram kanali sozlanmagan',
	          removeFromCasting: 'Kastingdan olib tashlash', cancelInvitation: 'Taklifni bekor qilish',
	          participantRemoved: 'Nomzod kastingdan olib tashlandi', invitationCancelled: 'Taklif bekor qilindi',
	        },
        en: {
          adminCode: 'Admin code', age: 'Age', ageFrom: 'Age from', ageTo: 'Age to',
          all: 'All', allMedia: 'All media', appearance: 'Appearance', approve: 'Approve',
          approved: 'Active', brand: 'Talent Platform', candidate: 'Candidate', candidatesPage: 'Candidates',
          castingBodyPlaceholder: 'Project description, who we seek, conditions, location, contact.',
          castingEnd: 'End', castingPostLabel: 'Casting post', castingStart: 'Start',
          castingTitlePlaceholder: 'Casting title', city: 'City', clearFilters: 'Reset filters',
          closeShotPhoto: 'Close shot', createSend: 'Create & send', createdAt: 'Created',
          createdFrom: 'Created from', createdTo: 'Created to', deselect: 'Deselect all',
          export: 'Export database', filledBy: 'Filled by', filter_additional: 'Additional filters',
          filter_main: 'Main filters', filter_media: 'Media', filter_talents: 'Talents & appearance',
          forFriend: 'For a friend', found: 'Found', foundShort: 'Found:', fullBodyPhoto: 'Full body',
          gender: 'Gender', hasTelegram: 'Telegram', height: 'Height', heightFrom: 'Height from',
          heightTo: 'Height to', hide: 'Hide', introVideo: 'Video', languages: 'Languages',
          leftProfile: 'Left profile', login: 'Login', logout: 'Logout', media: 'Media',
          messagePlaceholder: 'Write to candidate or application submitter',
          messageRecipients: 'Recipients', messageSelected: 'Message to selected',
          messageTelegram: 'Telegram message', messageText: 'Message text', newCasting: 'New casting',
          noApplications: 'No applications awaiting review', noMedia: 'No media uploaded',
          noRecipients: 'No approved candidates available',
          noResults: 'No candidates match current filters', noTelegram: 'No Telegram',
          confirmCandidateConsent: 'Confirm candidate consent', confirmGuardianConsent: 'Confirm guardian consent',
          consentPending: 'Manually verify consent before approval.',
          openProfile: 'Open profile', pendingPage: 'Applications', pendingStatus: 'Pending',
          performance: 'Performance talents', personal: 'Personal', phone: 'Phone',
          physical: 'Physical skills', portrait: 'Portrait',
          postsOnly: 'Posts are sent to approved candidates only.', postsPage: 'Posts',
          ratingLabel: 'Application rating', rating: 'Rating', refresh: 'Refresh',
          loading: 'Updating…', retry: 'Retry', loadMore: 'Load more',
          loadFailed: 'Could not refresh the data.', loadedResults: 'Loaded',
          sending: 'Sending…', saving: 'Saving…',
          regularPost: 'Regular post', reject: 'Reject', rejected: 'Rejected',
          recipientsAllApproved: 'All approved candidates are listed below',
          resultNote_others: 'Results sorted by rating',
          rightProfile: 'Right profile', saveRating: 'Save rating',
          search: 'Search: name, phone, Telegram, ID', selectAll: 'Select all',
          selected: 'Selected', selectedShort: 'Selected:', send: 'Send', sendPost: 'Send post',
          show: 'Show', source: 'Source', sports: 'Sports', status: 'Status',
          telegramCandidate: 'Candidate Telegram', title: 'MVP Console', type: 'Application type',
          updatedAt: 'Updated', updatedFrom: 'Updated from', updatedTo: 'Updated to',
          weight: 'Weight', weightFrom: 'Weight from', weightTo: 'Weight to',
          addComment: 'Add comment', addLabel: 'Add label', adminLabels: 'Labels',
          approveCustom: 'Make official', cancel: 'Cancel', comments: 'Internal comments',
          customValues: 'Custom values', deleteAction: 'Delete', editComment: 'Edit',
          editProfile: 'Edit profile', mergeCustom: 'Merge', newComment: 'Internal note',
          newLabel: 'New label', removeLabel: 'Remove', renameCustom: 'Rename',
	          saveProfile: 'Save profile', profileDetails: 'Profile details',
	          castingsPage: 'Castings', createCasting: 'Create casting', editCasting: 'Edit',
	          publishCasting: 'Publish', closeCasting: 'Close', cancelCasting: 'Cancel casting',
	          draft: 'Draft', published: 'Published', closed: 'Closed', cancelled: 'Cancelled',
	          applicationsTab: 'Applications', castingCandidatesTab: 'Candidates', invitationsTab: 'Invitations',
	          inviteView: 'Invite', awaitingView: 'Awaiting', inviteSelected: 'Invite selected',
	          appliedBadge: 'Already applied', invitedBadge: 'Already invited', awaitingBadge: 'Awaiting',
	          castingMessage: 'Casting message', acceptCasting: 'Accept for casting',
	          rejectCasting: 'Reject from casting', profileDecision: 'Profile decision',
	          keepProfile: 'Keep profile unchanged', approveProfile: 'Approve profile', rejectProfile: 'Reject profile',
	          saveDraft: 'Save draft', castingDetailsUnavailable: 'Casting details are not available yet.',
	          applicationsCount: 'Applications', candidatesCount: 'Candidates', invitationsCount: 'Invitations', awaitingCount: 'Awaiting',
	          queuedDelivery: 'Queued', deliveryIssues: 'Delivery issues', channelUnconfigured: 'Telegram channel is not configured',
	          removeFromCasting: 'Remove from casting', cancelInvitation: 'Cancel invitation',
	          participantRemoved: 'Candidate removed from casting', invitationCancelled: 'Invitation cancelled',
	        }
      };
      function t(key) { return (translations[lang] || translations.ru)[key] || key; }
      function getMediaFields() {
        return [
          ['fullBodyPhotoPath', 'fullBodyPhoto', t('fullBodyPhoto')],
          ['closeShotPhotoPath', 'closeShotPhoto', t('closeShotPhoto')],
          ['leftProfilePhotoPath', 'leftProfilePhoto', t('leftProfile')],
          ['rightProfilePhotoPath', 'rightProfilePhoto', t('rightProfile')],
          ['portraitPhotoPath', 'portraitPhoto', t('portrait')],
          ['introVideoPath', 'introVideo', t('introVideo')]
        ];
      }
      var taxonomy = ${taxonomy};
      var logoDataUri = (document.querySelector('link[rel="icon"]') || {}).href || '';
      var taxonomyByValue = {};
      Object.keys(taxonomy).forEach(function (field) {
        taxonomy[field].forEach(function (option) {
          [option.code, option.en, option.ru, option.uz].forEach(function (alias) {
            taxonomyByValue[String(alias || '').trim().toLowerCase().replaceAll('’', "'").replaceAll('‘', "'").replace(/\\s+/g, ' ')] = option.code;
          });
        });
      });
      function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
          return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
        });
      }
      function text(value) { return Array.isArray(value) ? value.join(', ') : (value || ''); }
      function norm(value) { return text(value).toLowerCase(); }
      function canonicalTalentValue(value) {
        var key = String(value || '').trim().toLowerCase().replaceAll('’', "'").replaceAll('‘', "'").replace(/\\s+/g, ' ');
        return taxonomyByValue[key] || String(value || '').trim();
      }
      function talentLabel(value) {
        var canonical = canonicalTalentValue(value);
        var fields = Object.keys(taxonomy);
        for (var fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
          var options = taxonomy[fields[fieldIndex]];
          for (var index = 0; index < options.length; index += 1) {
            if (options[index].code === canonical) return options[index].ru || options[index].en || canonical;
          }
        }
        return canonical;
      }
      function displayTalentList(value) {
        return Array.isArray(value) ? value.map(talentLabel).join(', ') : talentLabel(value || '');
      }
      function numberValue(value) {
        var parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      function ratingValue(candidate) {
        var parsed = Number(candidate && candidate.rating);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      function draftRatingValue(candidate) {
        if (candidate && draftRatings[candidate.id] != null) return Number(draftRatings[candidate.id]);
        return ratingValue(candidate);
      }
      function touchInteraction() {
        lastInteractionAt = Date.now();
      }
      function hasActiveEditor() {
        var activeId = document.activeElement && document.activeElement.id;
        var activeEditors = ['singleText', 'ratingInput', 'bulkText', 'castingTitle', 'castingBody', 'castingStart', 'castingEnd'];
        return activeEditors.includes(activeId) || Date.now() - lastInteractionAt < 10000;
      }
      function captureDetailDrafts() {
        if (!selectedId) return;
        var singleText = document.getElementById('singleText');
        if (singleText) draftMessages[selectedId] = singleText.value;
        var ratingInput = document.getElementById('ratingInput');
        if (ratingInput) draftRatings[selectedId] = Number(ratingInput.value);
      }
      function capturePostDrafts() {
        ['bulkText', 'castingTitle', 'castingBody', 'castingStart', 'castingEnd'].forEach(function (id) {
          var input = document.getElementById(id);
          if (input) postDraft[id] = input.value;
        });
      }
      function captureDrafts() {
        captureDetailDrafts();
        capturePostDrafts();
      }
      function pageBaseCandidates() {
        if (activePage === 'pending') {
          return candidates.filter(function (candidate) { return candidate.status === 'pending_review'; });
        }

	        if (activePage === 'candidates' || activePage === 'posts' || activePage === 'castings') {
          return candidates.filter(function (candidate) { return candidate.status === 'approved' || candidate.status === 'verified'; });
        }

        return candidates;
      }
      function pageTotalCount() {
        return pageBaseCandidates().length;
      }
      function starText(value) {
        var rating = Number(value || 0);
        var stars = '';
        for (var index = 1; index <= 5; index += 1) {
          stars += rating >= index ? '★' : rating >= index - 0.5 ? '◐' : '☆';
        }
        return stars;
      }
      function dateOnly(value) { return value ? String(value).slice(0, 10) : ''; }
      function optionValues(field) {
        var set = new Set();
        if (taxonomy[field]) {
          taxonomy[field].forEach(function (option) { set.add(option.code); });
          customValues.filter(function (item) {
            return item.field === field && item.status === 'approved';
          }).forEach(function (item) { set.add(item.value); });
        } else if (field === 'city') {
          (candidateFacets.cities || []).forEach(function (value) { set.add(value); });
        } else if (field === 'gender') {
          (candidateFacets.genders || []).forEach(function (value) { set.add(value); });
        } else if (field === 'source') {
          (candidateFacets.sources || []).forEach(function (value) { set.add(value); });
        } else {
          candidates.forEach(function (candidate) {
            var value = candidate[field];
            if (Array.isArray(value)) value.forEach(function (item) { if (item) set.add(canonicalTalentValue(item)); });
            else if (value) set.add(canonicalTalentValue(value));
          });
        }
        return Array.from(set)
          .filter(Boolean)
          .sort(function (a, b) { return String(talentLabel(a)).localeCompare(String(talentLabel(b))); })
          .map(function (value) { return taxonomy[field] ? { value: value, label: talentLabel(value) } : value; });
      }
      function optionValue(option) {
        return typeof option === 'string' ? option : option.value;
      }
      function optionLabel(option) {
        return typeof option === 'string' ? option : option.label;
      }
      function toggleSelection(selected, value) {
        return selected.includes(value)
          ? selected.filter(function (item) { return item !== value; })
          : selected.concat(value);
      }
      function choiceGroup(id, label, values, selected) {
        var options = values.map(function (option) {
          var value = optionValue(option);
          var display = optionLabel(option);
          return '<button type="button" class="choice' + (selected.includes(value) ? ' active' : '') + '" data-filter="' + id + '" data-value="' + esc(value) + '">' + esc(display) + '</button>';
        }).join('');
        return '<div class="filterField"><div class="filterLabel">' + label + '</div><div class="choiceGroup">' +
          '<button type="button" class="choice clear' + (!selected.length ? ' active' : '') + '" data-filter-clear="' + id + '">' + t('all') + '</button>' +
          (options || '<span class="muted small">Нет данных</span>') +
          '</div></div>';
      }
      function multiSelect(id, label, values, selected) {
        return '<label>' + label + '<select id="' + id + '" multiple>' +
          values.map(function (option) {
            var value = optionValue(option);
            var display = optionLabel(option);
            return '<option value="' + esc(value) + '"' + (selected.includes(value) ? ' selected' : '') + '>' + esc(display) + '</option>';
          }).join('') +
          '</select></label>';
      }
      function statusLabel(status) {
        if (status === 'approved' || status === 'verified') return t('approved');
        if (status === 'rejected') return t('rejected');
        return t('pendingStatus');
      }
      function statusClass(status) {
        if (status === 'approved' || status === 'verified') return 'approved';
        if (status === 'rejected') return 'rejected';
        return 'pending';
      }
      function submitterLabel(candidate) {
        if (!candidate || candidate.submissionMode !== 'friend') return '';
        return candidate.submittedByTelegramUsername
          ? '@' + candidate.submittedByTelegramUsername
          : candidate.submittedByTelegramFirstName || candidate.submittedByTelegramUserId || '';
      }
      function matchesRange(value, min, max) {
        var numeric = numberValue(value);
        if (min && (numeric == null || numeric < Number(min))) return false;
        if (max && (numeric == null || numeric > Number(max))) return false;
        return true;
      }
      function matchesDate(value, from, to) {
        var date = dateOnly(value);
        if (from && (!date || date < from)) return false;
        if (to && (!date || date > to)) return false;
        return true;
      }
      function matchesAny(candidateValue, selected) {
        if (!selected.length) return true;
        var values = Array.isArray(candidateValue) ? candidateValue : [candidateValue];
        var canonicalValues = values.map(canonicalTalentValue);
        return selected.some(function (item) {
          var canonical = canonicalTalentValue(item);
          return canonicalValues.includes(canonical) || norm(candidateValue).includes(String(item).toLowerCase());
        });
      }
      function hasCandidateMedia(candidate, key) {
        if (key === 'portraitPhotoPath') return Boolean(candidate.portraitPhotoPath || candidate.photoPath);
        return Boolean(candidate[key]);
      }
      function candidateHasLabel(candidate, labelId) {
        return (candidate.adminLabels || []).some(function (label) { return label.id === labelId; });
      }
      function candidateHasCustomValue(candidate, customValueId) {
        var customValue = customValues.find(function (item) { return item.id === customValueId; });
        if (!customValue) return false;
        return (candidate[customValue.field] || []).some(function (value) {
          return String(value).trim().toLowerCase() === String(customValue.value).trim().toLowerCase();
        });
      }
      function activeCustomValueOptions() {
        return customValues.filter(function (item) {
          return item.status === 'pending' || item.status === 'approved';
        }).map(function (item) {
          return { value: item.id, label: item.value };
        });
      }
      function mediaFilterButtons() {
        var active = Object.keys(filters.media).filter(function (key) { return filters.media[key]; });
        var mf = getMediaFields();
        return '<div class="mediaFilters">' +
          '<button type="button" class="choice clear' + (!active.length ? ' active' : '') + '" id="clearMediaFilters">' + t('allMedia') + '</button>' +
          mf.map(function (item) {
            return '<button type="button" class="choice' + (filters.media[item[0]] ? ' active' : '') + '" data-media="' + item[0] + '">' + item[2] + '</button>';
          }).join('') +
          '</div>';
      }
      function applyFilters() {
        var baseCandidates = pageBaseCandidates();

        if (activePage !== 'candidates') {
          filtered = baseCandidates.filter(function (candidate) {
            if (activePage !== 'pending' || !filters.labels.length) return true;
            return filters.labels.some(function (labelId) { return candidateHasLabel(candidate, labelId); });
          }).sort(function (a, b) {
            return ratingValue(b) - ratingValue(a) || String(a.name || '').localeCompare(String(b.name || ''));
          });
        } else {
          var q = filters.q.trim().toLowerCase();
          filtered = baseCandidates.filter(function (candidate) {
            var haystack = [
              candidate.id, candidate.name, candidate.phone, candidate.telegramUsername, candidate.telegramUserId
            ].map(norm).join(' ');
            if (q && !haystack.includes(q)) return false;
            if (filters.status.length && !filters.status.includes(candidate.status)) return false;
            if (filters.city.length && !filters.city.includes(candidate.city)) return false;
            if (filters.gender.length && !filters.gender.includes(candidate.gender)) return false;
            if (filters.source.length && !filters.source.includes(candidate.source)) return false;
            if (!matchesRange(candidate.age, filters.ageMin, filters.ageMax)) return false;
            if (!matchesRange(candidate.height, filters.heightMin, filters.heightMax)) return false;
            if (!matchesRange(candidate.weight, filters.weightMin, filters.weightMax)) return false;
            if (!matchesDate(candidate.createdAt, filters.createdFrom, filters.createdTo)) return false;
            if (!matchesDate(candidate.updatedAt, filters.updatedFrom, filters.updatedTo)) return false;
            if (!matchesAny(candidate.performanceTalents, filters.performance)) return false;
            if (!matchesAny(candidate.sportsTalents, filters.sports)) return false;
            if (!matchesAny(candidate.physicalSkills, filters.physical)) return false;
            if (!matchesAny(candidate.languageSkills, filters.languages)) return false;
            if (!matchesAny(candidate.appearance, filters.appearance)) return false;
            if (filters.labels.length && !filters.labels.some(function (labelId) { return candidateHasLabel(candidate, labelId); })) return false;
            if (filters.customValues.length && !filters.customValues.some(function (customValueId) { return candidateHasCustomValue(candidate, customValueId); })) return false;
            for (var key in filters.media) {
              if (filters.media[key] && !hasCandidateMedia(candidate, key)) return false;
            }
            return true;
          }).sort(function (a, b) {
            return ratingValue(b) - ratingValue(a) || String(a.name || '').localeCompare(String(b.name || ''));
          });
        }
        if (!filtered.some(function (candidate) { return candidate.id === selectedId; })) selectedId = '';
        if (selectionMode === 'auto') {
          selectedIds = filtered.map(function (candidate) { return candidate.id; });
        } else {
          var filteredIds = new Set(filtered.map(function (candidate) { return candidate.id; }));
          selectedIds = selectedIds.filter(function (id) { return filteredIds.has(id); });
        }
      }
      async function api(path, options) {
        var response = await fetch(path, Object.assign({
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' }
        }, options || {}));
        var data = await response.json();
        if (!response.ok) {
          var err = new Error(data.error || 'API error');
          err.status = response.status;
          throw err;
        }
        return data;
      }
      function currentCandidateScope() {
        return activePage === 'pending' ? 'applications' : 'candidates';
      }
      function candidateRequestFilters() {
        if (activePage === 'pending') return { labels: filters.labels };
        if (activePage !== 'candidates') return {};
        var requestFilters = Object.assign({}, filters, {
          customFilters: customValues.filter(function (item) {
            return filters.customValues.includes(item.id);
          }).map(function (item) {
            return { field: item.field, value: item.value };
          })
        });
        delete requestFilters.customValues;
        return requestFilters;
      }
      function mergeCandidateRows(existing, incoming) {
        var byId = new Map(existing.map(function (candidate) { return [candidate.id, candidate]; }));
        incoming.forEach(function (candidate) { byId.set(candidate.id, candidate); });
        return Array.from(byId.values());
      }
      async function load(options) {
        options = options || {};
        var scope = currentCandidateScope();
        var append = Boolean(options.append) && scope === loadedCandidateScope;
        var offset = append ? candidatePageInfo.nextOffset : 0;
        var shouldLoadCastings = !append && (Boolean(options.refreshCastings) || !castingsLoaded);
        if (candidateQueryController) candidateQueryController.abort();
        candidateQueryController = new AbortController();
        var controller = candidateQueryController;
        queryBusy = true;
        queryError = '';
        captureDrafts();
        if (authenticated) renderApp();
        try {
	          var responses = await Promise.all([
	            api('/api/candidates/query', {
	              body: JSON.stringify({
	                filters: candidateRequestFilters(),
	                limit: 100,
	                offset: offset,
	                scope: scope
	              }),
	              method: 'POST',
	              signal: controller.signal
	            }),
	            shouldLoadCastings ? api('/api/castings?limit=50&offset=0', {
	              signal: controller.signal
	            }) : Promise.resolve(null)
	          ]);
	          var data = responses[0];
	          var castingData = responses[1];
	          if (castingData) {
	            castings = castingData.castings || [];
	            castingPageInfo = castingData.pageInfo || castingPageInfo;
	            castingsLoaded = true;
	          }
          candidates = append
            ? mergeCandidateRows(candidates, data.candidates || [])
            : (data.candidates || []);
          candidatePageInfo = data.pageInfo || candidatePageInfo;
          candidateFacets = data.facets || candidateFacets;
          loadedCandidateScope = scope;
          customValues = data.customValues || [];
          labels = data.labels || [];
          currentAdmin = data.admin || null;
          authenticated = true;
          queryBusy = false;
          applyFilters();
          renderApp();
        } catch (error) {
          if (error && error.name === 'AbortError') return;
          queryBusy = false;
          if (error.status === 401 || error.status === 403) {
            authenticated = false;
            renderLogin(error.message);
            return;
          }
          queryError = error.message || t('loadFailed');
          if (authenticated) renderApp();
        } finally {
          if (candidateQueryController === controller) candidateQueryController = null;
        }
      }
      async function loadMoreCastings() {
        if (!castingPageInfo.hasMore || queryBusy) return;
        if (castingQueryController) castingQueryController.abort();
        castingQueryController = new AbortController();
        var controller = castingQueryController;
        queryBusy = true;
        queryError = '';
        renderApp();
        try {
          var data = await api('/api/castings?limit=50&offset=' + encodeURIComponent(castingPageInfo.nextOffset), {
            signal: controller.signal
          });
          castings = mergeCandidateRows(castings, data.castings || []);
          castingPageInfo = data.pageInfo || castingPageInfo;
          queryBusy = false;
          renderApp();
        } catch (error) {
          if (error && error.name === 'AbortError') return;
          queryBusy = false;
          queryError = error.message || t('loadFailed');
          renderApp();
        } finally {
          if (castingQueryController === controller) castingQueryController = null;
        }
      }
      function scheduleCandidateQuery(delay) {
        if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
        searchDebounceTimer = window.setTimeout(function () {
          searchDebounceTimer = null;
          load({ refreshCastings: false });
        }, delay == null ? 300 : delay);
      }
      async function runMutation(key, button, pendingLabel, task) {
        if (mutationInFlight.has(key)) return;
        mutationInFlight.add(key);
        var originalLabel = button ? button.textContent : '';
        if (button) {
          button.disabled = true;
          button.setAttribute('aria-busy', 'true');
          button.textContent = pendingLabel;
        }
        try {
          return await task();
        } finally {
          mutationInFlight.delete(key);
          if (button && button.isConnected) {
            button.disabled = false;
            button.removeAttribute('aria-busy');
            button.textContent = originalLabel;
          }
        }
      }
      async function decide(id, action, button, beforeDecision) {
        await runMutation('decision:' + id, button, t('saving'), async function () {
          if (beforeDecision) await beforeDecision();
          await api('/api/candidates/' + encodeURIComponent(id) + '/' + action, { method: 'POST' });
          await load();
        });
      }
      async function saveRating(id, rating) {
        await postJson('/api/candidates/' + encodeURIComponent(id) + '/rating', { rating: rating });
        var candidate = candidates.find(function (item) { return item.id === id; });
        if (candidate) candidate.rating = Number(rating);
        delete draftRatings[id];
        applyFilters();
      }
      async function postJson(path, body) {
        return api(path, { body: JSON.stringify(body), method: 'POST' });
      }
      function mediaUrl(id, kind) {
        return '/api/candidates/' + encodeURIComponent(id) + '/media/' + kind;
      }
      function renderLogin(error) {
        document.body.style.overflow = '';
        var langBtns = ['ru','uz','en'].map(function(l) { return '<button type="button" class="langBtn' + (lang === l ? ' active' : '') + '" data-lang="' + l + '">' + l.toUpperCase() + '</button>'; }).join('');
        root.innerHTML = '<main class="login"><section class="loginCard">' + (logoDataUri ? '<img class="logoMark" src="' + logoDataUri + '" alt="FACE Production">' : '<div class="mark">FP</div>') + '<div><p class="muted">FACE Production</p><h1>' + t('brand') + '</h1></div><input id="pass" type="password" placeholder="' + t('adminCode') + '" autofocus><button id="loginBtn" class="primary">' + t('login') + '</button>' + (error ? '<p class="notice">' + esc(error) + '</p>' : '') + '<div class="langRow">' + langBtns + '</div></section></main>';
        document.getElementById('loginBtn').onclick = async function () {
          var button = document.getElementById('loginBtn');
          var token = document.getElementById('pass').value.trim();
          if (!token) return renderLogin(t('adminCode'));
          button.disabled = true;
          button.setAttribute('aria-busy', 'true');
          button.textContent = t('loading');
          try {
            var response = await fetch('/api/auth/login', {
              method: 'POST',
              credentials: 'same-origin',
              headers: {
                'content-type': 'application/json',
                'x-face-admin-token': token
              },
              body: JSON.stringify({ token: token })
            });
            var data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Login failed');
            authenticated = true;
            await load();
          } catch (loginError) {
            authenticated = false;
            renderLogin(loginError.message);
          }
        };
        document.getElementById('pass').onkeydown = function (event) {
          if (event.key === 'Enter') document.getElementById('loginBtn').click();
        };
        document.querySelectorAll('[data-lang]').forEach(function(btn) {
          btn.onclick = function() { lang = btn.dataset.lang; localStorage.setItem('face-admin-lang', lang); renderLogin(error); };
        });
      }
      function renderQueryActivity() {
        var visible = queryBusy || queryError;
        return '<div class="queryActivity' + (queryError ? ' error' : '') + '" role="' + (queryError ? 'alert' : 'status') + '" aria-live="polite"' + (visible ? '' : ' hidden') + '>' +
          '<span>' + esc(queryError || t('loading')) + '</span>' +
          (queryError ? '<button type="button" id="retryQuery">' + t('retry') + '</button>' : '') +
          '</div>';
      }
      function renderCandidatePagination() {
        if (!candidatePageInfo.hasMore) return '';
        return '<div class="pagination"><button type="button" class="secondary" id="loadMoreCandidates"' + (queryBusy ? ' disabled aria-busy="true"' : '') + '>' +
          (queryBusy ? t('loading') : t('loadMore')) + '</button></div>';
      }
      function renderCastingPagination() {
        if (!castingPageInfo.hasMore) return '';
        return '<div class="pagination"><button type="button" class="secondary" id="loadMoreCastings"' + (queryBusy ? ' disabled aria-busy="true"' : '') + '>' +
          (queryBusy ? t('loading') : t('loadMore')) + '</button></div>';
      }
      function renderFilters() {
        var cityOptions = optionValues('city');
        var genderOptions = optionValues('gender');
        var sourceOptions = optionValues('source');
        var mainBody = '<div class="filterGrid">' +
          choiceGroup('city', t('city'), cityOptions, filters.city) +
          choiceGroup('gender', t('gender'), genderOptions, filters.gender) +
          choiceGroup('source', t('source'), sourceOptions, filters.source) +
          choiceGroup('labels', t('adminLabels'), labels.map(function (label) { return { value: label.id, label: label.name }; }), filters.labels) +
          '</div>';
        var additionalBody = '<div class="rangeGrid">' +
          '<label>' + t('ageFrom') + '<input id="ageMin" type="number" value="' + esc(filters.ageMin) + '"></label><label>' + t('ageTo') + '<input id="ageMax" type="number" value="' + esc(filters.ageMax) + '"></label>' +
          '<label>' + t('heightFrom') + '<input id="heightMin" type="number" value="' + esc(filters.heightMin) + '"></label><label>' + t('heightTo') + '<input id="heightMax" type="number" value="' + esc(filters.heightMax) + '"></label>' +
          '<label>' + t('weightFrom') + '<input id="weightMin" type="number" value="' + esc(filters.weightMin) + '"></label><label>' + t('weightTo') + '<input id="weightMax" type="number" value="' + esc(filters.weightMax) + '"></label>' +
          '<label>' + t('createdFrom') + '<input id="createdFrom" type="date" value="' + esc(filters.createdFrom) + '"></label><label>' + t('createdTo') + '<input id="createdTo" type="date" value="' + esc(filters.createdTo) + '"></label>' +
          '<label>' + t('updatedFrom') + '<input id="updatedFrom" type="date" value="' + esc(filters.updatedFrom) + '"></label><label>' + t('updatedTo') + '<input id="updatedTo" type="date" value="' + esc(filters.updatedTo) + '"></label>' +
          '</div>';
        var talentsBody = '<div class="filterGrid">' +
          choiceGroup('performance', t('performance'), optionValues('performanceTalents'), filters.performance) +
          choiceGroup('sports', t('sports'), optionValues('sportsTalents'), filters.sports) +
          choiceGroup('physical', t('physical'), optionValues('physicalSkills'), filters.physical) +
          choiceGroup('languages', t('languages'), optionValues('languageSkills'), filters.languages) +
          choiceGroup('appearance', t('appearance'), optionValues('appearance'), filters.appearance) +
          choiceGroup('customValues', t('customValues'), activeCustomValueOptions(), filters.customValues) +
          '</div>';
        return '<section class="filters"><input class="search" id="q" placeholder="' + t('search') + '" value="' + esc(filters.q) + '">' +
          renderFilterSection('main', t('filter_main'), mainBody) +
          renderFilterSection('additional', t('filter_additional'), additionalBody) +
          renderFilterSection('talents', t('filter_talents'), talentsBody) +
          renderFilterSection('media', t('filter_media'), mediaFilterButtons()) +
          '<div class="actions"><button class="secondary" id="clearFilters">' + t('clearFilters') + '</button><strong>' + t('found') + ': ' + filtered.length + '</strong><span class="muted">' + t('loadedResults') + ': ' + pageTotalCount() + ' · ' + t('resultNote_others') + '</span></div></section>';
      }
      function renderApplicationLabelFilter() {
        if (!labels.length) return '';
        return '<section class="filters">' +
          choiceGroup('labels', t('adminLabels'), labels.map(function (label) { return { value: label.id, label: label.name }; }), filters.labels) +
          '<div class="actions"><button class="secondary" id="clearFilters">' + t('clearFilters') + '</button><strong>' + t('found') + ': ' + filtered.length + '</strong><span class="muted">' + t('loadedResults') + ': ' + pageTotalCount() + '</span></div></section>';
      }
      function renderFilterSection(id, title, body) {
        return '<div class="filterSection"><button type="button" class="filterToggle" data-filter-toggle="' + id + '">' + esc(title) + '<span>' + (filterSections[id] ? t('hide') : t('show')) + '</span></button>' +
          (filterSections[id] ? body : '') +
          '</div>';
      }
      function selectedRecipientIds() {
        var filteredIds = new Set(filtered.map(function (candidate) { return candidate.id; }));
        return selectedIds.filter(function (id) { return filteredIds.has(id); });
      }
      function hasTelegram(candidate) {
        return Boolean(candidate.telegramChatId || candidate.submittedByTelegramChatId || candidate.telegramUserId || candidate.submittedByTelegramUserId);
      }
      function renderRecipientList() {
        if (!filtered.length) return '<div class="empty">' + t('noRecipients') + '</div>';
        return '<div class="recipientList">' + filtered.map(function (candidate) {
          var checked = selectedIds.includes(candidate.id);
          return '<label class="recipientItem"><input type="checkbox" data-recipient="' + esc(candidate.id) + '" ' + (checked ? 'checked' : '') + '><div><strong>' + esc(candidate.name || '-') + '</strong><div class="recipientMeta">' + esc(candidate.id) + ' · ' + esc(candidate.city || '-') + ' · ' + esc(candidate.gender || '-') + ' · ' + esc(candidate.age || '-') + '</div></div><span class="telegramBadge' + (hasTelegram(candidate) ? '' : ' missing') + '">' + (hasTelegram(candidate) ? t('hasTelegram') : t('noTelegram')) + '</span></label>';
        }).join('') + '</div>';
      }
	      function renderPostsPage() {
        var selected = selectedRecipientIds();
        var selectedTelegram = filtered.filter(function (candidate) { return selected.includes(candidate.id) && hasTelegram(candidate); }).length;
        var foundTelegram = filtered.filter(hasTelegram).length;
        var sendDisabled = selected.length ? '' : ' disabled';
        return '<section class="postPage">' +
          '<section class="postPanel"><div class="sectionHeader"><div><p class="muted">' + t('postsOnly') + '</p><h3>' + t('messageRecipients') + '</h3></div><div class="statRow"><span class="statPill">' + t('foundShort') + ' ' + filtered.length + '</span><span class="statPill">' + t('selectedShort') + ' ' + selected.length + '</span><span class="statPill">Telegram: ' + selectedTelegram + ' / ' + foundTelegram + '</span></div></div>' +
          '<div class="recipientToolbar"><span class="muted">' + t('recipientsAllApproved') + '</span><div class="actions"><button class="secondary" id="selectAllRecipients">' + t('selectAll') + '</button><button class="secondary" id="clearSelected">' + t('deselect') + '</button></div></div>' +
          renderRecipientList() + renderCandidatePagination() + '</section>' +
	          '<section class="postGrid">' +
	          '<div class="postCard"><div><p class="filterLabel">' + t('regularPost') + '</p><h3>' + t('messageSelected') + '</h3></div><textarea id="bulkText" placeholder="' + t('messageText') + '">' + esc(postDraft.bulkText) + '</textarea><div class="actions"><button class="primary" id="sendBulk"' + sendDisabled + '>' + t('sendPost') + '</button><span class="muted" id="bulkResult"></span></div></div>' +
	          '</section></section>';
	      }
	      function castingStatusValue(casting) {
	        return casting.status === 'active' ? 'published' : (casting.status || 'draft');
	      }
	      function castingStatusLabel(casting) {
	        return t(castingStatusValue(casting));
	      }
	      function castingCounts(casting) {
	        return Object.assign({ applications: 0, candidates: 0, invitations: 0, awaiting: 0 }, casting.counts || {});
	      }
	      function castingDeliveryNotice(delivery) {
	        delivery = delivery || {};
	        var queued = Number(delivery.queuedCount || (delivery.queued || []).length || 0);
	        var failed = Number(delivery.failedCount || (delivery.failed || []).length || 0);
	        var skipped = Array.isArray(delivery.skipped) ? delivery.skipped : [];
	        var issues = failed + skipped.length;
	        var channelMissing = skipped.some(function (item) { return item && item.reason === 'channel_unconfigured'; });
	        return t('published') + ' · ' + t('queuedDelivery') + ': ' + queued + ' · ' + t('deliveryIssues') + ': ' + issues +
	          (channelMissing ? ' · ' + t('channelUnconfigured') : '');
	      }
	      function renderCastingCounts(casting) {
	        var counts = castingCounts(casting);
	        return '<div class="castingCounts">' +
	          [['applications', 'applicationsCount'], ['candidates', 'candidatesCount'], ['invitations', 'invitationsCount'], ['awaiting', 'awaitingCount']].map(function (item) {
	            return '<div class="castingCount"><strong>' + Number(counts[item[0]] || 0) + '</strong><span>' + t(item[1]) + '</span></div>';
	          }).join('') + '</div>';
	      }
	      function renderCastingList() {
	        return '<section class="castingPage"><div class="castingToolbar"><div><p class="muted">' + t('castingsPage') + '</p><h3>' + t('castingsPage') + '</h3></div><button class="primary" id="newCasting">' + t('createCasting') + '</button></div>' +
	          (castings.length ? '<div class="castingGrid">' + castings.map(function (casting) {
	            return '<article class="castingCard"><span class="castingStatus ' + esc(castingStatusValue(casting)) + '">' + esc(castingStatusLabel(casting)) + '</span><h3>' + esc(casting.title || '-') + '</h3><p class="muted">' + esc(casting.body || '') + '</p><p class="muted">' + esc(casting.startsAt || '-') + ' — ' + esc(casting.endsAt || '-') + '</p>' + renderCastingCounts(casting) + '<button class="secondary" data-open-casting="' + esc(casting.id) + '">' + t('show') + '</button></article>';
	          }).join('') + '</div>' : '<div class="panel castingEmpty">' + t('createCasting') + '</div>') + renderCastingPagination() + '</section>';
	      }
	      function renderCastingForm() {
	        var editing = castings.find(function (item) { return item.id === selectedCastingId; });
	        return '<section class="castingPage"><div class="castingToolbar"><button class="secondary" id="backToCastings">← ' + t('castingsPage') + '</button><h3>' + (editing ? t('editCasting') : t('createCasting')) + '</h3></div><div class="castingForm">' +
	          '<input id="castingTitle" placeholder="' + t('castingTitlePlaceholder') + '" value="' + esc(castingDraft.title) + '">' +
	          '<textarea id="castingBody" placeholder="' + t('castingBodyPlaceholder') + '">' + esc(castingDraft.body) + '</textarea>' +
	          '<div class="composerDates"><label>' + t('castingStart') + '<input id="castingStart" type="datetime-local" value="' + esc(castingDraft.startsAt) + '"></label><label>' + t('castingEnd') + '<input id="castingEnd" type="datetime-local" value="' + esc(castingDraft.endsAt) + '"></label></div>' +
	          '<div class="actions"><button class="secondary" id="saveCastingDraft">' + t('saveDraft') + '</button><button class="primary" id="publishCastingForm">' + t('publishCasting') + '</button><span class="muted" id="castingResult"></span></div></div></section>';
	      }
	      function castingWorkspaceCandidates(tab) {
	        if (!castingWorkspace) return [];
	        if (tab === 'applications') return castingWorkspace.applications || [];
	        if (tab === 'candidates') return castingWorkspace.candidates || [];
	        return (castingWorkspace.invitations || []).map(function (invitation) {
	          var candidate = invitation.candidate || candidates.find(function (item) { return item.id === invitation.candidateId; }) || {};
	          return Object.assign({}, candidate, { invitationStatus: invitation.status || 'awaiting', invitedAt: invitation.invitedAt });
	        });
	      }
	      function candidateMatchesCastingFilters(candidate) {
	        var q = castingFilters.q.trim().toLowerCase();
	        var haystack = [candidate.id, candidate.name, candidate.phone, candidate.telegramUsername].map(norm).join(' ');
	        if (q && !haystack.includes(q)) return false;
	        if (castingFilters.city && candidate.city !== castingFilters.city) return false;
	        if (castingFilters.gender && candidate.gender !== castingFilters.gender) return false;
	        return true;
	      }
	      function castingAppliedIds() {
	        return new Set((castingWorkspace && castingWorkspace.applications || []).map(function (candidate) { return candidate.id; }));
	      }
	      function castingInvitedIds() {
	        return new Set((castingWorkspace && castingWorkspace.invitations || []).map(function (item) { return item.candidateId || (item.candidate || {}).id; }));
	      }
	      function renderCastingFilters() {
	        return '<div class="castingFilters"><input id="castingSearch" placeholder="' + t('search') + '" value="' + esc(castingFilters.q) + '"><select id="castingCity"><option value="">' + t('city') + ': ' + t('all') + '</option>' + optionValues('city').map(function (value) { return '<option' + (castingFilters.city === value ? ' selected' : '') + '>' + esc(value) + '</option>'; }).join('') + '</select><select id="castingGender"><option value="">' + t('gender') + ': ' + t('all') + '</option>' + optionValues('gender').map(function (value) { return '<option' + (castingFilters.gender === value ? ' selected' : '') + '>' + esc(value) + '</option>'; }).join('') + '</select></div>';
	      }
	      function renderCastingCandidateRows() {
	        var rows;
	        var applied = castingAppliedIds();
	        var invited = castingInvitedIds();
	        if (castingTab === 'invitations' && invitationView === 'invite') {
	          rows = candidates.filter(function (candidate) { return candidate.status === 'approved' || candidate.status === 'verified'; });
	        } else {
	          rows = castingWorkspaceCandidates(castingTab);
	          if (castingTab === 'invitations' && invitationView === 'awaiting') {
	            rows = rows.filter(function (candidate) { return candidate.invitationStatus === 'awaiting' || candidate.invitationStatus === 'invited'; });
	          }
	        }
	        rows = rows.filter(candidateMatchesCastingFilters);
	        var candidatePagination = castingTab === 'invitations' && invitationView === 'invite'
	          ? renderCandidatePagination()
	          : '';
	        if (!rows.length) return '<div class="castingEmpty">' + t('noResults') + '</div>' + candidatePagination;
	        return '<div class="castingCandidateList">' + rows.map(function (candidate) {
	          var isApplied = applied.has(candidate.id);
	          var isInvited = invited.has(candidate.id);
	          var disabled = castingTab === 'invitations' && invitationView === 'invite' && (isApplied || isInvited);
	          var badge = isApplied ? '<span class="castingBadge applied">' + t('appliedBadge') + '</span>' : isInvited ? '<span class="castingBadge invited">' + t('invitedBadge') + '</span>' : candidate.invitationStatus ? '<span class="castingBadge invited">' + esc(candidate.invitationStatus) + '</span>' : '';
	          var rowAction = castingTab === 'candidates'
	            ? '<button class="danger" data-casting-participant-remove="' + esc(candidate.id) + '">' + t('removeFromCasting') + '</button>'
	            : castingTab === 'invitations' && invitationView === 'awaiting' && candidate.invitationStatus === 'invited'
	              ? '<button class="danger" data-casting-invitation-cancel="' + esc(candidate.id) + '">' + t('cancelInvitation') + '</button>'
	              : '';
	          return '<div class="castingCandidate' + (disabled ? ' disabled' : '') + '"><input type="checkbox" data-casting-select="' + esc(candidate.id) + '"' + (castingSelection.includes(candidate.id) ? ' checked' : '') + (disabled ? ' disabled' : '') + '><div><strong>' + esc(candidate.name || '-') + '</strong><span class="recipientMeta">' + esc(candidate.city || '-') + ' · ' + esc(candidate.gender || '-') + ' · ' + esc(candidate.age || '-') + '</span>' + badge + '</div><div class="actions"><button class="secondary" data-casting-candidate="' + esc(candidate.id) + '">' + t('show') + '</button>' + rowAction + '</div></div>';
	        }).join('') + '</div>' + candidatePagination;
	      }
	      function renderCastingCandidateDrawer() {
	        return renderDetail();
	      }
	      function renderCastingDetail() {
	        var casting = castings.find(function (item) { return item.id === selectedCastingId; });
	        if (!casting) return renderCastingList();
	        var tabs = [['applications', 'applicationsTab'], ['candidates', 'castingCandidatesTab'], ['invitations', 'invitationsTab']];
	        var terminal = ['closed', 'cancelled', 'archived'].includes(casting.status);
	        var manage = castingStatusValue(casting) === 'draft' ? '<button class="primary" data-casting-manage="publish">' + t('publishCasting') + '</button>' : '<button class="secondary" data-casting-manage="close">' + t('closeCasting') + '</button>';
	        var lifecycleActions = terminal ? '' : '<button class="secondary" id="editCasting">' + t('editCasting') + '</button>' + manage + '<button class="danger" data-casting-manage="cancel">' + t('cancelCasting') + '</button>';
	        var invitationModes = castingTab === 'invitations' ? '<div class="actions"><button class="' + (invitationView === 'invite' ? 'primary' : 'secondary') + '" data-invitation-view="invite">' + t('inviteView') + '</button><button class="' + (invitationView === 'awaiting' ? 'primary' : 'secondary') + '" data-invitation-view="awaiting">' + t('awaitingView') + '</button></div>' : '';
	        return '<section class="castingPage"><div class="castingHeader"><div><button class="secondary" id="backToCastings">← ' + t('castingsPage') + '</button><h3>' + esc(casting.title) + '</h3><span class="castingStatus ' + esc(castingStatusValue(casting)) + '">' + esc(castingStatusLabel(casting)) + '</span></div><div class="actions">' + lifecycleActions + '</div></div>' + (castingNotice ? '<div class="notice">' + esc(castingNotice) + '</div>' : '') + renderCastingCounts(casting) + '<div class="castingTabs">' + tabs.map(function (tab) { return '<button class="castingTab' + (castingTab === tab[0] ? ' active' : '') + '" data-casting-tab="' + tab[0] + '">' + t(tab[1]) + '</button>'; }).join('') + '</div>' +
	          (!castingWorkspace ? '<div class="panel castingEmpty">' + t('castingDetailsUnavailable') + '</div>' : invitationModes + renderCastingFilters() + renderCastingCandidateRows() + '<section class="castingMessage"><h4>' + t('castingMessage') + '</h4><textarea id="castingBulkMessage" placeholder="' + t('messageText') + '"></textarea><div class="actions">' + (castingTab === 'invitations' && invitationView === 'invite' ? '<button class="primary" id="inviteCastingSelected">' + t('inviteSelected') + '</button>' : '') + '<button class="secondary" id="messageCastingSelected">' + t('send') + '</button><span id="castingBulkResult" class="muted"></span></div></section>') + renderCastingCandidateDrawer() + '</section>';
	      }
	      function renderCastingsPage() {
	        return castingView === 'form' ? renderCastingForm() : castingView === 'detail' ? renderCastingDetail() : renderCastingList();
	      }
      function bindFilters() {
        document.querySelectorAll('[data-filter-toggle]').forEach(function (el) {
          el.onclick = function () {
            filterSections[el.dataset.filterToggle] = !filterSections[el.dataset.filterToggle];
            renderApp();
          };
        });
        ['q','ageMin','ageMax','heightMin','heightMax','weightMin','weightMax','createdFrom','createdTo','updatedFrom','updatedTo'].forEach(function (id) {
          var el = document.getElementById(id);
          if (!el) return;
          if (filters[id] != null) el.value = filters[id];
          el.oninput = el.onchange = function () {
            filters[id] = el.value;
            selectionMode = 'auto';
            applyFilters();
            scheduleCandidateQuery(300);
          };
        });
        document.querySelectorAll('[data-filter]').forEach(function (el) {
          el.onclick = function () {
            var key = el.dataset.filter;
            filters[key] = toggleSelection(filters[key], el.dataset.value);
            selectionMode = 'auto';
            applyFilters();
            renderApp();
            scheduleCandidateQuery(0);
          };
        });
        document.querySelectorAll('[data-filter-clear]').forEach(function (el) {
          el.onclick = function () {
            filters[el.dataset.filterClear] = [];
            selectionMode = 'auto';
            applyFilters();
            renderApp();
            scheduleCandidateQuery(0);
          };
        });
        document.querySelectorAll('[data-media]').forEach(function (el) {
          el.onclick = function () {
            filters.media[el.dataset.media] = !filters.media[el.dataset.media];
            selectionMode = 'auto';
            applyFilters();
            renderApp();
            scheduleCandidateQuery(0);
          };
        });
        var clearMedia = document.getElementById('clearMediaFilters');
        if (clearMedia) clearMedia.onclick = function () {
          filters.media = {};
          selectionMode = 'auto';
          applyFilters();
          renderApp();
          scheduleCandidateQuery(0);
        };
        document.getElementById('clearFilters').onclick = function () {
          filters = { q: '', status: [], city: [], gender: [], source: [], ageMin: '', ageMax: '', heightMin: '', heightMax: '', weightMin: '', weightMax: '', createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '', performance: [], sports: [], physical: [], languages: [], appearance: [], customValues: [], labels: [], media: {} };
          selectionMode = 'auto';
          applyFilters();
          renderApp();
          scheduleCandidateQuery(0);
        };
      }
      function renderTable() {
        if (!filtered.length) return '<section class="panel empty">' + t(activePage === 'pending' ? 'noApplications' : 'noResults') + '</section>' + renderCandidatePagination();
        return '<section class="panel"><table><thead><tr><th>' + t('candidate') + '</th><th>' + t('city') + '</th><th>' + t('gender') + '</th><th>' + t('age') + '</th><th>' + t('rating') + '</th><th>' + t('status') + '</th></tr></thead><tbody>' +
          filtered.map(function (candidate) {
            return '<tr data-id="' + esc(candidate.id) + '" class="' + (candidate.id === selectedId ? 'selected' : '') + '"><td><strong>' + esc(candidate.name || '-') + '</strong><span>' + esc(candidate.id) + ' · ' + esc(candidate.phone || '') + '</span></td><td>' + esc(candidate.city || '-') + '</td><td>' + esc(candidate.gender || '-') + '</td><td>' + esc(candidate.age || '-') + '</td><td><strong>' + ratingValue(candidate).toFixed(2) + '</strong><span>' + starText(ratingValue(candidate)) + '</span></td><td><span class="status ' + statusClass(candidate.status) + '">' + statusLabel(candidate.status) + '</span></td></tr>';
          }).join('') +
          '</tbody></table></section>' + renderCandidatePagination();
      }
      function fact(label, value) {
        return '<div class="fact"><span>' + esc(label) + '</span><strong>' + esc(text(value) || '-') + '</strong></div>';
      }
      function renderConsentVerification(candidate) {
        var age = Number(candidate.age);
        var confirmation = '';
        var label = '';
        if (candidate.submissionMode === 'friend' && age >= 18 && candidate.consent === 'proxy_submitter_confirmed_pending_candidate_consent') {
          confirmation = 'proxy_candidate';
          label = t('confirmCandidateConsent');
        }
        if (age < 18 && candidate.consent === 'minor_pending_guardian_verification') {
          confirmation = 'guardian';
          label = t('confirmGuardianConsent');
        }
        if (!confirmation) return '';
        return '<section class="notice"><p>' + t('consentPending') + '</p><button class="secondary" id="confirmConsent" data-confirmation="' + confirmation + '">' + label + '</button></section>';
      }
      function renderProfileEditor(candidate) {
        function input(field, label, type, value, wide) {
          return '<label class="' + (wide ? 'wide' : '') + '">' + esc(label) + '<input id="edit-' + field + '" type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '"></label>';
        }
        function listInput(field, label, value) {
          return input(field, label, 'text', (value || []).map(talentLabel).join(', '), true);
        }
        return '<section class="profileSection"><h4>' + t('editProfile') + '</h4><div class="editGrid">' +
          input('name', t('candidate'), 'text', candidate.name) +
          input('phone', t('phone'), 'text', candidate.phone) +
          input('age', t('age'), 'number', candidate.age) +
          input('city', t('city'), 'text', candidate.city) +
          input('gender', t('gender'), 'text', candidate.gender) +
          input('height', t('height'), 'number', candidate.height) +
          input('weight', t('weight'), 'number', candidate.weight) +
          listInput('performanceTalents', t('performance'), candidate.performanceTalents) +
          listInput('sportsTalents', t('sports'), candidate.sportsTalents) +
          listInput('physicalSkills', t('physical'), candidate.physicalSkills) +
          listInput('languageSkills', t('languages'), candidate.languageSkills) +
          listInput('appearance', t('appearance'), candidate.appearance) +
          '</div><p class="muted">ID, Telegram ID, creation date and audit history cannot be edited.</p>' +
          '<div class="actions"><button class="primary" id="saveProfileEdit">' + t('saveProfile') + '</button><button class="secondary" id="cancelProfileEdit">' + t('cancel') + '</button><span class="muted" id="profileEditResult"></span></div></section>';
      }
      function renderLabelsSection(candidate) {
        var assigned = candidate.adminLabels || [];
        var available = labels.filter(function (label) {
          return !assigned.some(function (item) { return item.id === label.id; });
        });
        var pills = assigned.length
          ? assigned.map(function (label) {
              return '<span class="labelPill">' + esc(label.name) + '<button type="button" data-remove-label="' + esc(label.id) + '" title="' + t('removeLabel') + '">×</button></span>';
            }).join('')
          : '<span class="muted">—</span>';
        var options = available.map(function (label) {
          return '<option value="' + esc(label.id) + '">' + esc(label.name) + '</option>';
        }).join('');
        return '<section class="profileSection"><h4>' + t('adminLabels') + '</h4><div class="labelList">' + pills + '</div>' +
          (available.length ? '<div class="inlineForm"><select id="labelSelect">' + options + '</select><button class="secondary" id="assignLabel">' + t('addLabel') + '</button></div>' : '') +
          '<div class="inlineForm"><input id="newLabelName" maxlength="60" placeholder="' + t('newLabel') + '"><button class="secondary" id="createLabel">' + t('addLabel') + '</button></div></section>';
      }
      function renderCommentsSection(candidate) {
        var comments = candidate.adminComments || [];
        var content = comments.length ? comments.map(function (comment) {
          var actions = comment.canManage
            ? '<div class="actions"><button class="miniButton" data-edit-comment="' + esc(comment.id) + '">' + t('editComment') + '</button><button class="miniButton" data-delete-comment="' + esc(comment.id) + '">' + t('deleteAction') + '</button></div>'
            : '';
          return '<article class="commentCard"><div class="commentMeta">' + esc(comment.authorName) + ' · ' + esc(new Date(comment.createdAt).toLocaleString()) + '</div><p>' + esc(comment.body) + '</p>' + actions + '</article>';
        }).join('') : '<span class="muted">—</span>';
        return '<section class="profileSection"><h4>' + t('comments') + '</h4><div class="commentList">' + content + '</div><textarea id="newCommentBody" maxlength="4000" placeholder="' + t('newComment') + '"></textarea><div class="actions"><button class="secondary" id="addComment">' + t('addComment') + '</button><span class="muted" id="commentResult"></span></div></section>';
      }
      function renderCustomModeration(candidate) {
        var items = customValues.filter(function (customValue) {
          if (customValue.status === 'removed' || customValue.status === 'merged') return false;
          return (candidate[customValue.field] || []).some(function (value) {
            return String(value).trim().toLowerCase() === String(customValue.value).trim().toLowerCase();
          });
        });
        if (!items.length) return '';
        return '<section class="profileSection"><h4>' + t('customValues') + '</h4><div class="moderationList">' + items.map(function (item) {
          return '<div class="moderationItem ' + (item.status === 'approved' ? 'approvedValue' : '') + '"><div><strong>' + esc(item.value) + '</strong><div class="commentMeta">' + esc(t(item.field === 'performanceTalents' ? 'performance' : item.field === 'sportsTalents' ? 'sports' : item.field === 'physicalSkills' ? 'physical' : item.field === 'languageSkills' ? 'languages' : 'appearance')) + ' · ' + esc(item.status) + '</div></div><div class="actions">' +
            (item.status !== 'approved' ? '<button class="miniButton" data-custom-action="approve" data-custom-id="' + esc(item.id) + '">' + t('approveCustom') + '</button>' : '') +
            '<button class="miniButton" data-custom-action="rename" data-custom-id="' + esc(item.id) + '">' + t('renameCustom') + '</button>' +
            '<button class="miniButton" data-custom-action="merge" data-custom-id="' + esc(item.id) + '">' + t('mergeCustom') + '</button>' +
            '<button class="miniButton" data-custom-action="remove" data-custom-id="' + esc(item.id) + '">' + t('deleteAction') + '</button></div></div>';
        }).join('') + '</div></section>';
      }
	      function renderDetail() {
	        var candidate = filtered.find(function (item) { return item.id === selectedId; }) || candidates.find(function (item) { return item.id === selectedId; }) || (castingWorkspaceCandidates(castingTab).find(function (item) { return item.id === selectedId; }));
	        if (!candidate) return '';
	        var isPendingPage = activePage === 'pending';
	        var isCastingApplication = activePage === 'castings' && castingTab === 'applications';
        var portrait = candidate.portraitPhotoPath || candidate.photoPath;
        var mf = getMediaFields();
        var media = mf.filter(function (item) { return candidate[item[0]] || (item[0] === 'portraitPhotoPath' && candidate.photoPath); }).map(function (item) {
          if (item[1] === 'introVideo') return '<figure class="videoTile"><video controls src="' + mediaUrl(candidate.id, item[1]) + '"></video><figcaption>' + esc(item[2]) + '</figcaption></figure>';
          return '<figure><img src="' + mediaUrl(candidate.id, item[1]) + '" alt="' + esc(item[2]) + '"><figcaption>' + esc(item[2]) + '</figcaption></figure>';
        }).join('');
        var facts = '<section class="profileSection"><h4>' + t('profileDetails') + '</h4><div class="facts">' +
          fact(t('status'), statusLabel(candidate.status)) + fact(t('type'), candidate.submissionMode === 'friend' ? t('forFriend') : t('personal')) + fact(t('filledBy'), submitterLabel(candidate) || '-') + fact(t('rating'), ratingValue(candidate).toFixed(2) + ' ' + starText(ratingValue(candidate))) + fact(t('phone'), candidate.phone) + fact(t('telegramCandidate'), candidate.telegramUsername ? '@' + candidate.telegramUsername : candidate.telegramUserId) + fact(t('gender'), candidate.gender) + fact(t('height'), candidate.height) + fact(t('weight'), candidate.weight) + fact(t('appearance'), displayTalentList(candidate.appearance)) + fact(t('performance'), displayTalentList(candidate.performanceTalents)) + fact(t('sports'), displayTalentList(candidate.sportsTalents)) + fact(t('physical'), displayTalentList(candidate.physicalSkills)) + fact(t('languages'), displayTalentList(candidate.languageSkills)) + fact(t('createdAt'), candidate.createdAt) + fact(t('updatedAt'), candidate.updatedAt) +
          '</div></section>';
        return '<div class="drawerOverlay" id="detailDrawer"><aside class="detail"><div class="drawerTop"><button class="iconButton" id="closeDetail" title="' + t('hide') + '">×</button></div><div class="profileHead">' +
          (portrait ? '<img class="photo" src="' + mediaUrl(candidate.id, 'portraitPhoto') + '" alt="' + t('photo') + '">' : '<div class="avatar">' + esc(String(candidate.name || '?').slice(0, 1)) + '</div>') +
          '<div><p class="muted">' + esc(candidate.id) + '</p><h3>' + esc(candidate.name || '-') + '</h3><p class="muted">' + esc(candidate.age || '-') + ' · ' + esc(candidate.city || '-') + '</p></div></div>' +
          (editingProfileId === candidate.id ? renderProfileEditor(candidate) : facts) +
          renderConsentVerification(candidate) +
          (media ? '<section class="media">' + media + '</section>' : '<p class="notice">' + t('noMedia') + '</p>') +
          renderRatingControl(candidate) +
          renderLabelsSection(candidate) +
	          renderCommentsSection(candidate) +
	          renderCustomModeration(candidate) +
	          (isCastingApplication ? '<section class="profileSection"><h4>' + t('profileDecision') + '</h4><div class="castingDecisionRow"><button class="secondary" data-profile-only="approve">' + t('approveProfile') + '</button><button class="secondary" data-profile-only="reject">' + t('rejectProfile') + '</button></div><select id="castingProfileDecision"><option value="unchanged">' + t('keepProfile') + '</option><option value="approve">' + t('approveProfile') + '</option><option value="reject">' + t('rejectProfile') + '</option></select><div class="castingDecisionRow"><button class="primary" data-casting-decision="accept">' + t('acceptCasting') + '</button><button class="danger" data-casting-decision="reject">' + t('rejectCasting') + '</button></div><span id="castingDecisionResult" class="muted"></span></section>' : '') +
	          (activePage === 'castings' ? '<section class="castingMessage"><h4>' + t('castingMessage') + '</h4><textarea id="castingSingleMessage" placeholder="' + t('messagePlaceholder') + '"></textarea><button class="primary" id="sendCastingSingle">' + t('send') + '</button><span id="castingSingleResult" class="muted"></span></section>' : '') +
          '<div><p class="filterLabel">' + t('messageTelegram') + '</p><textarea id="singleText" placeholder="' + t('messagePlaceholder') + '">' + esc(draftMessages[candidate.id] || '') + '</textarea><div class="actions"><button class="primary" id="sendSingle">' + t('send') + '</button><span class="muted" id="singleResult"></span></div></div><div class="actions">' +
          (isPendingPage ? '<button class="primary" id="approve">' + t('approve') + '</button><button class="danger" id="reject">' + t('reject') + '</button>' : '') +
          (editingProfileId === candidate.id ? '' : '<button class="secondary" id="editProfile">' + t('editProfile') + '</button>') +
          '<button class="secondary" id="openProfile">' + t('openProfile') + '</button></div></aside></div>';
      }
      function renderRatingControl(candidate) {
        var value = draftRatingValue(candidate).toFixed(2);
        return '<section class="ratingBox"><div><p class="filterLabel">' + t('ratingLabel') + '</p><div class="ratingStars" id="ratingStars">' + starText(value) + '</div></div><div class="ratingControls"><input id="ratingInput" type="range" min="0" max="5" step="0.25" value="' + esc(value) + '"><div class="ratingValue" id="ratingValue">' + esc(value) + '</div></div><div class="actions"><button class="secondary" id="saveRating">' + t('saveRating') + '</button><span class="muted" id="ratingResult"></span></div></section>';
      }
      function bindTableAndDetail() {
        document.querySelectorAll('[data-id]').forEach(function (row) {
          row.onclick = function () { selectedId = row.dataset.id; editingProfileId = ''; renderApp(); };
        });
	        var candidate = filtered.find(function (item) { return item.id === selectedId; }) || candidates.find(function (item) { return item.id === selectedId; }) || castingWorkspaceCandidates(castingTab).find(function (item) { return item.id === selectedId; });
        if (!candidate) return;
        var approve = document.getElementById('approve');
        var reject = document.getElementById('reject');
        var closeDetail = document.getElementById('closeDetail');
        var detailDrawer = document.getElementById('detailDrawer');
        var openProfile = document.getElementById('openProfile');
        var ratingInput = document.getElementById('ratingInput');
        var saveRatingButton = document.getElementById('saveRating');
        var confirmConsentButton = document.getElementById('confirmConsent');
        var editProfileButton = document.getElementById('editProfile');
        var saveProfileEdit = document.getElementById('saveProfileEdit');
        var cancelProfileEdit = document.getElementById('cancelProfileEdit');
        var assignLabelButton = document.getElementById('assignLabel');
        var createLabelButton = document.getElementById('createLabel');
        var addCommentButton = document.getElementById('addComment');
        if (editProfileButton) editProfileButton.onclick = function () {
          editingProfileId = candidate.id;
          renderApp();
        };
        if (cancelProfileEdit) cancelProfileEdit.onclick = function () {
          editingProfileId = '';
          renderApp();
        };
        if (saveProfileEdit) saveProfileEdit.onclick = async function () {
          var output = document.getElementById('profileEditResult');
          function fieldValue(field) {
            return document.getElementById('edit-' + field).value.trim();
          }
          function listValue(field) {
            return fieldValue(field).split(',').map(function (value) { return value.trim(); }).filter(Boolean);
          }
          saveProfileEdit.disabled = true;
          try {
            var profileBody = {
              appearance: listValue('appearance'),
              languageSkills: listValue('languageSkills'),
              performanceTalents: listValue('performanceTalents'),
              physicalSkills: listValue('physicalSkills'),
              sportsTalents: listValue('sportsTalents')
            };
            ['name', 'phone', 'city', 'gender'].forEach(function (field) {
              var value = fieldValue(field);
              if (value) profileBody[field] = value;
            });
            ['age', 'height', 'weight'].forEach(function (field) {
              var value = fieldValue(field);
              if (value) profileBody[field] = Number(value);
            });
            await postJson('/api/candidates/' + encodeURIComponent(candidate.id) + '/profile', profileBody);
            editingProfileId = '';
            await load();
          } catch (error) {
            saveProfileEdit.disabled = false;
            output.textContent = error.message;
          }
        };
        if (assignLabelButton) assignLabelButton.onclick = async function () {
          assignLabelButton.disabled = true;
          try {
            await postJson('/api/candidates/' + encodeURIComponent(candidate.id) + '/labels', {
              action: 'add',
              labelId: document.getElementById('labelSelect').value
            });
            await load();
          } catch (error) {
            assignLabelButton.disabled = false;
            window.alert(error.message);
          }
        };
        if (createLabelButton) createLabelButton.onclick = async function () {
          var value = document.getElementById('newLabelName').value.trim();
          if (!value) return;
          createLabelButton.disabled = true;
          try {
            await postJson('/api/candidates/' + encodeURIComponent(candidate.id) + '/labels', {
              action: 'add',
              name: value
            });
            await load();
          } catch (error) {
            createLabelButton.disabled = false;
            window.alert(error.message);
          }
        };
        document.querySelectorAll('[data-remove-label]').forEach(function (button) {
          button.onclick = async function () {
            button.disabled = true;
            try {
              await postJson('/api/candidates/' + encodeURIComponent(candidate.id) + '/labels', {
                action: 'remove',
                labelId: button.dataset.removeLabel
              });
              await load();
            } catch (error) {
              button.disabled = false;
              window.alert(error.message);
            }
          };
        });
        if (addCommentButton) addCommentButton.onclick = async function () {
          var output = document.getElementById('commentResult');
          var value = document.getElementById('newCommentBody').value.trim();
          if (!value) return;
          addCommentButton.disabled = true;
          try {
            await postJson('/api/candidates/' + encodeURIComponent(candidate.id) + '/comments', { body: value });
            await load();
          } catch (error) {
            addCommentButton.disabled = false;
            output.textContent = error.message;
          }
        };
        document.querySelectorAll('[data-edit-comment]').forEach(function (button) {
          button.onclick = async function () {
            var comment = (candidate.adminComments || []).find(function (item) { return item.id === button.dataset.editComment; });
            var value = window.prompt(t('editComment'), comment ? comment.body : '');
            if (value == null || !value.trim()) return;
            await postJson('/api/comments/' + encodeURIComponent(button.dataset.editComment), {
              action: 'edit',
              body: value.trim()
            });
            await load();
          };
        });
        document.querySelectorAll('[data-delete-comment]').forEach(function (button) {
          button.onclick = async function () {
            if (!window.confirm(t('deleteAction') + '?')) return;
            await postJson('/api/comments/' + encodeURIComponent(button.dataset.deleteComment), { action: 'delete' });
            await load();
          };
        });
        document.querySelectorAll('[data-custom-action]').forEach(function (button) {
          button.onclick = async function () {
            var action = button.dataset.customAction;
            var body = { action: action };
            var item = customValues.find(function (value) { return value.id === button.dataset.customId; });
            if (action === 'rename') {
              var renamed = window.prompt(t('renameCustom'), item ? item.value : '');
              if (renamed == null || !renamed.trim()) return;
              body.value = renamed.trim();
            }
            if (action === 'merge') {
              var merged = window.prompt(t('mergeCustom'), '');
              if (merged == null || !merged.trim()) return;
              body.targetValue = merged.trim();
            }
            if (action === 'remove' && !window.confirm(t('deleteAction') + '?')) return;
            button.disabled = true;
            try {
              await postJson('/api/custom-values/' + encodeURIComponent(button.dataset.customId), body);
              await load();
            } catch (error) {
              button.disabled = false;
              window.alert(error.message);
            }
          };
        });
        if (confirmConsentButton) confirmConsentButton.onclick = async function () {
          confirmConsentButton.disabled = true;
          try {
            await postJson('/api/candidates/' + encodeURIComponent(candidate.id) + '/consent', {
              confirmation: confirmConsentButton.dataset.confirmation
            });
            await load();
          } catch (error) {
            confirmConsentButton.disabled = false;
            window.alert(error.message);
          }
        };
        if (ratingInput) ratingInput.oninput = function () {
          draftRatings[candidate.id] = Number(ratingInput.value);
          touchInteraction();
          document.getElementById('ratingValue').textContent = Number(ratingInput.value).toFixed(2);
          document.getElementById('ratingStars').textContent = starText(Number(ratingInput.value));
        };
        if (saveRatingButton) saveRatingButton.onclick = async function () {
          var output = document.getElementById('ratingResult');
          try {
            await saveRating(candidate.id, Number(document.getElementById('ratingInput').value));
            output.textContent = 'Сохранено';
          } catch (error) {
            output.textContent = error.message;
          }
        };
        if (approve) approve.onclick = async function () {
          try {
            if (reject) reject.disabled = true;
            await decide(candidate.id, 'approve', approve, async function () {
              var input = document.getElementById('ratingInput');
              if (input) {
                await postJson('/api/candidates/' + encodeURIComponent(candidate.id) + '/rating', {
                  rating: Number(input.value)
                });
              }
            });
          } catch (error) {
            window.alert(error.message);
          } finally {
            if (reject && reject.isConnected) reject.disabled = false;
          }
        };
        if (reject) reject.onclick = async function () {
          try {
            if (approve) approve.disabled = true;
            await decide(candidate.id, 'reject', reject);
          } catch (error) {
            window.alert(error.message);
          } finally {
            if (approve && approve.isConnected) approve.disabled = false;
          }
        };
        if (closeDetail) closeDetail.onclick = function () { selectedId = ''; editingProfileId = ''; renderApp(); };
        if (detailDrawer) detailDrawer.onclick = function (event) {
          if (event.target === detailDrawer) {
            selectedId = '';
            editingProfileId = '';
            renderApp();
          }
        };
        if (openProfile) openProfile.onclick = function () { window.open('/candidate-profile/' + encodeURIComponent(candidate.id), '_blank', 'noopener'); };
        var sendSingle = document.getElementById('sendSingle');
        var singleText = document.getElementById('singleText');
        if (singleText) singleText.oninput = function () {
          draftMessages[candidate.id] = singleText.value;
          deliveryOperations.candidates[candidate.id] = '';
          touchInteraction();
        };
        if (sendSingle) sendSingle.onclick = async function () {
          var output = document.getElementById('singleResult');
          try {
            await runMutation('candidate-message:' + candidate.id, sendSingle, t('sending'), async function () {
              var value = singleText.value.trim();
              deliveryOperations.candidates[candidate.id] = deliveryOperations.candidates[candidate.id] || newOperationId('candidate');
              await postJson('/api/candidates/' + encodeURIComponent(candidate.id) + '/message', {
                operationId: deliveryOperations.candidates[candidate.id],
                text: value
              });
              delete draftMessages[candidate.id];
              delete deliveryOperations.candidates[candidate.id];
              singleText.value = '';
              output.textContent = 'Отправлено';
            });
          } catch (error) {
            output.textContent = error.message;
          }
        };
      }
	      function bindMessagingPanel() {
        var selectAllRecipients = document.getElementById('selectAllRecipients');
        var clearSelected = document.getElementById('clearSelected');
        var sendBulk = document.getElementById('sendBulk');
        var sendCasting = document.getElementById('sendCasting');
        document.querySelectorAll('[data-recipient]').forEach(function (checkbox) {
          checkbox.onclick = function () {
            selectionMode = 'manual';
            deliveryOperations.bulk = '';
            deliveryOperations.casting = '';
            if (checkbox.checked && !selectedIds.includes(checkbox.dataset.recipient)) selectedIds.push(checkbox.dataset.recipient);
            if (!checkbox.checked) selectedIds = selectedIds.filter(function (id) { return id !== checkbox.dataset.recipient; });
            renderApp();
          };
        });
        ['bulkText', 'castingTitle', 'castingBody', 'castingStart', 'castingEnd'].forEach(function (id) {
          var input = document.getElementById(id);
          if (!input) return;
          input.oninput = input.onchange = function () {
            postDraft[id] = input.value;
            if (id === 'bulkText') deliveryOperations.bulk = '';
            else deliveryOperations.casting = '';
            touchInteraction();
          };
        });
        if (selectAllRecipients) selectAllRecipients.onclick = function () { selectionMode = 'manual'; selectedIds = filtered.map(function (candidate) { return candidate.id; }); deliveryOperations.bulk = ''; deliveryOperations.casting = ''; renderApp(); };
        if (clearSelected) clearSelected.onclick = function () { selectionMode = 'manual'; selectedIds = []; deliveryOperations.bulk = ''; deliveryOperations.casting = ''; renderApp(); };
        if (sendBulk) sendBulk.onclick = async function () {
          var output = document.getElementById('bulkResult');
          try {
            await runMutation('bulk-message', sendBulk, t('sending'), async function () {
              var value = document.getElementById('bulkText').value.trim();
              if (!selectedRecipientIds().length) throw new Error('Выберите хотя бы одного получателя');
              deliveryOperations.bulk = deliveryOperations.bulk || newOperationId('broadcast');
              var result = await postJson('/api/admin/broadcast', {
                candidateIds: selectedIds,
                operationId: deliveryOperations.bulk,
                text: value
              });
              postDraft.bulkText = '';
              deliveryOperations.bulk = '';
              document.getElementById('bulkText').value = '';
              output.textContent = 'Отправлено: ' + result.sentCount + ', ошибок: ' + result.failed.length;
            });
          } catch (error) {
            output.textContent = error.message;
          }
        };
        if (sendCasting) sendCasting.onclick = async function () {
          var output = document.getElementById('castingResult');
          sendCasting.disabled = true;
          try {
            if (!selectedRecipientIds().length) throw new Error('Выберите хотя бы одного получателя');
            deliveryOperations.casting = deliveryOperations.casting || newOperationId('casting');
            var result = await postJson('/api/castings', {
              body: document.getElementById('castingBody').value.trim(),
              candidateIds: selectedIds,
              endsAt: document.getElementById('castingEnd').value,
              operationId: deliveryOperations.casting,
              sendNow: true,
              startsAt: document.getElementById('castingStart').value,
              title: document.getElementById('castingTitle').value.trim()
            });
            postDraft.castingTitle = '';
            postDraft.castingBody = '';
            postDraft.castingStart = '';
            postDraft.castingEnd = '';
            deliveryOperations.casting = '';
            document.getElementById('castingTitle').value = '';
            document.getElementById('castingBody').value = '';
            document.getElementById('castingStart').value = '';
            document.getElementById('castingEnd').value = '';
            output.textContent = result.casting.id + ' создан. Отправлено: ' + result.delivery.sent.length;
          } catch (error) {
            output.textContent = error.message;
          } finally {
            sendCasting.disabled = false;
          }
	        };
	      }
	      async function loadCastingWorkspace(castingId) {
	        castingWorkspace = null;
	        try {
	          castingWorkspace = await api('/api/castings/' + encodeURIComponent(castingId) + '/workspace');
	        } catch (error) {
	          if (error.status !== 404 && error.status !== 501) throw error;
	        }
	        renderApp();
	      }
	      function captureCastingDraft() {
	        [['castingTitle','title'],['castingBody','body'],['castingStart','startsAt'],['castingEnd','endsAt']].forEach(function (item) {
	          var input = document.getElementById(item[0]);
	          if (input) castingDraft[item[1]] = input.value;
	        });
	      }
	      async function submitCastingForm(status) {
	        captureCastingDraft();
	        var output = document.getElementById('castingResult');
	        try {
	          var path = selectedCastingId ? '/api/castings/' + encodeURIComponent(selectedCastingId) + '/manage' : '/api/castings';
	          var payload = Object.assign({ operationId: newOperationId('casting'), sendNow: false, status: 'draft' }, castingDraft);
	          if (selectedCastingId) payload.action = 'edit';
	          var result = await postJson(path, payload);
	          selectedCastingId = (result.casting || result).id;
	          if (status === 'published') {
	            result = await postJson('/api/castings/' + encodeURIComponent(selectedCastingId) + '/manage', {
	              action: 'publish',
	              audiences: ['channel', 'eligible_bot_users'],
	              language: lang,
	              operationId: newOperationId('casting-publish')
	            });
	            castingNotice = castingDeliveryNotice(result.delivery);
	          }
	          castingDraft = { title: '', body: '', startsAt: '', endsAt: '' };
	          castingView = 'detail';
	          await load({ refreshCastings: true });
	          await loadCastingWorkspace(selectedCastingId);
	        } catch (error) {
	          output.textContent = error.message;
	        }
	      }
	      function bindCastingsPage() {
	        if (selectedId) bindTableAndDetail();
	        var newButton = document.getElementById('newCasting');
	        if (newButton) newButton.onclick = function () { selectedCastingId = ''; castingNotice = ''; castingDraft = { title: '', body: '', startsAt: '', endsAt: '' }; castingView = 'form'; renderApp(); };
	        document.querySelectorAll('[data-open-casting]').forEach(function (button) {
	          button.onclick = function () {
	            selectedCastingId = button.dataset.openCasting; castingNotice = ''; castingView = 'detail'; castingTab = 'applications'; castingSelection = []; renderApp();
	            loadCastingWorkspace(selectedCastingId).catch(function (error) { window.alert(error.message); });
	          };
	        });
	        var back = document.getElementById('backToCastings');
	        if (back) back.onclick = function () { castingView = 'list'; selectedCastingId = ''; castingWorkspace = null; castingNotice = ''; selectedId = ''; renderApp(); };
	        var edit = document.getElementById('editCasting');
	        if (edit) edit.onclick = function () {
	          var casting = castings.find(function (item) { return item.id === selectedCastingId; });
	          castingDraft = { title: casting.title || '', body: casting.body || '', startsAt: String(casting.startsAt || '').slice(0,16), endsAt: String(casting.endsAt || '').slice(0,16) };
	          castingView = 'form'; renderApp();
	        };
	        var save = document.getElementById('saveCastingDraft');
	        if (save) save.onclick = function () {
	          runMutation('casting-form', save, t('saving'), function () {
	            return submitCastingForm('draft');
	          });
	        };
	        var publish = document.getElementById('publishCastingForm');
	        if (publish) publish.onclick = function () {
	          runMutation('casting-form', publish, t('sending'), function () {
	            return submitCastingForm('published');
	          });
	        };
	        document.querySelectorAll('[data-casting-manage]').forEach(function (button) {
	          button.onclick = async function () {
	            try {
	              await runMutation('casting-manage:' + selectedCastingId, button, t('saving'), async function () {
	                var payload = { action: button.dataset.castingManage, operationId: newOperationId('casting-manage') };
	                if (payload.action === 'publish') {
	                  payload.audiences = ['channel', 'eligible_bot_users'];
	                  payload.language = lang;
	                }
	                var result = await postJson('/api/castings/' + encodeURIComponent(selectedCastingId) + '/manage', payload);
	                castingNotice = payload.action === 'publish' ? castingDeliveryNotice(result.delivery) : castingStatusLabel(result.casting || { status: payload.action === 'close' ? 'closed' : 'cancelled' });
	                await load({ refreshCastings: true });
	              });
	            }
	            catch (error) { window.alert(error.message); }
	          };
	        });
	        document.querySelectorAll('[data-casting-tab]').forEach(function (button) { button.onclick = function () { castingTab = button.dataset.castingTab; castingSelection = []; selectedId = ''; renderApp(); }; });
	        document.querySelectorAll('[data-invitation-view]').forEach(function (button) { button.onclick = function () { invitationView = button.dataset.invitationView; castingSelection = []; renderApp(); }; });
	        [['castingSearch','q'],['castingCity','city'],['castingGender','gender']].forEach(function (item) {
	          var input = document.getElementById(item[0]);
	          if (input) input.oninput = input.onchange = function () { castingFilters[item[1]] = input.value; renderApp(); };
	        });
	        document.querySelectorAll('[data-casting-select]').forEach(function (input) {
	          input.onchange = function () {
	            if (input.checked && !castingSelection.includes(input.dataset.castingSelect)) castingSelection.push(input.dataset.castingSelect);
	            if (!input.checked) castingSelection = castingSelection.filter(function (id) { return id !== input.dataset.castingSelect; });
	          };
	        });
	        document.querySelectorAll('[data-casting-candidate]').forEach(function (button) { button.onclick = function () { selectedId = button.dataset.castingCandidate; renderApp(); }; });
	        document.querySelectorAll('[data-casting-participant-remove]').forEach(function (button) {
	          button.onclick = async function () {
	            button.disabled = true;
	            try {
	              await api('/api/castings/' + encodeURIComponent(selectedCastingId) + '/participants/' + encodeURIComponent(button.dataset.castingParticipantRemove), { method: 'DELETE' });
	              castingNotice = t('participantRemoved');
	              castingSelection = [];
	              selectedId = '';
	              await load({ refreshCastings: true });
	              await loadCastingWorkspace(selectedCastingId);
	            } catch (error) {
	              castingNotice = error.message;
	              renderApp();
	            }
	          };
	        });
	        document.querySelectorAll('[data-casting-invitation-cancel]').forEach(function (button) {
	          button.onclick = async function () {
	            button.disabled = true;
	            try {
	              await api('/api/castings/' + encodeURIComponent(selectedCastingId) + '/invitations/' + encodeURIComponent(button.dataset.castingInvitationCancel) + '/cancel', { method: 'POST' });
	              castingNotice = t('invitationCancelled');
	              castingSelection = [];
	              selectedId = '';
	              await load({ refreshCastings: true });
	              await loadCastingWorkspace(selectedCastingId);
	            } catch (error) {
	              castingNotice = error.message;
	              renderApp();
	            }
	          };
	        });
	        var close = document.getElementById('closeCastingDrawer');
	        if (close) close.onclick = function () { selectedId = ''; renderApp(); };
	        var openProfile = document.getElementById('openCastingProfile');
	        if (openProfile) openProfile.onclick = function () { window.open('/candidate-profile/' + encodeURIComponent(selectedId), '_blank', 'noopener'); };
	        document.querySelectorAll('[data-casting-decision]').forEach(function (button) {
	          button.onclick = async function () {
	            var output = document.getElementById('castingDecisionResult'); button.disabled = true;
	            try {
	              await postJson('/api/castings/' + encodeURIComponent(selectedCastingId) + '/decisions', { candidateId: selectedId, castingDecision: button.dataset.castingDecision, profileDecision: document.getElementById('castingProfileDecision').value, operationId: newOperationId('casting-decision') });
	              selectedId = ''; await loadCastingWorkspace(selectedCastingId);
	            } catch (error) { output.textContent = error.message; button.disabled = false; }
	          };
	        });
	        document.querySelectorAll('[data-profile-only]').forEach(function (button) {
	          button.onclick = async function () {
	            var output = document.getElementById('castingDecisionResult'); button.disabled = true;
	            try { await api('/api/candidates/' + encodeURIComponent(selectedId) + '/' + button.dataset.profileOnly, { method: 'POST' }); output.textContent = t(button.dataset.profileOnly === 'approve' ? 'approveProfile' : 'rejectProfile') + ' ✓'; await loadCastingWorkspace(selectedCastingId); }
	            catch (error) { output.textContent = error.message; button.disabled = false; }
	          };
	        });
	        var invite = document.getElementById('inviteCastingSelected');
	        if (invite) invite.onclick = async function () {
	          invite.disabled = true;
	          try { await postJson('/api/castings/' + encodeURIComponent(selectedCastingId) + '/invitations', { candidateIds: castingSelection, operationId: newOperationId('casting-invite') }); castingSelection = []; await loadCastingWorkspace(selectedCastingId); }
	          catch (error) { document.getElementById('castingBulkResult').textContent = error.message; invite.disabled = false; }
	        };
	        function bindCastingMessage(buttonId, textareaId, resultId, ids) {
	          var button = document.getElementById(buttonId);
	          if (!button) return;
	          button.onclick = async function () {
	            button.disabled = true;
	            try { await postJson('/api/castings/' + encodeURIComponent(selectedCastingId) + '/messages', { audience: castingTab, candidateIds: ids(), operationId: newOperationId('casting-message'), text: document.getElementById(textareaId).value.trim() }); document.getElementById(resultId).textContent = t('send') + ' ✓'; }
	            catch (error) { document.getElementById(resultId).textContent = error.message; }
	            finally { button.disabled = false; }
	          };
	        }
	        bindCastingMessage('messageCastingSelected', 'castingBulkMessage', 'castingBulkResult', function () { return castingSelection; });
	        bindCastingMessage('sendCastingSingle', 'castingSingleMessage', 'castingSingleResult', function () { return [selectedId]; });
	      }
	      function bindNavigation() {
        document.querySelectorAll('[data-page]').forEach(function (button) {
          button.onclick = function () {
            activePage = button.dataset.page;
            selectedId = '';
            editingProfileId = '';
            selectionMode = 'auto';
            applyFilters();
            renderApp();
            load({ refreshCastings: activePage === 'castings' });
          };
        });
      }
      function bindQueryControls() {
        var retry = document.getElementById('retryQuery');
        if (retry) retry.onclick = function () {
          load({ refreshCastings: activePage === 'castings' });
        };
        var moreCandidates = document.getElementById('loadMoreCandidates');
        if (moreCandidates) moreCandidates.onclick = function () {
          load({ append: true, refreshCastings: false });
        };
        var moreCastings = document.getElementById('loadMoreCastings');
        if (moreCastings) moreCastings.onclick = loadMoreCastings;
      }
      function renderApp() {
        if (!authenticated) return renderLogin();
        var focusedElement = document.activeElement;
        var focusState = focusedElement && focusedElement.id ? {
          end: focusedElement.selectionEnd,
          id: focusedElement.id,
          start: focusedElement.selectionStart
        } : null;
        captureDrafts();
        document.body.style.overflow = selectedId ? 'hidden' : '';
	        var isPosts = activePage === 'posts';
	        var isPending = activePage === 'pending';
	        var isCandidates = activePage === 'candidates';
	        var isCastings = activePage === 'castings';
	        var pageTitle = isCastings ? t('castingsPage') : isPosts ? t('postsPage') : isPending ? t('pendingPage') : t('candidatesPage');
	        var body = isCastings
	          ? renderCastingsPage()
	          : isPosts
	          ? renderPostsPage()
	          : (isCandidates ? renderFilters() : renderApplicationLabelFilter()) + '<section class="layout">' + renderTable() + renderDetail() + '</section>';
        var exportAction = isCandidates ? '<button class="secondary" id="export">' + t('export') + '</button>' : '';
        var langBtns = ['ru','uz','en'].map(function(l) { return '<button type="button" class="langBtn' + (lang === l ? ' active' : '') + '" data-lang="' + l + '">' + l.toUpperCase() + '</button>'; }).join('');
	        root.innerHTML = '<main class="app"><aside class="sidebar"><div class="brand">' + (logoDataUri ? '<img class="logoMark" src="' + logoDataUri + '" alt="FACE Production">' : '<div class="mark">FP</div>') + '<div><strong>FACE Production</strong><p class="muted">' + t('brand') + '</p></div></div><button class="nav ' + (isPending ? 'active' : '') + '" data-page="pending">' + t('pendingPage') + '</button><button class="nav ' + (isCandidates ? 'active' : '') + '" data-page="candidates">' + t('candidatesPage') + '</button><button class="nav ' + (isCastings ? 'active' : '') + '" data-page="castings">' + t('castingsPage') + '</button><button class="nav ' + (isPosts ? 'active' : '') + '" data-page="posts">' + t('postsPage') + '</button><div class="langRow">' + langBtns + '</div></aside><section class="workspace" aria-busy="' + (queryBusy ? 'true' : 'false') + '"><header class="topbar"><div><p class="muted">' + t('title') + '</p><h2>' + pageTitle + '</h2></div><div class="actions"><button class="secondary" id="refresh">' + t('refresh') + '</button>' + exportAction + '<button class="secondary" id="logout">' + t('logout') + '</button></div></header>' + renderQueryActivity() + body + '</section></main>';
        bindNavigation();
	        if (isCastings) {
	          bindCastingsPage();
	        } else if (isPosts) {
          bindMessagingPanel();
        } else {
          if (isCandidates || (isPending && labels.length)) bindFilters();
          bindTableAndDetail();
        }
        bindQueryControls();
        document.getElementById('refresh').onclick = function () {
          load({ refreshCastings: activePage === 'castings' });
        };
        var exportButton = document.getElementById('export');
        if (exportButton) exportButton.onclick = function () { window.location.href = '/api/candidates/export.csv'; };
        document.getElementById('logout').onclick = async function () {
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
          authenticated = false;
          renderLogin();
        };
        document.querySelectorAll('[data-lang]').forEach(function(btn) {
          btn.onclick = function() { lang = btn.dataset.lang; localStorage.setItem('face-admin-lang', lang); renderApp(); };
        });
        if (focusState) {
          var focusTarget = document.getElementById(focusState.id);
          if (focusTarget && !focusTarget.disabled) {
            focusTarget.focus();
            if (
              typeof focusTarget.setSelectionRange === 'function'
              && Number.isInteger(focusState.start)
              && Number.isInteger(focusState.end)
            ) {
              focusTarget.setSelectionRange(focusState.start, focusState.end);
            }
          }
        }
      }
      load();
	      setInterval(function () {
	        if (authenticated && activePage !== 'posts' && activePage !== 'castings' && !hasActiveEditor() && !selectedId && !queryBusy) {
	          load({ refreshCastings: false });
	        }
	      }, 30000);
    })();
  </script>
</body>
</html>`
}

function mediaContentType(kind, candidate) {
  if (kind === 'introVideo') {
    const path = String(candidate?.introVideoPath ?? '').toLowerCase()

    if (path.endsWith('.mov')) {
      return 'video/quicktime'
    }

    if (path.endsWith('.webm')) {
      return 'video/webm'
    }

    if (path.endsWith('.m4v')) {
      return 'video/x-m4v'
    }

    return 'video/mp4'
  }

  return 'image/jpeg'
}

let cachedCandidateAdminHtml

function getCachedCandidateAdminHtml() {
  cachedCandidateAdminHtml ??= candidateAdminHtml()
  return cachedCandidateAdminHtml
}

function eligibleMessagingCandidates(candidates, candidateIds) {
  if (Array.isArray(candidateIds) && candidateIds.length === 0) {
    return []
  }

  const requestedIds = new Set((candidateIds ?? []).map(String))

  return candidates.filter((candidate) => {
    if (requestedIds.size && !requestedIds.has(candidate.id)) {
      return false
    }

    return isCandidateEligibleForMessaging(candidate)
  })
}

function requireOperationId(value) {
  const operationId = String(value ?? '').trim()

  if (!operationId || operationId.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(operationId)) {
    const error = new Error('A valid operationId is required')
    error.statusCode = 400
    throw error
  }

  return operationId
}

async function sendCandidateMessages(candidates, message, action, operationId, messageOptions = {}) {
  const sent = []
  const failed = []
  const recipients = new Map()

  for (const candidate of candidates) {
    const chatId = candidateMessagingChatId(candidate)
    if (chatId && !recipients.has(String(chatId))) {
      recipients.set(String(chatId), candidate)
    }
  }

  for (const [chatId, candidate] of recipients) {
    let claim

    try {
      claim = await claimTelegramDelivery({
        chatId,
        data: { action, candidateId: candidate.id },
        kind: action,
        operationId,
        recipientKey: chatId,
      })

      if (!claim.claimed) {
        if (claim.status === 'sent') {
          sent.push({
            candidateId: candidate.id,
            deduplicated: true,
            messageId: claim.messageId,
          })
        } else {
          failed.push({
            candidateId: candidate.id,
            error: 'Previous delivery outcome is uncertain; message was not sent again.',
            status: claim.status,
          })
        }
        continue
      }

      const recipientMessage = typeof message === 'function' ? message(candidate) : message
      const recipientOptions = typeof messageOptions === 'function'
        ? messageOptions(candidate)
        : messageOptions
      const result = await telegramProvider.sendMessage(chatId, recipientMessage, recipientOptions)
      await completeTelegramDelivery(claim, result.message_id)
      sent.push({ candidateId: candidate.id, messageId: result.message_id })
      await recordAuditEvent({
        action,
        actor: 'web_admin',
        candidateId: candidate.id,
        messageId: result.message_id,
        outcome: 'sent',
      })
    } catch (error) {
      if (claim?.claimed) {
        try {
          await failTelegramDelivery(claim, error)
        } catch (ledgerError) {
          console.error('Telegram delivery ledger update failed', {
            code: ledgerError?.code ?? ledgerError?.name ?? 'unknown',
          })
        }
      }
      failed.push({ candidateId: candidate.id, error: error.message })
      await recordAuditEvent({
        action,
        actor: 'web_admin',
        candidateId: candidate.id,
        error: error.message,
        outcome: 'failed',
      })
    }
  }

  return { failed, sent }
}

async function syncTelegramAdminDecision(candidate, nextStatus, source) {
  if (!candidate?.adminDecisionChatId || !candidate?.adminDecisionMessageId) {
    return
  }

  const resultText =
    nextStatus === 'approved'
      ? 'Кандидат одобрен.'
      : 'Кандидат отклонен.'
  const icon = nextStatus === 'approved' ? '✅' : '🚫'
  const sourceText = source === 'web_admin' ? 'Портал администратора' : 'Telegram admin'
  const baseText = candidate.adminDecisionMessageText ?? `ID: ${candidate.id}`

  try {
    await telegramProvider.call('editMessageText', {
      chat_id: candidate.adminDecisionChatId,
      disable_web_page_preview: true,
      message_id: candidate.adminDecisionMessageId,
      reply_markup: { inline_keyboard: [] },
      text: `${baseText}\n\n${icon} ${resultText}\nИсточник: ${sourceText}`,
    })
  } catch (error) {
    await recordAuditEvent({
      action: 'telegram_admin.sync_failed',
      actor: source,
      candidateId: candidate.id,
      error: error.message,
      outcome: 'failed',
    })
  }
}

async function candidateAdminPage(requestBody, admin, response) {
  const body = requestBody && typeof requestBody === 'object' && !Array.isArray(requestBody)
    ? requestBody
    : {}
  const filters = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)
    ? body.filters
    : {}
  const localLabelCandidateIds = await localCandidateIdsForLabels(filters.labels)
  const resolvedFilters = localLabelCandidateIds
    ? { ...filters, labelCandidateIds: localLabelCandidateIds }
    : filters
  const [page, initialCustomValues, labels, facets] = await withResponseTiming(
    response,
    'candidate_query',
    () => Promise.all([
      listCandidatePage({
        filters: resolvedFilters,
        limit: body.limit,
        offset: body.offset,
        scope: body.scope,
      }),
      listCustomTaxonomyValues(),
      listProfileLabels(),
      listCandidateFilterFacets(),
    ]),
  )
  const candidates = await withResponseTiming(
    response,
    'profile_enrichment',
    () => enrichCandidatesForAdmin(page.items, admin, labels),
  )

  return {
    admin: {
      id: admin.id,
      name: admin.name,
      role: admin.role,
    },
    candidates,
    customValues: initialCustomValues,
    facets,
    labels,
    pageInfo: page.pageInfo,
  }
}

export async function routeRequest(request, response) {
  startResponseTiming(response)

  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {})
    return
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, {
      ok: true,
      ...getConfigStatus(),
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readJson(request)
    const headerToken = request.headers['x-face-admin-token']
    const token = Array.isArray(headerToken) ? headerToken[0] : headerToken

    if (!authenticateAdminWebToken(token || body.token)) {
      sendJson(response, 403, { error: 'Admin web authorization failed' })
      return
    }

    setAdminSession(response)
    sendJson(response, 200, {
      admin: {
        id: config.adminWebId,
        name: config.adminWebName,
        role: 'superadmin',
      },
      ok: true,
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    clearAdminSession(response)
    sendJson(response, 200, { ok: true })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/candidates') {
    const admin = requireAdminWebToken(request)
    sendJson(response, 200, await candidateAdminPage({}, admin, response))
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/candidates/query') {
    const admin = requireAdminWebToken(request)
    const body = await readJson(request)
    sendJson(response, 200, await candidateAdminPage(body, admin, response))
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/candidates/export.csv') {
    requireAdminWebToken(request)
    sendCsv(response, 'face-candidates.csv', candidatesToCsv(await listCandidates()))
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/profile-labels') {
    const admin = requireAdminWebToken(request)
    const body = await readJson(request)
    const label = await createProfileLabel(body, admin)

    await recordAuditEvent({
      action: 'web_admin.label_created',
      ...adminAuditFields(admin),
      labelId: label.id,
      labelName: label.name,
      outcome: 'created',
    })

    sendJson(response, 201, { label, ok: true })
    return
  }

  const profileLabelAction = url.pathname.match(/^\/api\/profile-labels\/([^/]+)$/)

  if (request.method === 'POST' && profileLabelAction) {
    const admin = requireAdminWebToken(request)
    const [, labelId] = profileLabelAction
    const body = await readJson(request)
    const beforeLabel = (await listProfileLabels()).find((item) => item.id === labelId)
    let label

    if (body.action === 'rename') {
      label = await renameProfileLabel(labelId, body.name, admin)
    } else if (body.action === 'delete') {
      label = await deleteProfileLabel(labelId, admin)
    } else {
      sendJson(response, 400, { error: 'Label action must be rename or delete' })
      return
    }

    if (!label) {
      sendJson(response, 404, { error: 'Label not found' })
      return
    }

    await recordAuditEvent({
      action: `web_admin.label_${body.action === 'rename' ? 'renamed' : 'deleted'}`,
      ...adminAuditFields(admin),
      labelId,
      labelName: label.name,
      nameAfter: body.action === 'rename' ? label.name : null,
      nameBefore: beforeLabel?.name,
      outcome: 'updated',
    })

    sendJson(response, 200, { label, ok: true })
    return
  }

  const customValueAction = url.pathname.match(/^\/api\/custom-values\/([^/]+)$/)

  if (request.method === 'POST' && customValueAction) {
    const admin = requireAdminWebToken(request)
    const [, customValueId] = customValueAction
    const body = await readJson(request)
    const beforeCustomValue = (await listCustomTaxonomyValues()).find((item) => item.id === customValueId)
    const customValue = await moderateCustomTaxonomyValue(
      customValueId,
      String(body.action ?? ''),
      body,
      admin,
    )

    if (!customValue) {
      sendJson(response, 404, { error: 'Custom value not found' })
      return
    }

    await recordAuditEvent({
      action: `web_admin.custom_value_${body.action}`,
      ...adminAuditFields(admin),
      affectedCandidateCount: customValue.affectedCount ?? 0,
      before: beforeCustomValue,
      customValueId,
      after: customValue,
      field: customValue.field,
      mergedIntoValue: customValue.mergedIntoValue,
      outcome: 'updated',
      value: customValue.value,
    })

    sendJson(response, 200, { customValue, ok: true })
    return
  }

  const candidateProfileEdit = url.pathname.match(/^\/api\/candidates\/([^/]+)\/profile$/)

  if (request.method === 'POST' && candidateProfileEdit) {
    const admin = requireAdminWebToken(request)
    const [, candidateId] = candidateProfileEdit
    const existing = await findCandidate(candidateId)

    if (!existing) {
      sendJson(response, 404, { error: 'Candidate not found' })
      return
    }

    const patch = sanitizeCandidateProfilePatch(await readJson(request))
    const changes = profileChanges(existing, patch)

    if (!Object.keys(changes).length) {
      sendJson(response, 200, { candidate: existing, changes: {}, ok: true })
      return
    }

    const candidate = await updateCandidateMetadata(candidateId, patch)
    await registerCandidateCustomValues([candidate], admin)
    await recordAuditEvent({
      action: 'web_admin.profile_updated',
      ...adminAuditFields(admin),
      candidateId,
      changes,
      outcome: 'updated',
      statusAfterEdit: candidate.status,
    })

    sendJson(response, 200, { candidate, changes, ok: true })
    return
  }

  const candidateLabels = url.pathname.match(/^\/api\/candidates\/([^/]+)\/labels$/)

  if (request.method === 'POST' && candidateLabels) {
    const admin = requireAdminWebToken(request)
    const [, candidateId] = candidateLabels
    const body = await readJson(request)
    const candidate = await findCandidate(candidateId)

    if (!candidate) {
      sendJson(response, 404, { error: 'Candidate not found' })
      return
    }

    let labelId = String(body.labelId ?? '')
    let result
    let label

    if (body.action === 'add') {
      label = labelId
        ? (await listProfileLabels()).find((item) => item.id === labelId)
        : await createProfileLabel({ name: body.name }, admin)

      if (!label) {
        sendJson(response, 404, { error: 'Label not found' })
        return
      }
      labelId = label.id
      result = await assignCandidateLabel(candidateId, labelId, admin)
    } else if (body.action === 'remove') {
      result = await removeCandidateLabel(candidateId, labelId)
    } else {
      sendJson(response, 400, { error: 'Label action must be add or remove' })
      return
    }

    if (!result) {
      sendJson(response, 404, { error: 'Candidate label assignment not found' })
      return
    }

    await recordAuditEvent({
      action: `web_admin.candidate_label_${body.action === 'add' ? 'added' : 'removed'}`,
      ...adminAuditFields(admin),
      candidateId,
      labelId,
      labelName: label?.name,
      outcome: 'updated',
    })

    sendJson(response, 200, { label, ok: true })
    return
  }

  const candidateComments = url.pathname.match(/^\/api\/candidates\/([^/]+)\/comments$/)

  if (request.method === 'POST' && candidateComments) {
    const admin = requireAdminWebToken(request)
    const [, candidateId] = candidateComments
    const candidate = await findCandidate(candidateId)

    if (!candidate) {
      sendJson(response, 404, { error: 'Candidate not found' })
      return
    }

    const body = await readJson(request)
    const comment = await createCandidateComment(candidateId, body.body, admin)
    await recordAuditEvent({
      action: 'web_admin.comment_created',
      ...adminAuditFields(admin),
      candidateId,
      commentId: comment.id,
      outcome: 'created',
    })
    sendJson(response, 201, { comment, ok: true })
    return
  }

  const candidateCommentAction = url.pathname.match(/^\/api\/comments\/([^/]+)$/)

  if (request.method === 'POST' && candidateCommentAction) {
    const admin = requireAdminWebToken(request)
    const [, commentId] = candidateCommentAction
    const body = await readJson(request)
    let comment

    if (body.action === 'edit') {
      comment = await updateCandidateComment(commentId, body.body, admin)
    } else if (body.action === 'delete') {
      comment = await deleteCandidateComment(commentId, admin)
    } else {
      sendJson(response, 400, { error: 'Comment action must be edit or delete' })
      return
    }

    if (!comment) {
      sendJson(response, 404, { error: 'Comment not found' })
      return
    }

    const { previousBody, ...publicComment } = comment
    await recordAuditEvent({
      action: `web_admin.comment_${body.action === 'edit' ? 'edited' : 'deleted'}`,
      ...adminAuditFields(admin),
      after: body.action === 'edit' ? comment.body : null,
      before: body.action === 'edit' ? previousBody : comment.body,
      candidateId: comment.candidateId,
      commentId,
      outcome: 'updated',
    })
    sendJson(response, 200, { comment: publicComment, ok: true })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/telegram/me') {
    const bot = await telegramProvider.getMe()
    sendJson(response, 200, {
      bot: {
        canJoinGroups: bot.can_join_groups,
        firstName: bot.first_name,
        id: bot.id,
        username: bot.username,
      },
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/telegram/webhook') {
    if (!config.telegramWebhookSecret) {
      sendJson(response, 503, { error: 'Telegram webhook is not configured' })
      return
    }

    if (!hasValidTelegramWebhookSecret(request)) {
      sendJson(response, 403, { error: 'Telegram webhook authorization failed' })
      return
    }

    const update = await readJson(request)
    const claim = await claimTelegramUpdate(update?.update_id)

    if (!claim.claimed) {
      if (claim.status === 'completed') {
        sendJson(response, 200, { deduplicated: true, ok: true })
        return
      }

      response.setHeader('retry-after', '2')
      sendJson(response, 503, { error: 'Telegram update is already being processed' })
      return
    }

    try {
      const telegramUserId = update?.callback_query?.from?.id ?? update?.message?.from?.id
      const result = await withTelegramUserLock(
        telegramUserId,
        () => handleBotUpdate(update),
      )
      await completeTelegramUpdate(claim.updateId)
      sendJson(response, 200, { ok: true, result })
    } catch (error) {
      try {
        await releaseTelegramUpdate(claim.updateId, error)
      } catch (releaseError) {
        console.error('Telegram update release failed', { code: releaseError?.code ?? releaseError?.name ?? 'unknown' })
      }

      console.error('Telegram webhook processing failed', { code: error?.code ?? error?.name ?? 'unknown' })
      sendJson(response, 500, { error: 'Telegram update processing failed' })
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/notify') {
    requireAdminWebToken(request)
    const body = await readJson(request)

    const message = String(body.text ?? '').trim()

    if (!message) {
      sendJson(response, 400, { error: 'Message text is required' })
      return
    }

    const result = await telegramProvider.sendMessage(config.adminId, message)

    await recordAuditEvent({
      action: 'admin.notify',
      actor: 'web_admin',
      chatId: config.adminId,
      outcome: 'sent',
    })

    sendJson(response, 200, { ok: true, messageId: result.message_id })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/broadcast-dry-run') {
    requireAdminWebToken(request)
    const body = await readJson(request)

    const dryRun = await getBroadcastDryRun()

    await recordAuditEvent({
      action: 'admin.broadcast_dry_run',
      actor: 'web_admin',
      note: body.note ?? '',
      blockedCount: dryRun.blocked.length,
      eligibleCount: dryRun.eligible.length,
      outcome: 'evaluated',
    })

    sendJson(response, 200, {
      ok: true,
      dryRun,
      message: 'No Telegram messages were sent.',
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/broadcast') {
    requireAdminWebToken(request)
    const body = await readJson(request)
    const message = String(body.text ?? '').trim()
    const operationId = requireOperationId(body.operationId)
    const targetCandidateIds = Array.isArray(body.candidateIds)
      ? body.candidateIds.map(String).filter(Boolean)
      : []

    if (!message) {
      sendJson(response, 400, { error: 'Message text is required' })
      return
    }

    if (targetCandidateIds.length === 0) {
      sendJson(response, 400, { error: 'Select at least one candidate before sending a post' })
      return
    }

    const candidates = eligibleMessagingCandidates(await listCandidates(), targetCandidateIds)
    const result = await sendCandidateMessages(
      candidates,
      message,
      'web_admin.bulk_message',
      operationId,
    )

    sendJson(response, 200, {
      ...result,
      ok: true,
      requestedCount: targetCandidateIds.length,
      sentCount: result.sent.length,
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/castings') {
    requireAdminWebToken(request)
    const limit = url.searchParams.get('limit')
    const offset = url.searchParams.get('offset')
    const page = await withResponseTiming(response, 'casting_query', () => listCastingPageWithCounts({
      limit: limit == null ? undefined : Number(limit),
      offset: offset == null ? undefined : Number(offset),
    }))
    sendJson(response, 200, page)
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/castings') {
    const admin = requireAdminWebToken(request)
    const body = await readJson(request)
    const title = String(body.title ?? '').trim()
    const castingBody = String(body.body ?? '').trim()
    const operationId = requireOperationId(body.operationId)
    const startsAt = String(body.startsAt ?? '').trim()
    const endsAt = String(body.endsAt ?? '').trim()

    if (!title || !castingBody) {
      sendJson(response, 400, { error: 'Casting title and body are required' })
      return
    }

    if (startsAt && Number.isNaN(Date.parse(startsAt))) {
      sendJson(response, 400, { error: 'Casting start date is invalid' })
      return
    }

    if (endsAt && Number.isNaN(Date.parse(endsAt))) {
      sendJson(response, 400, { error: 'Casting end date is invalid' })
      return
    }

    if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
      sendJson(response, 400, { error: 'Casting end date must be after start date' })
      return
    }

    const targetCandidateIds = Array.isArray(body.candidateIds)
      ? body.candidateIds.map(String)
      : []

    if (body.sendNow !== false && targetCandidateIds.length === 0) {
      sendJson(response, 400, { error: 'Select at least one candidate before sending a casting post' })
      return
    }

    const casting = await createCasting({
      body: castingBody,
      createdBy: admin.id,
      endsAt,
      id: `CAST-${operationId}`,
      startsAt,
      status: body.status ?? 'active',
      targetCandidateIds,
      title,
      updatedBy: admin.id,
    })
    let delivery = { failed: [], failedCount: 0, queued: [], queuedCount: 0, sent: [], sentCount: 0 }

    if (body.sendNow !== false) {
      const publication = await publishCasting({
        actor: admin.id,
        audiences: ['channel', 'eligible_bot_users'],
        castingId: casting.id,
        operationId,
      })
      delivery = {
        ...delivery,
        queued: publication.queued,
        queuedCount: publication.queued.length,
        skipped: publication.skipped,
      }
    }

    await recordAuditEvent({
      action: 'web_admin.casting_created',
      ...adminAuditFields(admin),
      candidateCount: targetCandidateIds.length,
      castingId: casting.id,
      operationId,
      outcome: 'created',
      queuedCount: delivery.queuedCount,
    })

    sendJson(response, 200, {
      casting,
      delivery,
      ok: true,
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/castings/channel') {
    requireAdminWebToken(request)
    sendJson(response, 200, { channel: await getCastingChannelConfig(), ok: true })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/castings/channel') {
    const admin = requireSuperAdminWebToken(request)
    const body = await readJson(request)
    const channel = await updateCastingChannelConfig({
      displayName: body.displayName,
      enabled: body.enabled,
      telegramChatId: body.telegramChatId,
    }, admin.id)
    await recordAuditEvent({
      action: 'casting.channel_config_updated',
      ...adminAuditFields(admin),
      outcome: 'updated',
    })
    sendJson(response, 200, { channel, ok: true })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/castings/channel/health') {
    requireAdminWebToken(request)
    const channel = await getCastingChannelConfig()
    if (!channel.telegramChatId) {
      sendJson(response, 200, { channel, healthy: false, ok: true })
      return
    }

    try {
      const [chat, bot] = await Promise.all([
        telegramProvider.call('getChat', { chat_id: channel.telegramChatId }),
        telegramProvider.getMe(),
      ])
      const membership = await telegramProvider.call('getChatMember', {
        chat_id: channel.telegramChatId,
        user_id: bot.id,
      })
      const administrator = ['administrator', 'creator'].includes(membership.status)
      const canPostMessages = membership.status === 'creator' || membership.can_post_messages === true
      const canEditMessages = membership.status === 'creator' || membership.can_edit_messages === true
      const healthy = administrator && canPostMessages
      const updated = await recordCastingChannelHealth({
        errorCode: healthy ? '' : 'channel_post_permission_missing',
        healthy,
      })
      sendJson(response, 200, {
        canEditMessages,
        canPostMessages,
        channel: updated,
        chat,
        healthy,
        membershipStatus: membership.status,
        ok: true,
      })
    } catch (error) {
      const updated = await recordCastingChannelHealth({
        errorCode: error.code ?? error.name,
        healthy: false,
      })
      sendJson(response, 200, {
        channel: updated,
        error: error.message,
        healthy: false,
        ok: true,
      })
    }
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/castings/outbox') {
    requireSuperAdminWebToken(request)
    sendJson(response, 200, { events: await listCastingOutboxEvents(), ok: true })
    return
  }

  const castingWorkspaceRoute = url.pathname.match(/^\/api\/castings\/([^/]+)\/workspace$/)
  if (request.method === 'GET' && castingWorkspaceRoute) {
    requireAdminWebToken(request)
    const workspace = await getCastingWorkspace(decodeURIComponent(castingWorkspaceRoute[1]))
    if (!workspace) {
      sendJson(response, 404, { error: 'Casting not found' })
      return
    }
    sendJson(response, 200, workspace)
    return
  }

  const castingManageRoute = url.pathname.match(/^\/api\/castings\/([^/]+)\/manage$/)
  if (request.method === 'POST' && castingManageRoute) {
    const admin = requireAdminWebToken(request)
    const castingId = decodeURIComponent(castingManageRoute[1])
    const body = await readJson(request)
    const action = String(body.action ?? '').trim()
    const operationId = requireOperationId(body.operationId)
    const before = await findCasting(castingId)
    if (!before) {
      sendJson(response, 404, { error: 'Casting not found' })
      return
    }

    let casting
    let delivery = { failed: [], failedCount: 0, queued: [], queuedCount: 0, sent: [], sentCount: 0 }
    if (action === 'publish') {
      const publication = await publishCasting({
        actor: admin.id,
        audiences: Array.isArray(body.audiences) ? body.audiences : ['channel', 'eligible_bot_users'],
        castingId,
        language: body.language,
        operationId,
      })
      casting = publication.casting
      delivery = {
        ...delivery,
        queued: publication.queued,
        queuedCount: publication.queued.length,
        skipped: publication.skipped,
      }
    } else {
      casting = await manageCasting(castingId, action, body, admin.id)
    }

    await recordAuditEvent({
      action: `casting.${action}`,
      ...adminAuditFields(admin),
      after: casting?.status,
      before: before.status,
      castingId,
      operationId,
      outcome: casting?.version === before.version ? 'unchanged' : 'updated',
      queuedCount: delivery.queuedCount,
    })
    sendJson(response, 200, { casting, delivery, ok: true })
    return
  }

  const castingInvitationsRoute = url.pathname.match(/^\/api\/castings\/([^/]+)\/invitations$/)
  if (request.method === 'POST' && castingInvitationsRoute) {
    const admin = requireAdminWebToken(request)
    const castingId = decodeURIComponent(castingInvitationsRoute[1])
    const body = await readJson(request)
    const operationId = requireOperationId(body.operationId)
    const result = await inviteCandidatesToCasting({
      actor: admin.id,
      candidateIds: body.candidateIds,
      castingId,
      operationId,
    })
    if (!result.casting) {
      sendJson(response, 404, { error: 'Casting not found' })
      return
    }
    await recordAuditEvent({
      action: 'casting.invitations_created',
      ...adminAuditFields(admin),
      castingId,
      invitedCount: result.invited.length,
      operationId,
      outcome: 'queued',
      skippedCount: result.skipped.length,
    })
    sendJson(response, 200, { ...result, ok: true, queuedCount: result.invited.length })
    return
  }

  const castingDecisionsRoute = url.pathname.match(/^\/api\/castings\/([^/]+)\/decisions$/)
  if (request.method === 'POST' && castingDecisionsRoute) {
    const admin = requireAdminWebToken(request)
    const castingId = decodeURIComponent(castingDecisionsRoute[1])
    const body = await readJson(request)
    const operationId = requireOperationId(body.operationId)
    const candidateId = String(body.candidateId ?? '').trim()
    const castingDecision = String(body.castingDecision ?? '').trim()
    const profileDecision = String(body.profileDecision ?? 'unchanged').trim()
    if (!['accept', 'reject'].includes(castingDecision)) {
      sendJson(response, 400, { error: 'castingDecision must be accept or reject' })
      return
    }
    if (!['unchanged', 'approve', 'reject'].includes(profileDecision)) {
      sendJson(response, 400, { error: 'profileDecision must be unchanged, approve, or reject' })
      return
    }

    const decision = await applyCastingAndProfileDecision({
      actor: admin.id,
      candidateId,
      castingDecision,
      castingId,
      profileDecision,
    })
    if (!decision) {
      sendJson(response, 404, { error: 'Casting or candidate not found' })
      return
    }
    const { candidate, castingResult, previousCandidate: beforeCandidate } = decision
    const notificationEvents = []
    if (isCandidateReachableForDirectMessage(candidate)) {
      const castingNotification = await enqueueCastingOutboxEvent({
        castingId,
        eventType: 'casting.decision',
        operationId: `${operationId}:casting-decision`,
        payload: {
          candidateId,
          castingId,
          status: castingResult.participation.status,
        },
        recipientKey: candidateId,
      })
      notificationEvents.push(castingNotification.event)
      if (profileDecision !== 'unchanged' && candidate.status !== beforeCandidate.status) {
        const profileNotification = await enqueueCastingOutboxEvent({
          castingId,
          eventType: 'casting.profile_decision',
          operationId: `${operationId}:profile-decision`,
          payload: { candidateId, castingId, status: candidate.status },
          recipientKey: candidateId,
        })
        notificationEvents.push(profileNotification.event)
      }
    }

    await recordAuditEvent({
      action: 'casting.decision_updated',
      ...adminAuditFields(admin),
      castingDecision,
      castingId,
      candidateId,
      nextParticipationStatus: castingResult.participation?.status,
      nextProfileStatus: candidate.status,
      operationId,
      outcome: castingResult.changed || candidate.status !== beforeCandidate.status ? 'updated' : 'unchanged',
      participationId: castingResult.participation?.id,
      previousParticipationStatus: decision.previousParticipation?.status ?? null,
      previousProfileStatus: beforeCandidate.status,
      profileDecision,
      queuedNotificationCount: notificationEvents.length,
    })
    sendJson(response, 200, {
      candidate,
      casting: castingResult.casting,
      changed: castingResult.changed || candidate.status !== beforeCandidate.status,
      delivery: {
        queued: notificationEvents,
        queuedCount: notificationEvents.length,
      },
      ok: true,
      participation: castingResult.participation,
    })
    return
  }

  const castingMessagesRoute = url.pathname.match(/^\/api\/castings\/([^/]+)\/messages$/)
  if (request.method === 'POST' && castingMessagesRoute) {
    const admin = requireAdminWebToken(request)
    const castingId = decodeURIComponent(castingMessagesRoute[1])
    const body = await readJson(request)
    const operationId = requireOperationId(body.operationId)
    const text = String(body.text ?? '').trim()
    const candidateIds = [...new Set((body.candidateIds ?? []).map(String).filter(Boolean))]
    if (!text || candidateIds.length === 0) {
      sendJson(response, 400, { error: 'Message text and at least one candidate are required' })
      return
    }
    const casting = await findCasting(castingId)
    if (!casting) {
      sendJson(response, 404, { error: 'Casting not found' })
      return
    }

    const queued = []
    const skipped = []
    for (const candidateId of candidateIds) {
      const candidate = await findCandidate(candidateId)
      if (!candidate || !isCandidateReachableForDirectMessage(candidate)) {
        skipped.push({ candidateId, reason: 'candidate_unreachable' })
        continue
      }
      const event = await enqueueCastingOutboxEvent({
        castingId,
        eventType: 'casting.context_message',
        operationId: `${operationId}:${candidateId}`,
        payload: {
          audience: body.audience,
          candidateId,
          castingId,
          castingTitle: casting.title,
          text,
        },
        recipientKey: candidateId,
      })
      queued.push(event.event)
    }
    await recordAuditEvent({
      action: 'casting.context_messages_queued',
      ...adminAuditFields(admin),
      castingId,
      operationId,
      outcome: 'queued',
      queuedCount: queued.length,
      skippedCount: skipped.length,
    })
    sendJson(response, 200, { ok: true, queued, queuedCount: queued.length, skipped })
    return
  }

  const castingInvitationCancelRoute = url.pathname.match(
    /^\/api\/castings\/([^/]+)\/invitations\/([^/]+)\/cancel$/,
  )
  if (request.method === 'POST' && castingInvitationCancelRoute) {
    const admin = requireAdminWebToken(request)
    const castingId = decodeURIComponent(castingInvitationCancelRoute[1])
    const candidateId = decodeURIComponent(castingInvitationCancelRoute[2])
    const existing = await findCastingParticipation(castingId, candidateId)
    if (!existing) {
      sendJson(response, 404, { error: 'Casting invitation not found' })
      return
    }
    if (existing.source !== 'invitation' || existing.status !== 'invited') {
      sendJson(response, 409, { error: 'Only a pending invitation can be cancelled' })
      return
    }
    const result = await setCastingApplicationStatus({
      actor: admin.id,
      candidateId,
      castingId,
      status: 'cancelled',
    })
    sendJson(response, result.participation ? 200 : 404, { ...result, ok: Boolean(result.participation) })
    return
  }

  const castingParticipantRemoveRoute = url.pathname.match(
    /^\/api\/castings\/([^/]+)\/participants\/([^/]+)$/,
  )
  if (request.method === 'DELETE' && castingParticipantRemoveRoute) {
    const admin = requireAdminWebToken(request)
    const castingId = decodeURIComponent(castingParticipantRemoveRoute[1])
    const candidateId = decodeURIComponent(castingParticipantRemoveRoute[2])
    const result = await removeCastingParticipant({ actor: admin.id, candidateId, castingId })
    await recordAuditEvent({
      action: 'casting.participant_removed',
      ...adminAuditFields(admin),
      candidateId,
      castingId,
      outcome: result.changed ? 'updated' : 'unchanged',
      participationId: result.participation?.id,
    })
    sendJson(response, result.participation ? 200 : 404, { ...result, ok: Boolean(result.participation) })
    return
  }

  const candidateConsent = url.pathname.match(/^\/api\/candidates\/([^/]+)\/consent$/)

  if (request.method === 'POST' && candidateConsent) {
    const admin = requireAdminWebToken(request)

    const [, candidateId] = candidateConsent
    const candidate = await findCandidate(candidateId)
    const body = await readJson(request)
    const confirmation = String(body.confirmation ?? '')
    const age = Number(candidate?.age)
    let metadata

    if (
      confirmation === 'proxy_candidate'
      && candidate?.submissionMode === 'friend'
      && Number.isInteger(age)
      && age >= 18
      && candidate.consent === 'proxy_submitter_confirmed_pending_candidate_consent'
    ) {
      metadata = {
        candidateConsentVerifiedAt: new Date().toISOString(),
        candidateConsentVerifiedBy: admin.id,
        consent: 'proxy_confirmed',
      }
    } else if (
      confirmation === 'guardian'
      && Number.isInteger(age)
      && age > 0
      && age < 18
      && candidate?.consent === 'minor_pending_guardian_verification'
    ) {
      metadata = {
        consent: 'guardian_confirmed',
        guardianConsent: 'verified',
        guardianConsentVerifiedAt: new Date().toISOString(),
        guardianConsentVerifiedBy: admin.id,
      }
    } else {
      sendJson(response, 409, { error: 'This consent confirmation is not available for the candidate' })
      return
    }

    const updated = await updateCandidateMetadata(candidateId, metadata)

    if (!updated) {
      sendJson(response, 404, { error: 'Candidate not found' })
      return
    }

    await recordAuditEvent({
      action: 'web_admin.consent_verified',
      ...adminAuditFields(admin),
      candidateId,
      confirmation,
      outcome: 'updated',
    })

    sendJson(response, 200, { candidate: updated, ok: true })
    return
  }

  const candidateAction = url.pathname.match(/^\/api\/candidates\/([^/]+)\/(approve|reject)$/)

  if (request.method === 'POST' && candidateAction) {
    const admin = requireAdminWebToken(request)

    const [, candidateId, action] = candidateAction
    const nextStatus = action === 'approve' ? 'approved' : 'rejected'
    const candidate = await updateCandidateStatus(candidateId, nextStatus, admin.id)

    if (!candidate) {
      sendJson(response, 404, { error: 'Candidate not found or not editable' })
      return
    }

    const approvalChatId = candidate.telegramChatId ?? candidate.submittedByTelegramChatId ?? candidate.telegramUserId ?? candidate.submittedByTelegramUserId
    if (approvalChatId) {
      const message = candidateDecisionMessage(candidate, nextStatus)

      const decisionClaim = await claimTelegramDelivery({
        chatId: approvalChatId,
        data: { candidateId, nextStatus },
        kind: 'web_admin.candidate_decision',
        operationId: `decision:${candidateId}:${nextStatus}`,
        recipientKey: String(approvalChatId),
      })

      if (decisionClaim.claimed) {
        try {
          const decisionMessage = await telegramProvider.sendMessage(approvalChatId, message)
          await completeTelegramDelivery(decisionClaim, decisionMessage.message_id)
        } catch (error) {
          await failTelegramDelivery(decisionClaim, error)
          throw error
        }
      }
    }

    await syncTelegramAdminDecision(candidate, nextStatus, 'web_admin')

    await recordAuditEvent({
      action: `web_admin.${nextStatus}`,
      ...adminAuditFields(admin),
      candidateId,
      outcome: 'updated',
    })

    sendJson(response, 200, { candidate, ok: true })
    return
  }

  const candidateRating = url.pathname.match(/^\/api\/candidates\/([^/]+)\/rating$/)

  if (request.method === 'POST' && candidateRating) {
    const admin = requireAdminWebToken(request)

    const [, candidateId] = candidateRating
    const body = await readJson(request)
    const rating = Number(body.rating)
    const beforeCandidate = await findCandidate(candidateId)

    if (!Number.isFinite(rating) || rating < 0 || rating > 5 || Math.round(rating * 4) !== rating * 4) {
      sendJson(response, 400, { error: 'Rating must be between 0 and 5 in 0.25 steps' })
      return
    }

    const candidate = await updateCandidateMetadata(candidateId, { rating })

    if (!candidate) {
      sendJson(response, 404, { error: 'Candidate not found' })
      return
    }

    await recordAuditEvent({
      action: 'web_admin.rating_updated',
      ...adminAuditFields(admin),
      after: rating,
      before: Number(beforeCandidate?.rating ?? 0),
      candidateId,
      outcome: 'updated',
      rating,
    })

    sendJson(response, 200, { candidate, ok: true })
    return
  }

  const candidatePhoto = url.pathname.match(/^\/api\/candidates\/([^/]+)\/photo$/)

  if (request.method === 'GET' && candidatePhoto) {
    requireAdminWebToken(request)

    const [, candidateId] = candidatePhoto
    const candidate = await findCandidate(candidateId)
    const photo = await readCandidatePhoto(candidate)

    if (!photo) {
      sendJson(response, 404, { error: 'Photo not found' })
      return
    }

    sendImage(response, photo, request)
    return
  }

  const candidateMedia = url.pathname.match(/^\/api\/candidates\/([^/]+)\/media\/(portraitPhoto|fullBodyPhoto|closeShotPhoto|leftProfilePhoto|rightProfilePhoto|introVideo)$/)

  if (request.method === 'GET' && candidateMedia) {
    requireAdminWebToken(request)

    const [, candidateId, kind] = candidateMedia
    const candidate = await findCandidate(candidateId)
    const media = await readCandidateMedia(candidate, kind)

    if (!media) {
      sendJson(response, 404, { error: 'Media not found' })
      return
    }

    sendMedia(response, media, mediaContentType(kind, candidate), request)
    return
  }

  const candidateMessage = url.pathname.match(/^\/api\/candidates\/([^/]+)\/message$/)

  if (request.method === 'POST' && candidateMessage) {
    requireAdminWebToken(request)

    const [, candidateId] = candidateMessage
    const candidate = await findCandidate(candidateId)
    const body = await readJson(request)
    const message = String(body.text ?? '').trim()
    const operationId = requireOperationId(body.operationId)

    if (!candidate) {
      sendJson(response, 404, { error: 'Candidate not found' })
      return
    }

    if (!isCandidateReachableForDirectMessage(candidate)) {
      sendJson(response, 400, { error: 'У кандидата не найден Telegram ID для отправки сообщения' })
      return
    }

    if (!message) {
      sendJson(response, 400, { error: 'Message text is required' })
      return
    }

    const delivery = await sendCandidateMessages(
      [candidate],
      message,
      'web_admin.candidate_message',
      operationId,
    )

    if (delivery.failed.length) {
      sendJson(response, 502, {
        error: delivery.failed[0].error,
        ok: false,
      })
      return
    }

    sendJson(response, 200, {
      deduplicated: delivery.sent[0]?.deduplicated ?? false,
      messageId: delivery.sent[0]?.messageId,
      ok: true,
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/audit') {
    requireSuperAdminWebToken(request)
    sendJson(response, 200, { events: await readAuditEvents() })
    return
  }

  const profilePage = url.pathname.match(/^\/candidate-profile\/([^/]+)$/)

  if (request.method === 'GET' && profilePage) {
    requireAdminWebToken(request)

    const [, candidateId] = profilePage
    const candidate = await findCandidate(decodeURIComponent(candidateId))

    if (!candidate) {
      sendHtml(response, 404, '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:24px">Кандидат не найден</body>')
      return
    }

    sendHtml(response, 200, candidateProfileHtml(candidate))
    return
  }

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    sendHtml(response, 200, getCachedCandidateAdminHtml(), {
      cacheControl: 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400',
    })
    return
  }

  if (
    request.method === 'GET' &&
    (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.svg' || url.pathname === '/icons.svg')
  ) {
    await sendStaticFile(response, url.pathname)
    return
  }

  sendNotFound(response)
}

function isDirectRun() {
  return process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
}

if (isDirectRun()) {
  assertHostedConfiguration()

  const server = createServer(async (request, response) => {
    const requestStartedAt = performance.now()
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    const route = safeRouteName(request.method ?? 'GET', requestUrl.pathname)
    response.once('finish', () => {
      console.info(JSON.stringify({
        level: 'info',
        message: 'request_completed',
        method: request.method,
        ms: Number((performance.now() - requestStartedAt).toFixed(2)),
        requestId: request.headers['x-vercel-id'] ?? request.headers['x-railway-request-id'] ?? null,
        route,
        status: response.statusCode,
      }))
    })

    try {
      await routeRequest(request, response)
    } catch (error) {
      const statusCode = error.statusCode ?? 500
      const clientRejection = statusCode >= 400 && statusCode < 500
      const log = clientRejection ? console.info : console.error

      log(JSON.stringify({
        errorCode: error.code ?? error.name ?? 'Error',
        level: clientRejection ? 'info' : 'error',
        message: clientRejection ? 'request_rejected' : 'request_failed',
        method: request.method,
        ms: Number((performance.now() - requestStartedAt).toFixed(2)),
        route,
        status: statusCode,
      }))
      sendJson(response, statusCode, {
        error: error.message ?? 'Server error',
      })
    }
  })
  const stopCastingOutbox = (
    Boolean(config.telegramBotToken)
    && process.env.DATABASE_URL
  )
    ? startCastingOutboxProcessor()
    : () => {}

  server.listen(config.port, config.host, () => {
    console.log(`FACE Platform API listening on http://${config.host}:${config.port}`)
    console.log(`Telegram configured: ${getConfigStatus().telegramConfigured ? 'yes' : 'no'}`)
  })

  let shuttingDown = false

  function shutdown(signal) {
    if (shuttingDown) return

    shuttingDown = true
    console.log(`${signal} received; draining HTTP server`)
    stopCastingOutbox()

    server.close((error) => {
      if (error) {
        console.error('HTTP server shutdown failed:', error)
        process.exit(1)
      }

      process.exit(0)
    })
    server.closeIdleConnections?.()

    const forceExit = setTimeout(() => {
      console.error('Timed out while draining HTTP server; exiting')
      process.exit(1)
    }, 25_000)
    forceExit.unref()
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}
