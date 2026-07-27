import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { performance } from 'node:perf_hooks'

const RAILWAY_ORIGIN = 'https://face-production-staging.up.railway.app'
const REQUEST_HEADERS_TO_SKIP = new Set([
  'connection',
  'content-length',
  'host',
  'transfer-encoding',
])
const RESPONSE_HEADERS_TO_SKIP = new Set([
  'connection',
  'content-encoding',
  'set-cookie',
  'transfer-encoding',
])

function getUpstreamPath(request) {
  const rawPath = Array.isArray(request.query?.path)
    ? request.query.path.join('/')
    : request.query?.path
  const path = String(rawPath ?? '').replace(/^\/+/, '')
  const url = new URL(`/api/${path}`, RAILWAY_ORIGIN)

  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (key === 'path') continue

    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) url.searchParams.append(key, String(item))
    }
  }

  return url
}

function getUpstreamBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  if (Buffer.isBuffer(request.body) || typeof request.body === 'string') return request.body
  if (request.body === undefined || request.body === null) return undefined
  return JSON.stringify(request.body)
}

function getUpstreamHeaders(request) {
  const headers = new Headers()

  for (const [key, value] of Object.entries(request.headers ?? {})) {
    if (REQUEST_HEADERS_TO_SKIP.has(key.toLowerCase()) || value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : String(value))
  }

  headers.set('accept-encoding', 'identity')
  return headers
}

function copyResponseHeaders(upstream, response) {
  for (const [key, value] of upstream.headers.entries()) {
    if (RESPONSE_HEADERS_TO_SKIP.has(key.toLowerCase())) continue
    response.setHeader(key, value)
  }

  const cookies = upstream.headers.getSetCookie?.() ?? []
  if (cookies.length) {
    response.setHeader('set-cookie', cookies)
  } else {
    const cookie = upstream.headers.get('set-cookie')
    if (cookie) response.setHeader('set-cookie', cookie)
  }
}

function safeRouteName(method, pathname) {
  const route = pathname
    .replace(
      /^\/api\/candidates\/(?!query(?:\/|$)|export\.csv(?:\/|$))[^/]+/,
      '/api/candidates/:candidateId',
    )
    .replace(/^\/api\/castings\/[^/]+/, '/api/castings/:castingId')
  return `${method} ${route}`
}

export default async function handler(request, response) {
  const startedAt = performance.now()
  const upstreamPath = getUpstreamPath(request)
  const upstreamBody = getUpstreamBody(request)
  const upstreamHeaders = getUpstreamHeaders(request)
  const route = safeRouteName(request.method, upstreamPath.pathname)

  console.info(JSON.stringify({
    hasAdminHeader: upstreamHeaders.has('x-face-admin-token'),
    hasBody: upstreamBody !== undefined,
    level: 'info',
    message: 'proxy_request_started',
    method: request.method,
    requestId: request.headers['x-vercel-id'] ?? null,
    route,
  }))

  const upstream = await fetch(upstreamPath, {
    body: upstreamBody,
    headers: upstreamHeaders,
    method: request.method,
    redirect: 'manual',
  })

  const proxyDuration = performance.now() - startedAt
  console.info(JSON.stringify({
    level: 'info',
    message: 'proxy_request_completed',
    method: request.method,
    ms: Number(proxyDuration.toFixed(2)),
    route,
    status: upstream.status,
  }))

  response.statusCode = upstream.status
  copyResponseHeaders(upstream, response)
  const upstreamTiming = upstream.headers.get('server-timing')
  response.setHeader(
    'server-timing',
    [upstreamTiming, `proxy;dur=${proxyDuration.toFixed(2)}`].filter(Boolean).join(', '),
  )

  if (!upstream.body || request.method === 'HEAD') {
    response.end()
    return
  }

  await pipeline(Readable.fromWeb(upstream.body), response)
}
