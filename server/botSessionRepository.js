import { hasPostgres, query } from './postgres.js'

const memorySessions = new Map()

export async function getBotSession(telegramUserId) {
  const userId = String(telegramUserId)

  if (!hasPostgres()) {
    return memorySessions.get(userId)
  }

  const result = await query(
    `
      SELECT data
      FROM bot_sessions
      WHERE telegram_user_id = $1
      LIMIT 1
    `,
    [userId],
  )

  return result.rows[0]?.data
}

export async function saveBotSession(telegramUserId, session) {
  const userId = String(telegramUserId)

  if (!hasPostgres()) {
    memorySessions.set(userId, session)
    return session
  }

  await query(
    `
      INSERT INTO bot_sessions (telegram_user_id, data, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (telegram_user_id) DO UPDATE SET
        data = EXCLUDED.data,
        updated_at = now()
    `,
    [userId, JSON.stringify(session)],
  )

  return session
}

export async function deleteBotSession(telegramUserId) {
  const userId = String(telegramUserId)

  if (!hasPostgres()) {
    memorySessions.delete(userId)
    return
  }

  await query('DELETE FROM bot_sessions WHERE telegram_user_id = $1', [userId])
}
