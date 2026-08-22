import { loadLocalEnv } from '../server/env.js'

loadLocalEnv()

const token = process.env.TELEGRAM_BOT_TOKEN

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is required')
}

const response = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
  body: JSON.stringify({ drop_pending_updates: false }),
  headers: { 'content-type': 'application/json' },
  method: 'POST',
})
const data = await response.json()

if (!response.ok || !data.ok) {
  throw new Error(data.description ?? 'deleteWebhook failed')
}

console.log('Telegram webhook deleted.')
