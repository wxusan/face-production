const DEFAULT_TIMEOUT_MS = 25000
const readOnlyMethods = new Set(['getFile', 'getMe', 'getWebhookInfo'])

function telegramError(message, {
  code,
  deliveryUncertain = false,
  retryAfter,
  statusCode = 502,
} = {}) {
  const error = new Error(message)
  error.code = code
  error.deliveryUncertain = deliveryUncertain
  error.retryAfter = retryAfter
  error.statusCode = statusCode
  return error
}

export async function callTelegramApi(apiBase, method, {
  body,
  headers,
  payload,
  timeoutMs = Number(process.env.TELEGRAM_API_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
} = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const isSideEffect = !readOnlyMethods.has(method)
  let response

  try {
    response = await fetch(`${apiBase}/${method}`, {
      body: body ?? JSON.stringify(payload ?? {}),
      headers: headers ?? (body ? undefined : { 'content-type': 'application/json' }),
      method: 'POST',
      signal: controller.signal,
    })
  } catch (cause) {
    throw telegramError(
      cause?.name === 'AbortError'
        ? `Telegram API timed out: ${method}`
        : `Telegram API network failure: ${method}`,
      {
        code: cause?.name === 'AbortError' ? 'telegram_timeout' : 'telegram_network_error',
        deliveryUncertain: isSideEffect,
        statusCode: 502,
      },
    )
  } finally {
    clearTimeout(timeout)
  }

  let data
  try {
    data = await response.json()
  } catch {
    throw telegramError(`Telegram API returned an invalid response: ${method}`, {
      code: 'telegram_invalid_response',
      deliveryUncertain: isSideEffect && response.status >= 500,
      statusCode: response.status || 502,
    })
  }

  if (!response.ok || !data.ok) {
    const retryAfter = Number(data?.parameters?.retry_after)
    throw telegramError(data?.description ?? `Telegram API request failed: ${method}`, {
      code: `telegram_${data?.error_code ?? response.status ?? 'api_error'}`,
      deliveryUncertain: isSideEffect && response.status >= 500,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
      statusCode: response.status || 502,
    })
  }

  return data.result
}
