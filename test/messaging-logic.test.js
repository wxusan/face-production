import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

process.env.TELEGRAM_BOT_TOKEN = 'test-token'
process.env.TELEGRAM_DISABLED = 'false'
delete process.env.DATABASE_URL

const calls = []
let nextMessageId = 100

globalThis.fetch = async (url, options = {}) => {
  const method = String(url).split('/').at(-1)
  const payload = options.body instanceof FormData
    ? Object.fromEntries(options.body.entries())
    : JSON.parse(String(options.body ?? '{}'))
  const result = method === 'sendMessage'
    ? { chat: { id: payload.chat_id }, message_id: nextMessageId++, text: payload.text }
    : method === 'sendMediaGroup'
      ? []
      : true

  calls.push({ method, payload })
  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })
}

const { __botTesting, handleBotUpdate } = await import('../server/bot.js')

function messageUpdate(updateId, userId, text) {
  return {
    message: {
      chat: { id: userId, type: 'private' },
      from: { first_name: 'Test', id: userId },
      message_id: updateId + 1000,
      text,
    },
    update_id: updateId,
  }
}

function callbackUpdate(updateId, userId, messageId, data) {
  return {
    callback_query: {
      data,
      from: { first_name: 'Test', id: userId },
      id: `callback-${updateId}`,
      message: {
        chat: { id: userId, type: 'private' },
        message_id: messageId,
      },
    },
    update_id: updateId,
  }
}

function sentMessages() {
  return calls.filter((entry) => entry.method === 'sendMessage')
}

beforeEach(() => {
  calls.length = 0
  nextMessageId = 100
  __botTesting.resetRuntimeState()
})

test('/start sends one language prompt and does not delete the user command', async () => {
  const userId = 910001
  await handleBotUpdate(messageUpdate(1, userId, '/start'))

  assert.equal(sentMessages().length, 1)
  assert.equal(calls.some((entry) => entry.method === 'deleteMessage'), false)

  const languageMessage = sentMessages()[0]
  const callbackData = languageMessage.payload.reply_markup.inline_keyboard[0][0].callback_data
  assert.match(callbackData, /^lang:[a-f0-9-]+:ru$/)
  assert.equal(__botTesting.sessionFor(userId).step, 'language')
})

test('rapid repeated /start leaves exactly one current prompt', async () => {
  const userId = 910002
  await Promise.all([
    handleBotUpdate(messageUpdate(2, userId, '/start')),
    handleBotUpdate(messageUpdate(3, userId, '/start')),
  ])

  const state = __botTesting.sessionFor(userId)
  assert.equal(state.step, 'language')
  assert.equal(state.promptMessageIds.length, 1)
  assert.equal(calls.filter((entry) => entry.method === 'deleteMessage').length, 0)
  assert.deepEqual(
    calls
      .filter((entry) => entry.method === 'editMessageReplyMarkup')
      .map((entry) => entry.payload.message_id),
    [100],
  )
})

test('a language button can advance only once', async () => {
  const userId = 910003
  await handleBotUpdate(messageUpdate(4, userId, '/start'))
  const languageMessage = sentMessages()[0]
  const callbackData = languageMessage.payload.reply_markup.inline_keyboard[0][0].callback_data
  calls.length = 0

  await Promise.all([
    handleBotUpdate(callbackUpdate(5, userId, languageMessage.payload.chat_id ? 100 : 100, callbackData)),
    handleBotUpdate(callbackUpdate(6, userId, 100, callbackData)),
  ])

  assert.equal(sentMessages().length, 1)
  assert.equal(__botTesting.sessionFor(userId).step, 'mode')
  assert.equal(calls.filter((entry) => entry.method === 'answerCallbackQuery').length, 2)
})

test('all three interface languages advance with their localized registration prompt', async () => {
  const cases = [
    { expected: 'Для кого заполняем анкету?', index: 0, lang: 'ru', userId: 910031 },
    { expected: 'Who is this profile for?', index: 1, lang: 'en', userId: 910032 },
    { expected: 'Anketa kim uchun?', index: 2, lang: 'uz', userId: 910033 },
  ]

  for (const item of cases) {
    await handleBotUpdate(messageUpdate(item.userId, item.userId, '/start'))
    const languageMessage = sentMessages().at(-1)
    const callbackData = languageMessage.payload.reply_markup.inline_keyboard[0][item.index].callback_data
    const languageMessageId = nextMessageId - 1
    calls.length = 0

    await handleBotUpdate(callbackUpdate(
      item.userId + 100,
      item.userId,
      languageMessageId,
      callbackData,
    ))

    const state = __botTesting.sessionFor(item.userId)
    assert.equal(state.lang, item.lang)
    assert.equal(state.step, 'mode')
    assert.equal(sentMessages().at(-1).payload.text, item.expected)
    calls.length = 0
  }
})

test('an in-progress registration resumes from durable session state after a runtime restart', async () => {
  const userId = 910034
  await handleBotUpdate(messageUpdate(34, userId, '/start'))
  const languageMessage = sentMessages().at(-1)
  const callbackData = languageMessage.payload.reply_markup.inline_keyboard[0][2].callback_data
  const languageMessageId = nextMessageId - 1

  __botTesting.resetRuntimeState()
  calls.length = 0

  await handleBotUpdate(callbackUpdate(35, userId, languageMessageId, callbackData))

  const state = __botTesting.sessionFor(userId)
  assert.equal(state.lang, 'uz')
  assert.equal(state.step, 'mode')
  assert.equal(sentMessages().at(-1).payload.text, 'Anketa kim uchun?')
})

test('rapid text answers cannot skip a registration step', async () => {
  const userId = 910004
  await handleBotUpdate(messageUpdate(7, userId, '/start'))
  const languageMessage = sentMessages().at(-1)
  const languageData = languageMessage.payload.reply_markup.inline_keyboard[0][1].callback_data
  await handleBotUpdate(callbackUpdate(8, userId, 100, languageData))
  const modeMessage = sentMessages().at(-1)
  const modeData = modeMessage.payload.reply_markup.inline_keyboard[0][0].callback_data
  await handleBotUpdate(callbackUpdate(9, userId, modeMessage.payload.chat_id ? 101 : 101, modeData))
  calls.length = 0

  await Promise.all([
    handleBotUpdate(messageUpdate(10, userId, 'Alice Example')),
    handleBotUpdate(messageUpdate(11, userId, 'Bob Example')),
  ])

  const state = __botTesting.sessionFor(userId)
  assert.equal(state.step, 'phone')
  assert.equal(state.data.name, 'Alice Example')
  assert.equal(state.data.phone, undefined)
  assert.equal(sentMessages().length, 2)
})

test('/help keeps the active registration step', async () => {
  const userId = 910005
  await handleBotUpdate(messageUpdate(12, userId, '/start'))
  const before = __botTesting.sessionFor(userId)

  await handleBotUpdate(messageUpdate(13, userId, '/help'))

  const after = __botTesting.sessionFor(userId)
  assert.equal(after.step, before.step)
  assert.deepEqual(after.promptMessageIds, before.promptMessageIds)
})
