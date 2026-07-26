import { hasPostgres, query } from './postgres.js'

const memoryExamples = new Map()
const availabilityStatuses = new Set(['unknown', 'available', 'missing', 'invalid'])

function normalizeIdentifier(value, field) {
  const normalized = String(value ?? '').trim()

  if (!normalized || normalized.length > 200) {
    const error = new Error(`${field} is invalid`)
    error.statusCode = 400
    throw error
  }

  return normalized
}

function normalizeOptionalIdentifier(value, field) {
  if (value == null || value === '') return null
  return normalizeIdentifier(value, field)
}

function normalizeAvailabilityStatus(value) {
  const normalized = String(value ?? '').trim().toLowerCase()

  if (!availabilityStatuses.has(normalized)) {
    const error = new Error('availabilityStatus is invalid')
    error.statusCode = 400
    throw error
  }

  return normalized
}

function requireDurableProductionStorage() {
  const deployed =
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.RAILWAY_ENVIRONMENT_ID) ||
    Boolean(process.env.RAILWAY_PROJECT_ID) ||
    Boolean(process.env.VERCEL)

  if (!hasPostgres() && deployed) {
    const error = new Error(
      'DATABASE_URL is required for durable Telegram example media caching',
    )
    error.statusCode = 503
    throw error
  }
}

function normalizeKey({ assetKey, telegramMethod, mediaKind }) {
  return {
    assetKey: normalizeIdentifier(assetKey, 'assetKey'),
    telegramMethod: normalizeIdentifier(telegramMethod, 'telegramMethod'),
    mediaKind: normalizeIdentifier(mediaKind, 'mediaKind'),
  }
}

function memoryKey(key) {
  return JSON.stringify([key.assetKey, key.telegramMethod, key.mediaKind])
}

function mapRow(row) {
  if (!row) return null

  return {
    assetKey: row.asset_key,
    telegramMethod: row.telegram_method,
    mediaKind: row.media_kind,
    fileId: row.file_id ?? null,
    fileUniqueId: row.file_unique_id ?? null,
    availabilityStatus: row.availability_status,
    lastValidationErrorCode: row.last_validation_error_code ?? null,
    lastValidatedAt: row.last_validated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function cloneMemoryRecord(record) {
  return record ? structuredClone(record) : null
}

export async function getTelegramExampleFile(keyInput) {
  requireDurableProductionStorage()
  const key = normalizeKey(keyInput)

  if (!hasPostgres()) {
    return cloneMemoryRecord(memoryExamples.get(memoryKey(key)))
  }

  const result = await query(
    `
      SELECT
        asset_key,
        telegram_method,
        media_kind,
        file_id,
        file_unique_id,
        availability_status,
        last_validation_error_code,
        last_validated_at,
        created_at,
        updated_at
      FROM telegram_example_files
      WHERE asset_key = $1
        AND telegram_method = $2
        AND media_kind = $3
      LIMIT 1
    `,
    [key.assetKey, key.telegramMethod, key.mediaKind],
  )

  return mapRow(result.rows[0])
}

export async function upsertTelegramExampleFile({
  assetKey,
  telegramMethod,
  mediaKind,
  fileId,
  fileUniqueId = null,
}) {
  requireDurableProductionStorage()
  const key = normalizeKey({ assetKey, telegramMethod, mediaKind })
  const normalizedFileId = normalizeIdentifier(fileId, 'fileId')
  const normalizedFileUniqueId = normalizeOptionalIdentifier(
    fileUniqueId,
    'fileUniqueId',
  )

  if (!hasPostgres()) {
    const previous = memoryExamples.get(memoryKey(key))
    const now = new Date().toISOString()
    const record = {
      ...key,
      fileId: normalizedFileId,
      fileUniqueId: normalizedFileUniqueId,
      availabilityStatus: 'available',
      lastValidationErrorCode: null,
      lastValidatedAt: now,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    memoryExamples.set(memoryKey(key), record)
    return cloneMemoryRecord(record)
  }

  const result = await query(
    `
      INSERT INTO telegram_example_files (
        asset_key,
        telegram_method,
        media_kind,
        file_id,
        file_unique_id,
        availability_status,
        last_validation_error_code,
        last_validated_at
      )
      VALUES ($1, $2, $3, $4, $5, 'available', NULL, now())
      ON CONFLICT (asset_key, telegram_method, media_kind) DO UPDATE SET
        file_id = EXCLUDED.file_id,
        file_unique_id = EXCLUDED.file_unique_id,
        availability_status = 'available',
        last_validation_error_code = NULL,
        last_validated_at = now(),
        updated_at = now()
      RETURNING
        asset_key,
        telegram_method,
        media_kind,
        file_id,
        file_unique_id,
        availability_status,
        last_validation_error_code,
        last_validated_at,
        created_at,
        updated_at
    `,
    [
      key.assetKey,
      key.telegramMethod,
      key.mediaKind,
      normalizedFileId,
      normalizedFileUniqueId,
    ],
  )

  return mapRow(result.rows[0])
}

export async function recordTelegramExampleAvailability({
  assetKey,
  telegramMethod,
  mediaKind,
  availabilityStatus,
  errorCode = null,
}) {
  requireDurableProductionStorage()
  const key = normalizeKey({ assetKey, telegramMethod, mediaKind })
  const status = normalizeAvailabilityStatus(availabilityStatus)
  const normalizedErrorCode = normalizeOptionalIdentifier(errorCode, 'errorCode')

  if (!hasPostgres()) {
    const previous = memoryExamples.get(memoryKey(key))
    const now = new Date().toISOString()
    const record = {
      ...key,
      fileId: previous?.fileId ?? null,
      fileUniqueId: previous?.fileUniqueId ?? null,
      availabilityStatus: status,
      lastValidationErrorCode: normalizedErrorCode,
      lastValidatedAt: now,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    memoryExamples.set(memoryKey(key), record)
    return cloneMemoryRecord(record)
  }

  const result = await query(
    `
      INSERT INTO telegram_example_files (
        asset_key,
        telegram_method,
        media_kind,
        availability_status,
        last_validation_error_code,
        last_validated_at
      )
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (asset_key, telegram_method, media_kind) DO UPDATE SET
        availability_status = EXCLUDED.availability_status,
        last_validation_error_code = EXCLUDED.last_validation_error_code,
        last_validated_at = now(),
        updated_at = now()
      RETURNING
        asset_key,
        telegram_method,
        media_kind,
        file_id,
        file_unique_id,
        availability_status,
        last_validation_error_code,
        last_validated_at,
        created_at,
        updated_at
    `,
    [
      key.assetKey,
      key.telegramMethod,
      key.mediaKind,
      status,
      normalizedErrorCode,
    ],
  )

  return mapRow(result.rows[0])
}

export async function invalidateTelegramExampleFile({
  assetKey,
  telegramMethod,
  mediaKind,
  errorCode = 'telegram_file_invalid',
}) {
  requireDurableProductionStorage()
  const key = normalizeKey({ assetKey, telegramMethod, mediaKind })
  const normalizedErrorCode = normalizeOptionalIdentifier(errorCode, 'errorCode')

  if (!hasPostgres()) {
    const previous = memoryExamples.get(memoryKey(key))
    const now = new Date().toISOString()
    const record = {
      ...key,
      fileId: null,
      fileUniqueId: null,
      availabilityStatus: 'invalid',
      lastValidationErrorCode: normalizedErrorCode,
      lastValidatedAt: now,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    memoryExamples.set(memoryKey(key), record)
    return cloneMemoryRecord(record)
  }

  const result = await query(
    `
      INSERT INTO telegram_example_files (
        asset_key,
        telegram_method,
        media_kind,
        availability_status,
        last_validation_error_code,
        last_validated_at
      )
      VALUES ($1, $2, $3, 'invalid', $4, now())
      ON CONFLICT (asset_key, telegram_method, media_kind) DO UPDATE SET
        file_id = NULL,
        file_unique_id = NULL,
        availability_status = 'invalid',
        last_validation_error_code = EXCLUDED.last_validation_error_code,
        last_validated_at = now(),
        updated_at = now()
      RETURNING
        asset_key,
        telegram_method,
        media_kind,
        file_id,
        file_unique_id,
        availability_status,
        last_validation_error_code,
        last_validated_at,
        created_at,
        updated_at
    `,
    [
      key.assetKey,
      key.telegramMethod,
      key.mediaKind,
      normalizedErrorCode,
    ],
  )

  return mapRow(result.rows[0])
}

export function resetTelegramExampleMemoryForTests() {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.RAILWAY_ENVIRONMENT_ID ||
    process.env.RAILWAY_PROJECT_ID ||
    process.env.VERCEL
  ) {
    throw new Error('The Telegram example memory cache cannot be reset in production')
  }

  memoryExamples.clear()
}
