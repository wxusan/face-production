const productionDeliveryUrl = new URL(
  '../../server/telegramDeliveryRepository.js',
  import.meta.url,
).href
const memoryDeliveryUrl = new URL(
  './telegram-delivery-memory.js',
  import.meta.url,
).href

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context)
  if (resolved.url === productionDeliveryUrl) {
    return {
      shortCircuit: true,
      url: memoryDeliveryUrl,
    }
  }
  return resolved
}
