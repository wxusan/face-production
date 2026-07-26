import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { isCandidateEligibleForCastingApplication } from './candidateRepository.js'
import {
  assertCastingStatus,
  assertCastingStatusTransition,
  isCastingOpen,
} from './castingLifecycle.js'
import { hasPostgres, query, withPostgresAdvisoryLock } from './postgres.js'

const castingsPath = resolve(
  process.env.CASTING_STORAGE_PATH ?? resolve(process.cwd(), 'var/castings.json'),
)
const publicTokenPattern = /^[A-Za-z0-9_-]{1,50}$/

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
    cancelledAt: data.cancelledAt ?? row.cancelled_at?.toISOString?.() ?? row.cancelled_at,
    closedAt: data.closedAt ?? row.closed_at?.toISOString?.() ?? row.closed_at,
    createdAt: data.createdAt ?? row.created_at?.toISOString?.() ?? row.created_at,
    createdBy: row.created_by ?? data.createdBy,
    endsAt: data.endsAt ?? row.ends_at?.toISOString?.() ?? row.ends_at,
    id: row.id,
    publicToken: row.public_token ?? data.publicToken,
    publishedAt: data.publishedAt ?? row.published_at?.toISOString?.() ?? row.published_at,
    source: row.source ?? data.source ?? 'web_admin',
    startsAt: data.startsAt ?? row.starts_at?.toISOString?.() ?? row.starts_at,
    status: row.status ?? data.status ?? 'active',
    targetCandidateIds: row.target_candidate_ids ?? data.targetCandidateIds ?? [],
    title: row.title ?? data.title,
    updatedAt: data.updatedAt ?? row.updated_at?.toISOString?.() ?? row.updated_at,
    updatedBy: row.updated_by ?? data.updatedBy,
    version: Number(row.version ?? data.version ?? 1),
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
    casting.publicToken,
    casting.source ?? 'web_admin',
    casting.publishedAt ?? '',
    casting.closedAt ?? '',
    casting.cancelledAt ?? '',
    casting.createdBy ?? null,
    casting.updatedBy ?? null,
    Number(casting.version ?? 1),
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

async function findPostgresCastingByPublicToken(publicToken) {
  const result = await query(
    `
      SELECT *
      FROM castings
      WHERE public_token = $1
      LIMIT 1
    `,
    [publicToken],
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
        public_token,
        source,
        published_at,
        closed_at,
        cancelled_at,
        created_by,
        updated_by,
        version,
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
        $9,
        $10,
        NULLIF($11, '')::timestamptz,
        NULLIF($12, '')::timestamptz,
        NULLIF($13, '')::timestamptz,
        $14,
        $15,
        $16,
        COALESCE(($8::jsonb->>'createdAt')::timestamptz, now()),
        COALESCE(($8::jsonb->>'updatedAt')::timestamptz, now())
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `,
    postgresCastingParams(casting),
  )

  if (result.rows[0]) {
    return rowToCasting(result.rows[0])
  }

  return findPostgresCasting(casting.id)
}

async function updatePostgresCasting(castingId, patch) {
  const result = await query(
    `
      UPDATE castings
      SET
        status = COALESCE($2, status),
        title = COALESCE($3, title),
        body = COALESCE($4, body),
        starts_at = CASE WHEN $5::boolean THEN NULLIF($6, '')::timestamptz ELSE starts_at END,
        ends_at = CASE WHEN $7::boolean THEN NULLIF($8, '')::timestamptz ELSE ends_at END,
        target_candidate_ids = COALESCE($9::text[], target_candidate_ids),
        source = COALESCE($10, source),
        published_at = CASE WHEN $11::boolean THEN NULLIF($12, '')::timestamptz ELSE published_at END,
        closed_at = CASE WHEN $13::boolean THEN NULLIF($14, '')::timestamptz ELSE closed_at END,
        cancelled_at = CASE WHEN $15::boolean THEN NULLIF($16, '')::timestamptz ELSE cancelled_at END,
        updated_by = COALESCE($17, updated_by),
        version = version + 1,
        updated_at = now(),
        data = data || $18::jsonb
      WHERE id = $1
      RETURNING *
    `,
    [
      castingId,
      patch.status ?? null,
      patch.title ?? null,
      patch.body ?? null,
      Object.hasOwn(patch, 'startsAt'),
      patch.startsAt ?? '',
      Object.hasOwn(patch, 'endsAt'),
      patch.endsAt ?? '',
      patch.targetCandidateIds ?? null,
      patch.source ?? null,
      Object.hasOwn(patch, 'publishedAt'),
      patch.publishedAt ?? '',
      Object.hasOwn(patch, 'closedAt'),
      patch.closedAt ?? '',
      Object.hasOwn(patch, 'cancelledAt'),
      patch.cancelledAt ?? '',
      patch.updatedBy ?? null,
      JSON.stringify({
        ...patch,
        updatedAt: new Date().toISOString(),
      }),
    ],
  )

  return result.rows[0] ? rowToCasting(result.rows[0]) : undefined
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
  const status = assertCastingStatus(casting.status ?? 'active')
  const created = {
    body: String(casting.body ?? '').trim(),
    cancelledAt: '',
    closedAt: '',
    createdAt: now,
    createdBy: casting.createdBy ?? 'web_admin',
    endsAt: casting.endsAt || '',
    id: casting.id ?? createCastingId(),
    publicToken: publicTokenPattern.test(String(casting.publicToken ?? '').trim())
      ? String(casting.publicToken).trim()
      : randomUUID().replaceAll('-', ''),
    publishedAt: casting.publishedAt ?? (status === 'active' ? now : ''),
    sentAt: casting.sentAt ?? '',
    source: casting.source ?? 'web_admin',
    startsAt: casting.startsAt || '',
    status,
    targetCandidateIds: Array.isArray(casting.targetCandidateIds) ? casting.targetCandidateIds : [],
    title: String(casting.title ?? '').trim(),
    updatedAt: now,
    updatedBy: casting.updatedBy ?? casting.createdBy ?? 'web_admin',
    version: 1,
  }

  if (hasPostgres()) {
    return insertPostgresCasting(created)
  }

  const castings = await readJsonCastings()
  const existing = castings.find((item) => item.id === created.id)
  if (existing) {
    return existing
  }
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

export function castingPublicToken(casting) {
  const explicitToken = String(casting?.publicToken ?? '').trim()
  if (publicTokenPattern.test(explicitToken)) {
    return explicitToken
  }

  const compactId = String(casting?.id ?? '').replace(/^CAST-/, '')
  if (publicTokenPattern.test(compactId)) {
    return compactId
  }

  return createHash('sha256')
    .update(String(casting?.id ?? explicitToken))
    .digest('base64url')
    .slice(0, 22)
}

export function castingDeepLinkPayload(casting) {
  return `cast_${castingPublicToken(casting)}`
}

export async function findCastingByPublicToken(publicToken) {
  const token = String(publicToken ?? '').trim()
  if (!publicTokenPattern.test(token)) {
    return undefined
  }

  if (hasPostgres()) {
    const direct = await findPostgresCastingByPublicToken(token)
    if (direct) {
      return direct
    }
  }

  const castings = await listCastings()
  return castings.find((casting) => castingPublicToken(casting) === token)
}

export async function updateCasting(castingId, patch, actor = 'web_admin') {
  return withPostgresAdvisoryLock(164731, `casting:${castingId}`, async () => {
    const existing = await findCasting(castingId)
    if (!existing) {
      return undefined
    }

    if (patch.status !== undefined) {
      assertCastingStatusTransition(existing.status, patch.status)
      if (existing.status === patch.status) {
        return existing
      }
    }

    const normalizedPatch = {
      ...patch,
      body: patch.body === undefined ? undefined : String(patch.body).trim(),
      title: patch.title === undefined ? undefined : String(patch.title).trim(),
      updatedBy: actor,
    }
    Object.keys(normalizedPatch).forEach((key) => normalizedPatch[key] === undefined && delete normalizedPatch[key])

    if (hasPostgres()) {
      return updatePostgresCasting(castingId, normalizedPatch)
    }

    const castings = await readJsonCastings()
    const index = castings.findIndex((item) => item.id === castingId)
    if (index === -1) {
      return undefined
    }

    const updated = {
      ...castings[index],
      ...normalizedPatch,
      id: castingId,
      publicToken: castings[index].publicToken,
      updatedAt: new Date().toISOString(),
      version: Number(castings[index].version ?? 1) + 1,
    }
    castings[index] = updated
    await writeJsonCastings(castings)
    return updated
  })
}

export async function transitionCastingStatus(castingId, status, actor = 'web_admin') {
  const nextStatus = assertCastingStatus(status)
  const now = new Date().toISOString()
  const lifecyclePatch = { status: nextStatus }

  if (['active', 'scheduled'].includes(nextStatus)) {
    lifecyclePatch.publishedAt = now
    lifecyclePatch.closedAt = ''
    lifecyclePatch.cancelledAt = ''
  } else if (nextStatus === 'closed') {
    lifecyclePatch.closedAt = now
  } else if (nextStatus === 'cancelled') {
    lifecyclePatch.cancelledAt = now
  }

  return updateCasting(castingId, lifecyclePatch, actor)
}

export async function listActiveCastingsForCandidate(candidate) {
  if (!isCandidateEligibleForCastingApplication(candidate)) {
    return []
  }

  const now = new Date()
  const candidateId = candidate.id
  const castings = await listCastings()

  return castings.filter((casting) => {
    if (!isCastingOpen(casting, now)) {
      return false
    }

    if (casting.targetCandidateIds?.length && !casting.targetCandidateIds.includes(candidateId)) {
      return false
    }

    return true
  })
}
