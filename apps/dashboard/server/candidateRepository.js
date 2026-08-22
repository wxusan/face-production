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

async function readPostgresCandidates() {
  const result = await query(`
    SELECT *
    FROM candidates
    ORDER BY created_at ASC, id ASC
  `)

  return result.rows.map(rowToCandidate)
}

async function upsertPostgresCandidate(candidate) {
  const row = normalizeCandidateForRow(candidate)

  await query(
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
    `,
    [
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
    ],
  )
}

async function readStoredCandidates() {
  if (hasPostgres()) {
    return readPostgresCandidates()
  }

  return readJsonCandidates()
}

async function writeStoredCandidates(candidates) {
  if (hasPostgres()) {
    await Promise.all(candidates.map((candidate) => upsertPostgresCandidate(candidate)))
    return
  }

  await writeJsonCandidates(candidates)
}

function createCandidateId(candidates) {
  const nextNumber =
    candidates.reduce((max, candidate) => {
      const match = String(candidate.id ?? '').match(/^TG-(\d+)$/)
      return match ? Math.max(max, Number(match[1])) : max
    }, 0) + 1

  return `TG-${String(nextNumber).padStart(4, '0')}`
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
  const candidates = await readStoredCandidates()
  const now = new Date().toISOString()
  const created = {
    ...candidate,
    consent: candidate.consent ?? 'missing',
    createdAt: now,
    id: createCandidateId(candidates),
    source: candidate.source ?? 'telegram',
    status: 'pending_review',
    updatedAt: now,
  }

  candidates.push(created)
  await writeStoredCandidates(candidates)

  return created
}

export async function replaceCandidateIntake(candidateId, candidate) {
  const candidates = await readStoredCandidates()
  const existingIndex = candidates.findIndex((item) => item.id === candidateId)

  if (existingIndex === -1) {
    return undefined
  }

  const existing = candidates[existingIndex]
  const now = new Date().toISOString()
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
  const candidates = await listCandidates()
  return candidates.find((candidate) => candidate.id === candidateId)
}

export async function findCandidateByTelegramId(telegramUserId) {
  const candidates = await readStoredCandidates()
  const userId = String(telegramUserId)
  return candidates.find((candidate) => String(candidate.telegramUserId ?? '') === userId)
}

export async function findCandidateByPhone(phone) {
  const candidates = await readStoredCandidates()
  const normalized = normalizePhone(phone)

  if (!normalized) {
    return undefined
  }

  return candidates.find((candidate) => normalizePhone(candidate.phone) === normalized)
}

export async function updateCandidateStatus(candidateId, status, reviewedBy) {
  const candidates = await readStoredCandidates()
  const candidate = candidates.find((item) => item.id === candidateId)

  if (!candidate) {
    return undefined
  }

  candidate.status = status
  candidate.reviewedBy = reviewedBy
  candidate.updatedAt = new Date().toISOString()

  await writeStoredCandidates(candidates)

  return candidate
}

export async function updateCandidateMetadata(candidateId, metadata) {
  const candidates = await readStoredCandidates()
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
  const candidates = await readStoredCandidates()
  const existingIndex = candidates.findIndex((item) => item.id === candidate.id)
  const nextCandidate = {
    ...candidate,
    updatedAt: candidate.updatedAt ?? new Date().toISOString(),
  }

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
  const candidates = await readStoredCandidates()
  return candidates.filter((candidate) => candidate.status === 'pending_review')
}

export async function getBroadcastDryRun() {
  const candidates = await listCandidates()

  return {
    blocked: candidates.filter((candidate) => {
      return candidate.consent === 'missing' || candidate.status === 'rejected'
    }),
    eligible: candidates.filter((candidate) => {
      return candidate.consent !== 'missing' && ['approved', 'verified'].includes(candidate.status)
    }),
  }
}

function normalizePhone(phone) {
  return String(phone ?? '').replace(/\D/g, '')
}
