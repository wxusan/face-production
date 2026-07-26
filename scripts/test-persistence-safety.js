import assert from 'node:assert/strict'
import {
  hasRequiredCandidateConsent,
  isCandidateEligibleForMessaging,
} from '../server/candidateRepository.js'
import {
  MAX_TELEGRAM_FILE_BYTES,
  isWithinTelegramFileLimit,
} from '../server/photoStorage.js'

const adult = {
  age: 22,
  consent: 'candidate_confirmed',
  status: 'approved',
  telegramChatId: 123,
}

assert.equal(hasRequiredCandidateConsent(adult), true)
assert.equal(isCandidateEligibleForMessaging(adult), true)
assert.equal(hasRequiredCandidateConsent({ ...adult, consent: 'missing' }), false)
assert.equal(isCandidateEligibleForMessaging({ ...adult, consent: 'missing' }), false)

const minor = {
  age: 16,
  consent: 'guardian_confirmed',
  guardianConsent: 'yes',
  status: 'approved',
  telegramChatId: 456,
}

assert.equal(hasRequiredCandidateConsent(minor), true)
assert.equal(isCandidateEligibleForMessaging(minor), true)
assert.equal(hasRequiredCandidateConsent({ ...minor, guardianConsent: 'missing' }), false)
assert.equal(hasRequiredCandidateConsent({ ...adult, submissionMode: 'friend' }), false)

assert.equal(isWithinTelegramFileLimit(MAX_TELEGRAM_FILE_BYTES), true)
assert.equal(isWithinTelegramFileLimit(MAX_TELEGRAM_FILE_BYTES + 1), false)
assert.equal(isWithinTelegramFileLimit(undefined), true)

console.log('Persistence and media safety checks passed.')
