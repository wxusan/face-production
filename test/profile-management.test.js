import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { after, test } from 'node:test'

const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'face-profile-management-'))
process.env.PROFILE_MANAGEMENT_PATH = resolve(temporaryDirectory, 'profile-management.json')
process.env.CANDIDATE_STORAGE_PATH = resolve(temporaryDirectory, 'candidates.json')
await writeFile(
  process.env.CANDIDATE_STORAGE_PATH,
  JSON.stringify([
    {
      id: 'candidate-custom',
      performanceTalents: ['acting', 'Breakdance', 'Improvisation'],
      status: 'pending_review',
    },
  ]),
  'utf8',
)

const {
  assignCandidateLabel,
  createCandidateComment,
  createProfileLabel,
  enrichCandidatesForAdmin,
  listApprovedCustomValues,
  listCustomTaxonomyValues,
  moderateCustomTaxonomyValue,
  profileChanges,
  registerCandidateCustomValues,
  sanitizeCandidateProfilePatch,
  updateCandidateComment,
} = await import('../server/profileManagementRepository.js')
const { findCandidate } = await import('../server/candidateRepository.js')

after(async () => {
  await rm(temporaryDirectory, { force: true, recursive: true })
})

test('profile edits accept only editable fields and preserve status by construction', () => {
  const patch = sanitizeCandidateProfilePatch({
    age: 24,
    city: 'Tashkent',
    id: 'changed-id',
    performanceTalents: ['Acting', 'Breakdance'],
    status: 'approved',
    telegramUserId: 'changed-telegram-id',
  })

  assert.deepEqual(patch, {
    age: 24,
    city: 'Tashkent',
    performanceTalents: ['acting', 'Breakdance'],
  })
  assert.deepEqual(profileChanges(
    { age: 23, city: 'Tashkent', performanceTalents: ['acting'], status: 'pending_review' },
    patch,
  ), {
    age: { after: 24, before: 23 },
    performanceTalents: { after: ['acting', 'Breakdance'], before: ['acting'] },
  })
})

test('labels are reusable and enrich both pending and approved profiles', async () => {
  const actor = { id: 'admin-1', name: 'Admin One', role: 'admin' }
  const first = await createProfileLabel({ name: 'VIP' }, actor)
  const duplicate = await createProfileLabel({ name: ' vip ' }, actor)
  assert.equal(duplicate.id, first.id)

  await assignCandidateLabel('candidate-pending', first.id, actor)
  await assignCandidateLabel('candidate-approved', first.id, actor)
  const enriched = await enrichCandidatesForAdmin([
    { id: 'candidate-pending', status: 'pending_review' },
    { id: 'candidate-approved', status: 'approved' },
  ], actor)

  assert.deepEqual(enriched.map((candidate) => candidate.adminLabels.map((label) => label.name)), [
    ['VIP'],
    ['VIP'],
  ])
})

test('admins manage their own comments while a super admin manages every comment', async () => {
  const owner = { id: 'admin-owner', name: 'Owner', role: 'admin' }
  const other = { id: 'admin-other', name: 'Other', role: 'admin' }
  const superAdmin = { id: 'super', name: 'Super Admin', role: 'superadmin' }
  const comment = await createCandidateComment('candidate-pending', 'Needs better photos', owner)

  await assert.rejects(
    updateCandidateComment(comment.id, 'Changed by another admin', other),
    (error) => error.statusCode === 403,
  )

  const updated = await updateCandidateComment(comment.id, 'Changed by super admin', superAdmin)
  assert.equal(updated.body, 'Changed by super admin')
  assert.equal(updated.authorId, owner.id)
})

test('candidate Other values enter moderation and approved values become reusable', async () => {
  await registerCandidateCustomValues([
    {
      id: 'candidate-custom',
      performanceTalents: ['Acting', 'Breakdance', 'Improvisation'],
    },
  ])

  const stored = await listCustomTaxonomyValues()
  assert.equal(stored.length, 2)
  const breakdance = stored.find((item) => item.value === 'Breakdance')
  const improvisation = stored.find((item) => item.value === 'Improvisation')
  assert.equal(breakdance.field, 'performanceTalents')
  assert.equal(breakdance.status, 'pending')

  await moderateCustomTaxonomyValue(
    breakdance.id,
    'approve',
    {},
    { id: 'super', name: 'Super Admin', role: 'superadmin' },
  )
  assert.deepEqual(
    (await listApprovedCustomValues('performanceTalents')).map((item) => item.value),
    ['Breakdance'],
  )

  process.env.TELEGRAM_BOT_TOKEN = 'test-token'
  const { __botTesting } = await import('../server/bot.js')
  const keyboard = await __botTesting.multiKeyboard(
    { data: { performanceTalents: [] }, lang: 'en' },
    'performance',
  )
  const buttons = keyboard.reply_markup.inline_keyboard.flat()
  const reusableButton = buttons.find((button) => button.text.includes('Breakdance'))
  assert.ok(reusableButton)
  assert.ok(reusableButton.callback_data.length <= 64)

  await moderateCustomTaxonomyValue(
    breakdance.id,
    'rename',
    { value: 'Breaking' },
    { id: 'super', name: 'Super Admin', role: 'superadmin' },
  )
  assert.deepEqual((await findCandidate('candidate-custom')).performanceTalents, [
    'acting',
    'Breaking',
    'Improvisation',
  ])

  await moderateCustomTaxonomyValue(
    breakdance.id,
    'merge',
    { targetValue: 'dancing' },
    { id: 'super', name: 'Super Admin', role: 'superadmin' },
  )
  await moderateCustomTaxonomyValue(
    improvisation.id,
    'remove',
    {},
    { id: 'super', name: 'Super Admin', role: 'superadmin' },
  )
  assert.deepEqual((await findCandidate('candidate-custom')).performanceTalents, ['acting', 'dancing'])
})
