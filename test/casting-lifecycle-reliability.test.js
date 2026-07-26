import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

const testRoot = await mkdtemp(join(tmpdir(), 'face-casting-lifecycle-'))
process.env.AUDIT_LOG_PATH = join(testRoot, 'audit.jsonl')
process.env.CANDIDATE_STORAGE_PATH = join(testRoot, 'candidates.json')
process.env.CASTING_MANAGEMENT_PATH = join(testRoot, 'management.json')
process.env.CASTING_STORAGE_PATH = join(testRoot, 'castings.json')
delete process.env.DATABASE_URL

const { upsertCandidateIntake } = await import('../server/candidateRepository.js')
const {
  createCasting,
  listActiveCastingsForCandidate,
} = await import('../server/castingRepository.js')
const { manageCasting } = await import('../server/castingManagementService.js')
const {
  findCastingParticipation,
} = await import('../server/castingParticipationRepository.js')
const {
  getCastingParticipationContext,
  setCastingApplicationStatus,
} = await import('../server/castingParticipationService.js')
const {
  applyCastingAndProfileDecision,
} = await import('../server/castingDecisionService.js')

function completeCandidate(id, overrides = {}) {
  return {
    age: 24,
    appearance: ['central_asian'],
    city: 'Tashkent',
    closeShotPhotoFileId: `close-${id}`,
    consent: 'candidate_confirmed',
    fullBodyPhotoFileId: `full-${id}`,
    gender: 'Female',
    height: '170',
    id,
    introVideoFileId: `video-${id}`,
    languageSkills: ['uzbek'],
    leftProfilePhotoFileId: `left-${id}`,
    name: `Candidate ${id}`,
    performanceTalents: ['acting'],
    phone: '+998901234567',
    physicalSkills: ['dance'],
    portraitPhotoFileId: `portrait-${id}`,
    rightProfilePhotoFileId: `right-${id}`,
    sportsTalents: ['running'],
    status: 'pending_review',
    submissionMode: 'self',
    telegramChatId: id,
    telegramUserId: id,
    weight: '60',
    ...overrides,
  }
}

after(async () => {
  await rm(testRoot, { force: true, recursive: true })
})

test('end instant is closed and empty taxonomy selections are incomplete', async () => {
  const exactNow = new Date('2026-07-27T10:00:00.000Z')
  const casting = await createCasting({
    body: 'Boundary test',
    endsAt: exactNow.toISOString(),
    id: 'CAST-boundary',
    publicToken: 'boundary',
    startsAt: '2026-07-26T09:00:00.000Z',
    status: 'active',
    title: 'Boundary',
  })
  const complete = await upsertCandidateIntake(completeCandidate('boundary-complete'))
  const emptyTaxonomy = await upsertCandidateIntake(completeCandidate('boundary-empty', {
    performanceTalents: [],
  }))

  assert.equal((await getCastingParticipationContext({
    now: exactNow,
    publicToken: casting.publicToken,
    telegramUserId: complete.telegramUserId,
  })).outcome, 'closed')

  const open = await createCasting({
    body: 'Completeness test',
    endsAt: '2026-07-28T10:00:00.000Z',
    id: 'CAST-completeness',
    publicToken: 'completeness',
    startsAt: '2026-07-26T09:00:00.000Z',
    status: 'active',
    title: 'Completeness',
  })
  const context = await getCastingParticipationContext({
    now: exactNow,
    publicToken: open.publicToken,
    telegramUserId: emptyTaxonomy.telegramUserId,
  })
  assert.equal(context.outcome, 'profile_incomplete')
  assert.ok(context.missingFields.includes('performanceTalents'))
  assert.ok(
    (await listActiveCastingsForCandidate(complete)).some((item) => item.id === open.id),
  )
})

test('a closed casting cannot be republished', async () => {
  const casting = await createCasting({
    body: 'Terminal lifecycle',
    id: 'CAST-terminal',
    publicToken: 'terminal',
    status: 'active',
    title: 'Terminal',
  })
  await manageCasting(casting.id, 'close', { operationId: 'close-terminal' }, 'admin')
  await assert.rejects(
    manageCasting(casting.id, 'publish', { operationId: 'reopen-terminal' }, 'admin'),
    /cannot transition/,
  )
})

test('failed combined profile approval leaves the previous casting application unchanged', async () => {
  const casting = await createCasting({
    body: 'Compensation test',
    id: 'CAST-compensation',
    publicToken: 'compensation',
    status: 'active',
    title: 'Compensation',
  })
  const incomplete = await upsertCandidateIntake(completeCandidate('compensation-candidate', {
    portraitPhotoFileId: '',
  }))
  await setCastingApplicationStatus({
    candidate: incomplete,
    castingId: casting.id,
    source: 'self_apply',
    status: 'applied',
  })

  await assert.rejects(
    applyCastingAndProfileDecision({
      actor: 'admin',
      candidateId: incomplete.id,
      castingDecision: 'accept',
      castingId: casting.id,
      profileDecision: 'approve',
    }),
    /Incomplete profile/,
  )
  assert.equal(
    (await findCastingParticipation(casting.id, incomplete.id)).status,
    'applied',
  )
})
