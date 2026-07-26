import { mkdir, readFile, appendFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { hasPostgres, query } from './postgres.js'

const auditPath = resolve(
  process.env.AUDIT_LOG_PATH ?? resolve(process.cwd(), 'var/audit-log.jsonl'),
)

export async function recordAuditEvent(event) {
  const entry = {
    ...event,
    at: new Date().toISOString(),
  }

  if (hasPostgres()) {
    await query(
      `
        INSERT INTO audit_events (
          action,
          candidate_id,
          casting_id,
          participation_id,
          actor,
          actor_telegram_id,
          outcome,
          data,
          at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      `,
      [
        entry.action,
        entry.candidateId ?? null,
        entry.castingId ?? null,
        entry.participationId ?? null,
        entry.actor ?? null,
        entry.actorTelegramId ? String(entry.actorTelegramId) : null,
        entry.outcome ?? null,
        JSON.stringify(entry),
        entry.at,
      ],
    )

    return entry
  }

  await mkdir(dirname(auditPath), { recursive: true })
  await appendFile(auditPath, `${JSON.stringify(entry)}\n`, 'utf8')

  return entry
}

export async function readAuditEvents(limit = 100) {
  if (hasPostgres()) {
    const result = await query(
      `
        SELECT data, at
        FROM audit_events
        ORDER BY at DESC
        LIMIT $1
      `,
      [limit],
    )

    return result.rows
      .map((row) => ({
        ...row.data,
        at: row.data?.at ?? row.at?.toISOString?.() ?? row.at,
      }))
      .reverse()
  }

  try {
    const content = await readFile(auditPath, 'utf8')

    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-limit)
      .map((line) => JSON.parse(line))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}
