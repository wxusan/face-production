import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatCastingMessage } from '../server/castingMessages.js'

const casting = {
  body: 'Actors <25 & dancers>\nBring a portrait.',
  endsAt: '2026-07-30T22:00:00.000Z',
  startsAt: '2026-07-28T00:36:00.000Z',
  title: 'Commercial <Summer & Sun>',
}

test('casting cards use safe Telegram HTML with clear visual hierarchy', () => {
  const message = formatCastingMessage(casting, 'en')

  assert.match(message, /^🎬 <b>Commercial &lt;Summer &amp; Sun&gt;<\/b>/)
  assert.match(message, /📋 <b>Details:<\/b>/)
  assert.match(message, /Actors &lt;25 &amp; dancers&gt;/)
  assert.match(message, /📅 <b>Starts:<\/b>/)
  assert.match(message, /🏁 <b>Ends:<\/b>/)
  assert.doesNotMatch(message, /<Summer/)
})

test('casting labels follow each candidate interface language', () => {
  const uzbek = formatCastingMessage(casting, { language: 'uz' })
  const russian = formatCastingMessage(casting, { language: 'ru' })

  assert.match(uzbek, /📋 <b>Tafsilotlar:<\/b>/)
  assert.match(uzbek, /📅 <b>Boshlanish:<\/b>/)
  assert.match(uzbek, /🏁 <b>Tugash:<\/b>/)
  assert.match(russian, /📋 <b>Детали:<\/b>/)
  assert.match(russian, /📅 <b>Начало:<\/b>/)
  assert.match(russian, /🏁 <b>Завершение:<\/b>/)
})

test('casting cards omit empty schedule rows cleanly', () => {
  const message = formatCastingMessage({
    body: 'Open call',
    title: 'Actors',
  }, 'uz')

  assert.equal(message, '🎬 <b>Actors</b>\n\n📋 <b>Tafsilotlar:</b>\nOpen call')
})
