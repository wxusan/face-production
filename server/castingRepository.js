import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { isCandidateEligibleForMessaging } from './candidateRepository.js'
import { hasPostgres, query } from './postgres.js'

const castingsPath = resolve(process.cwd(), 'var/castings.json')

async function readJsonCastings() {
  try {
    return JSON.parse(await readFile(castingsPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

async function writeJsonCastings(castings) {
  await mkdir(dirname(castingsPath), { recursive: true })
  await writeFile(castingsPath, `${JSON.stringify(castings, null, 2)}\n`, 'utf8')
}

function createCastingId() {
  return `CAST-${randomUUID()}`
}

function rowToCasting(row) {
  const data = row.data ?? {}

  return {
    ...data,
    body: row.body ?? data.body,
    createdAt: data.createdAt ?? row.created_at?.toISOString?.() ?? row.created_at,
    endsAt: data.endsAt ?? row.ends_at?.toISOString?.() ?? row.ends_at,
    id: row.id,
    startsAt: data.startsAt ?? row.starts_at?.toISOString?.() ?? row.starts_at,
    status: row.status ?? data.status ?? 'active',
    targetCandidateIds: row.target_candidate_ids ?? data.targetCandidateIds ?? [],
    title: row.title ?? data.title,
    updatedAt: data.updatedAt ?? row.updated_at?.toISOString?.() ?? row.updated_at,
  }
}

function postgresCastingParams(casting) {
  return [
    casting.id,
    casting.status ?? 'active',
    casting.title,
    casting.body,
    casting.startsAt ?? '',
    casting.endsAt ?? '',
    casting.targetCandidateIds ?? [],
    JSON.stringify(casting),
  ]
}

async function readPostgresCastings() {
  const result = await query(`
    SELECT *
    FROM castings
    ORDER BY created_at DESC, id DESC
  `)

  return result.rows.map(rowToCasting)
}

async function findPostgresCasting(castingId) {
  const result = await query(
    `
      SELECT *
      FROM castings
      WHERE id = $1
      LIMIT 1
    `,
    [castingId],
  )

  return result.rows[0] ? rowToCasting(result.rows[0]) : undefined
}

async function insertPostgresCasting(casting) {
  const result = await query(
    `
      INSERT INTO castings (
        id,
        status,
        title,
        body,
        starts_at,
        ends_at,
        target_candidate_ids,
        data,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        NULLIF($5, '')::timestamptz,
        NULLIF($6, '')::timestamptz,
        $7::text[],
        $8::jsonb,
        COALESCE(($8::jsonb->>'createdAt')::timestamptz, now()),
        COALESCE(($8::jsonb->>'updatedAt')::timestamptz, now())
      )
      RETURNING *
    `,
    postgresCastingParams(casting),
  )

  return rowToCasting(result.rows[0])
}

async function readStoredCastings() {
  if (hasPostgres()) {
    return readPostgresCastings()
  }

  return readJsonCastings()
}

async function writeStoredCastings(castings) {
  if (hasPostgres()) {
    throw new Error('Whole-collection PostgreSQL writes are not supported')
  }

  await writeJsonCastings(castings)
}

export async function listCastings() {
  return readStoredCastings()
}

export async function createCasting(casting) {
  const now = new Date().toISOString()
  const created = {
    body: String(casting.body ?? '').trim(),
    createdAt: now,
    createdBy: casting.createdBy ?? 'web_admin',
    endsAt: casting.endsAt || '',
    id: createCastingId(),
    sentAt: casting.sentAt ?? '',
    startsAt: casting.startsAt || '',
    status: casting.status ?? 'active',
    targetCandidateIds: Array.isArray(casting.targetCandidateIds) ? casting.targetCandidateIds : [],
    title: String(casting.title ?? '').trim(),
    updatedAt: now,
  }

  if (hasPostgres()) {
    return insertPostgresCasting(created)
  }

  const castings = await readJsonCastings()
  castings.unshift(created)
  await writeStoredCastings(castings)
  return created
}

export async function findCasting(castingId) {
  if (hasPostgres()) {
    return findPostgresCasting(castingId)
  }

  return (await readJsonCastings()).find((casting) => casting.id === castingId)
}

export async function listActiveCastingsForCandidate(candidate) {
  if (!isCandidateEligibleForMessaging(candidate)) {
    return []
  }

  const now = new Date()
  const candidateId = candidate.id
  const castings = await listCastings()

  return castings.filter((casting) => {
    if (casting.status !== 'active') {
      return false
    }

    if (casting.startsAt && new Date(casting.startsAt) > now) {
      return false
    }

    if (casting.endsAt && new Date(casting.endsAt) < now) {
      return false
    }

    if (casting.targetCandidateIds?.length && !casting.targetCandidateIds.includes(candidateId)) {
      return false
    }

    return true
  })
}
