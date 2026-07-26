import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from './config.js'

const cookieName = 'face_admin_session'
const sessionTtlSeconds = Number(process.env.ADMIN_SESSION_TTL_SECONDS ?? 60 * 60 * 8)

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''))
  const rightBuffer = Buffer.from(String(right ?? ''))

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function parseCookies(request) {
  return Object.fromEntries(
    String(request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=')
        return separator === -1
          ? [part, '']
          : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))]
      }),
  )
}

function sign(payload) {
  return createHmac('sha256', config.adminWebToken).update(payload).digest('base64url')
}

function defaultAdminSession() {
  return {
    id: config.adminWebId,
    name: config.adminWebName,
    role: 'superadmin',
  }
}

function createSessionValue(actor = defaultAdminSession()) {
  const payload = Buffer.from(
    JSON.stringify({
      adminId: String(actor.id ?? config.adminWebId),
      adminName: String(actor.name ?? config.adminWebName),
      exp: Math.floor(Date.now() / 1000) + sessionTtlSeconds,
      role: actor.role === 'admin' ? 'admin' : 'superadmin',
      scope: 'admin',
    }),
  ).toString('base64url')

  return `${payload}.${sign(payload)}`
}

function readSession(request) {
  if (!config.adminWebToken) return undefined

  const value = parseCookies(request)[cookieName]
  const [payload, signature, extra] = String(value ?? '').split('.')

  if (!payload || !signature || extra || !safeEqual(signature, sign(payload))) {
    return undefined
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (session.scope !== 'admin' || Number(session.exp) <= Math.floor(Date.now() / 1000)) {
      return undefined
    }

    return {
      exp: Number(session.exp),
      id: String(session.adminId ?? config.adminWebId),
      name: String(session.adminName ?? config.adminWebName),
      role: session.role === 'admin' ? 'admin' : 'superadmin',
      scope: 'admin',
    }
  } catch {
    return undefined
  }
}

export function authenticateAdminWebToken(token) {
  return Boolean(config.adminWebToken) && safeEqual(token, config.adminWebToken)
}

export function isAdminWebAuthorized(request) {
  return Boolean(readSession(request))
}

export function getAdminWebSession(request) {
  return readSession(request)
}

export function setAdminSession(response, actor) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader(
    'set-cookie',
    `${cookieName}=${createSessionValue(actor)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionTtlSeconds}${secure}`,
  )
}

export function clearAdminSession(response) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  response.setHeader(
    'set-cookie',
    `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
  )
}
