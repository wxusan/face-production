import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import {
  assertCastingParticipationSource,
  assertCastingParticipationStatus,
  assertCastingParticipationStatusTransition,
} from './castingLifecycle.js'
import { hasPostgres, query, withPostgresAdvisoryLock } from './postgres.js'

const storagePath = resolve(
  process.env.CASTING_MANAGEMENT_PATH ?? resolve(process.cwd(), 'var/casting-management.json'),
)
const localParticipationChains = new Map()

async function withParticipationLock(castingId, candidateId, task) {
  const key = `${castingId}:${candidateId}`
  if (hasPostgres()) {
    return withPostgresAdvisoryLock(164732, `casting-participation:${key}`, task)
  }

  const previous = localParticipationChains.get(key) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(task)
  localParticipationChains.set(key, current)
  try {
    return await current
  } finally {
    if (localParticipationChains.get(key) === current) {
      localParticipationChains.delete(key)
    }
  }
}

async function readLocalStore() {
  try {
    const parsed = JSON.parse(await readFile(storagePath, 'utf8'))
    return {
      channel: parsed.channel ?? {},
      outbox: Array.isArray(parsed.outbox) ? parsed.outbox : [],
      participations: Array.isArray(parsed.participations) ? parsed.participations : [],
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { channel: {}, outbox: [], participations: [] }
    }
    throw error
  }
}

async function writeLocalStore(store) {
  await mkdir(dirname(storagePath), { recursive: true })
  await writeFile(storagePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

function asIso(value) {
  return value?.toISOString?.() ?? value ?? ''
}

function rowToParticipation(row) {
  const data = row.data ?? {}
  return {
    ...data,
    applicationMessage: row.application_message ?? data.applicationMessage ?? '',
    candidateId: row.candidate_id,
    castingId: row.casting_id,
    createdAt: asIso(row.created_at),
    createdBy: row.created_by ?? data.createdBy,
    decidedAt: asIso(row.decided_at),
    decidedBy: row.decided_by ?? data.decidedBy,
    id: row.id,
    invitedAt: asIso(row.invited_at),
    profileSnapshot: row.profile_snapshot ?? data.profileSnapshot ?? {},
    removedAt: asIso(row.removed_at),
    respondedAt: asIso(row.responded_at),
    source: row.source,
    status: row.status,
    updatedAt: asIso(row.updated_at),
    updatedBy: row.updated_by ?? data.updatedBy,
  }
}

function transitionTimestamps(status, now) {
  if (status === 'invited') return { invitedAt: now }
  if (['applied', 'declined', 'withdrawn'].includes(status)) return { respondedAt: now }
  if (['selected', 'rejected'].includes(status)) return { decidedAt: now }
  if (['removed', 'cancelled'].includes(status)) return { removedAt: now }
  return {}
}

function transitionHistory(existing, { actor, source, status }, now) {
  const history = Array.isArray(existing?.history) ? existing.history : []
  return [
    ...history,
    {
      actor: actor ?? null,
      at: now,
      fromStatus: existing?.status ?? null,
      source,
      toStatus: status,
    },
  ].slice(-100)
}

export function snapshotCandidateProfile(candidate) {
  if (!candidate?.id) {
    return {}
  }

  const snapshot = structuredClone(candidate)
  delete snapshot.adminComments
  delete snapshot.adminDecisionMessageText
  return snapshot
}

export async function findCastingParticipation(castingId, candidateId) {
  if (hasPostgres()) {
    const result = await query(
      `
        SELECT *
        FROM casting_participations
        WHERE casting_id = $1 AND candidate_id = $2
        LIMIT 1
      `,
      [castingId, candidateId],
    )
    return result.rows[0] ? rowToParticipation(result.rows[0]) : undefined
  }

  const store = await readLocalStore()
  return store.participations.find(
    (item) => item.castingId === castingId && item.candidateId === candidateId,
  )
}

export async function listCastingParticipations(castingId, filters = {}) {
  const source = filters.source ? assertCastingParticipationSource(filters.source) : undefined
  const status = filters.status ? assertCastingParticipationStatus(filters.status) : undefined

  if (hasPostgres()) {
    const result = await query(
      `
        SELECT *
        FROM casting_participations
        WHERE casting_id = $1
          AND ($2::text IS NULL OR source = $2)
          AND ($3::text IS NULL OR status = $3)
        ORDER BY created_at ASC, id ASC
      `,
      [castingId, source ?? null, status ?? null],
    )
    return result.rows.map(rowToParticipation)
  }

  const store = await readLocalStore()
  return store.participations.filter(
    (item) =>
      item.castingId === castingId
      && (!source || item.source === source)
      && (!status || item.status === status),
  )
}

export async function listCastingParticipationPage(castingId, filters = {}) {
  const source = filters.source ? assertCastingParticipationSource(filters.source) : undefined
  const status = filters.status ? assertCastingParticipationStatus(filters.status) : undefined
  const requestedLimit = Number(filters.limit)
  const requestedOffset = Number(filters.offset)
  const limit = Math.min(300, Math.max(1, Number.isInteger(requestedLimit) ? requestedLimit : 100))
  const offset = Math.max(0, Number.isInteger(requestedOffset) ? requestedOffset : 0)

  if (hasPostgres()) {
    const result = await query(
      `
        SELECT *
        FROM casting_participations
        WHERE casting_id = $1
          AND ($2::text IS NULL OR source = $2)
          AND ($3::text IS NULL OR status = $3)
        ORDER BY created_at ASC, id ASC
        LIMIT $4
        OFFSET $5
      `,
      [castingId, source ?? null, status ?? null, limit + 1, offset],
    )
    const items = result.rows.slice(0, limit).map(rowToParticipation)
    return {
      items,
      pageInfo: {
        hasMore: result.rows.length > limit,
        limit,
        nextOffset: offset + items.length,
        offset,
      },
    }
  }

  const store = await readLocalStore()
  const matching = store.participations.filter(
    (item) =>
      item.castingId === castingId
      && (!source || item.source === source)
      && (!status || item.status === status),
  )
  const page = matching.slice(offset, offset + limit + 1)
  const items = page.slice(0, limit)
  return {
    items,
    pageInfo: {
      hasMore: page.length > limit,
      limit,
      nextOffset: offset + items.length,
      offset,
    },
  }
}

async function insertPostgresParticipation(participation) {
  const result = await query(
    `
      INSERT INTO casting_participations (
        id,
        casting_id,
        candidate_id,
        source,
        status,
        profile_snapshot,
        application_message,
        created_by,
        updated_by,
        decided_by,
        invited_at,
        responded_at,
        decided_at,
        removed_at,
        data,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10,
        NULLIF($11, '')::timestamptz,
        NULLIF($12, '')::timestamptz,
        NULLIF($13, '')::timestamptz,
        NULLIF($14, '')::timestamptz,
        $15::jsonb,
        $16,
        $17
      )
      ON CONFLICT (casting_id, candidate_id) DO NOTHING
      RETURNING *
    `,
    [
      participation.id,
      participation.castingId,
      participation.candidateId,
      participation.source,
      participation.status,
      JSON.stringify(participation.profileSnapshot),
      participation.applicationMessage || null,
      participation.createdBy ?? null,
      participation.updatedBy ?? null,
      participation.decidedBy ?? null,
      participation.invitedAt || '',
      participation.respondedAt || '',
      participation.decidedAt || '',
      participation.removedAt || '',
      JSON.stringify(participation),
      participation.createdAt,
      participation.updatedAt,
    ],
  )
  return result.rows[0] ? rowToParticipation(result.rows[0]) : undefined
}

async function updatePostgresParticipation(participation) {
  const result = await query(
    `
      UPDATE casting_participations
      SET
        source = $3,
        status = $4,
        profile_snapshot = $5::jsonb,
        application_message = $6,
        updated_by = $7,
        decided_by = $8,
        invited_at = NULLIF($9, '')::timestamptz,
        responded_at = NULLIF($10, '')::timestamptz,
        decided_at = NULLIF($11, '')::timestamptz,
        removed_at = NULLIF($12, '')::timestamptz,
        data = $13::jsonb,
        updated_at = $14
      WHERE casting_id = $1 AND candidate_id = $2
      RETURNING *
    `,
    [
      participation.castingId,
      participation.candidateId,
      participation.source,
      participation.status,
      JSON.stringify(participation.profileSnapshot),
      participation.applicationMessage || null,
      participation.updatedBy ?? null,
      participation.decidedBy ?? null,
      participation.invitedAt || '',
      participation.respondedAt || '',
      participation.decidedAt || '',
      participation.removedAt || '',
      JSON.stringify(participation),
      participation.updatedAt,
    ],
  )
  return result.rows[0] ? rowToParticipation(result.rows[0]) : undefined
}

export async function upsertCastingParticipation({
  actor = 'system',
  applicationMessage = '',
  candidateId,
  castingId,
  metadata = {},
  profileSnapshot = {},
  source,
  status,
}) {
  const normalizedSource = assertCastingParticipationSource(source)
  const normalizedStatus = assertCastingParticipationStatus(status)

  return withParticipationLock(castingId, candidateId, async () => {
    const existing = await findCastingParticipation(castingId, candidateId)
    const now = new Date().toISOString()

    if (existing?.status === normalizedStatus) {
      return { changed: false, participation: existing }
    }
    if (existing) {
      assertCastingParticipationStatusTransition(existing.status, normalizedStatus)
    }

    const timestampPatch = transitionTimestamps(normalizedStatus, now)
    const participation = {
      ...(existing ?? {}),
      ...timestampPatch,
      ...metadata,
      applicationMessage: String(applicationMessage || existing?.applicationMessage || '').trim(),
      candidateId: String(candidateId),
      castingId: String(castingId),
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? actor,
      decidedBy: ['selected', 'rejected'].includes(normalizedStatus) ? actor : existing?.decidedBy,
      id: existing?.id ?? `CP-${randomUUID()}`,
      history: transitionHistory(
        existing,
        { actor, source: existing?.source ?? normalizedSource, status: normalizedStatus },
        now,
      ),
      profileSnapshot: Object.keys(profileSnapshot).length ? structuredClone(profileSnapshot) : existing?.profileSnapshot ?? {},
      source: existing?.source ?? normalizedSource,
      status: normalizedStatus,
      updatedAt: now,
      updatedBy: actor,
    }

    if (hasPostgres()) {
      const stored = existing
        ? await updatePostgresParticipation(participation)
        : await insertPostgresParticipation(participation)
      if (stored) {
        return { changed: true, participation: stored }
      }
      const concurrent = await findCastingParticipation(castingId, candidateId)
      return { changed: false, participation: concurrent }
    }

    const store = await readLocalStore()
    const index = store.participations.findIndex(
      (item) => item.castingId === castingId && item.candidateId === candidateId,
    )
    if (index === -1) {
      store.participations.push(participation)
    } else {
      store.participations[index] = participation
    }
    await writeLocalStore(store)
    return { changed: true, participation }
  })
}

export async function transitionCastingParticipation({
  actor = 'system',
  candidateId,
  castingId,
  metadata = {},
  status,
}) {
  const existing = await findCastingParticipation(castingId, candidateId)
  if (!existing) {
    return { changed: false, participation: undefined }
  }
  return upsertCastingParticipation({
    actor,
    applicationMessage: existing.applicationMessage,
    candidateId,
    castingId,
    metadata,
    profileSnapshot: existing.profileSnapshot,
    source: existing.source,
    status,
  })
}

export async function removeCastingParticipant({ actor = 'web_admin', candidateId, castingId }) {
  return transitionCastingParticipation({
    actor,
    candidateId,
    castingId,
    status: 'removed',
  })
}

export async function restoreCastingParticipation({ candidateId, castingId, participation }) {
  return withParticipationLock(castingId, candidateId, async () => {
    if (hasPostgres()) {
      if (!participation) {
        await query(
          'DELETE FROM casting_participations WHERE casting_id = $1 AND candidate_id = $2',
          [castingId, candidateId],
        )
        return undefined
      }
      return updatePostgresParticipation(participation)
    }

    const store = await readLocalStore()
    const index = store.participations.findIndex(
      (item) => item.castingId === castingId && item.candidateId === candidateId,
    )
    if (!participation) {
      if (index !== -1) store.participations.splice(index, 1)
      await writeLocalStore(store)
      return undefined
    }
    if (index === -1) store.participations.push(participation)
    else store.participations[index] = participation
    await writeLocalStore(store)
    return participation
  })
}

export async function castingParticipationCounts(castingId) {
  return (await castingParticipationCountsByCastingIds([castingId]))[castingId] ?? {
    applications: 0,
    awaiting: 0,
    byStatus: {},
    candidates: 0,
    invitations: 0,
    total: 0,
  }
}

function summarizeParticipations(participations) {
  const byStatus = Object.fromEntries(
    participations.reduce((counts, item) => {
      counts.set(item.status, (counts.get(item.status) ?? 0) + 1)
      return counts
    }, new Map()),
  )

  return {
    applications: participations.filter((item) => item.status === 'applied').length,
    awaiting: participations.filter((item) => item.status === 'invited').length,
    byStatus,
    candidates: participations.filter((item) => item.status === 'selected').length,
    invitations: participations.filter((item) => item.source === 'invitation').length,
    total: participations.length,
  }
}

export async function castingParticipationCountsByCastingIds(castingIds) {
  const uniqueIds = [...new Set((castingIds ?? []).map(String).filter(Boolean))]
  if (!uniqueIds.length) return {}

  if (hasPostgres()) {
    const result = await query(
      `
        SELECT casting_id, source, status, COUNT(*)::integer AS count
        FROM casting_participations
        WHERE casting_id = ANY($1::text[])
        GROUP BY casting_id, source, status
      `,
      [uniqueIds],
    )
    const summaries = Object.fromEntries(uniqueIds.map((castingId) => [castingId, {
      applications: 0,
      awaiting: 0,
      byStatus: {},
      candidates: 0,
      invitations: 0,
      total: 0,
    }]))
    for (const row of result.rows) {
      const count = Number(row.count ?? 0)
      const summary = summaries[row.casting_id]
      if (!summary) continue
      summary.byStatus[row.status] = (summary.byStatus[row.status] ?? 0) + count
      summary.total += count
      if (row.status === 'applied') summary.applications += count
      if (row.status === 'invited') summary.awaiting += count
      if (row.status === 'selected') summary.candidates += count
      if (row.source === 'invitation') summary.invitations += count
    }
    return summaries
  }

  const store = await readLocalStore()
  return Object.fromEntries(
    uniqueIds.map((castingId) => [
      castingId,
      summarizeParticipations(store.participations.filter((item) => item.castingId === castingId)),
    ]),
  )
}
