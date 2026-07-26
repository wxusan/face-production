import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  candidateMessagingChatId,
  isCandidateEligibleForMessaging,
  isCandidateReachableForDirectMessage,
} from '../server/candidateRepository.js'

test('a pending candidate with a Telegram chat can receive a direct admin message', () => {
  const candidate = {
    age: 24,
    consent: 'candidate_confirmed',
    status: 'pending_review',
    telegramChatId: '123456',
  }

  assert.equal(isCandidateReachableForDirectMessage(candidate), true)
  assert.equal(isCandidateEligibleForMessaging(candidate), false)
})

test('a rejected candidate can still receive a direct correction message', () => {
  const candidate = {
    age: 24,
    consent: 'candidate_confirmed',
    status: 'rejected',
    telegramUserId: '123456',
  }

  assert.equal(isCandidateReachableForDirectMessage(candidate), true)
  assert.equal(isCandidateEligibleForMessaging(candidate), false)
})

test('a friend-profile submitter is the direct-message recipient while consent is pending', () => {
  const candidate = {
    age: 24,
    consent: 'proxy_submitter_confirmed_pending_candidate_consent',
    status: 'pending_review',
    submissionMode: 'friend',
    submittedByTelegramChatId: '654321',
  }

  assert.equal(candidateMessagingChatId(candidate), '654321')
  assert.equal(isCandidateReachableForDirectMessage(candidate), true)
  assert.equal(isCandidateEligibleForMessaging(candidate), false)
})

test('a candidate without any Telegram destination cannot receive a direct message', () => {
  const candidate = {
    age: 24,
    consent: 'candidate_confirmed',
    status: 'pending_review',
  }

  assert.equal(isCandidateReachableForDirectMessage(candidate), false)
  assert.equal(isCandidateEligibleForMessaging(candidate), false)
})

test('bulk messaging remains limited to approved and consent-verified candidates', () => {
  const candidate = {
    age: 24,
    consent: 'candidate_confirmed',
    status: 'approved',
    telegramChatId: '123456',
  }

  assert.equal(isCandidateReachableForDirectMessage(candidate), true)
  assert.equal(isCandidateEligibleForMessaging(candidate), true)
})
