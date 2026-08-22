import { loadLocalEnv } from '../server/env.js'
import { listCandidateIntakes, upsertCandidateIntake } from '../server/candidateRepository.js'
import { recordAuditEvent } from '../server/auditLog.js'
import { normalizeCandidateTaxonomy } from '../server/taxonomy.js'

loadLocalEnv()

const candidates = await listCandidateIntakes()

for (const candidate of candidates) {
  const normalized = normalizeCandidateTaxonomy(candidate)
  await upsertCandidateIntake(normalized)
}

await recordAuditEvent({
  action: 'migration.normalize_candidate_taxonomy',
  actor: 'migration_script',
  candidateCount: candidates.length,
  normalizedCount: candidates.length,
  outcome: 'completed',
})

console.log(`Normalized taxonomy for ${candidates.length}/${candidates.length} candidates.`)
