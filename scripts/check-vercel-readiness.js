import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import handler from '../vercel/handler.js'

async function call(url, headers = {}) {
  const chunks = []
  const response = {
    headers: {},
    statusCode: 200,
    end(body) {
      chunks.push(body || '')
    },
    setHeader(key, value) {
      this.headers[key] = value
    },
    writeHead(statusCode, headersToSet = {}) {
      this.statusCode = statusCode
      Object.assign(this.headers, headersToSet)
    },
  }

  await handler({ headers, method: 'GET', url }, response)

  return {
    body: chunks.join(''),
    contentType: response.headers['content-type'],
    statusCode: response.statusCode,
    url,
  }
}

function assertOk(check, message) {
  if (!check) {
    throw new Error(message)
  }
}

const distAssets = await readdir(join(process.cwd(), 'dist', 'assets'))
const cssAsset = distAssets.find((file) => file.endsWith('.css'))
const jsAsset = distAssets.find((file) => file.endsWith('.js'))

assertOk(cssAsset, 'Missing generated CSS asset in dist/assets')
assertOk(jsAsset, 'Missing generated JS asset in dist/assets')

const checks = [
  await call('/api'),
  await call('/api/health'),
  await call(`/api/assets/${cssAsset}`),
  await call(`/api/assets/${jsAsset}`),
  await call('/api/favicon.svg'),
]

for (const check of checks) {
  assertOk(check.statusCode === 200, `${check.url} returned ${check.statusCode}`)
  assertOk(check.body.length > 0, `${check.url} returned an empty body`)
}

const health = JSON.parse(checks[1].body)

console.log(JSON.stringify({
  checks: checks.map((check) => ({
    bytes: check.body.length,
    contentType: check.contentType,
    statusCode: check.statusCode,
    url: check.url,
  })),
  health,
  ok: true,
}, null, 2))
