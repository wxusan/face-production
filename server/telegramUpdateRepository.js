import { hasPostgres, query, withPostgresAdvisoryLock } from './postgres.js'

const STALE_CLAIM_MINUTES = 10
const TELEGRAM_USER_LOCK_NAMESPACE = 164721

function normalizeUpdateId(value) {
  const updateId = Number(value)

  if (!Number.isSafeInteger(updateId) || updateId < 0) {
    const error = new Error('Telegram update_id is invalid')
    error.statusCode = 400
    throw error
  }

  return updateId
}

function requirePostgres() {
  if (hasPostgres()) {
    return
  }

  const error = new Error('DATABASE_URL is required for durable Telegram update processing')
  error.statusCode = 503
  throw error
}

/**
 * Atomically claim an update. A completed update is never processed twice;
 * an abandoned in-flight claim can be recovered after the timeout.
 */
export async function claimTelegramUpdate(value) {
  requirePostgres()
  const updateId = normalizeUpdateId(value)

  const result = await query(
    `
      INSERT INTO telegram_updates (
        update_id,
        status,
        attempt_count,
        claimed_at,
        updated_at
      )
      VALUES ($1, 'processing', 1, now(), now())
      ON CONFLICT (update_id) DO UPDATE SET
        status = 'processing',
        attempt_count = telegram_updates.attempt_count + 1,
        claimed_at = now(),
        last_error_code = NULL,
        updated_at = now()
      WHERE telegram_updates.status = 'failed'
        OR (
          telegram_updates.status = 'processing'
          AND telegram_updates.claimed_at < now() - ($2 * interval '1 minute')
        )
      RETURNING update_id, attempt_count
    `,
    [updateId, STALE_CLAIM_MINUTES],
  )

  if (result.rowCount === 1) {
    return {
      attemptCount: result.rows[0].attempt_count,
      claimed: true,
      status: 'processing',
      updateId,
    }
  }

  const existing = await query(
    `
      SELECT status, attempt_count, claimed_at
      FROM telegram_updates
      WHERE update_id = $1
      LIMIT 1
    `,
    [updateId],
  )

  return {
    attemptCount: existing.rows[0]?.attempt_count,
    claimed: false,
    claimedAt: existing.rows[0]?.claimed_at,
    status: existing.rows[0]?.status ?? 'unknown',
    updateId,
  }
}

export async function withTelegramUserLock(telegramUserId, task) {
  if (telegramUserId == null || telegramUserId === '') {
    return task()
  }

  return withPostgresAdvisoryLock(
    TELEGRAM_USER_LOCK_NAMESPACE,
    String(telegramUserId),
    task,
  )
}

export async function completeTelegramUpdate(value) {
  requirePostgres()
  const updateId = normalizeUpdateId(value)

  const result = await query(
    `
      UPDATE telegram_updates
      SET
        status = 'completed',
        processed_at = now(),
        updated_at = now(),
        last_error_code = NULL
      WHERE update_id = $1
        AND status = 'processing'
      RETURNING update_id
    `,
    [updateId],
  )

  if (result.rowCount !== 1) {
    throw new Error('Telegram update claim was lost before completion')
  }
}

/**
 * Release a claimed update so Telegram can retry it. Only an error class/code
 * is stored; error messages can contain user data or secrets.
 */
export async function releaseTelegramUpdate(value, error) {
  requirePostgres()
  const updateId = normalizeUpdateId(value)
  const errorCode = String(error?.code ?? error?.name ?? 'handler_error').slice(0, 80)

  await query(
    `
      UPDATE telegram_updates
      SET
        status = 'failed',
        last_error_code = $2,
        updated_at = now()
      WHERE update_id = $1
        AND status = 'processing'
    `,
    [updateId, errorCode],
  )
}
