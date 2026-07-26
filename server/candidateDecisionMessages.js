const decisionMessages = {
  en: {
    approved: 'Your FACE Production profile was approved for the internal talent database.',
    proxyApproved:
      'The profile you submitted for your friend was approved for the internal FACE Production talent database.',
    proxyRejected:
      'The profile you submitted for your friend was reviewed and not approved at this stage.',
    rejected: 'Your FACE Production registration was reviewed and not approved at this stage.',
  },
  ru: {
    approved: 'Ваш профиль FACE Production одобрен для внутренней базы талантов.',
    proxyApproved:
      'Анкета, которую вы отправили за друга, одобрена для внутренней базы талантов FACE Production.',
    proxyRejected:
      'Анкета, которую вы отправили за друга, рассмотрена и не одобрена на этом этапе.',
    rejected: 'Ваша заявка FACE Production рассмотрена и не одобрена на этом этапе.',
  },
  uz: {
    approved: 'FACE Production profilingiz ichki talentlar bazasi uchun tasdiqlandi.',
    proxyApproved:
      'Do‘stingiz uchun yuborgan anketa FACE Production ichki talentlar bazasi uchun tasdiqlandi.',
    proxyRejected:
      'Do‘stingiz uchun yuborgan anketa ko‘rib chiqildi va bu bosqichda tasdiqlanmadi.',
    rejected: 'FACE Production arizangiz ko‘rib chiqildi va bu bosqichda tasdiqlanmadi.',
  },
}

export function candidateInterfaceLanguage(candidate, fallback = 'ru') {
  const requested = String(candidate?.language ?? '').toLowerCase()
  return decisionMessages[requested] ? requested : fallback
}

export function candidateDecisionMessage(candidate, nextStatus) {
  const language = candidateInterfaceLanguage(candidate)
  const translations = decisionMessages[language]
  const isProxy = candidate?.submissionMode === 'friend'

  if (nextStatus === 'approved') {
    return isProxy ? translations.proxyApproved : translations.approved
  }

  if (nextStatus === 'rejected') {
    return isProxy ? translations.proxyRejected : translations.rejected
  }

  const error = new Error('Candidate decision status must be approved or rejected')
  error.statusCode = 400
  throw error
}
