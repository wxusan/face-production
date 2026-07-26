import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { after, beforeEach, test } from 'node:test'

process.env.TELEGRAM_BOT_TOKEN = 'lifecycle-test-token'
process.env.TELEGRAM_DISABLED = 'false'
delete process.env.DATABASE_URL
delete process.env.OBJECT_STORAGE_ACCESS_KEY_ID
delete process.env.OBJECT_STORAGE_BUCKET
delete process.env.OBJECT_STORAGE_ENDPOINT
delete process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY

const calls = []
let nextMessageId = 700
const savedPhotoPath = resolve(process.cwd(), 'var/candidate-media/photos/lifecycle-photo.jpg')
const savedVideoPath = resolve(process.cwd(), 'var/candidate-media/videos/lifecycle-video.mp4')

globalThis.fetch = async (url, options = {}) => {
  const requestUrl = String(url)

  if (requestUrl.includes('/file/bot')) {
    return new Response(new Uint8Array([255, 216, 255, 217]), {
      headers: {
        'content-length': '4',
        'content-type': 'image/jpeg',
      },
      status: 200,
    })
  }

  const method = requestUrl.split('/').at(-1)
  const payload = options.body instanceof FormData
    ? Object.fromEntries(options.body.entries())
    : JSON.parse(String(options.body ?? '{}'))
  let result = true

  if (method === 'sendMessage') {
    result = {
      chat: { id: payload.chat_id },
      message_id: nextMessageId++,
      text: payload.text,
    }
  } else if (method === 'sendPhoto') {
    result = {
      chat: { id: Number(payload.chat_id) },
      message_id: nextMessageId++,
      photo: [{ file_id: 'example-file-id' }],
    }
  } else if (method === 'sendVideo') {
    result = {
      chat: { id: Number(payload.chat_id) },
      message_id: nextMessageId++,
      video: { file_id: 'review-video-file-id' },
    }
  } else if (method === 'getFile') {
    result = {
      file_path: payload.file_id === 'candidate-video-file-id'
        ? 'videos/lifecycle-video.mp4'
        : 'photos/lifecycle-photo.jpg',
    }
  }

  calls.push({ method, payload })
  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })
}

const { __botTesting, handleBotUpdate } = await import('../server/bot.js')

function messageUpdate(updateId, userId, content) {
  return {
    message: {
      chat: { id: userId, type: 'private' },
      from: { first_name: 'Lifecycle', id: userId },
      message_id: updateId + 10_000,
      ...content,
    },
    update_id: updateId,
  }
}

function callbackUpdate(updateId, userId, messageId, messageText, data) {
  return {
    callback_query: {
      data,
      from: { first_name: 'Lifecycle', id: userId },
      id: `lifecycle-callback-${updateId}`,
      message: {
        chat: { id: userId, type: 'private' },
        message_id: messageId,
        text: messageText,
      },
    },
    update_id: updateId,
  }
}

function apiCalls(method) {
  return calls.filter((entry) => entry.method === method)
}

beforeEach(() => {
  calls.length = 0
  nextMessageId = 700
  __botTesting.resetRuntimeState()
})

after(async () => {
  await Promise.all([
    rm(savedPhotoPath, { force: true }),
    rm(savedVideoPath, { force: true }),
  ])
})

test('completed inline answer preserves and annotates the question while removing its buttons', async () => {
  const userId = 920001
  await handleBotUpdate(messageUpdate(1, userId, { text: '/start' }))

  const languagePrompt = apiCalls('sendMessage')[0]
  const callbackData = languagePrompt.payload.reply_markup.inline_keyboard[0][1].callback_data
  const messageId = 700
  calls.length = 0

  await handleBotUpdate(callbackUpdate(
    2,
    userId,
    messageId,
    languagePrompt.payload.text,
    callbackData,
  ))

  assert.equal(apiCalls('deleteMessage').length, 0)
  const annotation = apiCalls('editMessageText').at(-1)
  assert.match(annotation.payload.text, /✅ Answer: 🇬🇧 English/)
  assert.deepEqual(annotation.payload.reply_markup, { inline_keyboard: [] })
  assert.equal(__botTesting.sessionFor(userId).step, 'mode')
})

test('a new /start closes old controls but preserves the old prompt', async () => {
  const userId = 920002
  await handleBotUpdate(messageUpdate(3, userId, { text: '/start' }))
  calls.length = 0

  await handleBotUpdate(messageUpdate(4, userId, { text: '/start' }))

  assert.equal(apiCalls('deleteMessage').length, 0)
  assert.deepEqual(
    apiCalls('editMessageReplyMarkup').map((entry) => entry.payload.message_id),
    [700],
  )
  assert.equal(apiCalls('sendMessage').length, 1)
})

test('/cancel preserves questions and preview, disables controls, and deletes only temporary examples', async () => {
  const userId = 920003
  __botTesting.setSession(userId, {
    chatId: userId,
    data: { telegramUserId: String(userId) },
    flowId: 'cancel-flow',
    inlinePromptMessageIds: [801],
    lang: 'uz',
    previewControlMessageId: 803,
    previewMessageIds: [802, 803],
    promptMessageIds: [800, 801],
    proxy: false,
    step: 'city',
    temporaryExampleMessageIds: [804],
  })

  await handleBotUpdate(messageUpdate(5, userId, { text: '/cancel' }))

  assert.deepEqual(
    apiCalls('deleteMessage').map((entry) => entry.payload.message_id),
    [804],
  )
  assert.deepEqual(
    apiCalls('editMessageReplyMarkup').map((entry) => entry.payload.message_id).sort(),
    [801, 803],
  )
  assert.match(apiCalls('sendMessage').at(-1).payload.text, /Ro‘yxatdan o‘tish bekor qilindi/)
  assert.equal(__botTesting.sessionFor(userId), undefined)
})

test('submitting a candidate photo deletes its temporary example, never the user upload or question', async () => {
  const userId = 920004
  __botTesting.setSession(userId, {
    chatId: userId,
    data: {
      genderCode: 'male',
      telegramUserId: String(userId),
    },
    editing: false,
    flowId: 'photo-flow',
    inlinePromptMessageIds: [],
    lang: 'en',
    previewMessageIds: [],
    promptMessageIds: [901],
    proxy: false,
    step: 'fullBodyPhoto',
    temporaryExampleMessageIds: [900],
  })

  await handleBotUpdate(messageUpdate(6, userId, {
    photo: [{
      file_id: 'candidate-photo-file-id',
      file_unique_id: 'lifecycle-photo',
      height: 1000,
      width: 800,
    }],
  }))

  assert.deepEqual(
    apiCalls('deleteMessage').map((entry) => entry.payload.message_id),
    [900],
  )
  assert.equal(
    apiCalls('deleteMessage').some((entry) => [901, 10_006].includes(entry.payload.message_id)),
    false,
  )
  const session = __botTesting.sessionFor(userId)
  assert.equal(session.data.fullBodyPhotoPath, savedPhotoPath)
  assert.equal(session.step, 'closeShotPhoto')
})

test('replaying a completed photo update after a runtime restart cannot fill the next pose', async () => {
  const userId = 920005
  const update = messageUpdate(7, userId, {
    photo: [{
      file_id: 'replayed-candidate-photo-file-id',
      file_unique_id: 'lifecycle-photo',
      height: 1000,
      width: 800,
    }],
  })

  __botTesting.setSession(userId, {
    chatId: userId,
    data: {
      genderCode: 'female',
      telegramUserId: String(userId),
    },
    editing: false,
    flowId: 'restart-photo-flow',
    inlinePromptMessageIds: [],
    lang: 'en',
    previewMessageIds: [],
    promptMessageIds: [910],
    proxy: false,
    step: 'fullBodyPhoto',
    temporaryExampleMessageIds: [909],
  })

  await handleBotUpdate(update)
  const afterFirstDelivery = __botTesting.sessionFor(userId)
  assert.equal(afterFirstDelivery.step, 'closeShotPhoto')
  assert.equal(afterFirstDelivery.lastAppliedUpdateId, 7)
  assert.equal(afterFirstDelivery.data.closeShotPhotoPath, undefined)

  __botTesting.resetRuntimeState()
  calls.length = 0

  const replayResult = await handleBotUpdate(update)
  const afterReplay = __botTesting.sessionFor(userId)

  assert.equal(replayResult.reason, 'user_update_already_applied')
  assert.equal(afterReplay.step, 'closeShotPhoto')
  assert.equal(afterReplay.data.closeShotPhotoPath, undefined)
  assert.equal(calls.length, 0)
})

test('submitting a candidate video deletes only its temporary example and keeps the upload for preview', async () => {
  const userId = 920006
  __botTesting.setSession(userId, {
    chatId: userId,
    data: {
      genderCode: 'male',
      name: 'Video Candidate',
      telegramUserId: String(userId),
    },
    editing: false,
    flowId: 'video-flow',
    inlinePromptMessageIds: [],
    lang: 'en',
    previewMessageIds: [],
    promptMessageIds: [951],
    proxy: false,
    step: 'video',
    temporaryExampleMessageIds: [950],
  })

  await handleBotUpdate(messageUpdate(8, userId, {
    video: {
      duration: 45,
      file_id: 'candidate-video-file-id',
      file_unique_id: 'lifecycle-video',
    },
  }))

  assert.deepEqual(
    apiCalls('deleteMessage').map((entry) => entry.payload.message_id),
    [950],
  )
  assert.equal(
    apiCalls('deleteMessage').some((entry) => [951, 10_008].includes(entry.payload.message_id)),
    false,
  )
  const session = __botTesting.sessionFor(userId)
  assert.equal(session.data.introVideoPath, savedVideoPath)
  assert.equal(session.step, 'preview')
  assert.equal(session.temporaryExampleMessageIds.length, 0)
})
