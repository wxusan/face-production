import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadLocalEnv } from '../server/env.js'
import { hasPostgres } from '../server/postgres.js'
import { upsertCandidateIntake } from '../server/candidateRepository.js'
import { recordAuditEvent } from '../server/auditLog.js'

loadLocalEnv()

if (!hasPostgres()) {
  throw new Error('DATABASE_URL is required before running this migration')
}

const candidatePath = resolve(process.cwd(), 'var/candidate-intakes.json')
const candidates = JSON.parse(await readFile(candidatePath, 'utf8'))

for (const candidate of candidates) {
  await upsertCandidateIntake(candidate)
}

await recordAuditEvent({
  action: 'migration.json_to_postgres',
  actor: 'migration_script',
  count: candidates.length,
  outcome: 'completed',
})

console.log(`Migrated ${candidates.length} candidates to PostgreSQL.`)
