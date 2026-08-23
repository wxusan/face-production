import { config } from './config.js'
import { recordAuditEvent } from './auditLog.js'
import {
  createCandidateIntake,
  findCandidate,
  getBroadcastDryRun,
  listPendingCandidateIntakes,
  updateCandidateStatus,
} from './candidateRepository.js'
import { isAdminTelegramId } from './security.js'

const apiBase = 'https://api.telegram.org'
const sessions = new Map()

export class TelegramProvider {
  constructor(token) {
    this.token = token
  }

  get configured() {
    return Boolean(this.token)
  }

  async call(method, payload = {}) {
    if (!this.configured) {
      const error = new Error('Telegram bot token is not configured')
      error.statusCode = 500
      throw error
    }

    const response = await fetch(`${apiBase}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json()

    if (!response.ok || !data.ok) {
      const message = data.description ?? `Telegram API request failed: ${method}`
      const error = new Error(message)
      error.statusCode = response.status || 502
      throw error
    }

    return data.result
  }

  async deleteWebhook() {
    return this.call('deleteWebhook', { drop_pending_updates: false })
  }

  async getMe() {
    return this.call('getMe')
  }

  async getUpdates(offset) {
    return this.call('getUpdates', {
      allowed_updates: ['message'],
      offset,
      timeout: 25,
    })
  }

  async sendMessage(chatId, text, options = {}) {
    return this.call('sendMessage', {
      chat_id: chatId,
      disable_web_page_preview: true,
      text,
      ...options,
    })
  }
}

export const telegramProvider = new TelegramProvider(config.telegramBotToken)

function getCandidateHelp() {
  return [
    'FACE Production talent registration.',
    '',
    'Commands:',
    '/register - send your profile for review',
    '/whoami - show your Telegram ID',
    '/cancel - stop the current registration',
    '/help - show this message',
  ].join('\n')
}

function getAdminHelp() {
  return [
    'FACE Production admin bot.',
    '',
    'Commands:',
    '/status - check platform configuration',
    '/pending - list pending Telegram registrations',
    '/candidate <id> - view candidate details',
    '/approve <id> - approve a pending candidate',
    '/reject <id> - reject a pending candidate',
    '/dryrun - check governed campaign eligibility',
    '/whoami - show your Telegram ID',
    '/help - show this message',
  ].join('\n')
}

function formatCandidate(candidate) {
  return [
    `${candidate.id} · ${candidate.name}`,
    `Age: ${candidate.age ?? 'unknown'}`,
    `City: ${candidate.city ?? 'unknown'}`,
    `Role: ${candidate.role ?? 'unknown'}`,
    `Phone: ${candidate.phone ?? 'not provided'}`,
    `Consent: ${candidate.consent}`,
    `Status: ${candidate.status}`,
    `Telegram: ${candidate.telegramUsername ? `@${candidate.telegramUsername}` : candidate.telegramUserId}`,
  ].join('\n')
}

function normalizeCommand(text) {
  return text.split(/\s+/)[0].toLowerCase()
}

function getCommandArg(text) {
  return text.split(/\s+/).slice(1).join(' ').trim()
}

async function notifyAdmin(text) {
  try {
    await telegramProvider.sendMessage(config.adminId, text)
    return true
  } catch (error) {
    await recordAuditEvent({
      action: 'telegram.admin_notification_failed',
      error: error.message,
      outcome: 'failed',
    })
    return false
  }
}

async function handleAdminCommand(chatId, fromId, text) {
  const command = normalizeCommand(text)
  const arg = getCommandArg(text)

  if (command === '/whoami') {
    await telegramProvider.sendMessage(chatId, `Your Telegram ID is ${fromId}. Admin ID is ${config.adminId}.`)
    return { handled: true, role: 'admin' }
  }

  if (command === '/register') {
    await telegramProvider.sendMessage(
      chatId,
      'This Telegram account is configured as admin, so it cannot use the candidate registration flow. Use another Telegram account for user testing, or send /help for admin commands.',
    )
    return { handled: true, role: 'admin' }
  }

  if (command === '/start' || command === '/help') {
    await telegramProvider.sendMessage(chatId, getAdminHelp())

    await recordAuditEvent({
      action: 'telegram.admin_help',
      actorTelegramId: fromId,
      chatId,
      outcome: 'sent',
    })

    return { handled: true, role: 'admin' }
  }

  if (command === '/status') {
    await telegramProvider.sendMessage(
      chatId,
      [
        'Platform status:',
        `Admin locked: ${config.adminId}`,
        `Polling: ${config.enablePolling ? 'enabled' : 'disabled'}`,
        'Candidate registration: open',
        'Broadcasts: dry-run only',
      ].join('\n'),
    )

    await recordAuditEvent({
      action: 'telegram.admin_status',
      actorTelegramId: fromId,
      chatId,
      outcome: 'sent',
    })

    return { handled: true, role: 'admin' }
  }

  if (command === '/pending') {
    const pending = await listPendingCandidateIntakes()

    if (!pending.length) {
      await telegramProvider.sendMessage(chatId, 'No pending candidate registrations.')
      return { handled: true, role: 'admin' }
    }

    await telegramProvider.sendMessage(
      chatId,
      [
        `Pending candidates: ${pending.length}`,
        '',
        ...pending.slice(0, 10).map((candidate) => {
          return `${candidate.id} · ${candidate.name} · ${candidate.role} · ${candidate.city}`
        }),
        '',
        'Use /candidate <id>, /approve <id>, or /reject <id>.',
      ].join('\n'),
    )

    await recordAuditEvent({
      action: 'telegram.admin_pending',
      actorTelegramId: fromId,
      chatId,
      count: pending.length,
      outcome: 'sent',
    })

    return { handled: true, role: 'admin' }
  }

  if (command === '/candidate') {
    const candidate = await findCandidate(arg)

    if (!candidate) {
      await telegramProvider.sendMessage(chatId, 'Candidate not found.')
      return { handled: true, role: 'admin' }
    }

    await telegramProvider.sendMessage(chatId, formatCandidate(candidate))

    await recordAuditEvent({
      action: 'telegram.admin_candidate_view',
      actorTelegramId: fromId,
      candidateId: arg,
      chatId,
      outcome: 'sent',
    })

    return { handled: true, role: 'admin' }
  }

  if (command === '/approve' || command === '/reject') {
    const nextStatus = command === '/approve' ? 'approved' : 'rejected'
    const candidate = await updateCandidateStatus(arg, nextStatus, fromId)

    if (!candidate) {
      await telegramProvider.sendMessage(chatId, 'Candidate not found or not editable.')
      return { handled: true, role: 'admin' }
    }

    await telegramProvider.sendMessage(chatId, `${candidate.id} is now ${nextStatus}.`)

    if (candidate.telegramChatId) {
      const message =
        nextStatus === 'approved'
          ? 'Your FACE Production profile was approved for the internal talent database.'
          : 'Your FACE Production registration was reviewed and not approved at this stage.'

      await telegramProvider.sendMessage(candidate.telegramChatId, message)
    }

    await recordAuditEvent({
      action: `telegram.admin_${nextStatus}`,
      actorTelegramId: fromId,
      candidateId: arg,
      chatId,
      outcome: 'sent',
    })

    return { handled: true, role: 'admin' }
  }

  if (command === '/dryrun') {
    const dryRun = await getBroadcastDryRun()

    await telegramProvider.sendMessage(
      chatId,
      [
        'Campaign dry run:',
        `Eligible candidates: ${dryRun.eligible.length}`,
        `Blocked candidates: ${dryRun.blocked.length}`,
        'No messages were sent.',
      ].join('\n'),
    )

    await recordAuditEvent({
      action: 'telegram.admin_dry_run',
      actorTelegramId: fromId,
      chatId,
      outcome: 'sent',
    })

    return { handled: true, role: 'admin' }
  }

  await telegramProvider.sendMessage(chatId, 'Unknown admin command. Send /help.')

  await recordAuditEvent({
    action: 'telegram.admin_unknown_command',
    actorTelegramId: fromId,
    chatId,
    command: text.slice(0, 80),
    outcome: 'sent',
  })

  return { handled: true, role: 'admin' }
}

async function completeRegistration(chatId, from, session) {
  const consent =
    session.data.age < 18
      ? session.data.guardianConsent === 'yes'
        ? 'guardian_confirmed'
        : 'missing'
      : 'not_required'

  const candidate = await createCandidateIntake({
    age: session.data.age,
    city: session.data.city,
    consent,
    guardianConsent: session.data.guardianConsent ?? 'not_required',
    name: session.data.name,
    phone: session.data.phone,
    role: session.data.role,
    telegramChatId: chatId,
    telegramFirstName: from.first_name,
    telegramUserId: String(from.id),
    telegramUsername: from.username,
  })

  sessions.delete(String(from.id))

  await telegramProvider.sendMessage(
    chatId,
    [
      'Registration received.',
      `Your candidate ID: ${candidate.id}`,
      'FACE Production admin will review it before it enters the active database.',
    ].join('\n'),
  )

  const adminNotified = await notifyAdmin(
    [
      'New candidate registration:',
      '',
      formatCandidate(candidate),
      '',
      `Approve: /approve ${candidate.id}`,
      `Reject: /reject ${candidate.id}`,
    ].join('\n'),
  )

  await recordAuditEvent({
    action: 'telegram.candidate_registered',
    adminNotified,
    candidateId: candidate.id,
    telegramUserId: String(from.id),
    outcome: 'created',
  })

  return { candidateId: candidate.id, handled: true, role: 'candidate' }
}

async function handleCandidateMessage(chatId, from, text) {
  const fromId = String(from.id)
  const command = normalizeCommand(text)

  if (command === '/whoami') {
    await telegramProvider.sendMessage(chatId, `Your Telegram ID is ${fromId}.`)
    return { handled: true, role: 'candidate' }
  }

  if (command === '/start' || command === '/help') {
    sessions.delete(fromId)
    await telegramProvider.sendMessage(chatId, getCandidateHelp())
    return { handled: true, role: 'candidate' }
  }

  if (command === '/cancel') {
    sessions.delete(fromId)
    await telegramProvider.sendMessage(chatId, 'Registration cancelled. Send /register to start again.')
    return { handled: true, role: 'candidate' }
  }

  if (command === '/register') {
    sessions.set(fromId, {
      data: {},
      step: 'name',
    })
    await telegramProvider.sendMessage(chatId, 'What is your full name?')
    return { handled: true, role: 'candidate' }
  }

  const session = sessions.get(fromId)

  if (!session) {
    await telegramProvider.sendMessage(chatId, 'Send /register to submit your FACE Production talent profile.')
    return { handled: true, role: 'candidate' }
  }

  if (session.step === 'name') {
    if (text.length < 2) {
      await telegramProvider.sendMessage(chatId, 'Please send your full name.')
      return { handled: true, role: 'candidate' }
    }

    session.data.name = text
    session.step = 'age'
    await telegramProvider.sendMessage(chatId, 'How old are you?')
    return { handled: true, role: 'candidate' }
  }

  if (session.step === 'age') {
    const age = Number.parseInt(text, 10)

    if (!Number.isInteger(age) || age < 1 || age > 100) {
      await telegramProvider.sendMessage(chatId, 'Please send age as a number.')
      return { handled: true, role: 'candidate' }
    }

    session.data.age = age
    session.step = 'city'
    await telegramProvider.sendMessage(chatId, 'Which city are you based in?')
    return { handled: true, role: 'candidate' }
  }

  if (session.step === 'city') {
    session.data.city = text
    session.step = 'role'
    await telegramProvider.sendMessage(chatId, 'What talent role should we list? Example: actor, model, dancer, voice talent.')
    return { handled: true, role: 'candidate' }
  }

  if (session.step === 'role') {
    session.data.role = text
    session.step = 'phone'
    await telegramProvider.sendMessage(chatId, 'Send your phone number or type skip.')
    return { handled: true, role: 'candidate' }
  }

  if (session.step === 'phone') {
    session.data.phone = text.toLowerCase() === 'skip' ? '' : text

    if (session.data.age < 18) {
      session.step = 'guardianConsent'
      await telegramProvider.sendMessage(chatId, 'You are under 18. Do you have guardian permission to register? Reply yes or no.')
      return { handled: true, role: 'candidate' }
    }

    return completeRegistration(chatId, from, session)
  }

  if (session.step === 'guardianConsent') {
    const answer = text.toLowerCase()

    if (!['yes', 'no'].includes(answer)) {
      await telegramProvider.sendMessage(chatId, 'Please reply yes or no.')
      return { handled: true, role: 'candidate' }
    }

    session.data.guardianConsent = answer
    return completeRegistration(chatId, from, session)
  }

  await telegramProvider.sendMessage(chatId, 'Something went off in this registration. Send /register to start again.')
  sessions.delete(fromId)
  return { handled: true, role: 'candidate' }
}

export async function handleTelegramUpdate(update) {
  const message = update.message

  if (!message?.chat?.id || !message.from?.id) {
    return { handled: false, reason: 'unsupported_update' }
  }

  const fromId = String(message.from.id)
  const chatId = message.chat.id
  const text = String(message.text ?? '').trim()
  const role = await isAdminTelegramId(fromId) ? 'admin' : 'candidate'

  console.log(`Telegram update ${update.update_id}: ${role} ${fromId} -> ${text || '[non-text]'}`)

  if (!text) {
    await telegramProvider.sendMessage(chatId, 'Please send text. Use /help to see commands.')
    return { handled: true, role: 'unknown' }
  }

  if (role === 'admin') {
    return handleAdminCommand(chatId, fromId, text)
  }

  return handleCandidateMessage(chatId, message.from, text)
}

export async function startTelegramPolling() {
  if (!telegramProvider.configured) {
    console.warn('Telegram polling skipped: bot token is not configured')
    return
  }

  await telegramProvider.deleteWebhook()

  let offset
  console.log('Telegram polling started')

  while (true) {
    try {
      const updates = await telegramProvider.getUpdates(offset)

      for (const update of updates) {
        offset = update.update_id + 1
        await handleTelegramUpdate(update)
      }
    } catch (error) {
      console.error('Telegram polling error:', error.message)
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }
}
