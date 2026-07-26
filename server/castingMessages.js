import { candidateInterfaceLanguage } from './candidateDecisionMessages.js'

const castingCopy = {
  en: {
    details: 'Details',
    ends: 'Ends',
    locale: 'en-GB',
    starts: 'Starts',
  },
  ru: {
    details: 'Детали',
    ends: 'Завершение',
    locale: 'ru-RU',
    starts: 'Начало',
  },
  uz: {
    details: 'Tafsilotlar',
    ends: 'Tugash',
    locale: 'uz-UZ',
    starts: 'Boshlanish',
  },
}

export function escapeTelegramHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function formatCastingDate(value, locale) {
  return new Date(value).toLocaleString(locale, {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function formatCastingMessage(casting, languageOrCandidate = 'ru') {
  const language = typeof languageOrCandidate === 'string'
    ? candidateInterfaceLanguage({ language: languageOrCandidate })
    : candidateInterfaceLanguage(languageOrCandidate)
  const copy = castingCopy[language]
  const sections = [
    `🎬 <b>${escapeTelegramHtml(casting.title)}</b>`,
    `📋 <b>${copy.details}:</b>\n${escapeTelegramHtml(casting.body)}`,
  ]
  const schedule = []

  if (casting.startsAt) {
    schedule.push(`📅 <b>${copy.starts}:</b> ${formatCastingDate(casting.startsAt, copy.locale)}`)
  }
  if (casting.endsAt) {
    schedule.push(`🏁 <b>${copy.ends}:</b> ${formatCastingDate(casting.endsAt, copy.locale)}`)
  }
  if (schedule.length) {
    sections.push(schedule.join('\n'))
  }

  return sections.join('\n\n')
}
