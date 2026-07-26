import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

delete process.env.DATABASE_URL
delete process.env.RAILWAY_ENVIRONMENT_ID
delete process.env.RAILWAY_PROJECT_ID
delete process.env.VERCEL

const originalNodeEnv = process.env.NODE_ENV
const {
  getTelegramExampleFile,
  invalidateTelegramExampleFile,
  recordTelegramExampleAvailability,
  resetTelegramExampleMemoryForTests,
  upsertTelegramExampleFile,
} = await import('../server/telegramExampleRepository.js')

beforeEach(() => {
  process.env.NODE_ENV = 'test'
  resetTelegramExampleMemoryForTests()
})

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv
})

test('stores and retrieves reusable Telegram example file identifiers', async () => {
  const key = {
    assetKey: 'male.full-body',
    telegramMethod: 'sendPhoto',
    mediaKind: 'photo',
  }

  assert.equal(await getTelegramExampleFile(key), null)

  const saved = await upsertTelegramExampleFile({
    ...key,
    fileId: 'AgACAgQAAxkBAAIB',
    fileUniqueId: 'AQAD-example-unique',
  })

  assert.equal(saved.fileId, 'AgACAgQAAxkBAAIB')
  assert.equal(saved.fileUniqueId, 'AQAD-example-unique')
  assert.equal(saved.availabilityStatus, 'available')
  assert.ok(saved.lastValidatedAt)

  assert.deepEqual(await getTelegramExampleFile(key), saved)
})

test('availability records preserve a reusable file until it is invalidated', async () => {
  const key = {
    assetKey: 'female.introduction',
    telegramMethod: 'sendVideo',
    mediaKind: 'video',
  }

  await upsertTelegramExampleFile({
    ...key,
    fileId: 'BAACAgQAAxkBAAIC',
  })

  const missing = await recordTelegramExampleAvailability({
    ...key,
    availabilityStatus: 'missing',
    errorCode: 'object_not_found',
  })

  assert.equal(missing.fileId, 'BAACAgQAAxkBAAIC')
  assert.equal(missing.availabilityStatus, 'missing')
  assert.equal(missing.lastValidationErrorCode, 'object_not_found')

  const invalid = await invalidateTelegramExampleFile({
    ...key,
    errorCode: 'telegram_wrong_file_identifier',
  })

  assert.equal(invalid.fileId, null)
  assert.equal(invalid.fileUniqueId, null)
  assert.equal(invalid.availabilityStatus, 'invalid')
  assert.equal(
    invalid.lastValidationErrorCode,
    'telegram_wrong_file_identifier',
  )
})

test('rejects malformed keys and availability states', async () => {
  await assert.rejects(
    () =>
      getTelegramExampleFile({
        assetKey: '',
        telegramMethod: 'sendPhoto',
        mediaKind: 'photo',
      }),
    /assetKey is invalid/,
  )

  await assert.rejects(
    () =>
      recordTelegramExampleAvailability({
        assetKey: 'male.portrait',
        telegramMethod: 'sendPhoto',
        mediaKind: 'photo',
        availabilityStatus: 'maybe',
      }),
    /availabilityStatus is invalid/,
  )
})

test('requires durable storage in production deployments', async () => {
  process.env.NODE_ENV = 'production'

  await assert.rejects(
    () =>
      getTelegramExampleFile({
        assetKey: 'male.portrait',
        telegramMethod: 'sendPhoto',
        mediaKind: 'photo',
      }),
    (error) => {
      assert.equal(error.statusCode, 503)
      assert.match(error.message, /DATABASE_URL is required/)
      return true
    },
  )
})
