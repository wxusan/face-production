import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { config } from './config.js'
import { hasPostgres, query } from './postgres.js'

const adminPath = resolve(process.cwd(), 'var/admins.json')

function hashToken(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex')
}

function sanitize(admin) {
  const { tokenHash: _tokenHash, ...safe } = admin
  return safe
}

function defaultSuperAdmin() {
  const now = new Date().toISOString()
  return {
    id: 'ADMIN-0001',
    name: process.env.SUPER_ADMIN_NAME ?? 'Face Production Owner',
    email: process.env.SUPER_ADMIN_EMAIL ?? '',
    role: 'super_admin',
    status: 'active',
    tokenHash: hashToken(config.adminWebToken),
    telegramUserId: config.adminId || '',
    telegramUsername: '',
    telegramNotificationsAllowed: true,
    telegramNotifications: Boolean(config.adminId),
    invitedBy: null,
    createdAt: now,
    updatedAt: now,
  }
}

async function readJsonAdmins() {
  let admins
  try {
    admins = JSON.parse(await readFile(adminPath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    admins = []
  }
  if (!admins.some((admin) => admin.role === 'super_admin')) {
    admins.unshift(defaultSuperAdmin())
    await writeJsonAdmins(admins)
  }
  return admins
}

async function writeJsonAdmins(admins) {
  await mkdir(dirname(adminPath), { recursive: true })
  await writeFile(adminPath, `${JSON.stringify(admins, null, 2)}\n`, 'utf8')
}

function rowToAdmin(row) {
  return {
    ...(row.data ?? {}),
    id: row.id,
    name: row.name,
    email: row.email ?? '',
    role: row.role,
    status: row.status,
    tokenHash: row.token_hash,
    telegramUserId: row.telegram_user_id ?? '',
    telegramUsername: row.telegram_username ?? '',
    telegramNotifications: row.telegram_notifications,
    telegramNotificationsAllowed: row.telegram_notifications_allowed,
    invitedBy: row.invited_by,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  }
}

async function ensurePostgresSuperAdmin() {
  const admin = defaultSuperAdmin()
  await query(
    `INSERT INTO admins (
      id,name,email,role,status,token_hash,telegram_user_id,telegram_username,
      telegram_notifications,telegram_notifications_allowed,invited_by,data,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
    ON CONFLICT (id) DO NOTHING`,
    [admin.id, admin.name, admin.email || null, admin.role, admin.status, admin.tokenHash,
      admin.telegramUserId || null, null, admin.telegramNotifications, true, null,
      JSON.stringify(admin), admin.createdAt, admin.updatedAt],
  )
}

async function readStoredAdmins() {
  if (!hasPostgres()) return readJsonAdmins()
  await ensurePostgresSuperAdmin()
  const result = await query('SELECT * FROM admins ORDER BY created_at ASC, id ASC')
  return result.rows.map(rowToAdmin)
}

async function savePostgresAdmin(admin) {
  await query(
    `INSERT INTO admins (
      id,name,email,role,status,token_hash,telegram_user_id,telegram_username,
      telegram_notifications,telegram_notifications_allowed,invited_by,data,created_at,updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
    ON CONFLICT (id) DO UPDATE SET
      name=EXCLUDED.name,email=EXCLUDED.email,status=EXCLUDED.status,token_hash=EXCLUDED.token_hash,
      telegram_user_id=EXCLUDED.telegram_user_id,telegram_username=EXCLUDED.telegram_username,
      telegram_notifications=EXCLUDED.telegram_notifications,
      telegram_notifications_allowed=EXCLUDED.telegram_notifications_allowed,
      data=EXCLUDED.data,updated_at=EXCLUDED.updated_at`,
    [admin.id, admin.name, admin.email || null, admin.role, admin.status, admin.tokenHash,
      admin.telegramUserId || null, admin.telegramUsername || null, admin.telegramNotifications,
      admin.telegramNotificationsAllowed, admin.invitedBy, JSON.stringify(admin), admin.createdAt, admin.updatedAt],
  )
}

async function saveAdmins(admins, changedAdmin) {
  if (hasPostgres()) return savePostgresAdmin(changedAdmin)
  return writeJsonAdmins(admins)
}

function nextAdminId(admins) {
  const next = admins.reduce((max, item) => {
    const match = String(item.id).match(/^ADMIN-(\d+)$/)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0) + 1
  return `ADMIN-${String(next).padStart(4, '0')}`
}

export async function authenticateAdminToken(token) {
  if (!token) return undefined
  const tokenHash = hashToken(token)
  return (await readStoredAdmins()).find((admin) => admin.status === 'active' && admin.tokenHash === tokenHash)
}

export async function findAdminByTelegramId(value) {
  const id = String(value ?? '')
  return (await readStoredAdmins()).find((admin) => admin.status === 'active' && String(admin.telegramUserId ?? '') === id)
}

export async function listAdmins() {
  return (await readStoredAdmins()).map(sanitize)
}

export async function listBriefNotificationAdmins() {
  return (await readStoredAdmins())
    .filter((admin) => admin.status === 'active' && admin.telegramNotificationsAllowed && admin.telegramNotifications && admin.telegramUserId)
    .map(sanitize)
}

export async function createAdmin(input, superAdmin) {
  const admins = await readStoredAdmins()
  const now = new Date().toISOString()
  const accessToken = randomBytes(18).toString('base64url')
  const allowed = Boolean(input.telegramNotificationsAllowed)
  const admin = {
    id: nextAdminId(admins),
    name: String(input.name ?? '').trim(),
    email: String(input.email ?? '').trim(),
    role: 'admin',
    status: 'active',
    tokenHash: hashToken(accessToken),
    telegramUserId: String(input.telegramUserId ?? '').trim(),
    telegramUsername: String(input.telegramUsername ?? '').replace(/^@/, '').trim(),
    telegramNotificationsAllowed: allowed,
    telegramNotifications: allowed && Boolean(input.telegramNotifications),
    invitedBy: superAdmin.id,
    createdAt: now,
    updatedAt: now,
  }
  if (!admin.name) {
    const error = new Error('Admin name is required')
    error.statusCode = 400
    throw error
  }
  admins.push(admin)
  await saveAdmins(admins, admin)
  return { accessToken, admin: sanitize(admin) }
}

export async function updateAdmin(id, input, actor) {
  const admins = await readStoredAdmins()
  const index = admins.findIndex((admin) => admin.id === id)
  if (index === -1) return undefined
  const existing = admins[index]
  const isSuperAdmin = actor.role === 'super_admin'
  const isSelf = actor.id === id
  if (!isSuperAdmin && !isSelf) {
    const error = new Error('You can only update your own Telegram settings')
    error.statusCode = 403
    throw error
  }

  const updated = { ...existing, updatedAt: new Date().toISOString() }
  if (isSuperAdmin) {
    if (typeof input.name === 'string' && input.name.trim()) updated.name = input.name.trim()
    if (typeof input.email === 'string') updated.email = input.email.trim()
    if (typeof input.status === 'string' && existing.role !== 'super_admin' && ['active', 'disabled'].includes(input.status)) updated.status = input.status
    if (typeof input.telegramNotificationsAllowed === 'boolean' && existing.role !== 'super_admin') {
      updated.telegramNotificationsAllowed = input.telegramNotificationsAllowed
      if (!input.telegramNotificationsAllowed) updated.telegramNotifications = false
    }
  }
  if (isSuperAdmin || isSelf) {
    if (typeof input.telegramUserId === 'string') updated.telegramUserId = input.telegramUserId.trim()
    if (typeof input.telegramUsername === 'string') updated.telegramUsername = input.telegramUsername.replace(/^@/, '').trim()
    if (typeof input.telegramNotifications === 'boolean') {
      updated.telegramNotifications = updated.telegramNotificationsAllowed && input.telegramNotifications
    }
  }
  admins[index] = updated
  await saveAdmins(admins, updated)
  return sanitize(updated)
}
