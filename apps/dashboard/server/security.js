import { config } from './config.js'
import { authenticateAdminToken, findAdminByTelegramId } from './adminRepository.js'

export async function isAdminTelegramId(value) {
  return Boolean(await findAdminByTelegramId(value)) || config.adminIds.includes(String(value ?? ''))
}

export async function requireAdminTelegramId(value) {
  const admin = await findAdminByTelegramId(value)
  if (!admin && !config.adminIds.includes(String(value ?? ''))) {
    const error = new Error('Admin authorization failed')
    error.statusCode = 403
    throw error
  }
  return admin
}

export async function requireAdminWebToken(request) {
  const token = request.headers['x-admin-token']
  const admin = await authenticateAdminToken(token)
  if (!admin) {
    const error = new Error('Admin web authorization failed')
    error.statusCode = 403
    throw error
  }
  return admin
}

export async function requireSuperAdminWebToken(request) {
  const admin = await requireAdminWebToken(request)
  if (admin.role !== 'super_admin') {
    const error = new Error('Super admin authorization required')
    error.statusCode = 403
    throw error
  }
  return admin
}
