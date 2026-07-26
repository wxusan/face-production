const deliveries = new Map()
let completionFailures = 0

function keyFor(operationId, recipientKey) {
  return `${operationId}\u0000${recipientKey}`
}

export async function claimTelegramDelivery({
  chatId,
  data = {},
  kind,
  operationId,
  recipientKey,
}) {
  const key = keyFor(operationId, recipientKey)
  const existing = deliveries.get(key)
  if (existing && existing.status !== 'failed') {
    return {
      ...existing,
      claimed: false,
      operationId,
      recipientKey,
    }
  }

  const claim = {
    attemptCount: Number(existing?.attemptCount ?? 0) + 1,
    chatId: String(chatId),
    claimed: true,
    data: structuredClone(data),
    kind,
    operationId,
    recipientKey,
    status: 'sending',
  }
  deliveries.set(key, claim)
  return claim
}

export async function completeTelegramDelivery(claim, messageId) {
  if (completionFailures > 0) {
    completionFailures -= 1
    throw new Error('Simulated post-send ledger failure')
  }
  deliveries.set(keyFor(claim.operationId, claim.recipientKey), {
    ...claim,
    claimed: false,
    messageId: String(messageId),
    status: 'sent',
  })
}

export async function failTelegramDelivery(claim, error) {
  deliveries.set(keyFor(claim.operationId, claim.recipientKey), {
    ...claim,
    claimed: false,
    errorCode: error?.code ?? error?.name ?? 'delivery_error',
    status: error?.deliveryUncertain ? 'uncertain' : 'failed',
  })
}

export function resetMemoryTelegramDeliveries() {
  deliveries.clear()
  completionFailures = 0
}

export function failNextMemoryTelegramCompletions(count = 1) {
  completionFailures = Math.max(0, Number(count) || 0)
}

export function memoryTelegramDeliveries() {
  return [...deliveries.values()].map((delivery) => structuredClone(delivery))
}
