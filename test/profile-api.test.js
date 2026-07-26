import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'

const repositoryRoot = resolve(import.meta.dirname, '..')

function waitForServer(processHandle) {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10000)
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

test('authenticated profile APIs preserve status and expose labels/comments only to admins', async () => {
  const workingDirectory = await mkdtemp(resolve(tmpdir(), 'face-profile-api-'))
  const port = 21000 + Math.floor(Math.random() * 1000)
  const baseUrl = `http://127.0.0.1:${port}`
  await mkdir(resolve(workingDirectory, 'var'), { recursive: true })
  await writeFile(
    resolve(workingDirectory, 'var/candidate-intakes.json'),
    JSON.stringify([
      {
        age: 25,
        appearance: [],
        city: 'Tashkent',
        createdAt: '2026-01-01T00:00:00.000Z',
        gender: 'Male',
        height: 180,
        id: 'candidate-api-test',
        languageSkills: ['english'],
        name: 'Original Name',
        performanceTalents: [],
        phone: '+998900000000',
        physicalSkills: [],
        sportsTalents: [],
        status: 'pending_review',
        telegramUserId: '12345',
        updatedAt: '2026-01-01T00:00:00.000Z',
        weight: 75,
      },
    ]),
    'utf8',
  )

  const serverProcess = spawn(process.execPath, [resolve(repositoryRoot, 'server/index.js')], {
    cwd: workingDirectory,
    env: {
      ...process.env,
      ADMIN_WEB_TOKEN: 'profile-api-token',
      PORT: String(port),
      PROFILE_MANAGEMENT_PATH: resolve(workingDirectory, 'var/profile-management.json'),
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
        'x-face-admin-token': 'profile-api-token',
      },
      method: 'POST',
    })
    assert.equal(loginResponse.status, 200)
    const cookie = loginResponse.headers.get('set-cookie').split(';')[0]

    async function request(path, body) {
      const response = await fetch(`${baseUrl}${path}`, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          cookie,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        method: body === undefined ? 'GET' : 'POST',
      })
      const data = await response.json()
      assert.ok(response.ok, `${response.status}: ${JSON.stringify(data)}`)
      return data
    }

    const profileResult = await request('/api/candidates/candidate-api-test/profile', {
      id: 'forbidden-id',
      name: 'Edited Name',
      status: 'approved',
      telegramUserId: 'forbidden-telegram-id',
    })
    assert.equal(profileResult.candidate.id, 'candidate-api-test')
    assert.equal(profileResult.candidate.name, 'Edited Name')
    assert.equal(profileResult.candidate.status, 'pending_review')
    assert.equal(profileResult.candidate.telegramUserId, '12345')

    await request('/api/candidates/candidate-api-test/labels', {
      action: 'add',
      name: 'Needs better photos',
    })
    await request('/api/candidates/candidate-api-test/comments', {
      body: 'Ask for a new portrait.',
    })

    const management = await request('/api/candidates')
    assert.equal(management.admin.role, 'superadmin')
    assert.equal(management.candidates[0].adminLabels[0].name, 'Needs better photos')
    assert.equal(management.candidates[0].adminComments[0].body, 'Ask for a new portrait.')

    const audit = await request('/api/audit')
    const profileAudit = audit.events.find((event) => event.action === 'web_admin.profile_updated')
    assert.equal(profileAudit.actorRole, 'superadmin')
    assert.equal(profileAudit.changes.name.before, 'Original Name')
    assert.equal(profileAudit.changes.name.after, 'Edited Name')
  } finally {
    serverProcess.kill('SIGTERM')
    await new Promise((resolveExit) => serverProcess.once('exit', resolveExit))
    await rm(workingDirectory, { force: true, recursive: true })
  }
})
