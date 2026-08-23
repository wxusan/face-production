import { loadLocalEnv } from './env.js'
import { hasPostgres } from './postgres.js'
import { objectStorageConfigured } from './objectStorage.js'

loadLocalEnv()

function parseAdminIds(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const adminIds = parseAdminIds(process.env.TELEGRAM_ADMIN_ID)

export const config = {
  adminId: adminIds[0] ?? '',
  adminIds,
  adminWebToken: process.env.ADMIN_WEB_TOKEN ?? (process.env.VERCEL ? '' : 'face-admin-local'),
  enablePolling: process.env.TELEGRAM_ENABLE_POLLING === 'true',
  port: Number(process.env.SERVER_PORT ?? 8787),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  publicAppUrl: process.env.PUBLIC_APP_URL ?? (process.env.VERCEL ? '' : 'http://127.0.0.1:8787'),
}

export function getConfigStatus() {
  return {
    adminConfigured: config.adminIds.length > 0,
    adminCount: config.adminIds.length,
    databaseProvider: hasPostgres() ? 'postgres' : 'local-json',
    mediaStorageProvider: objectStorageConfigured() ? 'object-storage' : 'local-files',
    webAuthConfigured: Boolean(config.adminWebToken),
    pollingEnabled: config.enablePolling,
    telegramConfigured: Boolean(config.telegramBotToken),
    webhookSecretConfigured: Boolean(config.telegramWebhookSecret),
  }
}
