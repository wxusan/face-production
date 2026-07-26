import { config } from './config.js'
import { getAdminWebSession } from './webAuth.js'

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
  const session = getAdminWebSession(request)

  if (!session) {
    const error = new Error('Admin web authorization failed')
    error.statusCode = 403
    throw error
  }

  return session
}

export function requireSuperAdminWebToken(request) {
  const session = requireAdminWebToken(request)

  if (session.role !== 'superadmin') {
    const error = new Error('Super admin authorization required')
    error.statusCode = 403
    throw error
  }

  return session
}
