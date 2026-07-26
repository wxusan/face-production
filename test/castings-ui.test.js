import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../server/index.js', import.meta.url), 'utf8')
const postsSection = source.slice(
  source.indexOf('function renderPostsPage()'),
  source.indexOf('function castingStatusValue'),
)

test('admin navigation has a dedicated localized Castings page', () => {
  assert.match(source, /data-page="castings"/)
  assert.match(source, /castingsPage: 'Кастинги'/)
  assert.match(source, /castingsPage: 'Kastinglar'/)
  assert.match(source, /castingsPage: 'Castings'/)
})

test('Posts remains a general broadcast page without casting creation', () => {
  assert.match(postsSection, /id="bulkText"/)
  assert.doesNotMatch(postsSection, /id="castingTitle"/)
  assert.doesNotMatch(postsSection, /id="sendCasting"/)
})

test('casting workspace exposes lifecycle, tabs, invitations, decisions and messaging', () => {
  for (const marker of [
    'data-casting-manage="publish"',
    'data-casting-manage="close"',
    'data-casting-manage="cancel"',
    "['applications', 'applicationsTab']",
    "['candidates', 'castingCandidatesTab']",
    "['invitations', 'invitationsTab']",
    'data-invitation-view="invite"',
    'data-invitation-view="awaiting"',
    'data-casting-decision="accept"',
    'data-casting-decision="reject"',
    'data-profile-only="approve"',
    'data-profile-only="reject"',
    'id="castingProfileDecision"',
    'id="messageCastingSelected"',
    'id="sendCastingSingle"',
    'data-casting-participant-remove',
    'data-casting-invitation-cancel',
  ]) {
    assert.ok(source.includes(marker), `missing UI marker: ${marker}`)
  }
})

test('casting UI uses the documented detail API contracts', () => {
  assert.ok(source.includes("'/api/castings/' + encodeURIComponent(castingId) + '/workspace'"))
  assert.ok(source.includes("'/invitations'"))
  assert.ok(source.includes("'/decisions'"))
  assert.ok(source.includes("'/messages'"))
  assert.ok(source.includes("'/manage'"))
  assert.ok(source.includes("'/participants/'"))
  assert.ok(source.includes("'/cancel'"))
  assert.match(source, /appliedBadge/)
  assert.match(source, /invitedBadge/)
})

test('casting publication reports queued and skipped delivery outcomes', () => {
  assert.match(source, /function castingDeliveryNotice/)
  assert.match(source, /delivery\.queuedCount/)
  assert.match(source, /delivery\.skipped/)
  assert.match(source, /channel_unconfigured/)
  assert.match(source, /channelUnconfigured/)
  assert.match(source, /language: lang/)
  assert.match(source, /payload\.language = lang/)
})

test('terminal castings render without edit or lifecycle action buttons', () => {
  const detailSection = source.slice(
    source.indexOf('function renderCastingDetail()'),
    source.indexOf('function renderCastingsPage()'),
  )
  assert.match(detailSection, /\['closed', 'cancelled', 'archived'\]\.includes\(casting\.status\)/)
  assert.match(detailSection, /var lifecycleActions = terminal \? ''/)
  assert.match(detailSection, /<div class="actions">' \+ lifecycleActions/)
})

test('generated admin browser script is valid JavaScript', async () => {
  process.env.TELEGRAM_DISABLED = 'true'
  const { candidateAdminHtml } = await import('../server/index.js')
  const html = candidateAdminHtml()
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  assert.ok(scripts.length > 0)
  assert.doesNotThrow(() => new vm.Script(scripts.at(-1)[1]))
})
