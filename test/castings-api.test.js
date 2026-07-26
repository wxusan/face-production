import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'

const repositoryRoot = resolve(import.meta.dirname, '..')
const now = '2026-07-27T09:00:00.000Z'

function candidate(id, status, telegramUserId) {
  return {
    age: 25,
    appearance: ['central_asian'],
    city: 'Tashkent',
    closeShotPhotoFileId: `close-${id}`,
    consent: 'candidate_confirmed',
    createdAt: now,
    fullBodyPhotoFileId: `full-${id}`,
    gender: 'Female',
    height: '170',
    id,
    introVideoFileId: `video-${id}`,
    language: 'en',
    languageSkills: ['english'],
    leftProfilePhotoFileId: `left-${id}`,
    name: `Candidate ${id}`,
    performanceTalents: ['acting'],
    phone: `+99890${String(telegramUserId).slice(-7)}`,
    physicalSkills: ['dance'],
    portraitPhotoFileId: `portrait-${id}`,
    rightProfilePhotoFileId: `right-${id}`,
    source: 'telegram',
    sportsTalents: ['running'],
    status,
    submissionMode: 'self',
    telegramChatId: String(telegramUserId),
    telegramUserId: String(telegramUserId),
    updatedAt: now,
    weight: '60',
  }
}

const candidates = [
  candidate('candidate-separate', 'pending_review', 951001),
  candidate('candidate-combined', 'pending_review', 951002),
  candidate('candidate-reject', 'pending_review', 951003),
  candidate('candidate-message', 'pending_review', 951004),
  candidate('candidate-invite', 'approved', 951005),
  candidate('candidate-publish', 'approved', 951006),
]

function waitForServer(processHandle) {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10_000)
    let output = ''

    processHandle.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8')
      if (output.includes('FACE Platform API listening')) {
        clearTimeout(timeout)
        resolveReady()
      }
    })
    processHandle.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8')
    })
    processHandle.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Server exited before startup with code ${code}: ${output}`))
    })
  })
}

async function stopServer(serverProcess) {
  if (serverProcess.exitCode !== null) return
  const exited = new Promise((resolveExit) => serverProcess.once('exit', resolveExit))
  serverProcess.kill('SIGTERM')
  await exited
}

async function withCastingServer(run) {
  const workingDirectory = await mkdtemp(resolve(tmpdir(), 'face-castings-api-'))
  const varDirectory = resolve(workingDirectory, 'var')
  const paths = {
    audit: resolve(varDirectory, 'audit.jsonl'),
    candidates: resolve(varDirectory, 'candidate-intakes.json'),
    channel: resolve(varDirectory, 'casting-channel.json'),
    management: resolve(varDirectory, 'casting-management.json'),
    outbox: resolve(varDirectory, 'casting-outbox.json'),
    profileManagement: resolve(varDirectory, 'profile-management.json'),
    castings: resolve(varDirectory, 'castings.json'),
  }
  const port = 22000 + Math.floor(Math.random() * 1000)
  const baseUrl = `http://127.0.0.1:${port}`
  await mkdir(varDirectory, { recursive: true })
  await writeFile(paths.candidates, `${JSON.stringify(candidates, null, 2)}\n`, 'utf8')

  const serverProcess = spawn(process.execPath, [resolve(repositoryRoot, 'server/index.js')], {
    cwd: workingDirectory,
    env: {
      ...process.env,
      ADMIN_WEB_TOKEN: 'castings-api-token',
      AUDIT_LOG_PATH: paths.audit,
      CANDIDATE_STORAGE_PATH: paths.candidates,
      CASTING_CHANNEL_CONFIG_PATH: paths.channel,
      CASTING_MANAGEMENT_PATH: paths.management,
      CASTING_OUTBOX_PATH: paths.outbox,
      CASTING_STORAGE_PATH: paths.castings,
      DATABASE_URL: '',
      INCLUDE_SEED_CANDIDATES: 'false',
      PORT: String(port),
      PROFILE_MANAGEMENT_PATH: paths.profileManagement,
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_DISABLED: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForServer(serverProcess)
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      body: '{}',
      headers: {
        'content-type': 'application/json',
        'x-face-admin-token': 'castings-api-token',
      },
      method: 'POST',
    })
    assert.equal(loginResponse.status, 200)
    const cookie = loginResponse.headers.get('set-cookie').split(';')[0]

    async function request(path, {
      authenticated = true,
      body,
      expectedStatus = 200,
      method = body === undefined ? 'GET' : 'POST',
    } = {}) {
      const response = await fetch(`${baseUrl}${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          ...(authenticated ? { cookie } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        method,
      })
      const data = await response.json()
      assert.equal(
        response.status,
        expectedStatus,
        `${method} ${path}: ${response.status}: ${JSON.stringify(data)}`,
      )
      return data
    }

    await run({ baseUrl, paths, request })
  } finally {
    await stopServer(serverProcess)
    await rm(workingDirectory, { force: true, recursive: true })
  }
}

async function createDraft(request, operationId, overrides = {}) {
  const response = await request('/api/castings', {
    body: {
      body: 'API casting details',
      candidateIds: ['candidate-publish'],
      endsAt: '2027-08-01T12:00:00.000Z',
      operationId,
      sendNow: false,
      startsAt: '2026-07-01T12:00:00.000Z',
      status: 'draft',
      title: `API Casting ${operationId}`,
      ...overrides,
    },
  })
  assert.equal(response.ok, true)
  assert.equal(response.casting.status, 'draft')
  return response.casting
}

function appliedParticipation(castingId, candidateId, index) {
  const profile = candidates.find((item) => item.id === candidateId)
  return {
    applicationMessage: `Application ${index}`,
    candidateId,
    castingId,
    createdAt: `2026-07-27T09:0${index}:00.000Z`,
    createdBy: `telegram:${profile.telegramUserId}`,
    history: [{
      actor: `telegram:${profile.telegramUserId}`,
      at: `2026-07-27T09:0${index}:00.000Z`,
      fromStatus: null,
      source: 'self_apply',
      toStatus: 'applied',
    }],
    id: `CP-api-${index}`,
    profileSnapshot: structuredClone(profile),
    respondedAt: `2026-07-27T09:0${index}:00.000Z`,
    source: 'self_apply',
    status: 'applied',
    updatedAt: `2026-07-27T09:0${index}:00.000Z`,
    updatedBy: `telegram:${profile.telegramUserId}`,
  }
}

async function seedApplications(path, castingId, candidateIds) {
  await writeFile(path, `${JSON.stringify({
    channel: {},
    outbox: [],
    participations: candidateIds.map(
      (candidateId, index) => appliedParticipation(castingId, candidateId, index + 1),
    ),
  }, null, 2)}\n`, 'utf8')
}

test('casting APIs reject unauthenticated access and support draft, publish, list, and workspace reads', async () => {
  await withCastingServer(async ({ request }) => {
    const unauthorizedList = await request('/api/castings', {
      authenticated: false,
      expectedStatus: 403,
    })
    assert.match(unauthorizedList.error, /authorization/i)

    const unauthorizedMutation = await request('/api/castings', {
      authenticated: false,
      body: {
        body: 'Forbidden',
        operationId: 'forbidden-create',
        sendNow: false,
        title: 'Forbidden',
      },
      expectedStatus: 403,
    })
    assert.match(unauthorizedMutation.error, /authorization/i)

    const casting = await createDraft(request, 'draft-publish')
    const initialWorkspace = await request(`/api/castings/${casting.id}/workspace`)
    assert.equal(initialWorkspace.casting.id, casting.id)
    assert.deepEqual(initialWorkspace.applications, [])
    assert.deepEqual(initialWorkspace.candidates, [])
    assert.deepEqual(initialWorkspace.invitations, [])
    assert.deepEqual(initialWorkspace.casting.counts, {
      applications: 0,
      awaiting: 0,
      byStatus: {},
      candidates: 0,
      invitations: 0,
      total: 0,
    })

    const publication = await request(`/api/castings/${casting.id}/manage`, {
      body: {
        action: 'publish',
        audiences: ['channel', 'eligible_bot_users'],
        operationId: 'publish-api',
      },
    })
    assert.equal(publication.casting.status, 'active')
    assert.equal(publication.delivery.queuedCount, 1)
    assert.equal(publication.delivery.queued[0].eventType, 'casting.publication')
    assert.deepEqual(publication.delivery.skipped, [
      { audience: 'channel', reason: 'channel_unconfigured' },
    ])

    const list = await request('/api/castings')
    const listed = list.castings.find((item) => item.id === casting.id)
    assert.equal(listed.status, 'active')
    assert.equal(listed.counts.total, 0)
  })
})

test('casting invitations prevent duplicates and cancellation moves the invitation out of awaiting', async () => {
  await withCastingServer(async ({ request }) => {
    const casting = await createDraft(request, 'invitation-flow')
    await request(`/api/castings/${casting.id}/manage`, {
      body: {
        action: 'publish',
        audiences: [],
        operationId: 'publish-invitation-flow',
      },
    })

    const first = await request(`/api/castings/${casting.id}/invitations`, {
      body: {
        candidateIds: ['candidate-invite', 'candidate-invite'],
        operationId: 'invite-first',
      },
    })
    assert.equal(first.invited.length, 1)
    assert.equal(first.queuedCount, 1)
    assert.deepEqual(first.skipped, [])

    const duplicate = await request(`/api/castings/${casting.id}/invitations`, {
      body: {
        candidateIds: ['candidate-invite'],
        operationId: 'invite-second-distinct-operation',
      },
    })
    assert.equal(duplicate.invited.length, 0)
    assert.equal(duplicate.queuedCount, 0)
    assert.deepEqual(duplicate.skipped, [{
      candidateId: 'candidate-invite',
      reason: 'already_participating',
    }])

    let workspace = await request(`/api/castings/${casting.id}/workspace`)
    assert.equal(workspace.invitations.length, 1)
    assert.equal(workspace.casting.counts.awaiting, 1)
    assert.equal(workspace.casting.counts.invitations, 1)

    const outbox = await request('/api/castings/outbox')
    const invitationEvents = outbox.events.filter(
      (event) => event.castingId === casting.id && event.eventType === 'casting.invitation',
    )
    assert.equal(invitationEvents.length, 1)

    const cancelled = await request(
      `/api/castings/${casting.id}/invitations/candidate-invite/cancel`,
      { body: {} },
    )
    assert.equal(cancelled.participation.status, 'cancelled')

    workspace = await request(`/api/castings/${casting.id}/workspace`)
    assert.equal(workspace.invitations.length, 0)
    assert.equal(workspace.casting.counts.awaiting, 0)
    assert.equal(workspace.casting.counts.byStatus.cancelled, 1)
  })
})

test('casting decisions support separate and combined profile decisions and move list counts', async () => {
  await withCastingServer(async ({ paths, request }) => {
    const casting = await createDraft(request, 'decision-flow')
    await seedApplications(paths.management, casting.id, [
      'candidate-separate',
      'candidate-combined',
      'candidate-reject',
      'candidate-message',
    ])

    let workspace = await request(`/api/castings/${casting.id}/workspace`)
    assert.equal(workspace.applications.length, 4)
    assert.equal(workspace.candidates.length, 0)
    assert.equal(workspace.casting.counts.applications, 4)

    const separate = await request(`/api/castings/${casting.id}/decisions`, {
      body: {
        candidateId: 'candidate-separate',
        castingDecision: 'accept',
        operationId: 'decision-separate',
        profileDecision: 'unchanged',
      },
    })
    assert.equal(separate.participation.status, 'selected')
    assert.equal(separate.candidate.status, 'pending_review')

    const combined = await request(`/api/castings/${casting.id}/decisions`, {
      body: {
        candidateId: 'candidate-combined',
        castingDecision: 'accept',
        operationId: 'decision-combined',
        profileDecision: 'approve',
      },
    })
    assert.equal(combined.participation.status, 'selected')
    assert.equal(combined.candidate.status, 'approved')

    const rejected = await request(`/api/castings/${casting.id}/decisions`, {
      body: {
        candidateId: 'candidate-reject',
        castingDecision: 'reject',
        operationId: 'decision-reject',
        profileDecision: 'reject',
      },
    })
    assert.equal(rejected.participation.status, 'rejected')
    assert.equal(rejected.candidate.status, 'rejected')

    workspace = await request(`/api/castings/${casting.id}/workspace`)
    assert.deepEqual(
      workspace.applications.map((item) => item.id),
      ['candidate-message'],
    )
    assert.deepEqual(
      workspace.candidates.map((item) => item.id).sort(),
      ['candidate-combined', 'candidate-separate'],
    )
    assert.equal(workspace.casting.counts.applications, 1)
    assert.equal(workspace.casting.counts.candidates, 2)
    assert.equal(workspace.casting.counts.byStatus.rejected, 1)

    const list = await request('/api/castings')
    const listed = list.castings.find((item) => item.id === casting.id)
    assert.equal(listed.counts.applications, 1)
    assert.equal(listed.counts.candidates, 2)
  })
})

test('casting messages to a pending application retain routing context in the queued notification', async () => {
  await withCastingServer(async ({ paths, request }) => {
    const casting = await createDraft(request, 'context-message')
    await seedApplications(paths.management, casting.id, ['candidate-message'])

    const response = await request(`/api/castings/${casting.id}/messages`, {
      body: {
        audience: 'applications',
        candidateIds: ['candidate-message'],
        operationId: 'context-message-pending',
        text: 'Please upload a clearer portrait.',
      },
    })
    assert.equal(response.queuedCount, 1)
    assert.equal(response.queued[0].eventType, 'casting.context_message')
    assert.equal(response.queued[0].payload.candidateId, 'candidate-message')
    assert.equal(response.queued[0].payload.castingId, casting.id)

    const queuedText = response.queued[0].payload.text
    assert.match(queuedText, /Please upload a clearer portrait\./)
    assert.equal(response.queued[0].recipientKey, 'candidate-message')
  })
})

test('casting management supports close and cancel as distinct terminal actions', async () => {
  await withCastingServer(async ({ request }) => {
    const closing = await createDraft(request, 'closing-flow')
    await request(`/api/castings/${closing.id}/manage`, {
      body: {
        action: 'publish',
        audiences: [],
        operationId: 'publish-closing-flow',
      },
    })
    const closed = await request(`/api/castings/${closing.id}/manage`, {
      body: {
        action: 'close',
        operationId: 'close-flow',
      },
    })
    assert.equal(closed.casting.status, 'closed')
    assert.ok(closed.casting.closedAt)
    const repeatedClose = await request(`/api/castings/${closing.id}/manage`, {
      body: {
        action: 'close',
        operationId: 'close-flow-repeated',
      },
    })
    assert.equal(repeatedClose.casting.status, 'closed')
    assert.equal(repeatedClose.casting.version, closed.casting.version)
    assert.equal(repeatedClose.casting.closedAt, closed.casting.closedAt)

    const cancelling = await createDraft(request, 'cancelling-flow')
    const cancelled = await request(`/api/castings/${cancelling.id}/manage`, {
      body: {
        action: 'cancel',
        operationId: 'cancel-flow',
      },
    })
    assert.equal(cancelled.casting.status, 'cancelled')
    assert.ok(cancelled.casting.cancelledAt)
    const repeatedCancel = await request(`/api/castings/${cancelling.id}/manage`, {
      body: {
        action: 'cancel',
        operationId: 'cancel-flow-repeated',
      },
    })
    assert.equal(repeatedCancel.casting.status, 'cancelled')
    assert.equal(repeatedCancel.casting.version, cancelled.casting.version)
    assert.equal(repeatedCancel.casting.cancelledAt, cancelled.casting.cancelledAt)

    const list = await request('/api/castings')
    assert.equal(
      list.castings.find((item) => item.id === closing.id).status,
      'closed',
    )
    assert.equal(
      list.castings.find((item) => item.id === cancelling.id).status,
      'cancelled',
    )
  })
})
