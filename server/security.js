import { config } from './config.js'

export function isAdminTelegramId(value) {
  return config.adminIds.includes(String(value ?? ''))
}

export function requireAdminTelegramId(value) {
  if (!isAdminTelegramId(value)) {
    const error = new Error('Admin authorization failed')
    error.statusCode = 403
    throw error
  }
}

export function requireAdminWebToken(request) {
  const token = request.headers['x-admin-token']

  if (!config.adminWebToken || token !== config.adminWebToken) {
    const error = new Error('Admin web authorization failed')
    error.statusCode = 403
    throw error
  }
}
