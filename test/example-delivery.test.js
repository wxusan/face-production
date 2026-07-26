import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

process.env.NODE_ENV = 'test'
process.env.TELEGRAM_BOT_TOKEN = 'example-delivery-test-token'
process.env.TELEGRAM_DISABLED = 'false'
delete process.env.DATABASE_URL

const calls = []
let nextMessageId = 1200
let rejectedFileId

globalThis.fetch = async (url, options = {}) => {
  const method = String(url).split('/').at(-1)
  const payload = JSON.parse(String(options.body ?? '{}'))
  if (
    (method === 'sendPhoto' && payload.photo === rejectedFileId)
    || (method === 'sendVideo' && payload.video === rejectedFileId)
  ) {
    calls.push({ method, payload })
    return new Response(JSON.stringify({
      description: 'Bad Request: wrong file identifier',
      error_code: 400,
      ok: false,
    }), {
      headers: { 'content-type': 'application/json' },
      status: 400,
    })
  }
  const result = method === 'sendPhoto'
    ? {
        chat: { id: payload.chat_id },
        message_id: nextMessageId++,
        photo: [{ file_id: payload.photo, file_unique_id: `unique-${payload.photo}` }],
      }
    : method === 'sendVideo'
      ? {
          chat: { id: payload.chat_id },
          message_id: nextMessageId++,
          video: { file_id: payload.video, file_unique_id: `unique-${payload.video}` },
        }
      : method === 'sendMessage'
        ? {
            chat: { id: payload.chat_id },
            message_id: nextMessageId++,
            text: payload.text,
          }
        : true

  calls.push({ method, payload })
  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })
}

const { __botTesting } = await import('../server/bot.js')
const { allExampleMedia } = await import('../server/exampleMedia.js')
const {
  getTelegramExampleFile,
  resetTelegramExampleMemoryForTests,
  upsertTelegramExampleFile,
} = await import('../server/telegramExampleRepository.js')

function setMediaSession(userId, genderCode, step) {
  __botTesting.setSession(userId, {
    chatId: userId,
    data: { genderCode, telegramUserId: String(userId) },
    editing: false,
    flowId: `flow-${userId}`,
    inlinePromptMessageIds: [],
    lang: 'en',
    previewMessageIds: [],
    promptMessageIds: [],
    proxy: false,
    step,
    temporaryExampleMessageIds: [],
  })
}

beforeEach(() => {
  calls.length = 0
  nextMessageId = 1200
  rejectedFileId = undefined
  __botTesting.resetRuntimeState()
  resetTelegramExampleMemoryForTests()
})

test('male photo step sends the mapped reusable Telegram example before its instruction', async () => {
  const userId = 930001
  setMediaSession(userId, 'male', 'fullBodyPhoto')
  await upsertTelegramExampleFile({
    assetKey: 'male.fullBodyPhoto',
    fileId: 'male-full-body-file-id',
    mediaKind: 'photo',
    telegramMethod: 'sendPhoto',
  })

  await __botTesting.askCurrentStep(userId)

  assert.deepEqual(calls.map((entry) => entry.method), ['sendPhoto', 'sendMessage'])
  assert.equal(calls[0].payload.photo, 'male-full-body-file-id')
  assert.match(calls[0].payload.caption, /Example photo/)
  assert.match(calls[1].payload.text, /Send a full-body photo/)
  assert.deepEqual(__botTesting.sessionFor(userId).temporaryExampleMessageIds, [1200])
})

test('female video step sends the mapped reusable Telegram video before its instruction', async () => {
  const userId = 930002
  setMediaSession(userId, 'female', 'video')
  await upsertTelegramExampleFile({
    assetKey: 'female.introVideo',
    fileId: 'female-intro-file-id',
    mediaKind: 'video',
    telegramMethod: 'sendVideo',
  })

  await __botTesting.askCurrentStep(userId)

  assert.deepEqual(calls.map((entry) => entry.method), ['sendVideo', 'sendMessage'])
  assert.equal(calls[0].payload.video, 'female-intro-file-id')
  assert.equal(calls[0].payload.supports_streaming, true)
  assert.match(calls[0].payload.caption, /Example video/)
  assert.match(calls[1].payload.text, /intro video/)
  assert.deepEqual(__botTesting.sessionFor(userId).temporaryExampleMessageIds, [1200])
})

test('missing required media is visible to the user and the written instruction remains available', async () => {
  const userId = 930003
  setMediaSession(userId, 'female', 'fullBodyPhoto')

  await __botTesting.askCurrentStep(userId)

  assert.deepEqual(calls.map((entry) => entry.method), ['sendMessage', 'sendMessage'])
  assert.match(calls[0].payload.text, /example could not be loaded/i)
  assert.match(calls[1].payload.text, /Send a full-body photo/)
  assert.deepEqual(__botTesting.sessionFor(userId).temporaryExampleMessageIds, [])
})

test('both gender flows deliver every mapped photo and intro-video example', async () => {
  let userId = 930100

  for (const entry of allExampleMedia()) {
    userId += 1
    calls.length = 0
    const botStep = entry.step === 'introVideo' ? 'video' : entry.step
    const method = entry.kind === 'video' ? 'sendVideo' : 'sendPhoto'
    const mediaField = entry.kind === 'video' ? 'video' : 'photo'
    const fileId = `${entry.gender}-${entry.step}-file-id`

    setMediaSession(userId, entry.gender, botStep)
    await upsertTelegramExampleFile({
      assetKey: `${entry.gender}.${entry.step}`,
      fileId,
      mediaKind: entry.kind,
      telegramMethod: method,
    })

    await __botTesting.askCurrentStep(userId)

    assert.equal(calls[0].method, method)
    assert.equal(calls[0].payload[mediaField], fileId)
    assert.equal(calls[1].method, 'sendMessage')
    assert.deepEqual(
      __botTesting.sessionFor(userId).temporaryExampleMessageIds,
      [nextMessageId - 2],
    )
  }
})

test('final preview contains every answer and all six candidate media items', () => {
  const data = {
    age: 24,
    appearance: ['Central Asian'],
    city: 'Tashkent',
    closeShotPhotoPath: '/candidate/close.jpg',
    fullBodyPhotoPath: '/candidate/full.jpg',
    gender: 'Female',
    height: '170',
    introVideoPath: '/candidate/intro.mp4',
    languageSkills: ['Uzbek', 'English'],
    leftProfilePhotoPath: '/candidate/left.jpg',
    name: 'Preview Candidate',
    performanceTalents: ['Acting'],
    phone: '+998901234567',
    physicalSkills: ['Dance'],
    portraitPhotoPath: '/candidate/portrait.jpg',
    rightProfilePhotoPath: '/candidate/right.jpg',
    sportsTalents: ['Swimming'],
    weight: '58',
  }

  const preview = __botTesting.reviewPreview(data, 'en')

  for (const answer of [
    'Preview Candidate',
    '+998901234567',
    'Tashkent',
    'Acting',
    'Swimming',
    'Dance',
    'Uzbek, English',
    'Central Asian',
  ]) {
    assert.match(preview.card, new RegExp(answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.deepEqual(
    preview.mediaItems.map((item) => item.filePath),
    [
      '/candidate/full.jpg',
      '/candidate/close.jpg',
      '/candidate/left.jpg',
      '/candidate/right.jpg',
      '/candidate/portrait.jpg',
      '/candidate/intro.mp4',
    ],
  )
})

test('an invalid persisted Telegram file ID is invalidated and retried from the source', async () => {
  const entry = allExampleMedia().find(
    (item) => item.gender === 'male' && item.step === 'rightProfilePhoto',
  )
  const cacheKey = {
    assetKey: 'male.rightProfilePhoto',
    mediaKind: 'photo',
    telegramMethod: 'sendPhoto',
  }
  rejectedFileId = 'expired-telegram-file-id'
  await upsertTelegramExampleFile({
    ...cacheKey,
    fileId: rejectedFileId,
  })

  const sent = await __botTesting.sendExampleMedia(
    { chatId: 930500 },
    entry,
    {
      sendSource: async () => ({
        chat: { id: 930500 },
        message_id: 1500,
        photo: [{
          file_id: 'fresh-telegram-file-id',
          file_unique_id: 'fresh-unique-id',
        }],
      }),
    },
  )

  assert.equal(calls.length, 1)
  assert.equal(calls[0].payload.photo, rejectedFileId)
  assert.equal(sent.message_id, 1500)
  assert.equal((await getTelegramExampleFile(cacheKey)).fileId, 'fresh-telegram-file-id')
})

test('a cache-write failure cannot turn a successful Telegram delivery into a user-visible failure', async () => {
  const entry = allExampleMedia().find(
    (item) => item.gender === 'female' && item.step === 'leftProfilePhoto',
  )

  const sent = await __botTesting.sendExampleMedia(
    { chatId: 930501 },
    entry,
    {
      sendSource: async () => ({
        chat: { id: 930501 },
        message_id: 1501,
        photo: [{
          file_id: 'x'.repeat(201),
          file_unique_id: 'fresh-unique-id',
        }],
      }),
    },
  )

  assert.equal(sent.message_id, 1501)
})
