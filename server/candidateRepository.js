import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { hasPostgres, query } from './postgres.js'
import { normalizeCandidateTaxonomy } from './taxonomy.js'

const candidatePath = resolve(
  process.env.CANDIDATE_STORAGE_PATH ?? resolve(process.cwd(), 'var/candidate-intakes.json'),
)
const defaultCandidatePageSize = 100
const maximumCandidatePageSize = 200
const candidateArrayFilterFields = {
  appearance: 'appearance',
  languages: 'languageSkills',
  performance: 'performanceTalents',
  physical: 'physicalSkills',
  sports: 'sportsTalents',
}
const candidateMediaFilterFields = new Set([
  'closeShotPhotoPath',
  'fullBodyPhotoPath',
  'introVideoPath',
  'leftProfilePhotoPath',
  'portraitPhotoPath',
  'rightProfilePhotoPath',
])

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

function normalizeCandidatePageOptions(options = {}) {
  const requestedLimit = Number(options.limit)
  const requestedOffset = Number(options.offset)
  const filters = options.filters && typeof options.filters === 'object' && !Array.isArray(options.filters)
    ? options.filters
    : {}
  const scopeStatuses = {
    applications: ['pending_review'],
    candidates: ['approved', 'verified'],
  }[options.scope]
  const requestedStatuses = Array.isArray(filters.status)
    ? filters.status.map(String).filter(Boolean)
    : []
  const statuses = scopeStatuses
    ? (requestedStatuses.length
        ? requestedStatuses.filter((status) => scopeStatuses.includes(status))
        : scopeStatuses)
    : requestedStatuses

  return {
    filters,
    forceNoMatches: Boolean(scopeStatuses && requestedStatuses.length && !statuses.length),
    limit: Math.min(
      maximumCandidatePageSize,
      Math.max(1, Number.isInteger(requestedLimit) ? requestedLimit : defaultCandidatePageSize),
    ),
    offset: Math.max(0, Number.isInteger(requestedOffset) ? requestedOffset : 0),
    scope: ['applications', 'candidates', 'all'].includes(options.scope) ? options.scope : 'all',
    statuses,
  }
}

function normalizedFilterList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean)
    : []
}

function stringFilterList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : []
}

function comparableDate(value) {
  const timestamp = Date.parse(String(value ?? ''))
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function candidatePageRating(candidate) {
  const rating = Number(candidate?.rating)
  return Number.isFinite(rating) ? rating : 0
}

function matchesCandidatePageFilters(candidate, options) {
  const { filters, statuses } = options
  if (options.forceNoMatches) return false
  if (statuses.length && !statuses.includes(candidate.status)) return false

  const queryText = String(filters.q ?? '').trim().toLowerCase()
  if (queryText) {
    const haystack = [
      candidate.id,
      candidate.name,
      candidate.phone,
      candidate.telegramUsername,
      candidate.telegramUserId,
    ].map((value) => String(value ?? '').toLowerCase()).join(' ')
    if (!haystack.includes(queryText)) return false
  }

  for (const field of ['city', 'gender', 'source']) {
    const selected = normalizedFilterList(filters[field])
    if (selected.length && !selected.includes(String(candidate[field] ?? '').trim().toLowerCase())) return false
  }

  for (const [field, minimumKey, maximumKey] of [
    ['age', 'ageMin', 'ageMax'],
    ['height', 'heightMin', 'heightMax'],
    ['weight', 'weightMin', 'weightMax'],
  ]) {
    const value = Number(candidate[field])
    const minimum = filters[minimumKey] === '' || filters[minimumKey] == null ? undefined : Number(filters[minimumKey])
    const maximum = filters[maximumKey] === '' || filters[maximumKey] == null ? undefined : Number(filters[maximumKey])
    if (minimum !== undefined && (!Number.isFinite(value) || value < minimum)) return false
    if (maximum !== undefined && (!Number.isFinite(value) || value > maximum)) return false
  }

  for (const [field, fromKey, toKey] of [
    ['createdAt', 'createdFrom', 'createdTo'],
    ['updatedAt', 'updatedFrom', 'updatedTo'],
  ]) {
    const value = comparableDate(candidate[field])
    const from = filters[fromKey] ? comparableDate(`${filters[fromKey]}T00:00:00.000Z`) : undefined
    const to = filters[toKey] ? comparableDate(`${filters[toKey]}T23:59:59.999Z`) : undefined
    if (from !== undefined && (value === undefined || value < from)) return false
    if (to !== undefined && (value === undefined || value > to)) return false
  }

  for (const [filterField, candidateField] of Object.entries(candidateArrayFilterFields)) {
    const selected = normalizedFilterList(filters[filterField])
    if (!selected.length) continue
    const values = normalizedFilterList(
      Array.isArray(candidate[candidateField]) ? candidate[candidateField] : [candidate[candidateField]],
    )
    if (!selected.some((value) => values.includes(value))) return false
  }

  const labelIds = stringFilterList(filters.labels)
  if (labelIds.length) {
    const resolvedCandidateIds = stringFilterList(filters.labelCandidateIds)
    if (resolvedCandidateIds.length) {
      if (!resolvedCandidateIds.includes(candidate.id)) return false
    } else {
      const candidateLabelIds = stringFilterList(candidate.adminLabels?.map((label) => label.id))
      if (!labelIds.some((labelId) => candidateLabelIds.includes(labelId))) return false
    }
  }

  const customFilters = Array.isArray(filters.customFilters) ? filters.customFilters : []
  if (customFilters.length) {
    const matched = customFilters.some(({ field, value }) => {
      const candidateValues = normalizedFilterList(
        Array.isArray(candidate[field]) ? candidate[field] : [candidate[field]],
      )
      return candidateValues.includes(String(value ?? '').trim().toLowerCase())
    })
    if (!matched) return false
  }

  const media = filters.media && typeof filters.media === 'object' ? filters.media : {}
  for (const [field, required] of Object.entries(media)) {
    if (!required || !candidateMediaFilterFields.has(field)) continue
    if (field === 'portraitPhotoPath') {
      if (!candidate.portraitPhotoPath && !candidate.photoPath) return false
    } else if (!candidate[field]) {
      return false
    }
  }

  return true
}

function addSqlCondition(conditions, params, sql, value) {
  params.push(value)
  conditions.push(sql.replaceAll('$value', `$${params.length}`))
}

async function readPostgresCandidatePage(rawOptions) {
  const options = normalizeCandidatePageOptions(rawOptions)
  const { filters } = options
  const conditions = []
  const params = []

  if (options.forceNoMatches) {
    conditions.push('FALSE')
  }

  if (options.statuses.length) {
    addSqlCondition(conditions, params, 'status = ANY($value::text[])', options.statuses)
  }

  const queryText = String(filters.q ?? '').trim().toLowerCase()
  if (queryText) {
    addSqlCondition(
      conditions,
      params,
      `lower(concat_ws(' ', id, name, phone, telegram_username, telegram_user_id)) LIKE $value`,
      `%${queryText}%`,
    )
  }

  for (const field of ['city', 'gender', 'source']) {
    const selected = normalizedFilterList(filters[field])
    if (!selected.length) continue
    addSqlCondition(conditions, params, `lower(COALESCE(${field}, '')) = ANY($value::text[])`, selected)
  }

  for (const [column, minimumKey, maximumKey] of [
    ['age', 'ageMin', 'ageMax'],
    [`CASE WHEN COALESCE(data->>'height', '') ~ '^[0-9]+([.][0-9]+)?$' THEN (data->>'height')::numeric END`, 'heightMin', 'heightMax'],
    [`CASE WHEN COALESCE(data->>'weight', '') ~ '^[0-9]+([.][0-9]+)?$' THEN (data->>'weight')::numeric END`, 'weightMin', 'weightMax'],
  ]) {
    if (filters[minimumKey] !== '' && filters[minimumKey] != null) {
      addSqlCondition(conditions, params, `${column} >= $value::numeric`, Number(filters[minimumKey]))
    }
    if (filters[maximumKey] !== '' && filters[maximumKey] != null) {
      addSqlCondition(conditions, params, `${column} <= $value::numeric`, Number(filters[maximumKey]))
    }
  }

  for (const [column, fromKey, toKey] of [
    ['created_at', 'createdFrom', 'createdTo'],
    ['updated_at', 'updatedFrom', 'updatedTo'],
  ]) {
    if (filters[fromKey]) {
      addSqlCondition(conditions, params, `${column} >= $value::date`, String(filters[fromKey]))
    }
    if (filters[toKey]) {
      addSqlCondition(conditions, params, `${column} < ($value::date + interval '1 day')`, String(filters[toKey]))
    }
  }

  for (const [filterField, candidateField] of Object.entries(candidateArrayFilterFields)) {
    const selected = normalizedFilterList(filters[filterField])
    if (!selected.length) continue
    const alternatives = []
    for (const value of selected) {
      params.push(JSON.stringify({ [candidateField]: [value] }))
      alternatives.push(`data @> $${params.length}::jsonb`)
    }
    conditions.push(`(${alternatives.join(' OR ')})`)
  }

  const labelIds = stringFilterList(filters.labels)
  if (labelIds.length) {
    addSqlCondition(
      conditions,
      params,
      'EXISTS (SELECT 1 FROM candidate_profile_labels cpl WHERE cpl.candidate_id = candidates.id AND cpl.label_id = ANY($value::text[]))',
      labelIds,
    )
  }

  const customFilters = Array.isArray(filters.customFilters) ? filters.customFilters : []
  if (customFilters.length) {
    const alternatives = []
    for (const item of customFilters) {
      if (!candidateArrayFilterFields[item.group] && !Object.values(candidateArrayFilterFields).includes(item.field)) continue
      params.push(JSON.stringify({ [item.field]: [String(item.value ?? '').trim()] }))
      alternatives.push(`data @> $${params.length}::jsonb`)
    }
    if (alternatives.length) conditions.push(`(${alternatives.join(' OR ')})`)
  }

  const media = filters.media && typeof filters.media === 'object' ? filters.media : {}
  for (const [field, required] of Object.entries(media)) {
    if (!required || !candidateMediaFilterFields.has(field)) continue
    if (field === 'portraitPhotoPath') {
      conditions.push(`(COALESCE(data->>'portraitPhotoPath', '') <> '' OR COALESCE(data->>'photoPath', '') <> '')`)
    } else {
      params.push(field)
      conditions.push(`COALESCE(data->>$${params.length}, '') <> ''`)
    }
  }

  params.push(options.limit + 1)
  const limitPosition = params.length
  params.push(options.offset)
  const offsetPosition = params.length
  const result = await query(
    `
      SELECT *
      FROM candidates
      ${conditions.length ? `WHERE ${conditions.join('\n        AND ')}` : ''}
      ORDER BY
        CASE
          WHEN COALESCE(data->>'rating', '') ~ '^[0-9]+([.][0-9]+)?$'
          THEN (data->>'rating')::numeric
          ELSE 0
        END DESC,
        lower(COALESCE(name, '')),
        id
      LIMIT $${limitPosition}
      OFFSET $${offsetPosition}
    `,
    params,
  )
  const items = result.rows.slice(0, options.limit).map(rowToCandidate)
  return {
    items,
    pageInfo: {
      hasMore: result.rows.length > options.limit,
      limit: options.limit,
      nextOffset: options.offset + items.length,
      offset: options.offset,
    },
  }
}

async function readJsonCandidatePage(rawOptions) {
  const options = normalizeCandidatePageOptions(rawOptions)
  const storedCandidates = await listCandidates()
  const filtered = storedCandidates
    .filter((candidate) => matchesCandidatePageFilters(candidate, options))
    .sort((left, right) => (
      candidatePageRating(right) - candidatePageRating(left)
      || String(left.name ?? '').localeCompare(String(right.name ?? ''))
      || String(left.id).localeCompare(String(right.id))
    ))
  const page = filtered.slice(options.offset, options.offset + options.limit + 1)
  const items = page.slice(0, options.limit)
  return {
    items,
    pageInfo: {
      hasMore: page.length > options.limit,
      limit: options.limit,
      nextOffset: options.offset + items.length,
      offset: options.offset,
    },
  }
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

export function isCandidateReachableForDirectMessage(candidate) {
  return Boolean(candidateMessagingChatId(candidate))
}

export function isCandidateEligibleForMessaging(candidate) {
  return isCandidateReachableForDirectMessage(candidate)
    && ['approved', 'verified'].includes(candidate?.status)
    && hasRequiredCandidateConsent(candidate)
}

const castingRequiredScalarFields = Object.freeze([
  'name',
  'phone',
  'age',
  'city',
  'gender',
  'height',
  'weight',
])
const castingRequiredArrayFields = Object.freeze([
  'performanceTalents',
  'sportsTalents',
  'physicalSkills',
  'languageSkills',
  'appearance',
])
const castingRequiredMediaFields = Object.freeze([
  'fullBodyPhoto',
  'closeShotPhoto',
  'leftProfilePhoto',
  'rightProfilePhoto',
  'portraitPhoto',
  'introVideo',
])

export function candidateCastingProfileMissingFields(candidate) {
  const missingScalars = castingRequiredScalarFields.filter((field) => {
    const value = candidate?.[field]
    return value === undefined || value === null || String(value).trim() === ''
  })
  const missingArrays = castingRequiredArrayFields.filter(
    (field) =>
      !Array.isArray(candidate?.[field])
      || candidate[field].every((value) => String(value ?? '').trim() === ''),
  )
  const missingMedia = castingRequiredMediaFields.filter(
    (field) => !candidate?.[`${field}Path`] && !candidate?.[`${field}FileId`],
  )
  const missingConsent = hasRequiredCandidateConsent(candidate) ? [] : ['consent']
  return [...missingScalars, ...missingArrays, ...missingMedia, ...missingConsent]
}

export function isCandidateEligibleForCastingApplication(candidate) {
  return ['pending_review', 'approved', 'verified'].includes(candidate?.status)
    && candidateCastingProfileMissingFields(candidate).length === 0
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

export async function findCandidatesByIds(candidateIds) {
  const ids = [...new Set((candidateIds ?? []).map(String).filter(Boolean))].slice(0, 300)
  if (!ids.length) return []

  if (hasPostgres()) {
    const result = await query(
      `
        SELECT *
        FROM candidates
        WHERE id = ANY($1::text[])
      `,
      [ids],
    )
    return result.rows.map(rowToCandidate)
  }

  const idSet = new Set(ids)
  return (await listCandidates()).filter((candidate) => idSet.has(candidate.id))
}

export async function listCandidatePage(options = {}) {
  return hasPostgres()
    ? readPostgresCandidatePage(options)
    : readJsonCandidatePage(options)
}

export async function listCandidateFilterFacets() {
  if (hasPostgres()) {
    const result = await query(`
      SELECT
        ARRAY(
          SELECT city
          FROM (
            SELECT DISTINCT city
            FROM candidates
            WHERE city IS NOT NULL AND city <> ''
            ORDER BY city
            LIMIT 101
          ) cities
        ) AS cities,
        ARRAY(
          SELECT gender
          FROM (
            SELECT DISTINCT gender
            FROM candidates
            WHERE gender IS NOT NULL AND gender <> ''
            ORDER BY gender
            LIMIT 101
          ) genders
        ) AS genders,
        ARRAY(
          SELECT source
          FROM (
            SELECT DISTINCT source
            FROM candidates
            WHERE source IS NOT NULL AND source <> ''
            ORDER BY source
            LIMIT 101
          ) sources
        ) AS sources
    `)
    const row = result.rows[0] ?? {}
    return {
      cities: (row.cities ?? []).slice(0, 100),
      genders: (row.genders ?? []).slice(0, 100),
      sources: (row.sources ?? []).slice(0, 100),
      truncated: [row.cities, row.genders, row.sources].some((values) => (values?.length ?? 0) > 100),
    }
  }

  const candidates = await listCandidates()
  const distinct = (field) => [...new Set(candidates.map((candidate) => candidate[field]).filter(Boolean))]
    .sort((left, right) => String(left).localeCompare(String(right)))
  const cities = distinct('city')
  const genders = distinct('gender')
  const sources = distinct('source')
  return {
    cities: cities.slice(0, 100),
    genders: genders.slice(0, 100),
    sources: sources.slice(0, 100),
    truncated: [cities, genders, sources].some((values) => values.length > 100),
  }
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
