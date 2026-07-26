import { config } from './config.js'
import { isAdminWebAuthorized } from './webAuth.js'

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
  if (!isAdminWebAuthorized(request)) {
    const error = new Error('Admin web authorization failed')
    error.statusCode = 403
    throw error
  }
}
