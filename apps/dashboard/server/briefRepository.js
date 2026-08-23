import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { hasPostgres, query } from './postgres.js'

const briefPath = resolve(process.cwd(), 'var/briefs.json')

async function readJsonBriefs() {
  try {
    return JSON.parse(await readFile(briefPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

async function writeJsonBriefs(briefs) {
  await mkdir(dirname(briefPath), { recursive: true })
  await writeFile(briefPath, `${JSON.stringify(briefs, null, 2)}\n`, 'utf8')
}

function rowToBrief(row) {
  return {
    ...(row.data ?? {}),
    id: row.id,
    status: row.status,
    locale: row.locale,
    clientName: row.client_name,
    company: row.company ?? '',
    phone: row.data?.phone ?? row.data?.phoneOrTelegram ?? row.contact,
    telegram: row.data?.telegram ?? '',
    projectType: row.project_type,
    shootingDate: row.shooting_date ?? '',
    location: row.location ?? '',
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    updatedAt: row.updated_at?.toISOString?.() ?? row.updated_at,
  }
}

async function readPostgresBriefs() {
  const result = await query('SELECT * FROM briefs ORDER BY created_at DESC, id DESC')
  return result.rows.map(rowToBrief)
}

async function readStoredBriefs() {
  return hasPostgres() ? readPostgresBriefs() : readJsonBriefs()
}

function createBriefId(briefs) {
  const next = briefs.reduce((max, item) => {
    const match = String(item.id ?? '').match(/^BRIEF-(\d+)$/)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0) + 1
  return `BRIEF-${String(next).padStart(4, '0')}`
}

async function insertPostgresBrief(brief) {
  await query(
    `INSERT INTO briefs (
      id, status, locale, client_name, company, contact, project_type,
      shooting_date, location, data, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)`,
    [
      brief.id,
      brief.status,
      brief.locale,
      brief.clientName,
      brief.company || null,
      brief.phone,
      brief.projectType,
      brief.shootingDate || null,
      brief.location || null,
      JSON.stringify(brief),
      brief.createdAt,
      brief.updatedAt,
    ],
  )
}

async function updatePostgresBrief(brief) {
  await query(
    `UPDATE briefs SET status=$2, data=$3::jsonb, updated_at=$4 WHERE id=$1`,
    [brief.id, brief.status, JSON.stringify(brief), brief.updatedAt],
  )
}

export async function listBriefs() {
  return readStoredBriefs()
}

export async function findBrief(id) {
  return (await readStoredBriefs()).find((brief) => brief.id === id)
}

export async function createBrief(input) {
  const briefs = await readStoredBriefs()
  const now = new Date().toISOString()
  const brief = {
    ...input,
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    createdAt: now,
    id: createBriefId(briefs),
    locale: ['ru', 'en', 'uz'].includes(input.locale) ? input.locale : 'ru',
    status: 'new',
    updatedAt: now,
  }

  if (hasPostgres()) {
    await insertPostgresBrief(brief)
  } else {
    briefs.unshift(brief)
    await writeJsonBriefs(briefs)
  }
  return brief
}

export async function updateBrief(id, changes, actor) {
  const briefs = await readStoredBriefs()
  const index = briefs.findIndex((brief) => brief.id === id)
  if (index === -1) return undefined

  const allowedStatuses = ['new', 'contacted', 'qualified', 'closed']
  const brief = {
    ...briefs[index],
    status: allowedStatuses.includes(changes.status) ? changes.status : briefs[index].status,
    internalNotes: typeof changes.internalNotes === 'string' ? changes.internalNotes : briefs[index].internalNotes,
    assignedTo: typeof changes.assignedTo === 'string' ? changes.assignedTo : briefs[index].assignedTo,
    updatedAt: new Date().toISOString(),
    updatedBy: actor?.id,
  }

  if (hasPostgres()) {
    await updatePostgresBrief(brief)
  } else {
    briefs[index] = brief
    await writeJsonBriefs(briefs)
  }
  return brief
}

export async function setBriefAttachments(id, attachments) {
  const briefs = await readStoredBriefs()
  const index = briefs.findIndex((brief) => brief.id === id)
  if (index === -1) return undefined
  const brief = {
    ...briefs[index],
    attachments,
    updatedAt: new Date().toISOString(),
  }
  if (hasPostgres()) {
    await updatePostgresBrief(brief)
  } else {
    briefs[index] = brief
    await writeJsonBriefs(briefs)
  }
  return brief
}
