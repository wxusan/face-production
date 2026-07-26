import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  candidateDecisionMessage,
  candidateInterfaceLanguage,
} from '../server/candidateDecisionMessages.js'

test('approval and rejection follow the candidate interface language', () => {
  assert.equal(
    candidateDecisionMessage({ language: 'uz' }, 'approved'),
    'FACE Production profilingiz ichki talentlar bazasi uchun tasdiqlandi.',
  )
  assert.equal(
    candidateDecisionMessage({ language: 'en' }, 'rejected'),
    'Your FACE Production registration was reviewed and not approved at this stage.',
  )
  assert.equal(
    candidateDecisionMessage({ language: 'ru' }, 'approved'),
    'Ваш профиль FACE Production одобрен для внутренней базы талантов.',
  )
})

test('friend-profile decisions use localized proxy wording', () => {
  assert.equal(
    candidateDecisionMessage({ language: 'uz', submissionMode: 'friend' }, 'approved'),
    'Do‘stingiz uchun yuborgan anketa FACE Production ichki talentlar bazasi uchun tasdiqlandi.',
  )
  assert.equal(
    candidateDecisionMessage({ language: 'en', submissionMode: 'friend' }, 'rejected'),
    'The profile you submitted for your friend was reviewed and not approved at this stage.',
  )
})

test('unknown or missing languages safely fall back to Russian', () => {
  assert.equal(candidateInterfaceLanguage({ language: 'de' }), 'ru')
  assert.equal(
    candidateDecisionMessage({}, 'approved'),
    'Ваш профиль FACE Production одобрен для внутренней базы талантов.',
  )
})

test('unsupported decision states are rejected', () => {
  assert.throws(
    () => candidateDecisionMessage({ language: 'uz' }, 'pending_review'),
    /approved or rejected/,
  )
})
