import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, test } from 'node:test'

const testRoot = await mkdtemp(join(tmpdir(), 'face-casting-bot-'))
process.env.AUDIT_LOG_PATH = join(testRoot, 'audit.jsonl')
process.env.CANDIDATE_STORAGE_PATH = join(testRoot, 'candidates.json')
process.env.CASTING_MANAGEMENT_PATH = join(testRoot, 'casting-management.json')
process.env.CASTING_STORAGE_PATH = join(testRoot, 'castings.json')
process.env.TELEGRAM_BOT_TOKEN = 'casting-flow-test-token'
process.env.TELEGRAM_DISABLED = 'false'
delete process.env.DATABASE_URL

const telegramCalls = []
let nextMessageId = 1200

globalThis.fetch = async (url, options = {}) => {
  const method = String(url).split('/').at(-1)
  const payload = options.body instanceof FormData
    ? Object.fromEntries(options.body.entries())
    : JSON.parse(String(options.body ?? '{}'))
  const result = method === 'sendMessage'
    ? {
        chat: { id: payload.chat_id },
        message_id: nextMessageId++,
        text: payload.text,
      }
    : true

  telegramCalls.push({ method, payload })
  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })
}

const {
  createCasting,
  castingPublicToken,
} = await import('../server/castingRepository.js')
const {
  findCastingParticipation,
  listCastingParticipations,
} = await import('../server/castingParticipationRepository.js')
const {
  getCastingParticipationContext,
  setCastingApplicationStatus,
} = await import('../server/castingParticipationService.js')
const {
  findCandidateByTelegramId,
  upsertCandidateIntake,
} = await import('../server/candidateRepository.js')
const { __botTesting, handleBotUpdate } = await import('../server/bot.js')

function completeCandidate(userId, overrides = {}) {
  return {
    age: 24,
    appearance: ['central_asian'],
    city: 'Tashkent',
    closeShotPhotoFileId: `close-${userId}`,
    consent: 'candidate_confirmed',
    fullBodyPhotoFileId: `full-${userId}`,
    gender: 'Female',
    height: '170',
    id: `CAND-${userId}`,
    introVideoFileId: `video-${userId}`,
    language: 'en',
    languageSkills: ['uzbek'],
    leftProfilePhotoFileId: `left-${userId}`,
    name: `Candidate ${userId}`,
    performanceTalents: ['acting'],
    phone: `+99890${String(userId).slice(-7).padStart(7, '0')}`,
    physicalSkills: ['dance'],
    portraitPhotoFileId: `portrait-${userId}`,
    rightProfilePhotoFileId: `right-${userId}`,
    sportsTalents: ['running'],
    status: 'pending_review',
    submissionMode: 'self',
    telegramChatId: userId,
    telegramUserId: String(userId),
    weight: '60',
    ...overrides,
  }
}

async function seedCandidate(userId, overrides) {
  return upsertCandidateIntake(completeCandidate(userId, overrides))
}

async function seedCasting(name, overrides = {}) {
  return createCasting({
    body: `Details for ${name}`,
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    id: `CAST-${name}`,
    publicToken: name,
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    status: 'active',
    title: `Casting ${name}`,
    ...overrides,
  })
}

function messageUpdate(updateId, userId, text) {
  return {
    message: {
      chat: { id: userId, type: 'private' },
      from: { first_name: 'Casting', id: userId },
      message_id: updateId + 20_000,
      text,
    },
    update_id: updateId,
  }
}

function callbackUpdate(updateId, userId, messageId, data, messageText = 'Casting action') {
  return {
    callback_query: {
      data,
      from: { first_name: 'Casting', id: userId },
      id: `casting-callback-${updateId}`,
      message: {
        chat: { id: userId, type: 'private' },
        message_id: messageId,
        text: messageText,
      },
    },
    update_id: updateId,
  }
}

function calls(method) {
  return telegramCalls.filter((entry) => entry.method === method)
}

beforeEach(() => {
  telegramCalls.length = 0
  nextMessageId = 1200
  __botTesting.resetRuntimeState()
})

after(async () => {
  await rm(testRoot, { force: true, recursive: true })
})

test('central casting context covers availability, profile, eligibility, and every participation status', async () => {
  const open = await seedCasting('context-open')
  const notOpen = await seedCasting('context-future', {
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
  })
  const closed = await seedCasting('context-closed', { status: 'closed' })
  const complete = await seedCandidate(930001)
  await seedCandidate(930002, { height: '' })
  await seedCandidate(930003, { status: 'rejected' })

  assert.equal((await getCastingParticipationContext({
    publicToken: 'missing-token',
    telegramUserId: 930001,
  })).outcome, 'not_found')
  assert.equal((await getCastingParticipationContext({
    publicToken: castingPublicToken(notOpen),
    telegramUserId: 930001,
  })).outcome, 'not_open')
  assert.equal((await getCastingParticipationContext({
    publicToken: castingPublicToken(closed),
    telegramUserId: 930001,
  })).outcome, 'closed')
  assert.equal((await getCastingParticipationContext({
    publicToken: castingPublicToken(open),
    telegramUserId: 939999,
  })).outcome, 'registration_required')
  assert.equal((await getCastingParticipationContext({
    publicToken: castingPublicToken(open),
    telegramUserId: 930002,
  })).outcome, 'profile_incomplete')
  assert.equal((await getCastingParticipationContext({
    publicToken: castingPublicToken(open),
    telegramUserId: 930003,
  })).outcome, 'profile_rejected')
  assert.equal((await getCastingParticipationContext({
    publicToken: castingPublicToken(open),
    telegramUserId: 930001,
  })).outcome, 'can_apply')

  const statuses = [
    'applied',
    'invited',
    'selected',
    'rejected',
    'declined',
    'withdrawn',
    'removed',
    'cancelled',
  ]

  for (const [index, status] of statuses.entries()) {
    const userId = 931000 + index
    const candidate = await seedCandidate(userId)
    await setCastingApplicationStatus({
      candidate,
      castingId: open.id,
      source: status === 'invited' ? 'invitation' : 'admin_added',
      status,
    })
    const context = await getCastingParticipationContext({
      publicToken: castingPublicToken(open),
      telegramUserId: userId,
    })
    assert.equal(context.outcome, status)
  }

  assert.equal(complete.status, 'pending_review')
})

test('channel deep link keeps casting intent across a runtime restart and resumes self registration', async () => {
  const casting = await seedCasting('deep-link')
  const userId = 932001

  await handleBotUpdate(messageUpdate(
    1,
    userId,
    `/start cast_${castingPublicToken(casting)}`,
  ))

  const languagePrompt = calls('sendMessage')[0]
  const languageCallback = languagePrompt.payload.reply_markup.inline_keyboard[0][2].callback_data
  assert.equal(__botTesting.sessionFor(userId).pendingCastingToken, castingPublicToken(casting))

  __botTesting.resetRuntimeState()
  telegramCalls.length = 0

  await handleBotUpdate(callbackUpdate(
    2,
    userId,
    1200,
    languageCallback,
    languagePrompt.payload.text,
  ))

  const resumed = __botTesting.sessionFor(userId)
  assert.equal(resumed.step, 'name')
  assert.equal(resumed.lang, 'uz')
  assert.equal(resumed.pendingCastingToken, castingPublicToken(casting))
  assert.equal(calls('sendMessage').some((entry) => (
    String(entry.payload.text).includes('FACE Production kastingi')
    && String(entry.payload.text).includes(casting.title)
  )), true)
  assert.equal(await findCastingParticipation(casting.id, resumed.data.id), undefined)
})

test('profile completion shows Apply now and does not silently create an application', async () => {
  const casting = await seedCasting('apply-now')
  const userId = 932002
  const data = completeCandidate(userId)
  delete data.id

  __botTesting.setSession(userId, {
    awaitingUserApproval: true,
    chatId: userId,
    data,
    editing: false,
    flowId: 'casting-profile-flow',
    inlinePromptMessageIds: [],
    lang: 'en',
    pendingCastingToken: castingPublicToken(casting),
    previewControlMessageId: 1500,
    previewMessageIds: [1500],
    previewToken: 'approve-casting-profile',
    promptMessageIds: [],
    proxy: false,
    step: 'preview',
    temporaryExampleMessageIds: [],
  })

  await handleBotUpdate(callbackUpdate(
    3,
    userId,
    1500,
    'form:approve:approve-casting-profile',
    'Check your card',
  ))

  const savedCandidate = await findCandidateByTelegramId(userId)
  assert.ok(savedCandidate)
  assert.equal(await findCastingParticipation(casting.id, savedCandidate.id), undefined)
  const applyNowMessage = calls('sendMessage').find((entry) => (
    entry.payload.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data
      === `cast:apply:${castingPublicToken(casting)}`
  ))
  assert.ok(applyNowMessage)
  assert.match(applyNowMessage.payload.reply_markup.inline_keyboard[0][0].text, /Apply now/)
})

test('private Current Projects cards expose the idempotent Apply callback', async () => {
  const casting = await seedCasting('private-apply')
  const userId = 932010
  await seedCandidate(userId, { status: 'approved' })

  await handleBotUpdate(messageUpdate(30, userId, '🎬 Current Projects'))

  const applyCallback = calls('sendMessage')
    .flatMap((entry) => entry.payload.reply_markup?.inline_keyboard ?? [])
    .flat()
    .find((button) => button.callback_data === `cast:apply:${castingPublicToken(casting)}`)
  assert.ok(applyCallback)
  assert.match(applyCallback.text, /Apply/)
})

test('rapid and replayed Apply callbacks create one application and return current state', async () => {
  const casting = await seedCasting('rapid-apply')
  const userId = 932003
  await seedCandidate(userId)
  const callbackData = `cast:apply:${castingPublicToken(casting)}`

  await Promise.all([
    handleBotUpdate(callbackUpdate(4, userId, 1600, callbackData)),
    handleBotUpdate(callbackUpdate(5, userId, 1600, callbackData)),
  ])
  await handleBotUpdate(callbackUpdate(6, userId, 1600, callbackData))

  const participations = await listCastingParticipations(casting.id)
  assert.equal(participations.length, 1)
  assert.equal(participations[0].status, 'applied')
  const callbackAnswers = calls('answerCallbackQuery').map((entry) => entry.payload.text)
  assert.equal(callbackAnswers.some((value) => /submitted/i.test(value)), true)
  assert.equal(callbackAnswers.some((value) => /already applied/i.test(value)), true)
})

test('Apply accepts an invitation, while accept and decline callbacks are idempotent', async () => {
  const casting = await seedCasting('invitation-actions')
  const applyUser = 932004
  const acceptUser = 932005
  const declineUser = 932006

  for (const userId of [applyUser, acceptUser, declineUser]) {
    const candidate = await seedCandidate(userId)
    await setCastingApplicationStatus({
      candidate,
      castingId: casting.id,
      source: 'invitation',
      status: 'invited',
    })
  }

  await Promise.all([
    handleBotUpdate(callbackUpdate(
      7,
      applyUser,
      1700,
      `cast:apply:${castingPublicToken(casting)}`,
    )),
    handleBotUpdate(callbackUpdate(
      8,
      applyUser,
      1700,
      `cast:apply:${castingPublicToken(casting)}`,
    )),
  ])
  await Promise.all([
    handleBotUpdate(callbackUpdate(
      9,
      acceptUser,
      1701,
      `cast:accept:${castingPublicToken(casting)}`,
    )),
    handleBotUpdate(callbackUpdate(
      10,
      acceptUser,
      1701,
      `cast:accept:${castingPublicToken(casting)}`,
    )),
  ])
  await Promise.all([
    handleBotUpdate(callbackUpdate(
      11,
      declineUser,
      1702,
      `cast:decline:${castingPublicToken(casting)}`,
    )),
    handleBotUpdate(callbackUpdate(
      12,
      declineUser,
      1702,
      `cast:decline:${castingPublicToken(casting)}`,
    )),
  ])

  const applyCandidate = await findCandidateByTelegramId(applyUser)
  const acceptCandidate = await findCandidateByTelegramId(acceptUser)
  const declineCandidate = await findCandidateByTelegramId(declineUser)
  assert.equal((await findCastingParticipation(casting.id, applyCandidate.id)).status, 'selected')
  assert.equal((await findCastingParticipation(casting.id, acceptCandidate.id)).status, 'selected')
  assert.equal((await findCastingParticipation(casting.id, declineCandidate.id)).status, 'declined')
  assert.equal((await listCastingParticipations(casting.id)).length, 3)
})

test('closed casting makes old Apply buttons harmless and reports context in RU, UZ, and EN', async () => {
  const casting = await seedCasting('closed-button', { status: 'closed' })
  const languages = [
    [932007, 'ru', 'Приём заявок'],
    [932008, 'uz', 'ariza qabul qilish'],
    [932009, 'en', 'Applications'],
  ]

  for (const [index, [userId, language, expected]] of languages.entries()) {
    await seedCandidate(userId, { language })
    await handleBotUpdate(callbackUpdate(
      20 + index,
      userId,
      1800 + index,
      `cast:apply:${castingPublicToken(casting)}`,
    ))
    const answer = calls('answerCallbackQuery').at(-1).payload.text
    assert.match(answer, new RegExp(expected, 'i'))
  }

  assert.equal((await listCastingParticipations(casting.id)).length, 0)
})
