import { config } from './config.js'
import { listBriefNotificationAdmins } from './adminRepository.js'
import { recordAuditEvent } from './auditLog.js'
import { telegramProvider } from './telegramProvider.js'

function briefMessage(brief) {
  return [
    '🎬 New casting request',
    '',
    `${brief.id} · ${brief.company || brief.clientName}`,
    `Project: ${brief.projectType}`,
    `Roles: ${brief.rolesNeeded}`,
    `Shoot: ${brief.shootingDate || 'Not specified'} · ${brief.location || 'Not specified'}`,
    `Contact: ${brief.phoneOrTelegram}`,
  ].join('\n')
}

export async function notifyAdminsAboutBrief(brief) {
  if (!telegramProvider.configured) return { delivered: 0, skipped: 'telegram_not_configured' }
  const admins = await listBriefNotificationAdmins()
  let delivered = 0

  for (const admin of admins) {
    try {
      const options = config.publicAppUrl
        ? { reply_markup: { inline_keyboard: [[{ text: 'Open in dashboard', url: `${config.publicAppUrl}/?view=briefs&brief=${encodeURIComponent(brief.id)}` }]] } }
        : {}
      await telegramProvider.sendMessage(admin.telegramUserId, briefMessage(brief), options)
      delivered += 1
      await recordAuditEvent({
        action: 'brief.telegram_notification_sent',
        actor: admin.id,
        briefId: brief.id,
        outcome: 'sent',
      })
    } catch (error) {
      await recordAuditEvent({
        action: 'brief.telegram_notification_failed',
        actor: admin.id,
        briefId: brief.id,
        error: error.message,
        outcome: 'failed',
      })
    }
  }
  return { delivered }
}
