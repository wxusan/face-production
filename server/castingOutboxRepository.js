import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { hasPostgres, query } from './postgres.js'

const outboxPath = resolve(
  process.env.CASTING_OUTBOX_PATH ?? resolve(process.cwd(), 'var/casting-outbox.json'),
)
const outboxStatuses = new Set(['pending', 'processing', 'sent', 'failed', 'cancelled'])

async function readLocalOutbox() {
  try {
    const parsed = JSON.parse(await readFile(outboxPath, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

async function writeLocalOutbox(outbox) {
  await mkdir(dirname(outboxPath), { recursive: true })
  await writeFile(outboxPath, `${JSON.stringify(outbox, null, 2)}\n`, 'utf8')
}

function rowToOutboxEvent(row) {
  return {
    attemptCount: Number(row.attempt_count ?? 0),
    availableAt: row.available_at?.toISOString?.() ?? row.available_at,
    castingId: row.casting_id,
    claimedAt: row.claimed_at?.toISOString?.() ?? row.claimed_at,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    eventType: row.event_type,
    id: row.id,
    lastErrorCode: row.last_error_code,
    operationId: row.operation_id,
    participationId: row.participation_id,
    payload: row.payload ?? {},
    recipientKey: row.recipient_key,
    sentAt: row.sent_at?.toISOString?.() ?? row.sent_at,
    status: row.status,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  }
}

export async function enqueueCastingOutboxEvent({
  availableAt = new Date().toISOString(),
  castingId,
  eventType,
  operationId,
  participationId,
  payload = {},
  recipientKey,
}) {
  const normalizedOperationId = String(operationId ?? '').trim()
  if (!normalizedOperationId || normalizedOperationId.length > 220) {
    const error = new Error('A valid casting outbox operationId is required')
    error.statusCode = 400
    throw error
  }

  if (hasPostgres()) {
    const result = await query(
      `
        INSERT INTO casting_outbox (
          id,
          operation_id,
          event_type,
          casting_id,
          participation_id,
          recipient_key,
          payload,
          available_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        ON CONFLICT (operation_id) DO NOTHING
        RETURNING *
      `,
      [
        `CO-${randomUUID()}`,
        normalizedOperationId,
        String(eventType),
        castingId ?? null,
        participationId ?? null,
        recipientKey ?? null,
        JSON.stringify(payload),
        availableAt,
      ],
    )
    if (result.rows[0]) {
      return { changed: true, event: rowToOutboxEvent(result.rows[0]) }
    }
    const existing = await query(
      'SELECT * FROM casting_outbox WHERE operation_id = $1 LIMIT 1',
      [normalizedOperationId],
    )
    return { changed: false, event: rowToOutboxEvent(existing.rows[0]) }
  }

  const outbox = await readLocalOutbox()
  const existing = outbox.find((item) => item.operationId === normalizedOperationId)
  if (existing) {
    return { changed: false, event: existing }
  }
  const now = new Date().toISOString()
  const event = {
    attemptCount: 0,
    availableAt,
    castingId: castingId ?? null,
    claimedAt: '',
    createdAt: now,
    eventType: String(eventType),
    id: `CO-${randomUUID()}`,
    lastErrorCode: '',
    operationId: normalizedOperationId,
    participationId: participationId ?? null,
    payload: structuredClone(payload),
    recipientKey: recipientKey ?? null,
    sentAt: '',
    status: 'pending',
    updatedAt: now,
  }
  outbox.push(event)
  await writeLocalOutbox(outbox)
  return { changed: true, event }
}

export async function listCastingOutboxEvents({ castingId, status } = {}) {
  if (status && !outboxStatuses.has(status)) {
    const error = new Error('Casting outbox status is invalid')
    error.statusCode = 400
    throw error
  }

  if (hasPostgres()) {
    const result = await query(
      `
        SELECT *
        FROM casting_outbox
        WHERE ($1::text IS NULL OR casting_id = $1)
          AND ($2::text IS NULL OR status = $2)
        ORDER BY created_at ASC, id ASC
      `,
      [castingId ?? null, status ?? null],
    )
    return result.rows.map(rowToOutboxEvent)
  }

  return (await readLocalOutbox()).filter(
    (event) => (!castingId || event.castingId === castingId) && (!status || event.status === status),
  )
}

export async function listReadyCastingOutboxEvents(limit = 25) {
  const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 25))
  if (hasPostgres()) {
    const result = await query(
      `
        SELECT *
        FROM casting_outbox
        WHERE (
            status IN ('pending', 'failed')
            OR (status = 'processing' AND claimed_at < now() - interval '2 minutes')
          )
          AND available_at <= now()
          AND attempt_count < 5
        ORDER BY available_at ASC, created_at ASC
        LIMIT $1
      `,
      [normalizedLimit],
    )
    return result.rows.map(rowToOutboxEvent)
  }

  const now = new Date()
  return (await readLocalOutbox())
    .filter(
      (event) =>
        (
          ['pending', 'failed'].includes(event.status)
          || (
            event.status === 'processing'
            && event.claimedAt
            && new Date(event.claimedAt).getTime() < now.getTime() - 120_000
          )
        )
        && new Date(event.availableAt) <= now
        && event.attemptCount < 5,
    )
    .slice(0, normalizedLimit)
}

export async function markCastingOutboxEvent(operationId, status, errorCode = '') {
  if (!outboxStatuses.has(status)) {
    const error = new Error('Casting outbox status is invalid')
    error.statusCode = 400
    throw error
  }
  const now = new Date().toISOString()

  if (hasPostgres()) {
    const result = await query(
      `
        UPDATE casting_outbox
        SET
          status = $2,
          attempt_count = attempt_count + CASE WHEN $2 = 'processing' THEN 1 ELSE 0 END,
          claimed_at = CASE WHEN $2 = 'processing' THEN now() ELSE claimed_at END,
          sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
          available_at = CASE
            WHEN $2 = 'failed'
              THEN now() + (LEAST(300, 15 * GREATEST(1, attempt_count)) || ' seconds')::interval
            ELSE available_at
          END,
          last_error_code = NULLIF($3, ''),
          updated_at = now()
        WHERE operation_id = $1
        RETURNING *
      `,
      [operationId, status, String(errorCode).slice(0, 100)],
    )
    return result.rows[0] ? rowToOutboxEvent(result.rows[0]) : undefined
  }

  const outbox = await readLocalOutbox()
  const event = outbox.find((item) => item.operationId === operationId)
  if (!event) return undefined
  event.status = status
  event.attemptCount += status === 'processing' ? 1 : 0
  event.claimedAt = status === 'processing' ? now : event.claimedAt
  event.sentAt = status === 'sent' ? now : event.sentAt
  event.availableAt = status === 'failed'
    ? new Date(Date.now() + Math.min(300, 15 * Math.max(1, event.attemptCount)) * 1000).toISOString()
    : event.availableAt
  event.lastErrorCode = String(errorCode).slice(0, 100)
  event.updatedAt = now
  await writeLocalOutbox(outbox)
  return event
}
