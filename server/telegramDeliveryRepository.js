import { hasPostgres, query } from './postgres.js'

function normalizeIdentifier(value, field) {
  const normalized = String(value ?? '').trim()

  if (!normalized || normalized.length > 200) {
    const error = new Error(`${field} is invalid`)
    error.statusCode = 400
    throw error
  }

  return normalized
}

function requirePostgres() {
  if (hasPostgres()) {
    return
  }

  const error = new Error('DATABASE_URL is required for durable Telegram delivery')
  error.statusCode = 503
  throw error
}

export async function claimTelegramDelivery({
  operationId,
  recipientKey,
  chatId,
  kind,
  data = {},
}) {
  requirePostgres()
  const normalizedOperationId = normalizeIdentifier(operationId, 'operationId')
  const normalizedRecipientKey = normalizeIdentifier(recipientKey, 'recipientKey')
  const normalizedChatId = normalizeIdentifier(chatId, 'chatId')
  const normalizedKind = normalizeIdentifier(kind, 'kind')

  const claimed = await query(
    `
      INSERT INTO telegram_deliveries (
        operation_id,
        recipient_key,
        chat_id,
        kind,
        status,
        data
      )
      VALUES ($1, $2, $3, $4, 'sending', $5::jsonb)
      ON CONFLICT (operation_id, recipient_key) DO UPDATE SET
        status = 'sending',
        attempt_count = telegram_deliveries.attempt_count + 1,
        last_error_code = NULL,
        updated_at = now()
      WHERE telegram_deliveries.status = 'failed'
      RETURNING status, message_id, attempt_count
    `,
    [
      normalizedOperationId,
      normalizedRecipientKey,
      normalizedChatId,
      normalizedKind,
      JSON.stringify(data),
    ],
  )

  if (claimed.rowCount === 1) {
    return {
      attemptCount: claimed.rows[0].attempt_count,
      claimed: true,
      operationId: normalizedOperationId,
      recipientKey: normalizedRecipientKey,
      status: claimed.rows[0].status,
    }
  }

  const existing = await query(
    `
      SELECT status, message_id, attempt_count
      FROM telegram_deliveries
      WHERE operation_id = $1
        AND recipient_key = $2
      LIMIT 1
    `,
    [normalizedOperationId, normalizedRecipientKey],
  )
  const row = existing.rows[0]

  return {
    attemptCount: row?.attempt_count,
    claimed: false,
    messageId: row?.message_id,
    operationId: normalizedOperationId,
    recipientKey: normalizedRecipientKey,
    status: row?.status ?? 'unknown',
  }
}

export async function completeTelegramDelivery(claim, messageId) {
  requirePostgres()

  const result = await query(
    `
      UPDATE telegram_deliveries
      SET
        status = 'sent',
        message_id = $3,
        sent_at = now(),
        updated_at = now(),
        last_error_code = NULL
      WHERE operation_id = $1
        AND recipient_key = $2
        AND status = 'sending'
      RETURNING operation_id
    `,
    [claim.operationId, claim.recipientKey, String(messageId ?? '')],
  )

  if (result.rowCount !== 1) {
    throw new Error('Telegram delivery claim was lost before completion')
  }
}

export async function failTelegramDelivery(claim, error) {
  requirePostgres()
  const status = error?.deliveryUncertain ? 'uncertain' : 'failed'
  const errorCode = String(error?.code ?? error?.name ?? 'delivery_error').slice(0, 80)

  await query(
    `
      UPDATE telegram_deliveries
      SET
        status = $3,
        last_error_code = $4,
        updated_at = now()
      WHERE operation_id = $1
        AND recipient_key = $2
        AND status = 'sending'
    `,
    [claim.operationId, claim.recipientKey, status, errorCode],
  )
}
