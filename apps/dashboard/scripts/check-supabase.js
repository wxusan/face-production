import { randomUUID } from 'node:crypto'
import { loadLocalEnv } from '../server/env.js'
import { ensurePostgresSchema, hasPostgres, rawQuery } from '../server/postgres.js'
import {
  deleteObject,
  getObject,
  objectStorageConfigured,
  putObject,
} from '../server/objectStorage.js'

loadLocalEnv()

const checks = []

function addCheck(name, ok, detail) {
  checks.push({ detail, name, ok })
}

if (!hasPostgres()) {
  addCheck('DATABASE_URL', false, 'Missing')
} else {
  try {
    await ensurePostgresSchema()
    const result = await rawQuery('SELECT count(*)::int AS count FROM candidates')
    addCheck('Supabase Postgres', true, `${result.rows[0].count} candidates`)
  } catch (error) {
    addCheck('Supabase Postgres', false, error.message)
  }
}

if (!objectStorageConfigured()) {
  addCheck('Supabase Storage S3', false, 'Missing object storage variables')
} else {
  const key = `healthchecks/${randomUUID()}.txt`
  const content = Buffer.from(`FACE Production storage check ${new Date().toISOString()}`)

  try {
    const reference = await putObject({
      body: content,
      contentType: 'text/plain',
      key,
    })
    const stored = await getObject(reference)
    await deleteObject(reference)
    addCheck('Supabase Storage S3', stored.equals(content), reference)
  } catch (error) {
    addCheck('Supabase Storage S3', false, error.message)
  }
}

console.log(JSON.stringify({ checks }, null, 2))

if (checks.some((check) => !check.ok)) {
  process.exitCode = 1
}
