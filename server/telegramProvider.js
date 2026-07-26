import { config } from './config.js'
import { callTelegramApi } from './telegramApi.js'

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

    return callTelegramApi(`${apiBase}/bot${this.token}`, method, { payload })
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
