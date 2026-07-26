import { config } from './config.js'

const apiBase = 'https://api.telegram.org'

export class TelegramProvider {
  constructor(token) {
    this.token = token
  }

  get configured() {
    return Boolean(this.token)
  }

  async call(method, payload = {}) {
    if (!this.configured) {
      const error = new Error('Telegram bot token is not configured')
      error.statusCode = 500
      throw error
    }

    const response = await fetch(`${apiBase}/bot${this.token}/${method}`, {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    const data = await response.json()

    if (!response.ok || !data.ok) {
      const error = new Error(data.description ?? `Telegram API request failed: ${method}`)
      error.statusCode = response.status || 502
      throw error
    }

    return data.result
  }

  async getMe() {
    return this.call('getMe')
  }

  async sendMessage(chatId, text, options = {}) {
    return this.call('sendMessage', {
      chat_id: chatId,
      disable_web_page_preview: true,
      text,
      ...options,
    })
  }
}

export const telegramProvider = new TelegramProvider(config.telegramBotToken)
