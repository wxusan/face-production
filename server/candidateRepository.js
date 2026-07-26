import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { hasPostgres, query } from './postgres.js'
import { normalizeCandidateTaxonomy } from './taxonomy.js'

const candidatePath = resolve(process.cwd(), 'var/candidate-intakes.json')

const seedCandidates = [
  {
    id: 'FC-1048',
    name: 'Anisa Karimova',
    consent: 'confirmed',
    source: 'seed',
    status: 'verified',
    telegramChatId: null,
  },
  {
    id: 'FC-1119',
    name: 'Madina Rasulova',
    consent: 'missing',
    source: 'seed',
    status: 'incomplete',
    telegramChatId: null,
  },
]

async function readJsonCandidates() {
  try {
    const content = await readFile(candidatePath, 'utf8')
    return JSON.parse(content)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

async function writeJsonCandidates(candidates) {
  await mkdir(dirname(candidatePath), { recursive: true })
  await writeFile(candidatePath, `${JSON.stringify(candidates, null, 2)}\n`, 'utf8')
}

function rowToCandidate(row) {
  const data = row.data ?? {}

  return normalizeCandidateTaxonomy({
    ...data,
    age: data.age ?? row.age,
    city: data.city ?? row.city,
    createdAt: data.createdAt ?? row.created_at?.toISOString?.() ?? row.created_at,
    gender: data.gender ?? row.gender,
    id: row.id,
    name: data.name ?? row.name,
    phone: data.phone ?? row.phone,
    source: row.source ?? data.source ?? 'telegram',
    status: row.status ?? data.status ?? 'pending_review',
    telegramUserId: data.telegramUserId ?? row.telegram_user_id,
    telegramUsername: data.telegramUsername ?? row.telegram_username,
    updatedAt: data.updatedAt ?? row.updated_at?.toISOString?.() ?? row.updated_at,
  })
}

function normalizeCandidateForRow(candidate) {
  const normalizedCandidate = normalizeCandidateTaxonomy(candidate)

  return {
    age: Number.isInteger(Number(normalizedCandidate.age)) ? Number(normalizedCandidate.age) : null,
    city: normalizedCandidate.city ?? null,
    data: JSON.stringify(normalizedCandidate),
    gender: normalizedCandidate.gender ?? null,
    id: normalizedCandidate.id,
    name: normalizedCandidate.name ?? null,
    phone: normalizedCandidate.phone ?? null,
    source: normalizedCandidate.source ?? 'telegram',
    status: normalizedCandidate.status ?? 'pending_review',
    telegramUserId: normalizedCandidate.telegramUserId ? String(normalizedCandidate.telegramUserId) : null,
    telegramUsername: normalizedCandidate.telegramUsername ?? null,
  }
}

function postgresCandidateParams(row) {
  return [
    row.id,
    row.status,
    row.source,
    row.name,
    row.phone,
    row.telegramUserId,
    row.telegramUsername,
    row.city,
    row.gender,
    row.age,
    row.data,
  ]
}

async function readPostgresCandidates() {
  const result = await query(`
    SELECT *
    FROM candidates
    ORDER BY created_at ASC, id ASC
  `)

  return result.rows.map(rowToCandidate)
}

async function findPostgresCandidate(candidateId) {
  const result = await query(
    `
      SELECT *
      FROM candidates
      WHERE id = $1
      LIMIT 1
    `,
    [candidateId],
  )

  return result.rows[0] ? rowToCandidate(result.rows[0]) : undefined
}

async function insertPostgresCandidate(candidate) {
  const row = normalizeCandidateForRow(candidate)
  const result = await query(
    `
      INSERT INTO candidates (
        id,
        status,
        source,
        name,
        phone,
        telegram_user_id,
        telegram_username,
        city,
        gender,
        age,
        data,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11::jsonb,
        COALESCE(($11::jsonb->>'createdAt')::timestamptz, now()),
        COALESCE(($11::jsonb->>'updatedAt')::timestamptz, now())
      )
      RETURNING *
    `,
    postgresCandidateParams(row),
  )

  return rowToCandidate(result.rows[0])
}

async function updatePostgresCandidate(candidate) {
  const row = normalizeCandidateForRow(candidate)
  const result = await query(
    `
      UPDATE candidates
      SET
        status = $2,
        source = $3,
        name = $4,
        phone = $5,
        telegram_user_id = $6,
        telegram_username = $7,
        city = $8,
        gender = $9,
        age = $10,
        data = $11::jsonb,
        created_at = COALESCE(($11::jsonb->>'createdAt')::timestamptz, candidates.created_at),
        updated_at = COALESCE(($11::jsonb->>'updatedAt')::timestamptz, now())
      WHERE id = $1
      RETURNING *
    `,
    postgresCandidateParams(row),
  )

  return result.rows[0] ? rowToCandidate(result.rows[0]) : undefined
}

async function upsertPostgresCandidate(candidate) {
  const row = normalizeCandidateForRow(candidate)
  const result = await query(
    `
      INSERT INTO candidates (
        id,
        status,
        source,
        name,
        phone,
        telegram_user_id,
        telegram_username,
        city,
        gender,
        age,
        data,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11::jsonb,
        COALESCE(($11::jsonb->>'createdAt')::timestamptz, now()),
        COALESCE(($11::jsonb->>'updatedAt')::timestamptz, now())
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        source = EXCLUDED.source,
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        telegram_user_id = EXCLUDED.telegram_user_id,
        telegram_username = EXCLUDED.telegram_username,
        city = EXCLUDED.city,
        gender = EXCLUDED.gender,
        age = EXCLUDED.age,
        data = EXCLUDED.data,
        updated_at = COALESCE((EXCLUDED.data->>'updatedAt')::timestamptz, now())
      RETURNING *
    `,
    postgresCandidateParams(row),
  )

  return rowToCandidate(result.rows[0])
}

async function readStoredCandidates() {
  if (hasPostgres()) {
    return readPostgresCandidates()
  }

  return readJsonCandidates()
}

async function writeStoredCandidates(candidates) {
  if (hasPostgres()) {
    throw new Error('Whole-collection PostgreSQL writes are not supported')
  }

  await writeJsonCandidates(candidates)
}

function createCandidateId() {
  return `TG-${randomUUID()}`
}

function normalizePhone(phone) {
  return String(phone ?? '').replace(/\D/g, '')
}

function candidateAge(candidate) {
  const age = Number(candidate?.age)
  return Number.isInteger(age) && age > 0 ? age : undefined
}

export function candidateMessagingChatId(candidate) {
  return candidate?.telegramChatId
    ?? candidate?.submittedByTelegramChatId
    ?? candidate?.telegramUserId
    ?? candidate?.submittedByTelegramUserId
}

export function hasRequiredCandidateConsent(candidate) {
  const age = candidateAge(candidate)

  if (!age) {
    return false
  }

  const consent = String(candidate.consent ?? '')

  if (age < 18) {
    const guardianConsent = String(candidate.guardianConsent ?? '').toLowerCase()
    return consent === 'guardian_confirmed' && ['confirmed', 'verified', 'yes'].includes(guardianConsent)
  }

  if (candidate.submissionMode === 'friend') {
    return consent === 'proxy_confirmed'
  }

  return ['candidate_confirmed', 'confirmed', 'not_required'].includes(consent)
}

export function isCandidateEligibleForMessaging(candidate) {
  return Boolean(candidateMessagingChatId(candidate))
    && ['approved', 'verified'].includes(candidate?.status)
    && hasRequiredCandidateConsent(candidate)
}

export async function listCandidateIntakes() {
  return readStoredCandidates()
}

export async function listCandidates() {
  const storedCandidates = await listCandidateIntakes()

  if (process.env.INCLUDE_SEED_CANDIDATES === 'true') {
    return [...seedCandidates, ...storedCandidates]
  }

  return storedCandidates
}

export async function createCandidateIntake(candidate) {
  const now = new Date().toISOString()
  const created = {
    ...candidate,
    consent: candidate.consent ?? 'missing',
    createdAt: now,
    id: createCandidateId(),
    source: candidate.source ?? 'telegram',
    status: 'pending_review',
    updatedAt: now,
  }

  if (hasPostgres()) {
    return insertPostgresCandidate(created)
  }

  const candidates = await readJsonCandidates()
  candidates.push(created)
  await writeStoredCandidates(candidates)
  return created
}

export async function replaceCandidateIntake(candidateId, candidate) {
  const now = new Date().toISOString()

  if (hasPostgres()) {
    const existing = await findPostgresCandidate(candidateId)
    if (!existing) {
      return undefined
    }

    return updatePostgresCandidate({
      ...existing,
      ...candidate,
      consent: candidate.consent ?? existing.consent ?? 'missing',
      createdAt: existing.createdAt ?? now,
      id: existing.id,
      reviewedBy: undefined,
      source: existing.source ?? 'telegram',
      status: 'pending_review',
      telegramUserId: existing.telegramUserId ?? candidate.telegramUserId,
      updatedAt: now,
    })
  }

  const candidates = await readJsonCandidates()
  const existingIndex = candidates.findIndex((item) => item.id === candidateId)

  if (existingIndex === -1) {
    return undefined
  }

  const existing = candidates[existingIndex]
  const updated = {
    ...existing,
    ...candidate,
    consent: candidate.consent ?? existing.consent ?? 'missing',
    id: existing.id,
    reviewedBy: undefined,
    source: existing.source ?? 'telegram',
    status: 'pending_review',
    telegramUserId: existing.telegramUserId ?? candidate.telegramUserId,
    createdAt: existing.createdAt ?? now,
    updatedAt: now,
  }

  candidates[existingIndex] = updated
  await writeStoredCandidates(candidates)
  return updated
}

export async function findCandidate(candidateId) {
  const candidate = hasPostgres()
    ? await findPostgresCandidate(candidateId)
    : (await readJsonCandidates()).find((item) => item.id === candidateId)

  if (candidate) {
    return candidate
  }

  return process.env.INCLUDE_SEED_CANDIDATES === 'true'
    ? seedCandidates.find((item) => item.id === candidateId)
    : undefined
}

export async function findCandidateByTelegramId(telegramUserId) {
  const userId = String(telegramUserId)

  if (hasPostgres()) {
    const result = await query(
      `
        SELECT *
        FROM candidates
        WHERE telegram_user_id = $1
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [userId],
    )

    return result.rows[0] ? rowToCandidate(result.rows[0]) : undefined
  }

  return (await readJsonCandidates()).find((candidate) => String(candidate.telegramUserId ?? '') === userId)
}

export async function findCandidateByPhone(phone) {
  const normalized = normalizePhone(phone)

  if (!normalized) {
    return undefined
  }

  if (hasPostgres()) {
    const result = await query(
      `
        SELECT *
        FROM candidates
        WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = $1
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [normalized],
    )

    return result.rows[0] ? rowToCandidate(result.rows[0]) : undefined
  }

  return (await readJsonCandidates()).find((candidate) => normalizePhone(candidate.phone) === normalized)
}

export async function updateCandidateStatus(candidateId, status, reviewedBy) {
  if (hasPostgres()) {
    const candidate = await findPostgresCandidate(candidateId)

    if (!candidate || (['approved', 'verified'].includes(status) && !hasRequiredCandidateConsent(candidate))) {
      return undefined
    }

    return updatePostgresCandidate({
      ...candidate,
      reviewedBy,
      status,
      updatedAt: new Date().toISOString(),
    })
  }

  const candidates = await readJsonCandidates()
  const candidate = candidates.find((item) => item.id === candidateId)

  if (!candidate || (['approved', 'verified'].includes(status) && !hasRequiredCandidateConsent(candidate))) {
    return undefined
  }

  candidate.status = status
  candidate.reviewedBy = reviewedBy
  candidate.updatedAt = new Date().toISOString()
  await writeStoredCandidates(candidates)
  return candidate
}

export async function updateCandidateMetadata(candidateId, metadata) {
  if (hasPostgres()) {
    const candidate = await findPostgresCandidate(candidateId)

    if (!candidate) {
      return undefined
    }

    return updatePostgresCandidate({
      ...candidate,
      ...metadata,
      updatedAt: new Date().toISOString(),
    })
  }

  const candidates = await readJsonCandidates()
  const candidate = candidates.find((item) => item.id === candidateId)

  if (!candidate) {
    return undefined
  }

  Object.assign(candidate, metadata, {
    updatedAt: new Date().toISOString(),
  })

  await writeStoredCandidates(candidates)
  return candidate
}

export async function upsertCandidateIntake(candidate) {
  const nextCandidate = {
    ...candidate,
    id: candidate.id ?? createCandidateId(),
    updatedAt: candidate.updatedAt ?? new Date().toISOString(),
  }

  if (hasPostgres()) {
    return upsertPostgresCandidate(nextCandidate)
  }

  const candidates = await readJsonCandidates()
  const existingIndex = candidates.findIndex((item) => item.id === nextCandidate.id)

  if (existingIndex === -1) {
    candidates.push(nextCandidate)
  } else {
    candidates[existingIndex] = {
      ...candidates[existingIndex],
      ...nextCandidate,
    }
  }

  await writeStoredCandidates(candidates)
  return nextCandidate
}

export async function listPendingCandidateIntakes() {
  if (hasPostgres()) {
    const result = await query(`
      SELECT *
      FROM candidates
      WHERE status = 'pending_review'
      ORDER BY created_at ASC, id ASC
    `)

    return result.rows.map(rowToCandidate)
  }

  return (await readJsonCandidates()).filter((candidate) => candidate.status === 'pending_review')
}

export async function getBroadcastDryRun() {
  const candidates = await listCandidates()

  return {
    blocked: candidates.filter((candidate) => !isCandidateEligibleForMessaging(candidate)),
    eligible: candidates.filter(isCandidateEligibleForMessaging),
  }
}
