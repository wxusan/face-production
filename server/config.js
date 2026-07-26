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

function parsePort(value, fallback) {
  const port = Number(value ?? fallback)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT or SERVER_PORT must be an integer between 1 and 65535')
  }

  return port
}

const adminIds = parseAdminIds(process.env.TELEGRAM_ADMIN_ID)

export const config = {
  adminId: adminIds[0] ?? '',
  adminIds,
  adminWebToken: process.env.ADMIN_WEB_TOKEN ?? '',
  host: process.env.HOST ?? '0.0.0.0',
  isHostedRuntime: Boolean(process.env.RAILWAY_SERVICE_ID || process.env.VERCEL),
  port: parsePort(process.env.PORT ?? process.env.SERVER_PORT, 8787),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
}

export function getHostedConfigurationProblems() {
  if (!config.isHostedRuntime && process.env.NODE_ENV !== 'production') {
    return []
  }

  const problems = []

  if (!config.adminWebToken) problems.push('ADMIN_WEB_TOKEN is required')
  if (!config.adminIds.length) problems.push('TELEGRAM_ADMIN_ID is required')
  if (!config.telegramBotToken) problems.push('TELEGRAM_BOT_TOKEN is required')
  if (!config.telegramWebhookSecret) problems.push('TELEGRAM_WEBHOOK_SECRET is required')
  if (process.env.TELEGRAM_ENABLE_POLLING === 'true') {
    problems.push('TELEGRAM_ENABLE_POLLING=true is not supported; deploy the webhook service only')
  }
  if (!hasPostgres()) problems.push('DATABASE_URL is required; local JSON storage is not allowed in production')
  if (!objectStorageConfigured()) {
    problems.push('Supabase object-storage variables are required; local media storage is not allowed in production')
  }

  return problems
}

export function assertHostedConfiguration() {
  const problems = getHostedConfigurationProblems()

  if (problems.length) {
    throw new Error(`Hosted configuration is incomplete:\n- ${problems.join('\n- ')}`)
  }
}

export function getConfigStatus() {
  const configurationProblems = getHostedConfigurationProblems()

  return {
    adminConfigured: config.adminIds.length > 0,
    adminCount: config.adminIds.length,
    databaseProvider: hasPostgres() ? 'postgres' : 'local-json',
    mediaStorageProvider: objectStorageConfigured() ? 'object-storage' : 'local-files',
    ready: configurationProblems.length === 0,
    webAuthConfigured: Boolean(config.adminWebToken),
    telegramConfigured: Boolean(config.telegramBotToken),
    webhookSecretConfigured: Boolean(config.telegramWebhookSecret),
    configurationProblems,
  }
}
