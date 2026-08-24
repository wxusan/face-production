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

const checks = [
  await call('/api'),
  await call('/api/health'),
  await call('/api/favicon.svg'),
  await call('/api/icons.svg'),
]

for (const check of checks) {
  assertOk(check.statusCode === 200, `${check.url} returned ${check.statusCode}`)
  assertOk(check.body.length > 0, `${check.url} returned an empty body`)
}

const health = JSON.parse(checks[1].body)
assertOk(checks[0].body.includes('FACE Production'), 'Admin portal HTML is missing its product title')
assertOk(checks[2].contentType === 'image/svg+xml', 'Favicon did not return SVG content')
assertOk(checks[3].contentType === 'image/svg+xml', 'Icon sprite did not return SVG content')

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
