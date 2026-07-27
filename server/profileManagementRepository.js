import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { listCandidates, updateCandidateMetadata } from './candidateRepository.js'
import { hasPostgres, query } from './postgres.js'
import { canonicalTalentList, canonicalTalentValue, talentTaxonomy } from './taxonomy.js'

const profileManagementPath = resolve(
  process.env.PROFILE_MANAGEMENT_PATH ?? resolve(process.cwd(), 'var/profile-management.json'),
)

export const editableCandidateFields = [
  'name',
  'phone',
  'age',
  'city',
  'gender',
  'height',
  'weight',
  'appearance',
  'performanceTalents',
  'sportsTalents',
  'physicalSkills',
  'languageSkills',
]

export const customTaxonomyFields = [
  'appearance',
  'languageSkills',
  'performanceTalents',
  'physicalSkills',
  'sportsTalents',
]

const fieldToGroup = {
  appearance: 'appearance',
  languageSkills: 'languages',
  performanceTalents: 'performance',
  physicalSkills: 'physical',
  sportsTalents: 'sports',
}

const initialLocalState = {
  assignments: [],
  comments: [],
  customValues: [],
  labels: [],
}

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('’', "'")
    .replaceAll('‘', "'")
    .replaceAll('`', "'")
    .replace(/\s+/g, ' ')
}

function cleanText(value, field, maximumLength = 120) {
  const cleaned = String(value ?? '').trim().replace(/\s+/g, ' ')

  if (!cleaned) {
    const error = new Error(`${field} is required`)
    error.statusCode = 400
    throw error
  }

  if (cleaned.length > maximumLength) {
    const error = new Error(`${field} must be ${maximumLength} characters or less`)
    error.statusCode = 400
    throw error
  }

  return cleaned
}

function cleanActor(actor = {}) {
  return {
    id: String(actor.id ?? 'super_admin'),
    name: String(actor.name ?? 'Super Admin'),
    role: actor.role === 'admin' ? 'admin' : 'superadmin',
  }
}

function isSuperAdmin(actor) {
  return cleanActor(actor).role === 'superadmin'
}

function canManageComment(comment, actor) {
  const normalizedActor = cleanActor(actor)
  return normalizedActor.role === 'superadmin' || comment.authorId === normalizedActor.id
}

async function readLocalState() {
  try {
    const stored = JSON.parse(await readFile(profileManagementPath, 'utf8'))
    return {
      ...initialLocalState,
      ...stored,
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return structuredClone(initialLocalState)
    }

    throw error
  }
}

async function writeLocalState(state) {
  await mkdir(dirname(profileManagementPath), { recursive: true })
  await writeFile(profileManagementPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

function labelRow(row) {
  return {
    color: row.color ?? '',
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    createdBy: row.created_by,
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  }
}

function commentRow(row, actor) {
  const comment = {
    authorId: row.author_id,
    authorName: row.author_name,
    body: row.body,
    candidateId: row.candidate_id,
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    id: row.id,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  }

  return {
    ...comment,
    canManage: canManageComment(comment, actor),
  }
}

function customValueRow(row) {
  return {
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    createdBy: row.created_by,
    field: row.field,
    id: row.id,
    mergedIntoValue: row.merged_into_value,
    status: row.status,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
    updatedBy: row.updated_by,
    value: row.value,
  }
}

function officialCodesForField(field) {
  const group = fieldToGroup[field]
  return new Set((talentTaxonomy[group] ?? []).map((option) => option.code))
}

function isCustomTaxonomyValue(field, value) {
  if (!customTaxonomyFields.includes(field)) return false
  return !officialCodesForField(field).has(canonicalTalentValue(value))
}

export function sanitizeCandidateProfilePatch(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const patch = {}

  for (const field of editableCandidateFields) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue

    if (customTaxonomyFields.includes(field)) {
      patch[field] = canonicalTalentList(source[field]).slice(0, 30)
      continue
    }

    if (['age', 'height', 'weight'].includes(field)) {
      const value = Number(source[field])
      const limits = {
        age: [1, 120],
        height: [30, 260],
        weight: [5, 400],
      }[field]

      if (!Number.isFinite(value) || value < limits[0] || value > limits[1]) {
        const error = new Error(`${field} is outside the allowed range`)
        error.statusCode = 400
        throw error
      }

      patch[field] = Math.round(value * 100) / 100
      continue
    }

    patch[field] = cleanText(source[field], field, field === 'name' ? 100 : 120)
  }

  if (!Object.keys(patch).length) {
    const error = new Error('No editable profile fields were supplied')
    error.statusCode = 400
    throw error
  }

  return patch
}

export function profileChanges(candidate, patch) {
  const changes = {}

  for (const [field, after] of Object.entries(patch)) {
    const before = candidate?.[field] ?? (Array.isArray(after) ? [] : null)
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes[field] = { after, before }
    }
  }

  return changes
}

export async function listProfileLabels() {
  if (hasPostgres()) {
    const result = await query('SELECT * FROM profile_labels ORDER BY lower(name), id LIMIT 501')
    return result.rows.map(labelRow)
  }

  return (await readLocalState()).labels
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function localCandidateIdsForLabels(labelIds) {
  if (hasPostgres()) return undefined
  const selected = new Set((labelIds ?? []).map(String).filter(Boolean))
  if (!selected.size) return undefined
  const state = await readLocalState()
  return [...new Set(
    state.assignments
      .filter((assignment) => selected.has(assignment.labelId))
      .map((assignment) => assignment.candidateId),
  )]
}

export async function createProfileLabel({ color, name }, actor) {
  const labelName = cleanText(name, 'Label name', 60)
  const normalizedName = normalizeText(labelName)
  const normalizedActor = cleanActor(actor)

  if (hasPostgres()) {
    const result = await query(
      `
        INSERT INTO profile_labels (id, name, normalized_name, color, created_by)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (normalized_name) DO UPDATE SET
          name = EXCLUDED.name,
          color = COALESCE(EXCLUDED.color, profile_labels.color),
          updated_at = now()
        RETURNING *
      `,
      [`LBL-${randomUUID()}`, labelName, normalizedName, color ?? null, normalizedActor.id],
    )
    return labelRow(result.rows[0])
  }

  const state = await readLocalState()
  const existing = state.labels.find((label) => normalizeText(label.name) === normalizedName)
  if (existing) return existing

  const now = new Date().toISOString()
  const label = {
    color: color ?? '',
    createdAt: now,
    createdBy: normalizedActor.id,
    id: `LBL-${randomUUID()}`,
    name: labelName,
    updatedAt: now,
  }
  state.labels.push(label)
  await writeLocalState(state)
  return label
}

export async function renameProfileLabel(labelId, name, actor) {
  const labelName = cleanText(name, 'Label name', 60)
  const normalizedName = normalizeText(labelName)
  cleanActor(actor)

  if (hasPostgres()) {
    const result = await query(
      `
        UPDATE profile_labels
        SET name = $2, normalized_name = $3, updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [labelId, labelName, normalizedName],
    )
    return result.rows[0] ? labelRow(result.rows[0]) : undefined
  }

  const state = await readLocalState()
  const label = state.labels.find((item) => item.id === labelId)
  if (!label) return undefined
  const duplicate = state.labels.find((item) => item.id !== labelId && normalizeText(item.name) === normalizedName)
  if (duplicate) {
    const error = new Error('A label with this name already exists')
    error.statusCode = 409
    throw error
  }
  label.name = labelName
  label.updatedAt = new Date().toISOString()
  await writeLocalState(state)
  return label
}

export async function deleteProfileLabel(labelId, actor) {
  cleanActor(actor)

  if (hasPostgres()) {
    const result = await query('DELETE FROM profile_labels WHERE id = $1 RETURNING id, name', [labelId])
    return result.rows[0]
  }

  const state = await readLocalState()
  const index = state.labels.findIndex((label) => label.id === labelId)
  if (index === -1) return undefined
  const [removed] = state.labels.splice(index, 1)
  state.assignments = state.assignments.filter((assignment) => assignment.labelId !== labelId)
  await writeLocalState(state)
  return removed
}

export async function assignCandidateLabel(candidateId, labelId, actor) {
  const normalizedActor = cleanActor(actor)

  if (hasPostgres()) {
    const result = await query(
      `
        INSERT INTO candidate_profile_labels (candidate_id, label_id, assigned_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (candidate_id, label_id) DO UPDATE SET assigned_by = EXCLUDED.assigned_by
        RETURNING candidate_id, label_id, assigned_at
      `,
      [candidateId, labelId, normalizedActor.id],
    )
    return result.rows[0]
  }

  const state = await readLocalState()
  if (!state.labels.some((label) => label.id === labelId)) return undefined
  let assignment = state.assignments.find((item) => item.candidateId === candidateId && item.labelId === labelId)
  if (!assignment) {
    assignment = {
      assignedAt: new Date().toISOString(),
      assignedBy: normalizedActor.id,
      candidateId,
      labelId,
    }
    state.assignments.push(assignment)
    await writeLocalState(state)
  }
  return assignment
}

export async function removeCandidateLabel(candidateId, labelId) {
  if (hasPostgres()) {
    const result = await query(
      'DELETE FROM candidate_profile_labels WHERE candidate_id = $1 AND label_id = $2 RETURNING candidate_id, label_id',
      [candidateId, labelId],
    )
    return result.rows[0]
  }

  const state = await readLocalState()
  const before = state.assignments.length
  state.assignments = state.assignments.filter(
    (assignment) => assignment.candidateId !== candidateId || assignment.labelId !== labelId,
  )
  if (state.assignments.length === before) return undefined
  await writeLocalState(state)
  return { candidateId, labelId }
}

export async function createCandidateComment(candidateId, body, actor) {
  const normalizedActor = cleanActor(actor)
  const commentBody = cleanText(body, 'Comment', 4000)
  const id = `CMT-${randomUUID()}`

  if (hasPostgres()) {
    const result = await query(
      `
        INSERT INTO candidate_comments (id, candidate_id, body, author_id, author_name)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `,
      [id, candidateId, commentBody, normalizedActor.id, normalizedActor.name],
    )
    return commentRow(result.rows[0], normalizedActor)
  }

  const now = new Date().toISOString()
  const comment = {
    authorId: normalizedActor.id,
    authorName: normalizedActor.name,
    body: commentBody,
    candidateId,
    createdAt: now,
    id,
    updatedAt: now,
  }
  const state = await readLocalState()
  state.comments.push(comment)
  await writeLocalState(state)
  return { ...comment, canManage: true }
}

export async function updateCandidateComment(commentId, body, actor) {
  const normalizedActor = cleanActor(actor)
  const commentBody = cleanText(body, 'Comment', 4000)

  if (hasPostgres()) {
    const existingResult = await query('SELECT * FROM candidate_comments WHERE id = $1 LIMIT 1', [commentId])
    const existing = existingResult.rows[0] ? commentRow(existingResult.rows[0], normalizedActor) : undefined
    if (!existing) return undefined
    if (!canManageComment(existing, normalizedActor)) {
      const error = new Error('You can edit only your own comments')
      error.statusCode = 403
      throw error
    }
    const result = await query(
      'UPDATE candidate_comments SET body = $2, updated_at = now() WHERE id = $1 RETURNING *',
      [commentId, commentBody],
    )
    return {
      ...commentRow(result.rows[0], normalizedActor),
      previousBody: existing.body,
    }
  }

  const state = await readLocalState()
  const comment = state.comments.find((item) => item.id === commentId)
  if (!comment) return undefined
  if (!canManageComment(comment, normalizedActor)) {
    const error = new Error('You can edit only your own comments')
    error.statusCode = 403
    throw error
  }
  const previousBody = comment.body
  comment.body = commentBody
  comment.updatedAt = new Date().toISOString()
  await writeLocalState(state)
  return { ...comment, canManage: true, previousBody }
}

export async function deleteCandidateComment(commentId, actor) {
  const normalizedActor = cleanActor(actor)

  if (hasPostgres()) {
    const existingResult = await query('SELECT * FROM candidate_comments WHERE id = $1 LIMIT 1', [commentId])
    const existing = existingResult.rows[0] ? commentRow(existingResult.rows[0], normalizedActor) : undefined
    if (!existing) return undefined
    if (!canManageComment(existing, normalizedActor)) {
      const error = new Error('You can delete only your own comments')
      error.statusCode = 403
      throw error
    }
    await query('DELETE FROM candidate_comments WHERE id = $1', [commentId])
    return existing
  }

  const state = await readLocalState()
  const index = state.comments.findIndex((item) => item.id === commentId)
  if (index === -1) return undefined
  const comment = state.comments[index]
  if (!canManageComment(comment, normalizedActor)) {
    const error = new Error('You can delete only your own comments')
    error.statusCode = 403
    throw error
  }
  state.comments.splice(index, 1)
  await writeLocalState(state)
  return comment
}

export async function registerCandidateCustomValues(candidates, actor = { id: 'telegram', name: 'Telegram bot', role: 'admin' }) {
  const normalizedActor = cleanActor(actor)
  const discovered = []

  for (const candidate of candidates ?? []) {
    for (const field of customTaxonomyFields) {
      for (const value of canonicalTalentList(candidate[field])) {
        if (isCustomTaxonomyValue(field, value)) {
          discovered.push({ field, value })
        }
      }
    }
  }

  const unique = Array.from(
    new Map(discovered.map((item) => [`${item.field}:${normalizeText(item.value)}`, item])).values(),
  )

  if (!unique.length) return []

  if (hasPostgres()) {
    const stored = []
    for (const item of unique) {
      const result = await query(
        `
          INSERT INTO custom_taxonomy_values (
            id, field, value, normalized_value, status, created_by, updated_by
          )
          VALUES ($1, $2, $3, $4, 'pending', $5, $5)
          ON CONFLICT (field, normalized_value) DO UPDATE SET
            updated_at = custom_taxonomy_values.updated_at
          RETURNING *
        `,
        [`CTV-${randomUUID()}`, item.field, item.value, normalizeText(item.value), normalizedActor.id],
      )
      stored.push(customValueRow(result.rows[0]))
    }
    return stored
  }

  const state = await readLocalState()
  const now = new Date().toISOString()
  for (const item of unique) {
    if (state.customValues.some(
      (stored) => stored.field === item.field && normalizeText(stored.value) === normalizeText(item.value),
    )) continue
    state.customValues.push({
      createdAt: now,
      createdBy: normalizedActor.id,
      field: item.field,
      id: `CTV-${randomUUID()}`,
      mergedIntoValue: null,
      status: 'pending',
      updatedAt: now,
      updatedBy: normalizedActor.id,
      value: item.value,
    })
  }
  await writeLocalState(state)
  return state.customValues
}

export async function listCustomTaxonomyValues({ includeRemoved = true } = {}) {
  if (hasPostgres()) {
    const result = await query(
      `
        SELECT *
        FROM custom_taxonomy_values
        ${includeRemoved ? '' : "WHERE status <> 'removed'"}
        ORDER BY field, lower(value), id
        LIMIT 501
      `,
    )
    return result.rows.map(customValueRow)
  }

  return (await readLocalState()).customValues
    .filter((item) => includeRemoved || item.status !== 'removed')
    .sort((left, right) => left.field.localeCompare(right.field) || left.value.localeCompare(right.value))
}

export async function listApprovedCustomValues(field) {
  const values = await listCustomTaxonomyValues({ includeRemoved: false })
  return values.filter((item) => item.status === 'approved' && (!field || item.field === field))
}

async function replaceValueAcrossCandidates(field, fromValue, toValue) {
  const normalizedFrom = normalizeText(fromValue)
  let affectedCount = 0

  for (const candidate of await listCandidates()) {
    const current = canonicalTalentList(candidate[field])
    if (!current.some((value) => normalizeText(value) === normalizedFrom)) continue

    const next = canonicalTalentList(
      current.flatMap((value) => {
        if (normalizeText(value) !== normalizedFrom) return [value]
        return toValue ? [toValue] : []
      }),
    )
    await updateCandidateMetadata(candidate.id, { [field]: next })
    affectedCount += 1
  }

  return affectedCount
}

export async function moderateCustomTaxonomyValue(customValueId, action, options, actor) {
  const normalizedActor = cleanActor(actor)
  const values = await listCustomTaxonomyValues()
  const existing = values.find((item) => item.id === customValueId)
  if (!existing) return undefined

  if (!['approve', 'rename', 'merge', 'remove'].includes(action)) {
    const error = new Error('Unknown custom value moderation action')
    error.statusCode = 400
    throw error
  }

  let value = existing.value
  let status = existing.status
  let mergedIntoValue = existing.mergedIntoValue ?? null
  let affectedCount = 0

  if (action === 'approve') {
    status = 'approved'
  }

  if (action === 'rename') {
    value = cleanText(options?.value, 'Custom value', 120)
    const conflict = values.find(
      (item) => (
        item.id !== existing.id
        && item.field === existing.field
        && normalizeText(item.value) === normalizeText(value)
        && item.status !== 'removed'
      ),
    )
    if (conflict) {
      const error = new Error('This custom value already exists; merge into it instead')
      error.statusCode = 409
      throw error
    }
    affectedCount = await replaceValueAcrossCandidates(existing.field, existing.value, value)
    status = options?.approve === false ? 'pending' : 'approved'
    mergedIntoValue = null
  }

  if (action === 'merge') {
    mergedIntoValue = canonicalTalentValue(cleanText(options?.targetValue, 'Merge target', 120))
    const validOfficialTarget = officialCodesForField(existing.field).has(mergedIntoValue)
    const validApprovedCustomTarget = values.some(
      (item) => (
        item.id !== existing.id
        && item.field === existing.field
        && item.status === 'approved'
        && normalizeText(item.value) === normalizeText(mergedIntoValue)
      ),
    )
    if (!validOfficialTarget && !validApprovedCustomTarget) {
      const error = new Error('Merge target must be an official or approved value in the same category')
      error.statusCode = 400
      throw error
    }
    affectedCount = await replaceValueAcrossCandidates(existing.field, existing.value, mergedIntoValue)
    status = 'merged'
  }

  if (action === 'remove') {
    affectedCount = await replaceValueAcrossCandidates(existing.field, existing.value, null)
    status = 'removed'
    mergedIntoValue = null
  }

  if (hasPostgres()) {
    const result = await query(
      `
        UPDATE custom_taxonomy_values
        SET
          value = $2,
          normalized_value = $3,
          status = $4,
          merged_into_value = $5,
          updated_by = $6,
          updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        customValueId,
        value,
        normalizeText(value),
        status,
        mergedIntoValue,
        normalizedActor.id,
      ],
    )
    return { ...customValueRow(result.rows[0]), affectedCount }
  }

  const state = await readLocalState()
  const stored = state.customValues.find((item) => item.id === customValueId)
  Object.assign(stored, {
    mergedIntoValue,
    status,
    updatedAt: new Date().toISOString(),
    updatedBy: normalizedActor.id,
    value,
  })
  await writeLocalState(state)
  return { ...stored, affectedCount }
}

export async function enrichCandidatesForAdmin(candidates, actor, providedLabels) {
  const labels = providedLabels ?? await listProfileLabels()
  let assignments
  let comments
  const candidateIds = candidates.map((candidate) => String(candidate.id)).filter(Boolean)

  if (hasPostgres()) {
    if (!candidateIds.length) return []
    const [assignmentResult, commentResult] = await Promise.all([
      query(
        `
          SELECT candidate_id, label_id, assigned_by, assigned_at
          FROM candidate_profile_labels
          WHERE candidate_id = ANY($1::text[])
        `,
        [candidateIds],
      ),
      query(
        `
          SELECT *
          FROM candidate_comments
          WHERE candidate_id = ANY($1::text[])
          ORDER BY created_at ASC, id ASC
        `,
        [candidateIds],
      ),
    ])
    assignments = assignmentResult.rows.map((row) => ({
      assignedAt: row.assigned_at?.toISOString?.() ?? row.assigned_at,
      assignedBy: row.assigned_by,
      candidateId: row.candidate_id,
      labelId: row.label_id,
    }))
    comments = commentResult.rows.map((row) => commentRow(row, actor))
  } else {
    const state = await readLocalState()
    assignments = state.assignments
    comments = state.comments.map((comment) => ({
      ...comment,
      canManage: canManageComment(comment, actor),
    }))
  }

  const labelById = new Map(labels.map((label) => [label.id, label]))
  const assignmentsByCandidate = new Map()
  const commentsByCandidate = new Map()
  for (const assignment of assignments) {
    const values = assignmentsByCandidate.get(assignment.candidateId) ?? []
    values.push(assignment)
    assignmentsByCandidate.set(assignment.candidateId, values)
  }
  for (const comment of comments) {
    const values = commentsByCandidate.get(comment.candidateId) ?? []
    values.push(comment)
    commentsByCandidate.set(comment.candidateId, values)
  }
  return candidates.map((candidate) => ({
    ...candidate,
    adminComments: commentsByCandidate.get(candidate.id) ?? [],
    adminLabels: (assignmentsByCandidate.get(candidate.id) ?? [])
      .map((assignment) => labelById.get(assignment.labelId))
      .filter(Boolean),
  }))
}

export function isSuperAdminSession(actor) {
  return isSuperAdmin(actor)
}
