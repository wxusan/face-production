import { loadLocalEnv } from '../server/env.js'

loadLocalEnv()

const token = process.env.TELEGRAM_BOT_TOKEN
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET
const railwayPublicUrl = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : ''
const baseUrl = process.argv[2] ?? process.env.PUBLIC_APP_URL ?? railwayPublicUrl ?? process.env.VERCEL_PROJECT_PRODUCTION_URL

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is required')
}

if (!baseUrl) {
  throw new Error('Pass your deployment URL, for example: npm run webhook:set -- https://your-app.up.railway.app')
}

const webhookUrl = `${String(baseUrl).replace(/\/+$/, '')}/api/telegram/webhook`
const body = {
  allowed_updates: ['message', 'callback_query'],
  drop_pending_updates: false,
  url: webhookUrl,
}

if (!secretToken) {
  throw new Error('TELEGRAM_WEBHOOK_SECRET is required')
}

body.secret_token = secretToken

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
  method: 'POST',
})
const data = await response.json()

if (!response.ok || !data.ok) {
  throw new Error(data.description ?? 'setWebhook failed')
}

console.log(`Telegram webhook set: ${webhookUrl}`)
