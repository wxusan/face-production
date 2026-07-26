import {
  candidateMessagingChatId,
  findCandidate,
  isCandidateReachableForDirectMessage,
} from './candidateRepository.js'
import {
  candidateDecisionMessage,
  candidateInterfaceLanguage,
} from './candidateDecisionMessages.js'
import {
  castingPublicToken,
  findCasting,
  updateCasting,
} from './castingRepository.js'
import { getCastingChannelConfig } from './castingChannelRepository.js'
import { escapeTelegramHtml, formatCastingMessage } from './castingMessages.js'
import {
  listReadyCastingOutboxEvents,
  markCastingOutboxEvent,
} from './castingOutboxRepository.js'
import {
  claimTelegramDelivery,
  completeTelegramDelivery,
  failTelegramDelivery,
} from './telegramDeliveryRepository.js'
import { telegramProvider } from './telegramProvider.js'
import { recordAuditEvent } from './auditLog.js'

const invitationButtonCopy = {
  en: { accept: '✅ Accept', apply: '🎬 Apply', decline: '❌ Decline' },
  ru: { accept: '✅ Принять', apply: '🎬 Подать заявку', decline: '❌ Отказаться' },
  uz: { accept: '✅ Qabul qilish', apply: '🎬 Ariza topshirish', decline: '❌ Rad etish' },
}
const castingNotificationCopy = {
  en: {
    context: 'Regarding casting',
    cancelled: 'This casting has been cancelled.',
    closed: 'Applications are closed.',
    invited: '🎟 <b>You are invited to this casting</b>',
    rejected: 'Thank you for applying. You were not selected for this casting.',
    selected: 'Congratulations! You have been selected for this casting.',
  },
  ru: {
    context: 'По поводу кастинга',
    cancelled: 'Этот кастинг отменён.',
    closed: 'Приём заявок закрыт.',
    invited: '🎟 <b>Вас пригласили на этот кастинг</b>',
    rejected: 'Спасибо за заявку. Вы не были выбраны на этот кастинг.',
    selected: 'Поздравляем! Вы выбраны на этот кастинг.',
  },
  uz: {
    context: 'Kasting bo‘yicha',
    cancelled: 'Ushbu kasting bekor qilindi.',
    closed: 'Arizalar qabuli yopilgan.',
    invited: '🎟 <b>Siz ushbu kastingga taklif qilindingiz</b>',
    rejected: 'Arizangiz uchun rahmat. Siz bu kasting uchun tanlanmadingiz.',
    selected: 'Tabriklaymiz! Siz ushbu kasting uchun tanlandingiz.',
  },
}
let botUsername

async function resolveBotUsername() {
  if (botUsername !== undefined) return botUsername
  const configured = String(process.env.TELEGRAM_BOT_USERNAME ?? '').trim().replace(/^@/, '')
  if (configured) {
    botUsername = configured
    return botUsername
  }
  const bot = await telegramProvider.getMe()
  botUsername = String(bot?.username ?? '').trim()
  return botUsername
}

function invitationKeyboard(casting, candidate) {
  const token = castingPublicToken(casting)
  const copy = invitationButtonCopy[candidateInterfaceLanguage(candidate)]
  return {
    inline_keyboard: [
      [
        { callback_data: `cast:accept:${token}`, text: copy.accept },
        { callback_data: `cast:decline:${token}`, text: copy.decline },
      ],
    ],
  }
}

function applicationKeyboard(casting, candidate) {
  const token = castingPublicToken(casting)
  const copy = invitationButtonCopy[candidateInterfaceLanguage(candidate)]
  return {
    inline_keyboard: [[{
      callback_data: `cast:apply:${token}`,
      text: copy.apply,
    }]],
  }
}

async function channelApplicationKeyboard(casting, language) {
  const username = await resolveBotUsername()
  if (!username) {
    const error = new Error('Telegram bot username is unavailable for the casting deep link')
    error.code = 'TELEGRAM_BOT_USERNAME_UNAVAILABLE'
    throw error
  }
  const copy = invitationButtonCopy[candidateInterfaceLanguage({ language })]
  return {
    inline_keyboard: [[{
      text: copy.apply,
      url: `https://t.me/${username}?start=cast_${castingPublicToken(casting)}`,
    }]],
  }
}

async function eventDelivery(event) {
  if (event.eventType === 'casting.channel_publish') {
    const [casting, channel] = await Promise.all([
      findCasting(event.castingId),
      getCastingChannelConfig(),
    ])
    if (!casting) throw new Error('Casting outbox references a missing casting')
    if (!['active', 'scheduled'].includes(casting.status)) {
      const error = new Error('Casting is no longer publishable')
      error.code = 'CASTING_NOT_OPEN'
      error.nonRetryable = true
      throw error
    }
    if (!channel.enabled || !channel.telegramChatId) {
      const error = new Error('Casting announcement channel is not configured')
      error.code = 'CASTING_CHANNEL_UNCONFIGURED'
      throw error
    }
    return {
      chatId: channel.telegramChatId,
      options: {
        parse_mode: 'HTML',
        reply_markup: await channelApplicationKeyboard(casting, event.payload.language ?? 'ru'),
      },
      recipientKey: `channel:${channel.telegramChatId}`,
      text: formatCastingMessage(casting, event.payload.language ?? 'ru'),
    }
  }

  if (event.eventType === 'casting.channel_status_update') {
    const [casting, channel] = await Promise.all([
      findCasting(event.castingId),
      getCastingChannelConfig(),
    ])
    if (!casting?.channelMessageId || !channel.telegramChatId) {
      const error = new Error('Casting channel message is unavailable for update')
      error.code = 'CASTING_CHANNEL_MESSAGE_UNAVAILABLE'
      error.nonRetryable = true
      throw error
    }
    const language = event.payload.language ?? 'ru'
    const copy = castingNotificationCopy[language] ?? castingNotificationCopy.ru
    return {
      chatId: channel.telegramChatId,
      messageId: casting.channelMessageId,
      method: 'editMessageText',
      options: { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } },
      recipientKey: `channel:${channel.telegramChatId}`,
      text: `${formatCastingMessage(casting, language)}\n\n🚫 <b>${copy[event.payload.status] ?? copy.closed}</b>`,
    }
  }

  const candidate = await findCandidate(event.payload.candidateId)
  if (!candidate || !isCandidateReachableForDirectMessage(candidate)) {
    const error = new Error('Casting outbox candidate is not reachable')
    error.code = 'CASTING_CANDIDATE_UNREACHABLE'
    throw error
  }
  const chatId = String(candidateMessagingChatId(candidate))

  if (['casting.invitation', 'casting.publication'].includes(event.eventType)) {
    const casting = await findCasting(event.castingId)
    if (!casting) throw new Error('Casting outbox references a missing casting')
    if (!['active', 'scheduled'].includes(casting.status)) {
      const error = new Error('Casting is no longer open for delivery')
      error.code = 'CASTING_NOT_OPEN'
      error.nonRetryable = true
      throw error
    }
    const language = candidateInterfaceLanguage(candidate)
    const prefix = event.eventType === 'casting.invitation'
      ? `${castingNotificationCopy[language].invited}\n\n`
      : ''
    return {
      chatId,
      options: {
        parse_mode: 'HTML',
        reply_markup: event.eventType === 'casting.invitation'
          ? invitationKeyboard(casting, candidate)
          : applicationKeyboard(casting, candidate),
      },
      recipientKey: chatId,
      text: `${prefix}${formatCastingMessage(casting, candidate)}`,
    }
  }
  if (event.eventType === 'casting.context_message') {
    const casting = await findCasting(event.castingId)
    if (!casting) throw new Error('Casting outbox references a missing casting')
    const copy = castingNotificationCopy[candidateInterfaceLanguage(candidate)]
    return {
      chatId,
      options: { parse_mode: 'HTML', ...(event.payload.options ?? {}) },
      recipientKey: chatId,
      text: `🎬 <b>${copy.context}: ${escapeTelegramHtml(casting.title)}</b>\n\n${escapeTelegramHtml(event.payload.text)}`,
    }
  }
  if (event.eventType === 'casting.decision') {
    const casting = await findCasting(event.castingId)
    if (!casting) throw new Error('Casting outbox references a missing casting')
    const copy = castingNotificationCopy[candidateInterfaceLanguage(candidate)]
    const status = event.payload.status === 'selected' ? 'selected' : 'rejected'
    const icon = status === 'selected' ? '✅' : 'ℹ️'
    return {
      chatId,
      options: { parse_mode: 'HTML' },
      recipientKey: chatId,
      text: `🎬 <b>${copy.context}: ${escapeTelegramHtml(casting.title)}</b>\n\n${icon} ${copy[status]}`,
    }
  }
  if (event.eventType === 'casting.profile_decision') {
    return {
      chatId,
      options: {},
      recipientKey: chatId,
      text: candidateDecisionMessage(candidate, event.payload.status),
    }
  }

  const error = new Error(`Unsupported casting outbox event "${event.eventType}"`)
  error.code = 'CASTING_OUTBOX_EVENT_UNSUPPORTED'
  throw error
}

export async function processCastingOutboxEvent(event) {
  await markCastingOutboxEvent(event.operationId, 'processing')
  let claim
  let telegramMessageId

  try {
    const delivery = await eventDelivery(event)
    claim = await claimTelegramDelivery({
      chatId: delivery.chatId,
      data: {
        castingId: event.castingId,
        eventType: event.eventType,
        outboxId: event.id,
      },
      kind: event.eventType,
      operationId: `casting-outbox:${event.id}`,
      recipientKey: delivery.recipientKey,
    })

    if (!claim.claimed) {
      if (claim.status === 'sent') {
        if (event.eventType === 'casting.channel_publish' && claim.messageId) {
          await updateCasting(event.castingId, {
            channelChatId: delivery.chatId,
            channelMessageId: claim.messageId,
          }, 'casting_outbox')
        }
        const completed = await markCastingOutboxEvent(event.operationId, 'sent')
        return { deduplicated: true, event: completed, sent: true }
      }
      const cancelled = await markCastingOutboxEvent(
        event.operationId,
        'cancelled',
        `delivery_${claim.status}`,
      )
      return { deduplicated: true, event: cancelled, sent: false }
    }

    const message = delivery.method === 'editMessageText'
      ? await telegramProvider.call('editMessageText', {
          chat_id: delivery.chatId,
          message_id: delivery.messageId,
          text: delivery.text,
          ...delivery.options,
        })
      : await telegramProvider.sendMessage(
          delivery.chatId,
          delivery.text,
          delivery.options,
        )
    telegramMessageId = message.message_id
    try {
      await completeTelegramDelivery(claim, telegramMessageId)
    } catch (error) {
      error.code = 'CASTING_DELIVERY_POST_SEND_UNCERTAIN'
      error.deliveryUncertain = true
      throw error
    }
    if (event.eventType === 'casting.channel_publish') {
      await updateCasting(event.castingId, {
        channelChatId: delivery.chatId,
        channelMessageId: telegramMessageId,
      }, 'casting_outbox')
    }
    const completed = await markCastingOutboxEvent(event.operationId, 'sent')
    await recordAuditEvent({
      action: 'casting.outbox_sent',
      castingId: event.castingId,
      messageId: telegramMessageId,
      operationId: event.operationId,
      outcome: 'sent',
      participationId: event.participationId,
    })
    return { event: completed, messageId: telegramMessageId, sent: true }
  } catch (error) {
    if (claim?.claimed) {
      try {
        await failTelegramDelivery(claim, error)
      } catch (ledgerError) {
        console.error('Casting delivery ledger failure update failed', {
          code: ledgerError?.code ?? ledgerError?.name ?? 'unknown',
        })
      }
    }
    const failed = await markCastingOutboxEvent(
      event.operationId,
      error?.deliveryUncertain || error?.nonRetryable ? 'cancelled' : 'failed',
      error.code ?? error.name ?? 'casting_outbox_failed',
    )
    await recordAuditEvent({
      action: error?.deliveryUncertain
        ? 'casting.outbox_delivery_uncertain'
        : 'casting.outbox_failed',
      castingId: event.castingId,
      errorCode: error.code ?? error.name,
      messageId: telegramMessageId,
      operationId: event.operationId,
      outcome: error?.deliveryUncertain ? 'uncertain' : 'failed',
      participationId: event.participationId,
    })
    return { error: error.message, event: failed, sent: false }
  }
}

export async function processCastingOutboxBatch(limit = 25) {
  const events = await listReadyCastingOutboxEvents(limit)
  const results = []
  for (const event of events) {
    results.push(await processCastingOutboxEvent(event))
  }
  return results
}

export function startCastingOutboxProcessor({ intervalMs = 15_000 } = {}) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      await processCastingOutboxBatch()
    } catch (error) {
      console.error('Casting outbox processing failed', {
        code: error?.code ?? error?.name ?? 'unknown',
      })
    } finally {
      running = false
    }
  }

  void run()
  const timer = setInterval(run, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
