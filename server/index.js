import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleBotUpdate } from './bot.js'
import { createCasting, listCastings } from './castingRepository.js'
import { config, getConfigStatus } from './config.js'
import { readAuditEvents, recordAuditEvent } from './auditLog.js'
import {
  findCandidate,
  getBroadcastDryRun,
  listCandidates,
  updateCandidateMetadata,
  updateCandidateStatus,
} from './candidateRepository.js'
import { requireAdminWebToken } from './security.js'
import { talentTaxonomy } from './taxonomy.js'
import {
  startTelegramPolling,
  telegramProvider,
} from './telegramProvider.js'
import { readCandidateMedia, readCandidatePhoto } from './photoStorage.js'

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
  response.writeHead(statusCode, {
    'access-control-allow-headers': 'content-type,x-admin-token',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-origin': 'http://127.0.0.1:5173',
    'content-type': 'application/json',
  })
  response.end(JSON.stringify(body, null, 2))
}

function sendHtml(response, statusCode, content) {
  response.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
  })
  response.end(content)
}

function sendCsv(response, filename, content) {
  response.writeHead(200, {
    'access-control-allow-headers': 'content-type,x-admin-token',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-origin': 'http://127.0.0.1:5173',
    'content-disposition': `attachment; filename="${filename}"`,
    'content-type': 'text/csv; charset=utf-8',
  })
  response.end(content)
}

function sendImage(response, content) {
  sendMedia(response, content, 'image/jpeg')
}

function sendMedia(response, content, contentType) {
  response.writeHead(200, {
    'access-control-allow-headers': 'content-type,x-admin-token',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-origin': 'http://127.0.0.1:5173',
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

function candidateProfileHtml(candidate, token) {
  const mediaUrl = (kind) => `/api/candidates/${encodeURIComponent(candidate.id)}/media/${kind}?token=${encodeURIComponent(token)}`
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
  </main>
</body>
</html>`
}

function candidateAdminHtml() {
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
    .composerDates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .composerDates label { display: grid; gap: 5px; color: #63748d; font-size: 12px; font-weight: 850; text-transform: uppercase; }
    .composerDates input { width: 100%; min-height: 40px; border: 1px solid #d7e0ec; border-radius: 8px; padding: 0 10px; background: #fff; color: #152033; }
    .selectCell { width: 42px; }
    .empty { min-height: 220px; display: grid; place-items: center; padding: 24px; color: #63748d; text-align: center; }
    @media (max-width: 1180px) { .filterGrid, .postGrid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .rangeGrid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 900px) { .postGrid { grid-template-columns: 1fr; } .sectionHeader { display: grid; } .statRow { justify-content: flex-start; } }
    @media (max-width: 760px) { .app { grid-template-columns: 1fr; } .sidebar { padding: 16px; } .filterGrid, .rangeGrid, .facts, .media, .composerDates { grid-template-columns: 1fr; } .workspace { padding: 18px; } .topbar { display: grid; } .recipientItem { grid-template-columns: 24px minmax(0, 1fr); } .recipientItem .telegramBadge { grid-column: 2; justify-self: start; } }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    (function () {
      var root = document.getElementById('root');
      var token = localStorage.getItem('face-admin-token') || '';
      var candidates = [];
      var activePage = 'pending';
      var filtered = [];
      var selectedIds = [];
      var selectionMode = 'auto';
      var selectedId = '';
      var draftMessages = {};
      var draftRatings = {};
      var postDraft = {
        bulkText: '',
        castingBody: '',
        castingEnd: '',
        castingStart: '',
        castingTitle: ''
      };
      var lastInteractionAt = 0;
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
        media: {}
      };
      var mediaFields = [
        ['fullBodyPhotoPath', 'fullBodyPhoto', 'Полный рост'],
        ['closeShotPhotoPath', 'closeShotPhoto', 'Фото ближе'],
        ['leftProfilePhotoPath', 'leftProfilePhoto', 'Левый профиль'],
        ['rightProfilePhotoPath', 'rightProfilePhoto', 'Правый профиль'],
        ['portraitPhotoPath', 'portraitPhoto', 'Портрет'],
        ['introVideoPath', 'introVideo', 'Видео']
      ];
      var taxonomy = ${taxonomy};
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

        if (activePage === 'candidates' || activePage === 'posts') {
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
        }
        candidates.forEach(function (candidate) {
          var value = candidate[field];
          if (Array.isArray(value)) value.forEach(function (item) { if (item) set.add(canonicalTalentValue(item)); });
          else if (value) set.add(canonicalTalentValue(value));
        });
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
          '<button type="button" class="choice clear' + (!selected.length ? ' active' : '') + '" data-filter-clear="' + id + '">Все</button>' +
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
        if (status === 'approved' || status === 'verified') return 'Активно';
        if (status === 'rejected') return 'Отклонен';
        return 'На проверке';
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
      function mediaFilterButtons() {
        var active = Object.keys(filters.media).filter(function (key) { return filters.media[key]; });
        return '<div class="mediaFilters">' +
          '<button type="button" class="choice clear' + (!active.length ? ' active' : '') + '" id="clearMediaFilters">Все медиа</button>' +
          mediaFields.map(function (item) {
            return '<button type="button" class="choice' + (filters.media[item[0]] ? ' active' : '') + '" data-media="' + item[0] + '">' + item[2] + '</button>';
          }).join('') +
          '</div>';
      }
      function applyFilters() {
        var q = filters.q.trim().toLowerCase();
        filtered = pageBaseCandidates().filter(function (candidate) {
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
          for (var key in filters.media) {
            if (filters.media[key] && !hasCandidateMedia(candidate, key)) return false;
          }
          return true;
        }).sort(function (a, b) {
          return ratingValue(b) - ratingValue(a) || String(a.name || '').localeCompare(String(b.name || ''));
        });
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
          headers: { 'content-type': 'application/json', 'x-admin-token': token }
        }, options || {}));
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'API error');
        return data;
      }
      async function load() {
        try {
          captureDrafts();
          var data = await api('/api/candidates');
          candidates = data.candidates || [];
          applyFilters();
          renderApp();
        } catch (error) {
          localStorage.removeItem('face-admin-token');
          token = '';
          renderLogin(error.message);
        }
      }
      async function decide(id, action) {
        await api('/api/candidates/' + encodeURIComponent(id) + '/' + action, { method: 'POST' });
        await load();
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
        return '/api/candidates/' + encodeURIComponent(id) + '/media/' + kind + '?token=' + encodeURIComponent(token);
      }
      function renderLogin(error) {
        document.body.style.overflow = '';
        root.innerHTML = '<main class="login"><section class="loginCard"><div class="mark">FP</div><div><p class="muted">FACE Production</p><h1>Платформа талантов</h1></div><input id="pass" type="password" placeholder="Код администратора" autofocus><button id="login" class="primary">Войти</button>' + (error ? '<p class="notice">' + esc(error) + '</p>' : '') + '</section></main>';
        document.getElementById('login').onclick = function () {
          token = document.getElementById('pass').value.trim();
          localStorage.setItem('face-admin-token', token);
          load();
        };
        document.getElementById('pass').onkeydown = function (event) {
          if (event.key === 'Enter') document.getElementById('login').click();
        };
      }
      function renderFilters() {
        var cityOptions = optionValues('city');
        var genderOptions = optionValues('gender');
        var sourceOptions = optionValues('source');
        var resultNote = activePage === 'posts' ? 'Выбор получателей ниже' : 'Результаты сортируются по рейтингу';
        var mainBody = '<div class="filterGrid">' +
          choiceGroup('city', 'Город', cityOptions, filters.city) +
          choiceGroup('gender', 'Пол', genderOptions, filters.gender) +
          choiceGroup('source', 'Источник', sourceOptions, filters.source) +
          '</div>';
        var additionalBody = '<div class="rangeGrid">' +
          '<label>Возраст от<input id="ageMin" type="number" value="' + esc(filters.ageMin) + '"></label><label>Возраст до<input id="ageMax" type="number" value="' + esc(filters.ageMax) + '"></label>' +
          '<label>Рост от<input id="heightMin" type="number" value="' + esc(filters.heightMin) + '"></label><label>Рост до<input id="heightMax" type="number" value="' + esc(filters.heightMax) + '"></label>' +
          '<label>Вес от<input id="weightMin" type="number" value="' + esc(filters.weightMin) + '"></label><label>Вес до<input id="weightMax" type="number" value="' + esc(filters.weightMax) + '"></label>' +
          '<label>Создан от<input id="createdFrom" type="date" value="' + esc(filters.createdFrom) + '"></label><label>Создан до<input id="createdTo" type="date" value="' + esc(filters.createdTo) + '"></label>' +
          '<label>Обновлен от<input id="updatedFrom" type="date" value="' + esc(filters.updatedFrom) + '"></label><label>Обновлен до<input id="updatedTo" type="date" value="' + esc(filters.updatedTo) + '"></label>' +
          '</div>';
        var talentsBody = '<div class="filterGrid">' +
          choiceGroup('performance', 'Сценические таланты', optionValues('performanceTalents'), filters.performance) +
          choiceGroup('sports', 'Спорт', optionValues('sportsTalents'), filters.sports) +
          choiceGroup('physical', 'Физические навыки', optionValues('physicalSkills'), filters.physical) +
          choiceGroup('languages', 'Языки', optionValues('languageSkills'), filters.languages) +
          choiceGroup('appearance', 'Внешность', optionValues('appearance'), filters.appearance) +
          '</div>';
        return '<section class="filters"><input class="search" id="q" placeholder="Поиск: имя, телефон, Telegram, ID" value="' + esc(filters.q) + '">' +
          renderFilterSection('main', 'Основные фильтры', mainBody) +
          renderFilterSection('additional', 'Дополнительные фильтры', additionalBody) +
          renderFilterSection('talents', 'Таланты и внешность', talentsBody) +
          renderFilterSection('media', 'Медиа', mediaFilterButtons()) +
          '<div class="actions"><button class="secondary" id="clearFilters">Сбросить фильтры</button><strong>Найдено: ' + filtered.length + ' / ' + pageTotalCount() + '</strong><span class="muted">' + resultNote + '</span></div></section>';
      }
      function renderFilterSection(id, title, body) {
        return '<div class="filterSection"><button type="button" class="filterToggle" data-filter-toggle="' + id + '">' + esc(title) + '<span>' + (filterSections[id] ? 'Скрыть' : 'Показать') + '</span></button>' +
          (filterSections[id] ? body : '') +
          '</div>';
      }
      function selectedRecipientIds() {
        var filteredIds = new Set(filtered.map(function (candidate) { return candidate.id; }));
        return selectedIds.filter(function (id) { return filteredIds.has(id); });
      }
      function hasTelegram(candidate) {
        return Boolean(candidate.telegramChatId);
      }
      function renderRecipientList() {
        if (!filtered.length) return '<div class="empty">Нет кандидатов по текущему фильтру</div>';
        return '<div class="recipientList">' + filtered.map(function (candidate) {
          var checked = selectedIds.includes(candidate.id);
          return '<label class="recipientItem"><input type="checkbox" data-recipient="' + esc(candidate.id) + '" ' + (checked ? 'checked' : '') + '><div><strong>' + esc(candidate.name || '-') + '</strong><div class="recipientMeta">' + esc(candidate.id) + ' · ' + esc(candidate.city || '-') + ' · ' + esc(candidate.gender || '-') + ' · ' + esc(candidate.age || '-') + '</div></div><span class="telegramBadge' + (hasTelegram(candidate) ? '' : ' missing') + '">' + (hasTelegram(candidate) ? 'Telegram' : 'Нет Telegram') + '</span></label>';
        }).join('') + '</div>';
      }
      function renderPostsPage() {
        var selected = selectedRecipientIds();
        var selectedTelegram = filtered.filter(function (candidate) { return selected.includes(candidate.id) && hasTelegram(candidate); }).length;
        var foundTelegram = filtered.filter(hasTelegram).length;
        var sendDisabled = selected.length ? '' : ' disabled';
        return '<section class="postPage">' +
          '<section class="postPanel"><div class="sectionHeader"><div><p class="muted">Посты отправляются только одобренным кандидатам.</p><h3>Получатели</h3></div><div class="statRow"><span class="statPill">Найдено: ' + filtered.length + '</span><span class="statPill">Выбрано: ' + selected.length + '</span><span class="statPill">Telegram: ' + selectedTelegram + ' / ' + foundTelegram + '</span></div></div>' +
          '<div class="recipientToolbar"><span class="muted">Список формируется фильтрами выше</span><div class="actions"><button class="secondary" id="selectFiltered">Выбрать найденных</button><button class="secondary" id="clearSelected">Снять выбор</button></div></div>' +
          renderRecipientList() + '</section>' +
          '<section class="postGrid">' +
          '<div class="postCard"><div><p class="filterLabel">Обычный пост</p><h3>Сообщение выбранным</h3></div><textarea id="bulkText" placeholder="Текст сообщения">' + esc(postDraft.bulkText) + '</textarea><div class="actions"><button class="primary" id="sendBulk"' + sendDisabled + '>Отправить пост</button><span class="muted" id="bulkResult"></span></div></div>' +
          '<div class="postCard"><div><p class="filterLabel">Кастинг-пост</p><h3>Новый кастинг</h3></div><input class="search" id="castingTitle" placeholder="Название кастинга" value="' + esc(postDraft.castingTitle) + '"><textarea id="castingBody" placeholder="Описание проекта, кого ищем, условия, адрес, контакт.">' + esc(postDraft.castingBody) + '</textarea><div class="composerDates"><label>Старт<input id="castingStart" type="datetime-local" value="' + esc(postDraft.castingStart) + '"></label><label>Конец<input id="castingEnd" type="datetime-local" value="' + esc(postDraft.castingEnd) + '"></label></div><div class="actions"><button class="primary" id="sendCasting"' + sendDisabled + '>Создать и отправить</button><span class="muted" id="castingResult"></span></div></div>' +
          '</section></section>';
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
          el.oninput = el.onchange = function () { filters[id] = el.value; selectionMode = 'auto'; applyFilters(); renderApp(); };
        });
        document.querySelectorAll('[data-filter]').forEach(function (el) {
          el.onclick = function () {
            var key = el.dataset.filter;
            filters[key] = toggleSelection(filters[key], el.dataset.value);
            selectionMode = 'auto';
            applyFilters();
            renderApp();
          };
        });
        document.querySelectorAll('[data-filter-clear]').forEach(function (el) {
          el.onclick = function () {
            filters[el.dataset.filterClear] = [];
            selectionMode = 'auto';
            applyFilters();
            renderApp();
          };
        });
        document.querySelectorAll('[data-media]').forEach(function (el) {
          el.onclick = function () { filters.media[el.dataset.media] = !filters.media[el.dataset.media]; selectionMode = 'auto'; applyFilters(); renderApp(); };
        });
        var clearMedia = document.getElementById('clearMediaFilters');
        if (clearMedia) clearMedia.onclick = function () { filters.media = {}; selectionMode = 'auto'; applyFilters(); renderApp(); };
        document.getElementById('clearFilters').onclick = function () {
          filters = { q: '', status: [], city: [], gender: [], source: [], ageMin: '', ageMax: '', heightMin: '', heightMax: '', weightMin: '', weightMax: '', createdFrom: '', createdTo: '', updatedFrom: '', updatedTo: '', performance: [], sports: [], physical: [], languages: [], appearance: [], media: {} };
          selectionMode = 'auto';
          applyFilters();
          renderApp();
        };
      }
      function renderTable() {
        if (!filtered.length) return '<section class="panel empty">Нет кандидатов по текущим фильтрам</section>';
        return '<section class="panel"><table><thead><tr><th>Кандидат</th><th>Город</th><th>Пол</th><th>Возраст</th><th>Рейтинг</th><th>Статус</th></tr></thead><tbody>' +
          filtered.map(function (candidate) {
            return '<tr data-id="' + esc(candidate.id) + '" class="' + (candidate.id === selectedId ? 'selected' : '') + '"><td><strong>' + esc(candidate.name || '-') + '</strong><span>' + esc(candidate.id) + ' · ' + esc(candidate.phone || '') + '</span></td><td>' + esc(candidate.city || '-') + '</td><td>' + esc(candidate.gender || '-') + '</td><td>' + esc(candidate.age || '-') + '</td><td><strong>' + ratingValue(candidate).toFixed(2) + '</strong><span>' + starText(ratingValue(candidate)) + '</span></td><td><span class="status ' + statusClass(candidate.status) + '">' + statusLabel(candidate.status) + '</span></td></tr>';
          }).join('') +
          '</tbody></table></section>';
      }
      function fact(label, value) {
        return '<div class="fact"><span>' + esc(label) + '</span><strong>' + esc(text(value) || '-') + '</strong></div>';
      }
      function renderDetail() {
        var candidate = filtered.find(function (item) { return item.id === selectedId; });
        if (!candidate) return '';
        var isPendingPage = activePage === 'pending';
        var portrait = candidate.portraitPhotoPath || candidate.photoPath;
        var media = mediaFields.filter(function (item) { return candidate[item[0]] || (item[0] === 'portraitPhotoPath' && candidate.photoPath); }).map(function (item) {
          if (item[1] === 'introVideo') return '<figure class="videoTile"><video controls src="' + mediaUrl(candidate.id, item[1]) + '"></video><figcaption>' + esc(item[2]) + '</figcaption></figure>';
          return '<figure><img src="' + mediaUrl(candidate.id, item[1]) + '" alt="' + esc(item[2]) + '"><figcaption>' + esc(item[2]) + '</figcaption></figure>';
        }).join('');
        return '<div class="drawerOverlay" id="detailDrawer"><aside class="detail"><div class="drawerTop"><button class="iconButton" id="closeDetail" title="Закрыть">×</button></div><div class="profileHead">' +
          (portrait ? '<img class="photo" src="' + mediaUrl(candidate.id, 'portraitPhoto') + '" alt="Фото">' : '<div class="avatar">' + esc(String(candidate.name || '?').slice(0, 1)) + '</div>') +
          '<div><p class="muted">' + esc(candidate.id) + '</p><h3>' + esc(candidate.name || '-') + '</h3><p class="muted">' + esc(candidate.age || '-') + ' · ' + esc(candidate.city || '-') + '</p></div></div>' +
          (media ? '<section class="media">' + media + '</section>' : '<p class="notice">Медиа не загружено</p>') +
          '<section class="facts">' +
          fact('Статус', statusLabel(candidate.status)) + fact('Тип анкеты', candidate.submissionMode === 'friend' ? 'За друга' : 'Личная') + fact('Заполнил', submitterLabel(candidate) || '-') + fact('Рейтинг', ratingValue(candidate).toFixed(2) + ' ' + starText(ratingValue(candidate))) + fact('Телефон', candidate.phone) + fact('Telegram кандидата', candidate.telegramUsername ? '@' + candidate.telegramUsername : candidate.telegramUserId) + fact('Пол', candidate.gender) + fact('Рост', candidate.height) + fact('Вес', candidate.weight) + fact('Внешность', displayTalentList(candidate.appearance)) + fact('Сценические таланты', displayTalentList(candidate.performanceTalents)) + fact('Спорт', displayTalentList(candidate.sportsTalents)) + fact('Физические навыки', displayTalentList(candidate.physicalSkills)) + fact('Языки', displayTalentList(candidate.languageSkills)) + fact('Создан', candidate.createdAt) + fact('Обновлен', candidate.updatedAt) +
          '</section>' +
          (isPendingPage ? renderRatingControl(candidate) : '') +
          '<div><p class="filterLabel">Сообщение в Telegram</p><textarea id="singleText" placeholder="Написать кандидату или отправителю анкеты">' + esc(draftMessages[candidate.id] || '') + '</textarea><div class="actions"><button class="primary" id="sendSingle">Отправить</button><span class="muted" id="singleResult"></span></div></div><div class="actions">' +
          (isPendingPage ? '<button class="primary" id="approve">Одобрить</button><button class="danger" id="reject">Отклонить</button>' : '') +
          '<button class="secondary" id="openProfile">Открыть профиль</button></div></aside></div>';
      }
      function renderRatingControl(candidate) {
        var value = draftRatingValue(candidate).toFixed(2);
        return '<section class="ratingBox"><div><p class="filterLabel">Рейтинг заявки</p><div class="ratingStars" id="ratingStars">' + starText(value) + '</div></div><div class="ratingControls"><input id="ratingInput" type="range" min="0" max="5" step="0.25" value="' + esc(value) + '"><div class="ratingValue" id="ratingValue">' + esc(value) + '</div></div><div class="actions"><button class="secondary" id="saveRating">Сохранить рейтинг</button><span class="muted" id="ratingResult"></span></div></section>';
      }
      function bindTableAndDetail() {
        document.querySelectorAll('[data-id]').forEach(function (row) {
          row.onclick = function () { selectedId = row.dataset.id; renderApp(); };
        });
        var candidate = filtered.find(function (item) { return item.id === selectedId; });
        if (!candidate) return;
        var approve = document.getElementById('approve');
        var reject = document.getElementById('reject');
        var closeDetail = document.getElementById('closeDetail');
        var detailDrawer = document.getElementById('detailDrawer');
        var openProfile = document.getElementById('openProfile');
        var ratingInput = document.getElementById('ratingInput');
        var saveRatingButton = document.getElementById('saveRating');
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
          var input = document.getElementById('ratingInput');
          if (input) await postJson('/api/candidates/' + encodeURIComponent(candidate.id) + '/rating', { rating: Number(input.value) });
          await decide(candidate.id, 'approve');
        };
        if (reject) reject.onclick = function () { decide(candidate.id, 'reject'); };
        if (closeDetail) closeDetail.onclick = function () { selectedId = ''; renderApp(); };
        if (detailDrawer) detailDrawer.onclick = function (event) {
          if (event.target === detailDrawer) {
            selectedId = '';
            renderApp();
          }
        };
        if (openProfile) openProfile.onclick = function () { window.open('/candidate-profile/' + encodeURIComponent(candidate.id) + '?token=' + encodeURIComponent(token), '_blank', 'noopener'); };
        var sendSingle = document.getElementById('sendSingle');
        var singleText = document.getElementById('singleText');
        if (singleText) singleText.oninput = function () {
          draftMessages[candidate.id] = singleText.value;
          touchInteraction();
        };
        if (sendSingle) sendSingle.onclick = async function () {
          var output = document.getElementById('singleResult');
          try {
            var value = singleText.value.trim();
            await postJson('/api/candidates/' + encodeURIComponent(candidate.id) + '/message', { text: value });
            delete draftMessages[candidate.id];
            singleText.value = '';
            output.textContent = 'Отправлено';
          } catch (error) {
            output.textContent = error.message;
          }
        };
      }
      function bindMessagingPanel() {
        var selectFiltered = document.getElementById('selectFiltered');
        var clearSelected = document.getElementById('clearSelected');
        var sendBulk = document.getElementById('sendBulk');
        var sendCasting = document.getElementById('sendCasting');
        document.querySelectorAll('[data-recipient]').forEach(function (checkbox) {
          checkbox.onclick = function () {
            selectionMode = 'manual';
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
            touchInteraction();
          };
        });
        if (selectFiltered) selectFiltered.onclick = function () { selectionMode = 'manual'; selectedIds = filtered.map(function (candidate) { return candidate.id; }); renderApp(); };
        if (clearSelected) clearSelected.onclick = function () { selectionMode = 'manual'; selectedIds = []; renderApp(); };
        if (sendBulk) sendBulk.onclick = async function () {
          var output = document.getElementById('bulkResult');
          try {
            var value = document.getElementById('bulkText').value.trim();
            if (!selectedRecipientIds().length) throw new Error('Выберите хотя бы одного получателя');
            var result = await postJson('/api/admin/broadcast', { candidateIds: selectedIds, text: value });
            postDraft.bulkText = '';
            document.getElementById('bulkText').value = '';
            output.textContent = 'Отправлено: ' + result.sentCount + ', ошибок: ' + result.failed.length;
          } catch (error) {
            output.textContent = error.message;
          }
        };
        if (sendCasting) sendCasting.onclick = async function () {
          var output = document.getElementById('castingResult');
          try {
            if (!selectedRecipientIds().length) throw new Error('Выберите хотя бы одного получателя');
            var result = await postJson('/api/castings', {
              body: document.getElementById('castingBody').value.trim(),
              candidateIds: selectedIds,
              endsAt: document.getElementById('castingEnd').value,
              sendNow: true,
              startsAt: document.getElementById('castingStart').value,
              title: document.getElementById('castingTitle').value.trim()
            });
            postDraft.castingTitle = '';
            postDraft.castingBody = '';
            postDraft.castingStart = '';
            postDraft.castingEnd = '';
            document.getElementById('castingTitle').value = '';
            document.getElementById('castingBody').value = '';
            document.getElementById('castingStart').value = '';
            document.getElementById('castingEnd').value = '';
            output.textContent = result.casting.id + ' создан. Отправлено: ' + result.delivery.sent.length;
          } catch (error) {
            output.textContent = error.message;
          }
        };
      }
      function bindNavigation() {
        document.querySelectorAll('[data-page]').forEach(function (button) {
          button.onclick = function () {
            activePage = button.dataset.page;
            selectedId = '';
            selectionMode = 'auto';
            applyFilters();
            renderApp();
          };
        });
      }
      function renderApp() {
        if (!token) return renderLogin();
        captureDrafts();
        document.body.style.overflow = selectedId ? 'hidden' : '';
        var isPosts = activePage === 'posts';
        var isPending = activePage === 'pending';
        var isCandidates = activePage === 'candidates';
        var title = isPosts ? 'Посты' : isPending ? 'Заявки' : 'Кандидаты';
        var body = isPosts
          ? renderFilters() + renderPostsPage()
          : renderFilters() + '<section class="layout">' + renderTable() + renderDetail() + '</section>';
        var exportAction = isCandidates ? '<button class="secondary" id="export">Экспорт всей базы</button>' : '';
        root.innerHTML = '<main class="app"><aside class="sidebar"><div class="brand"><div class="mark">FP</div><div><strong>FACE Production</strong><p class="muted">Платформа талантов</p></div></div><button class="nav ' + (isPending ? 'active' : '') + '" data-page="pending">Заявки</button><button class="nav ' + (isCandidates ? 'active' : '') + '" data-page="candidates">Кандидаты</button><button class="nav ' + (isPosts ? 'active' : '') + '" data-page="posts">Посты</button></aside><section class="workspace"><header class="topbar"><div><p class="muted">Консоль MVP</p><h2>' + title + '</h2></div><div class="actions"><button class="secondary" id="refresh">Обновить</button>' + exportAction + '<button class="secondary" id="logout">Выйти</button></div></header>' + body + '</section></main>';
        bindNavigation();
        if (isPosts) {
          bindFilters();
          bindMessagingPanel();
        } else {
          bindFilters();
          bindTableAndDetail();
        }
        document.getElementById('refresh').onclick = load;
        var exportButton = document.getElementById('export');
        if (exportButton) exportButton.onclick = function () { window.location.href = '/api/candidates/export.csv?token=' + encodeURIComponent(token); };
        document.getElementById('logout').onclick = function () { localStorage.removeItem('face-admin-token'); token = ''; renderLogin(); };
      }
      if (token) load(); else renderLogin();
      setInterval(function () { if (token && activePage !== 'posts' && !hasActiveEditor()) load(); }, 5000);
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

function eligibleMessagingCandidates(candidates, candidateIds) {
  if (Array.isArray(candidateIds) && candidateIds.length === 0) {
    return []
  }

  const requestedIds = new Set((candidateIds ?? []).map(String))

  return candidates.filter((candidate) => {
    if (requestedIds.size && !requestedIds.has(candidate.id)) {
      return false
    }

    return Boolean(candidate.telegramChatId) && ['approved', 'verified'].includes(candidate.status)
  })
}

async function sendCandidateMessages(candidates, message, action) {
  const sent = []
  const failed = []

  for (const candidate of candidates) {
    try {
      const result = await telegramProvider.sendMessage(candidate.telegramChatId, message)
      sent.push({ candidateId: candidate.id, messageId: result.message_id })
      await recordAuditEvent({
        action,
        actor: 'web_admin',
        candidateId: candidate.id,
        messageId: result.message_id,
        outcome: 'sent',
      })
    } catch (error) {
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

function castingMessage(casting) {
  return [
    `🎬 ${casting.title}`,
    '',
    casting.body,
    casting.startsAt ? `\n📅 Начало: ${new Date(casting.startsAt).toLocaleString('ru-RU')}` : '',
    casting.endsAt ? `⏱ Завершение: ${new Date(casting.endsAt).toLocaleString('ru-RU')}` : '',
  ].filter(Boolean).join('\n')
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

export async function routeRequest(request, response) {
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

  if (request.method === 'GET' && url.pathname === '/api/candidates') {
    requireAdminWebToken(request)
    sendJson(response, 200, { candidates: await listCandidates() })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/candidates/export.csv') {
    const tokenFromQuery = url.searchParams.get('token')

    if (tokenFromQuery) {
      request.headers['x-admin-token'] = tokenFromQuery
    }

    requireAdminWebToken(request)
    sendCsv(response, 'face-candidates.csv', candidatesToCsv(await listCandidates()))
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
    if (
      config.telegramWebhookSecret &&
      request.headers['x-telegram-bot-api-secret-token'] !== config.telegramWebhookSecret
    ) {
      sendJson(response, 403, { error: 'Telegram webhook authorization failed' })
      return
    }

    const update = await readJson(request)
    const result = await handleBotUpdate(update)
    sendJson(response, 200, { ok: true, result })
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
    const result = await sendCandidateMessages(candidates, message, 'web_admin.bulk_message')

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
    sendJson(response, 200, { castings: await listCastings() })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/castings') {
    requireAdminWebToken(request)
    const body = await readJson(request)
    const title = String(body.title ?? '').trim()
    const castingBody = String(body.body ?? '').trim()
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
      endsAt,
      startsAt,
      status: body.status ?? 'active',
      targetCandidateIds,
      title,
    })
    let delivery = { failed: [], sent: [] }

    if (body.sendNow !== false) {
      const candidates = eligibleMessagingCandidates(await listCandidates(), targetCandidateIds)
      delivery = await sendCandidateMessages(candidates, castingMessage(casting), 'web_admin.casting_post')
    }

    await recordAuditEvent({
      action: 'web_admin.casting_created',
      actor: 'web_admin',
      candidateCount: targetCandidateIds.length,
      castingId: casting.id,
      outcome: 'created',
      sentCount: delivery.sent.length,
    })

    sendJson(response, 200, {
      casting,
      delivery,
      ok: true,
    })
    return
  }

  const candidateAction = url.pathname.match(/^\/api\/candidates\/([^/]+)\/(approve|reject)$/)

  if (request.method === 'POST' && candidateAction) {
    requireAdminWebToken(request)

    const [, candidateId, action] = candidateAction
    const nextStatus = action === 'approve' ? 'approved' : 'rejected'
    const candidate = await updateCandidateStatus(candidateId, nextStatus, 'web_admin')

    if (!candidate) {
      sendJson(response, 404, { error: 'Candidate not found or not editable' })
      return
    }

    if (candidate.telegramChatId || candidate.submittedByTelegramChatId) {
      const message = candidate.submissionMode === 'friend'
        ? nextStatus === 'approved'
          ? 'Анкета, которую вы отправили за друга, одобрена для внутренней базы талантов FACE Production.'
          : 'Анкета, которую вы отправили за друга, рассмотрена и не одобрена на этом этапе.'
        : nextStatus === 'approved'
          ? 'Ваш профиль FACE Production одобрен для внутренней кастинг-базы.'
          : 'Ваша заявка FACE Production рассмотрена и не одобрена на этом этапе.'

      await telegramProvider.sendMessage(candidate.telegramChatId ?? candidate.submittedByTelegramChatId, message)
    }

    await syncTelegramAdminDecision(candidate, nextStatus, 'web_admin')

    await recordAuditEvent({
      action: `web_admin.${nextStatus}`,
      actor: 'web_admin',
      candidateId,
      outcome: 'updated',
    })

    sendJson(response, 200, { candidate, ok: true })
    return
  }

  const candidateRating = url.pathname.match(/^\/api\/candidates\/([^/]+)\/rating$/)

  if (request.method === 'POST' && candidateRating) {
    requireAdminWebToken(request)

    const [, candidateId] = candidateRating
    const body = await readJson(request)
    const rating = Number(body.rating)

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
      actor: 'web_admin',
      candidateId,
      outcome: 'updated',
      rating,
    })

    sendJson(response, 200, { candidate, ok: true })
    return
  }

  const candidatePhoto = url.pathname.match(/^\/api\/candidates\/([^/]+)\/photo$/)

  if (request.method === 'GET' && candidatePhoto) {
    const tokenFromQuery = url.searchParams.get('token')

    if (tokenFromQuery) {
      request.headers['x-admin-token'] = tokenFromQuery
    }

    requireAdminWebToken(request)

    const [, candidateId] = candidatePhoto
    const candidate = await findCandidate(candidateId)
    const photo = await readCandidatePhoto(candidate)

    if (!photo) {
      sendJson(response, 404, { error: 'Photo not found' })
      return
    }

    sendImage(response, photo)
    return
  }

  const candidateMedia = url.pathname.match(/^\/api\/candidates\/([^/]+)\/media\/(portraitPhoto|fullBodyPhoto|closeShotPhoto|leftProfilePhoto|rightProfilePhoto|introVideo)$/)

  if (request.method === 'GET' && candidateMedia) {
    const tokenFromQuery = url.searchParams.get('token')

    if (tokenFromQuery) {
      request.headers['x-admin-token'] = tokenFromQuery
    }

    requireAdminWebToken(request)

    const [, candidateId, kind] = candidateMedia
    const candidate = await findCandidate(candidateId)
    const media = await readCandidateMedia(candidate, kind)

    if (!media) {
      sendJson(response, 404, { error: 'Media not found' })
      return
    }

    sendMedia(response, media, mediaContentType(kind, candidate))
    return
  }

  const candidateMessage = url.pathname.match(/^\/api\/candidates\/([^/]+)\/message$/)

  if (request.method === 'POST' && candidateMessage) {
    requireAdminWebToken(request)

    const [, candidateId] = candidateMessage
    const candidate = await findCandidate(candidateId)
    const body = await readJson(request)
    const message = String(body.text ?? '').trim()

    if (!candidate) {
      sendJson(response, 404, { error: 'Candidate not found' })
      return
    }

    const targetChatId = candidate.telegramChatId ?? candidate.submittedByTelegramChatId

    if (!targetChatId) {
      sendJson(response, 400, { error: 'Candidate or submitter does not have a Telegram chat ID' })
      return
    }

    if (!message) {
      sendJson(response, 400, { error: 'Message text is required' })
      return
    }

    const result = await telegramProvider.sendMessage(targetChatId, message)

    await recordAuditEvent({
      action: 'web_admin.candidate_message',
      actor: 'web_admin',
      candidateId,
      messageId: result.message_id,
      outcome: 'sent',
    })

    sendJson(response, 200, { messageId: result.message_id, ok: true })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/audit') {
    const tokenFromQuery = url.searchParams.get('token')

    if (tokenFromQuery) {
      request.headers['x-admin-token'] = tokenFromQuery
    }

    requireAdminWebToken(request)
    sendJson(response, 200, { events: await readAuditEvents() })
    return
  }

  const profilePage = url.pathname.match(/^\/candidate-profile\/([^/]+)$/)

  if (request.method === 'GET' && profilePage) {
    const tokenFromQuery = url.searchParams.get('token')

    if (tokenFromQuery) {
      request.headers['x-admin-token'] = tokenFromQuery
    }

    requireAdminWebToken(request)

    const [, candidateId] = profilePage
    const candidate = await findCandidate(decodeURIComponent(candidateId))

    if (!candidate) {
      sendHtml(response, 404, '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:24px">Кандидат не найден</body>')
      return
    }

    sendHtml(response, 200, candidateProfileHtml(candidate, tokenFromQuery ?? ''))
    return
  }

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    sendHtml(response, 200, candidateAdminHtml())
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
  const server = createServer(async (request, response) => {
    try {
      await routeRequest(request, response)
    } catch (error) {
      const statusCode = error.statusCode ?? 500

      sendJson(response, statusCode, {
        error: error.message ?? 'Server error',
      })
    }
  })

  server.listen(config.port, () => {
    console.log(`FACE Platform API listening on http://127.0.0.1:${config.port}`)
    console.log(`Telegram configured: ${getConfigStatus().telegramConfigured ? 'yes' : 'no'}`)
  })

  if (config.enablePolling) {
    startTelegramPolling()
  }
}
