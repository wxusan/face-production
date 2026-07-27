import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

const repositoryRoot = resolve(import.meta.dirname, '..')
const source = await readFile(resolve(repositoryRoot, 'server/index.js'), 'utf8')

function candidate(index) {
  const createdAt = new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString()
  return {
    age: 18 + (index % 40),
    appearance: ['central_asian'],
    city: index % 2 ? 'Tashkent' : 'Samarkand',
    consent: 'candidate_confirmed',
    createdAt,
    gender: index % 2 ? 'Female' : 'Male',
    height: 160 + (index % 35),
    id: `PRIVATE-CANDIDATE-${index}`,
    languageSkills: ['english'],
    name: `Performance Candidate ${index}`,
    performanceTalents: ['acting'],
    phone: `+99890${String(index).padStart(7, '0')}`,
    physicalSkills: ['dance'],
    rating: index === 249 ? 5 : index === 248 ? 4 : 0,
    source: 'telegram',
    sportsTalents: ['running'],
    status: index < 130 ? 'pending_review' : 'approved',
    telegramUserId: String(800_000 + index),
    updatedAt: createdAt,
    weight: 50 + (index % 40),
  }
}

function casting(index) {
  return {
    body: `Casting body ${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
    id: `CAST-PERF-${index}`,
    source: 'web_admin',
    status: 'draft',
    targetCandidateIds: [],
    title: `Casting ${index}`,
    updatedAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
  }
}

function waitForServer(processHandle, output) {
  return new Promise((resolveReady, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timed out')), 10_000)
    processHandle.stdout.on('data', (chunk) => {
      output.push(chunk.toString('utf8'))
      if (output.join('').includes('FACE Platform API listening')) {
        clearTimeout(timeout)
        resolveReady()
      }
    })
    processHandle.stderr.on('data', (chunk) => output.push(chunk.toString('utf8')))
    processHandle.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Server exited before startup with code ${code}: ${output.join('')}`))
    })
  })
}

async function stopServer(processHandle) {
  if (processHandle.exitCode !== null) return
  const exited = new Promise((resolveExit) => processHandle.once('exit', resolveExit))
  processHandle.kill('SIGTERM')
  await exited
}

test('performance contract keeps critical reads bounded, private, observable, and resilient', async () => {
  const workingDirectory = await mkdtemp(resolve(tmpdir(), 'face-performance-contract-'))
  const varDirectory = resolve(workingDirectory, 'var')
  const port = 25_000 + Math.floor(Math.random() * 1_000)
  const baseUrl = `http://127.0.0.1:${port}`
  const output = []
  const candidates = Array.from({ length: 250 }, (_, index) => candidate(index))
  const castings = Array.from({ length: 75 }, (_, index) => casting(index))
  await mkdir(varDirectory, { recursive: true })
  await writeFile(resolve(varDirectory, 'candidate-intakes.json'), JSON.stringify(candidates), 'utf8')
  await writeFile(resolve(varDirectory, 'castings.json'), JSON.stringify(castings), 'utf8')
  await writeFile(
    resolve(varDirectory, 'profile-management.json'),
    JSON.stringify({
      assignments: [{
        assignedAt: '2026-01-01T00:00:00.000Z',
        assignedBy: 'super_admin',
        candidateId: 'PRIVATE-CANDIDATE-207',
        labelId: 'LBL-FAST',
      }],
      comments: [],
      customValues: [],
      labels: [{
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'super_admin',
        id: 'LBL-FAST',
        name: 'Fast shortlist',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    }),
    'utf8',
  )

  const serverProcess = spawn(process.execPath, [resolve(repositoryRoot, 'server/index.js')], {
    cwd: workingDirectory,
    env: {
      ...process.env,
      ADMIN_WEB_TOKEN: 'performance-contract-token',
      CANDIDATE_STORAGE_PATH: resolve(varDirectory, 'candidate-intakes.json'),
      CASTING_MANAGEMENT_PATH: resolve(varDirectory, 'casting-management.json'),
      CASTING_STORAGE_PATH: resolve(varDirectory, 'castings.json'),
      DATABASE_URL: '',
      INCLUDE_SEED_CANDIDATES: 'false',
      PORT: String(port),
      PROFILE_MANAGEMENT_PATH: resolve(varDirectory, 'profile-management.json'),
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_DISABLED: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForServer(serverProcess, output)

    const shell = await fetch(baseUrl)
    const shellText = await shell.text()
    assert.equal(shell.status, 200)
    assert.ok(Buffer.byteLength(shellText) < 150_000, 'admin shell should stay below 150 KB')
    assert.doesNotMatch(shellText, /data:image\/jpeg;base64/)
    assert.match(shell.headers.get('cache-control'), /s-maxage=300/)
    assert.match(shell.headers.get('server-timing'), /app;dur=/)

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      body: '{}',
      headers: {
        'content-type': 'application/json',
        'x-face-admin-token': 'performance-contract-token',
      },
      method: 'POST',
    })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie').split(';')[0]

    const candidateResponse = await fetch(`${baseUrl}/api/candidates`, {
      headers: { cookie },
    })
    const candidatePayload = await candidateResponse.json()
    assert.equal(candidateResponse.status, 200)
    assert.equal(candidatePayload.candidates.length, 100)
    assert.equal(candidatePayload.pageInfo.limit, 100)
    assert.equal(candidatePayload.pageInfo.hasMore, true)
    assert.equal(candidatePayload.candidates[0].id, 'PRIVATE-CANDIDATE-249')
    assert.ok(
      Buffer.byteLength(JSON.stringify(candidatePayload)) < 500_000,
      'bounded candidate response should stay below 500 KB for this fixture',
    )
    assert.match(candidateResponse.headers.get('server-timing'), /candidate_query;dur=/)
    assert.match(candidateResponse.headers.get('server-timing'), /profile_enrichment;dur=/)
    assert.match(candidateResponse.headers.get('server-timing'), /serialize;dur=/)

    const privateSearch = 'PRIVATE-CANDIDATE-207'
    const searchResponse = await fetch(`${baseUrl}/api/candidates/query`, {
      body: JSON.stringify({
        filters: { labels: ['LBL-FAST'], q: privateSearch },
        limit: 100,
        offset: 0,
        scope: 'candidates',
      }),
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      method: 'POST',
    })
    const searchPayload = await searchResponse.json()
    assert.equal(searchResponse.status, 200)
    assert.deepEqual(searchPayload.candidates.map((item) => item.id), [privateSearch])
    assert.equal(searchPayload.candidates[0].adminLabels[0].id, 'LBL-FAST')

    const scopeResponse = await fetch(`${baseUrl}/api/candidates/query`, {
      body: JSON.stringify({
        filters: { status: ['rejected'] },
        limit: 100,
        offset: 0,
        scope: 'candidates',
      }),
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      method: 'POST',
    })
    const scopePayload = await scopeResponse.json()
    assert.equal(scopeResponse.status, 200)
    assert.deepEqual(scopePayload.candidates, [])

    const castingResponse = await fetch(`${baseUrl}/api/castings?limit=50&offset=0`, {
      headers: { cookie },
    })
    const castingPayload = await castingResponse.json()
    assert.equal(castingPayload.castings.length, 50)
    assert.equal(castingPayload.pageInfo.hasMore, true)
    assert.equal(castingPayload.pageInfo.nextOffset, 50)

    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
    const logs = output.join('')
    assert.doesNotMatch(logs, /PRIVATE-CANDIDATE-207/)
    assert.match(logs, /"route":"POST \/api\/candidates\/query"/)
  } finally {
    await stopServer(serverProcess)
    await rm(workingDirectory, { force: true, recursive: true })
  }
})

test('admin UI contract retains data, aborts stale searches, and blocks duplicate actions', () => {
  assert.match(source, /new AbortController\(\)/)
  assert.match(source, /method: 'POST'/)
  assert.match(source, /'\/api\/candidates\/query'/)
  assert.match(source, /aria-busy/)
  assert.match(source, /function runMutation/)
  assert.match(source, /mutationInFlight\.has\(key\)/)
  assert.match(source, /button\.disabled = true/)
  assert.match(source, /scheduleCandidateQuery\(300\)/)
  assert.match(source, /setInterval\(function \(\)/)
  assert.match(source, /\}, 30000\)/)
  assert.doesNotMatch(source, /\}, 5000\)/)
})

test('mutation feedback is immediate and a rapid second submit is ignored', async () => {
  const start = source.indexOf('async function runMutation')
  const end = source.indexOf('async function decide', start)
  const context = {
    mutationInFlight: new Set(),
  }
  vm.runInNewContext(
    `${source.slice(start, end)}\nglobalThis.runMutation = runMutation`,
    context,
  )

  const attributes = new Map()
  const button = {
    disabled: false,
    isConnected: true,
    setAttribute(name, value) {
      attributes.set(name, value)
    },
    removeAttribute(name) {
      attributes.delete(name)
    },
    textContent: 'Send',
  }
  let release
  let taskCalls = 0
  const pendingTask = () => {
    taskCalls += 1
    return new Promise((resolveTask) => {
      release = resolveTask
    })
  }

  const startedAt = performance.now()
  const first = context.runMutation('send:test', button, 'Sending…', pendingTask)
  const feedbackMs = performance.now() - startedAt
  const second = context.runMutation('send:test', button, 'Sending…', pendingTask)

  assert.ok(feedbackMs < 100, `pending feedback took ${feedbackMs.toFixed(2)} ms`)
  assert.equal(button.disabled, true)
  assert.equal(button.textContent, 'Sending…')
  assert.equal(attributes.get('aria-busy'), 'true')
  assert.equal(taskCalls, 1)

  release()
  await Promise.all([first, second])
  assert.equal(button.disabled, false)
  assert.equal(button.textContent, 'Send')
  assert.equal(attributes.has('aria-busy'), false)
})
