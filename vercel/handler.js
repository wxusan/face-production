import { routeRequest } from '../server/index.js'

function normalizeUrl(request) {
  const originalUrl = request.url ?? '/'
  const [pathname, query = ''] = originalUrl.split('?')
  let nextPathname = pathname

  if (pathname === '/api' || pathname === '/api/') {
    nextPathname = '/'
  } else if (
    pathname.startsWith('/api/assets/')
    || pathname === '/api/favicon.svg'
    || pathname === '/api/icons.svg'
    || pathname.startsWith('/api/candidate-profile/')
  ) {
    nextPathname = pathname.replace(/^\/api/, '')
  }

  request.url = query ? `${nextPathname}?${query}` : nextPathname
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
