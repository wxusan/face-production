import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { hasPostgres, query } from './postgres.js'

const channelPath = resolve(
  process.env.CASTING_CHANNEL_CONFIG_PATH ?? resolve(process.cwd(), 'var/casting-channel.json'),
)
const defaultChannelKey = 'casting_announcements'

function defaultConfig() {
  const telegramChatId = String(
    process.env.TELEGRAM_CASTING_CHANNEL_ID
      ?? process.env.TELEGRAM_CHANNEL_ID
      ?? '',
  ).trim()
  return {
    channelKey: defaultChannelKey,
    channelUrl: String(process.env.TELEGRAM_CHANNEL_URL ?? '').trim(),
    displayName: String(process.env.TELEGRAM_CASTING_CHANNEL_NAME ?? '').trim(),
    enabled: Boolean(telegramChatId),
    healthStatus: telegramChatId ? 'unknown' : 'unconfigured',
    lastCheckedAt: '',
    lastErrorCode: '',
    telegramChatId,
    updatedAt: '',
    updatedBy: '',
  }
}

function rowToConfig(row) {
  return {
    ...row.data,
    channelKey: row.channel_key,
    displayName: row.display_name ?? '',
    enabled: Boolean(row.enabled),
    healthStatus: row.health_status,
    lastCheckedAt: row.last_checked_at?.toISOString?.() ?? row.last_checked_at ?? '',
    lastErrorCode: row.last_error_code ?? '',
    telegramChatId: row.telegram_chat_id ?? '',
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    updatedBy: row.updated_by ?? '',
  }
}

export async function getCastingChannelConfig() {
  if (hasPostgres()) {
    const result = await query(
      'SELECT * FROM casting_channel_config WHERE channel_key = $1 LIMIT 1',
      [defaultChannelKey],
    )
    return result.rows[0] ? rowToConfig(result.rows[0]) : defaultConfig()
  }

  try {
    return { ...defaultConfig(), ...JSON.parse(await readFile(channelPath, 'utf8')) }
  } catch (error) {
    if (error.code === 'ENOENT') return defaultConfig()
    throw error
  }
}

export async function updateCastingChannelConfig(patch, actor = 'web_admin') {
  const existing = await getCastingChannelConfig()
  const next = {
    ...existing,
    ...patch,
    channelKey: defaultChannelKey,
    enabled: Boolean(patch.enabled ?? existing.enabled),
    telegramChatId: String(patch.telegramChatId ?? existing.telegramChatId ?? '').trim(),
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  }
  if (!next.telegramChatId) {
    next.enabled = false
    next.healthStatus = 'unconfigured'
  }

  if (hasPostgres()) {
    const result = await query(
      `
        INSERT INTO casting_channel_config (
          channel_key,
          telegram_chat_id,
          display_name,
          enabled,
          health_status,
          last_checked_at,
          last_error_code,
          updated_by,
          data,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          NULLIF($6, '')::timestamptz,
          NULLIF($7, ''),
          $8,
          $9::jsonb,
          $10
        )
        ON CONFLICT (channel_key) DO UPDATE SET
          telegram_chat_id = EXCLUDED.telegram_chat_id,
          display_name = EXCLUDED.display_name,
          enabled = EXCLUDED.enabled,
          health_status = EXCLUDED.health_status,
          last_checked_at = EXCLUDED.last_checked_at,
          last_error_code = EXCLUDED.last_error_code,
          updated_by = EXCLUDED.updated_by,
          data = EXCLUDED.data,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [
        next.channelKey,
        next.telegramChatId || null,
        String(next.displayName ?? '').trim() || null,
        next.enabled,
        next.healthStatus,
        next.lastCheckedAt || '',
        next.lastErrorCode || '',
        actor,
        JSON.stringify(next),
        next.updatedAt,
      ],
    )
    return rowToConfig(result.rows[0])
  }

  await mkdir(dirname(channelPath), { recursive: true })
  await writeFile(channelPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

export async function recordCastingChannelHealth({ errorCode = '', healthy }) {
  return updateCastingChannelConfig({
    healthStatus: healthy ? 'healthy' : 'unhealthy',
    lastCheckedAt: new Date().toISOString(),
    lastErrorCode: healthy ? '' : String(errorCode || 'channel_check_failed').slice(0, 100),
  }, 'system')
}
