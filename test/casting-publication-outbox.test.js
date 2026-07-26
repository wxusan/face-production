import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const testRoot = await mkdtemp(join(tmpdir(), 'face-casting-outbox-'))
process.env.AUDIT_LOG_PATH = join(testRoot, 'audit.jsonl')
process.env.CANDIDATE_STORAGE_PATH = join(testRoot, 'candidates.json')
process.env.CASTING_CHANNEL_CONFIG_PATH = join(testRoot, 'channel.json')
process.env.CASTING_MANAGEMENT_PATH = join(testRoot, 'management.json')
process.env.CASTING_OUTBOX_PATH = join(testRoot, 'outbox.json')
process.env.CASTING_STORAGE_PATH = join(testRoot, 'castings.json')
process.env.TELEGRAM_BOT_TOKEN = 'outbox-test-token'
process.env.TELEGRAM_BOT_USERNAME = 'FaceProd_bot'
process.env.TELEGRAM_DISABLED = 'false'
delete process.env.DATABASE_URL

const telegramMessages = []
const telegramEdits = []
let retryChatFailures = 1
let nextMessageId = 5000

globalThis.fetch = async (url, options = {}) => {
  const method = String(url).split('/').at(-1)
  const payload = JSON.parse(String(options.body ?? '{}'))

  if (method === 'sendMessage' && String(payload.chat_id) === '940002' && retryChatFailures > 0) {
    retryChatFailures -= 1
    return new Response(JSON.stringify({
      description: 'Too Many Requests',
      error_code: 429,
      ok: false,
      parameters: { retry_after: 1 },
    }), {
      headers: { 'content-type': 'application/json' },
      status: 429,
    })
  }

  if (method === 'sendMessage') {
    telegramMessages.push(structuredClone(payload))
  }
  if (method === 'editMessageText') {
    telegramEdits.push(structuredClone(payload))
  }

  return new Response(JSON.stringify({
    ok: true,
    result: method === 'sendMessage'
      ? { chat: { id: payload.chat_id }, message_id: nextMessageId++ }
      : method === 'editMessageText'
        ? { chat: { id: payload.chat_id }, message_id: payload.message_id }
      : { id: 123, username: 'FaceProd_bot' },
  }), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })
}

const {
  castingPublicToken,
  createCasting,
  findCasting,
} = await import('../server/castingRepository.js')
const {
  manageCasting,
  publishCasting,
} = await import('../server/castingManagementService.js')
const {
  enqueueCastingOutboxEvent,
  listCastingOutboxEvents,
} = await import('../server/castingOutboxRepository.js')
const {
  processCastingOutboxBatch,
} = await import('../server/castingOutboxProcessor.js')
const {
  updateCastingChannelConfig,
} = await import('../server/castingChannelRepository.js')
const {
  upsertCandidateIntake,
} = await import('../server/candidateRepository.js')
const {
  memoryTelegramDeliveries,
  failNextMemoryTelegramCompletions,
  resetMemoryTelegramDeliveries,
} = await import('./helpers/telegram-delivery-memory.js')

function approvedCandidate(userId, language) {
  return {
    age: 25,
    appearance: ['central_asian'],
    city: 'Tashkent',
    closeShotPhotoFileId: `close-${userId}`,
    consent: 'candidate_confirmed',
    fullBodyPhotoFileId: `full-${userId}`,
    gender: 'Female',
    height: '170',
    id: `OUTBOX-CAND-${userId}`,
    introVideoFileId: `video-${userId}`,
    language,
    languageSkills: ['uzbek'],
    leftProfilePhotoFileId: `left-${userId}`,
    name: `Outbox Candidate ${userId}`,
    performanceTalents: ['acting'],
    phone: `+99890${String(userId).slice(-7)}`,
    physicalSkills: ['dance'],
    portraitPhotoFileId: `portrait-${userId}`,
    rightProfilePhotoFileId: `right-${userId}`,
    sportsTalents: ['running'],
    status: 'approved',
    submissionMode: 'self',
    telegramChatId: String(userId),
    telegramUserId: String(userId),
    weight: '60',
  }
}

async function makeOutboxEventReady(operationId) {
  const outbox = JSON.parse(await readFile(process.env.CASTING_OUTBOX_PATH, 'utf8'))
  const event = outbox.find((item) => item.operationId === operationId)
  assert.ok(event)
  event.availableAt = '2000-01-01T00:00:00.000Z'
  await writeFile(
    process.env.CASTING_OUTBOX_PATH,
    `${JSON.stringify(outbox, null, 2)}\n`,
    'utf8',
  )
}

after(async () => {
  await rm(testRoot, { force: true, recursive: true })
})

test('publication delivers channel deep link and localized private Apply buttons, then resumes a retry after worker restart', async () => {
  resetMemoryTelegramDeliveries()
  const uzbekCandidate = await upsertCandidateIntake(approvedCandidate(940001, 'uz'))
  const englishCandidate = await upsertCandidateIntake(approvedCandidate(940002, 'en'))
  await updateCastingChannelConfig({
    displayName: 'FACE casting channel',
    enabled: true,
    telegramChatId: '-100940000',
  }, 'test-admin')
  const casting = await createCasting({
    body: 'Black-box publication details',
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    id: 'CAST-black-box-publication',
    publicToken: 'black-box-publication',
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    status: 'draft',
    targetCandidateIds: [uzbekCandidate.id, englishCandidate.id],
    title: 'Black-box publication',
  })

  const publication = await publishCasting({
    audiences: ['channel', 'eligible_bot_users'],
    castingId: casting.id,
    language: 'ru',
    operationId: 'publish-black-box-1',
  })
  assert.equal(publication.casting.status, 'active')
  assert.equal(publication.queued.length, 3)
  assert.equal(telegramMessages.length, 0)

  const firstRun = await processCastingOutboxBatch()
  assert.equal(firstRun.length, 3)
  assert.equal(firstRun.filter((result) => result.sent).length, 2)
  assert.equal(firstRun.filter((result) => !result.sent).length, 1)

  const channelMessage = telegramMessages.find((message) => String(message.chat_id) === '-100940000')
  assert.ok(channelMessage)
  assert.equal(
    channelMessage.reply_markup.inline_keyboard[0][0].url,
    `https://t.me/FaceProd_bot?start=cast_${castingPublicToken(casting)}`,
  )
  assert.match(channelMessage.reply_markup.inline_keyboard[0][0].text, /Подать заявку/)

  const uzbekMessage = telegramMessages.find((message) => String(message.chat_id) === '940001')
  assert.ok(uzbekMessage)
  assert.equal(
    uzbekMessage.reply_markup.inline_keyboard[0][0].callback_data,
    `cast:apply:${castingPublicToken(casting)}`,
  )
  assert.match(uzbekMessage.reply_markup.inline_keyboard[0][0].text, /Ariza topshirish/)

  let events = await listCastingOutboxEvents({ castingId: casting.id })
  assert.equal(events.filter((event) => event.status === 'sent').length, 2)
  const failedEvent = events.find((event) => event.status === 'failed')
  assert.ok(failedEvent)
  assert.equal(failedEvent.attemptCount, 1)
  assert.ok(new Date(failedEvent.availableAt) > new Date(failedEvent.updatedAt))

  await makeOutboxEventReady(failedEvent.operationId)
  const restartedWorker = await import(
    `../server/castingOutboxProcessor.js?restart=${Date.now()}`
  )
  const retryRun = await restartedWorker.processCastingOutboxBatch()
  assert.equal(retryRun.length, 1)
  assert.equal(retryRun[0].sent, true)

  const englishMessage = telegramMessages.find((message) => String(message.chat_id) === '940002')
  assert.ok(englishMessage)
  assert.equal(
    englishMessage.reply_markup.inline_keyboard[0][0].callback_data,
    `cast:apply:${castingPublicToken(casting)}`,
  )
  assert.match(englishMessage.reply_markup.inline_keyboard[0][0].text, /Apply/)

  events = await listCastingOutboxEvents({ castingId: casting.id })
  assert.equal(events.every((event) => event.status === 'sent'), true)
  assert.equal(events.find((event) => event.id === failedEvent.id).attemptCount, 2)

  const deliveries = memoryTelegramDeliveries()
  assert.equal(deliveries.length, 3)
  assert.equal(deliveries.every((delivery) => delivery.status === 'sent'), true)
  assert.equal(
    deliveries.find((delivery) => delivery.chatId === '940002').attemptCount,
    2,
  )

  const secondRestart = await import(
    `../server/castingOutboxProcessor.js?restart=${Date.now() + 1}`
  )
  assert.deepEqual(await secondRestart.processCastingOutboxBatch(), [])
  assert.equal(telegramMessages.length, 3)

  const repeatedPublication = await publishCasting({
    audiences: ['channel', 'eligible_bot_users'],
    castingId: casting.id,
    language: 'ru',
    operationId: 'publish-black-box-1',
  })
  assert.equal(repeatedPublication.queued.length, 3)
  assert.equal((await listCastingOutboxEvents({ castingId: casting.id })).length, 3)
})

test('context messages render a localized casting heading and escape admin-provided HTML', async () => {
  const pendingCandidate = await upsertCandidateIntake({
    ...approvedCandidate(940003, 'en'),
    status: 'pending_review',
  })
  const casting = await createCasting({
    body: 'Context message delivery details',
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    id: 'CAST-context-message-delivery',
    publicToken: 'context-message-delivery',
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    status: 'active',
    targetCandidateIds: [pendingCandidate.id],
    title: 'Callback <Day 2> & Camera',
  })
  await enqueueCastingOutboxEvent({
    castingId: casting.id,
    eventType: 'casting.context_message',
    operationId: 'context-message-delivery:940003',
    payload: {
      audience: 'applications',
      candidateId: pendingCandidate.id,
      castingId: casting.id,
      text: 'Use <front> & "neutral" pose.',
    },
    recipientKey: pendingCandidate.id,
  })

  const result = await processCastingOutboxBatch()
  assert.equal(result.length, 1)
  assert.equal(result[0].sent, true)

  const message = telegramMessages.find(
    (item) =>
      String(item.chat_id) === '940003'
      && String(item.text).includes('Callback'),
  )
  assert.ok(message)
  assert.equal(message.parse_mode, 'HTML')
  assert.match(
    message.text,
    /🎬 <b>Regarding casting: Callback &lt;Day 2&gt; &amp; Camera<\/b>/,
  )
  assert.match(message.text, /Use &lt;front&gt; &amp; "neutral" pose\./)
  assert.doesNotMatch(message.text, /<front>/)
})

test('stale processing work resumes, while a post-send ledger failure never retries the message', async () => {
  resetMemoryTelegramDeliveries()
  const casting = await createCasting({
    body: 'Crash recovery details',
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    id: 'CAST-crash-recovery',
    publicToken: 'crash-recovery',
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    status: 'active',
    title: 'Crash recovery',
  })

  await enqueueCastingOutboxEvent({
    castingId: casting.id,
    eventType: 'casting.context_message',
    operationId: 'stale-processing:940001',
    payload: {
      candidateId: 'OUTBOX-CAND-940001',
      castingId: casting.id,
      text: 'This stale event should resume.',
    },
    recipientKey: 'OUTBOX-CAND-940001',
  })
  const stored = JSON.parse(await readFile(process.env.CASTING_OUTBOX_PATH, 'utf8'))
  const stale = stored.find((item) => item.operationId === 'stale-processing:940001')
  stale.status = 'processing'
  stale.claimedAt = '2000-01-01T00:00:00.000Z'
  stale.availableAt = '2000-01-01T00:00:00.000Z'
  stale.attemptCount = 1
  await writeFile(
    process.env.CASTING_OUTBOX_PATH,
    `${JSON.stringify(stored, null, 2)}\n`,
    'utf8',
  )

  const resumed = await processCastingOutboxBatch()
  assert.equal(resumed.length, 1)
  assert.equal(resumed[0].sent, true)

  await enqueueCastingOutboxEvent({
    castingId: casting.id,
    eventType: 'casting.context_message',
    operationId: 'post-send-uncertain:940001',
    payload: {
      candidateId: 'OUTBOX-CAND-940001',
      castingId: casting.id,
      text: 'This message must be sent at most once.',
    },
    recipientKey: 'OUTBOX-CAND-940001',
  })
  failNextMemoryTelegramCompletions()
  const before = telegramMessages.length
  const uncertain = await processCastingOutboxBatch()
  assert.equal(uncertain.length, 1)
  assert.equal(uncertain[0].sent, false)
  assert.equal(uncertain[0].event.status, 'cancelled')
  assert.equal(telegramMessages.length, before + 1)
  assert.deepEqual(await processCastingOutboxBatch(), [])
  assert.equal(telegramMessages.length, before + 1)
  assert.ok(memoryTelegramDeliveries().some((delivery) => delivery.status === 'uncertain'))
})

test('closing a published casting edits its channel post and removes the Apply button', async () => {
  resetMemoryTelegramDeliveries()
  const casting = await createCasting({
    body: 'Channel close details',
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    id: 'CAST-channel-close',
    publicToken: 'channel-close',
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    status: 'draft',
    title: 'Channel close',
  })
  await publishCasting({
    audiences: ['channel'],
    castingId: casting.id,
    operationId: 'publish-channel-close',
  })
  await processCastingOutboxBatch()
  const published = await findCasting(casting.id)
  assert.ok(published.channelMessageId)

  await manageCasting(
    casting.id,
    'close',
    { language: 'en', operationId: 'close-channel-post' },
    'test-admin',
  )
  const result = await processCastingOutboxBatch()
  assert.equal(result.length, 1)
  assert.equal(result[0].sent, true)
  const closed = await findCasting(casting.id)
  const eventsAfterClose = await listCastingOutboxEvents({ castingId: casting.id })

  const repeatedClose = await manageCasting(
    casting.id,
    'close',
    { language: 'en', operationId: 'close-channel-post-repeated' },
    'test-admin',
  )
  assert.equal(repeatedClose.version, closed.version)
  assert.equal(repeatedClose.closedAt, closed.closedAt)
  assert.equal(
    (await listCastingOutboxEvents({ castingId: casting.id })).length,
    eventsAfterClose.length,
  )
  assert.deepEqual(await processCastingOutboxBatch(), [])

  const edit = telegramEdits.find(
    (item) => String(item.message_id) === String(published.channelMessageId),
  )
  assert.ok(edit)
  assert.deepEqual(edit.reply_markup, { inline_keyboard: [] })
  assert.match(edit.text, /Applications are closed/)
})

test('invitation and decision notifications are casting-specific and localized', async () => {
  resetMemoryTelegramDeliveries()
  const casting = await createCasting({
    body: 'Localized notification details',
    endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    id: 'CAST-localized-notifications',
    publicToken: 'localized-notifications',
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    status: 'active',
    title: 'Localized notifications',
  })
  await enqueueCastingOutboxEvent({
    castingId: casting.id,
    eventType: 'casting.invitation',
    operationId: 'localized-invitation:940001',
    payload: { candidateId: 'OUTBOX-CAND-940001', castingId: casting.id },
    recipientKey: 'OUTBOX-CAND-940001',
  })
  await enqueueCastingOutboxEvent({
    castingId: casting.id,
    eventType: 'casting.decision',
    operationId: 'localized-decision:940001',
    payload: {
      candidateId: 'OUTBOX-CAND-940001',
      castingId: casting.id,
      status: 'selected',
    },
    recipientKey: 'OUTBOX-CAND-940001',
  })

  const before = telegramMessages.length
  const result = await processCastingOutboxBatch()
  assert.equal(result.length, 2)
  const delivered = telegramMessages.slice(before)
  const invitation = delivered.find((item) => item.reply_markup?.inline_keyboard?.[0]?.length === 2)
  const decision = delivered.find((item) => String(item.text).includes('tanlandingiz'))
  assert.ok(invitation)
  assert.match(invitation.text, /taklif qilindingiz/)
  assert.match(invitation.reply_markup.inline_keyboard[0][0].text, /Qabul qilish/)
  assert.ok(decision)
  assert.match(decision.text, /Kasting bo‘yicha/)
})
