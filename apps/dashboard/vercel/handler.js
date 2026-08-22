import { routeRequest } from '../server/index.js'

function normalizeUrl(request) {
  const originalUrl = request.url ?? '/'
  const [pathname, query = ''] = originalUrl.split('?')
  const params = new URLSearchParams(query)
  const rewrittenPath = params.get('__path')
  let nextPathname = pathname
  let nextQuery = query

  if (rewrittenPath) {
    nextPathname = rewrittenPath
    params.delete('__path')
    nextQuery = params.toString()
  }

  if (!rewrittenPath && (pathname === '/api' || pathname === '/api/')) {
    nextPathname = '/'
  } else if (
    nextPathname.startsWith('/api/assets/')
    || nextPathname === '/api/favicon.svg'
    || nextPathname === '/api/icons.svg'
    || nextPathname.startsWith('/api/candidate-profile/')
  ) {
    nextPathname = nextPathname.replace(/^\/api/, '')
  }

  request.url = nextQuery ? `${nextPathname}?${nextQuery}` : nextPathname
}

export default async function handler(request, response) {
  try {
    normalizeUrl(request)
    await routeRequest(request, response)
  } catch (error) {
    const statusCode = error.statusCode ?? 500
    response.statusCode = statusCode
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ error: error.message ?? 'Server error' }))
  }
}
