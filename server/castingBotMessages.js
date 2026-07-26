const castingBotCopy = {
  en: {
    accept: 'Accept invitation',
    apply: 'Apply',
    applyNow: 'Apply now',
    canApply: 'Your profile is ready. Tap Apply to send your application for this casting.',
    cancelled: 'Your participation in this casting was cancelled.',
    closed: 'Applications for this casting are closed.',
    context: 'FACE Production casting',
    decline: 'Decline',
    declined: 'You declined this invitation.',
    declinedNow: 'Your decline has been saved.',
    incomplete:
      'Your profile is incomplete. I saved this casting and will bring you back after registration.',
    invitation: 'You are invited to this casting. Accept or decline the invitation below.',
    missing: 'This casting link is invalid or no longer exists.',
    notEligible: 'This casting is not available for your profile.',
    notOpen: 'This casting is not accepting applications yet.',
    profileRejected:
      'Your FACE Production profile needs to be updated and resubmitted before you can apply.',
    registration:
      'Create your FACE Production profile first. I saved this casting and will bring you back after registration.',
    rejected: 'Your application for this casting was not selected.',
    removed: 'Your participation in this casting is no longer active.',
    selected: 'You have already been selected for this casting.',
    selectedNow: 'Invitation accepted. You are now selected for this casting.',
    selfOnly: 'Casting applications must use your own Telegram profile, not a friend’s profile.',
    submitted: 'Your application has been submitted.',
    submittedAlready: 'You have already applied for this casting.',
    withdrawn: 'Your application for this casting was withdrawn.',
  },
  ru: {
    accept: 'Принять приглашение',
    apply: 'Откликнуться',
    applyNow: 'Откликнуться сейчас',
    canApply: 'Ваша анкета готова. Нажмите «Откликнуться», чтобы подать заявку на этот кастинг.',
    cancelled: 'Ваше участие в этом кастинге отменено.',
    closed: 'Приём заявок на этот кастинг завершён.',
    context: 'Кастинг FACE Production',
    decline: 'Отказаться',
    declined: 'Вы отказались от этого приглашения.',
    declinedNow: 'Ваш отказ сохранён.',
    incomplete:
      'Ваша анкета заполнена не полностью. Кастинг сохранён, и после регистрации мы вернём вас к нему.',
    invitation: 'Вы приглашены на этот кастинг. Примите или отклоните приглашение ниже.',
    missing: 'Ссылка на кастинг недействительна или кастинг больше не существует.',
    notEligible: 'Этот кастинг недоступен для вашей анкеты.',
    notOpen: 'Приём заявок на этот кастинг ещё не начался.',
    profileRejected:
      'Обновите и повторно отправьте анкету FACE Production, прежде чем откликаться.',
    registration:
      'Сначала создайте анкету FACE Production. Кастинг сохранён, и после регистрации мы вернём вас к нему.',
    rejected: 'Ваша заявка на этот кастинг не была выбрана.',
    removed: 'Ваше участие в этом кастинге больше не активно.',
    selected: 'Вы уже выбраны для этого кастинга.',
    selectedNow: 'Приглашение принято. Вы выбраны для этого кастинга.',
    selfOnly: 'Для отклика используйте свою анкету Telegram, а не анкету друга.',
    submitted: 'Ваша заявка на кастинг отправлена.',
    submittedAlready: 'Вы уже откликнулись на этот кастинг.',
    withdrawn: 'Ваша заявка на этот кастинг отозвана.',
  },
  uz: {
    accept: 'Taklifni qabul qilish',
    apply: 'Ariza topshirish',
    applyNow: 'Hozir ariza topshirish',
    canApply: 'Profilingiz tayyor. Ushbu kastingga ariza yuborish uchun tugmani bosing.',
    cancelled: 'Bu kastingdagi ishtirokingiz bekor qilindi.',
    closed: 'Bu kastingga ariza qabul qilish yakunlangan.',
    context: 'FACE Production kastingi',
    decline: 'Rad etish',
    declined: 'Siz bu taklifni rad etgansiz.',
    declinedNow: 'Rad javobingiz saqlandi.',
    incomplete:
      'Profilingiz to‘liq emas. Kasting saqlandi va ro‘yxatdan o‘tgach sizni unga qaytaramiz.',
    invitation: 'Siz ushbu kastingga taklif qilindingiz. Quyida taklifni qabul qiling yoki rad eting.',
    missing: 'Kasting havolasi noto‘g‘ri yoki kasting endi mavjud emas.',
    notEligible: 'Bu kasting profilingiz uchun mavjud emas.',
    notOpen: 'Bu kastingga ariza qabul qilish hali boshlanmagan.',
    profileRejected:
      'Ariza topshirishdan oldin FACE Production profilingizni yangilab, qayta yuboring.',
    registration:
      'Avval FACE Production profilini yarating. Kasting saqlandi va ro‘yxatdan o‘tgach sizni unga qaytaramiz.',
    rejected: 'Bu kasting uchun arizangiz tanlanmadi.',
    removed: 'Bu kastingdagi ishtirokingiz endi faol emas.',
    selected: 'Siz bu kasting uchun allaqachon tanlangansiz.',
    selectedNow: 'Taklif qabul qilindi. Siz bu kasting uchun tanlandingiz.',
    selfOnly: 'Kastingga ariza berish uchun do‘stingiznikini emas, o‘z Telegram profilingizni ishlating.',
    submitted: 'Kasting uchun arizangiz yuborildi.',
    submittedAlready: 'Siz bu kastingga allaqachon ariza topshirgansiz.',
    withdrawn: 'Bu kasting uchun arizangiz qaytarib olingan.',
  },
}

export function castingBotLanguage(value) {
  return ['en', 'ru', 'uz'].includes(value) ? value : 'ru'
}

export function castingBotText(language, key) {
  const lang = castingBotLanguage(language)
  return castingBotCopy[lang][key] ?? castingBotCopy.en[key] ?? key
}

export function castingOutcomeText(language, outcome, { changed = false } = {}) {
  const key = {
    applied: changed ? 'submitted' : 'submittedAlready',
    can_apply: 'canApply',
    cancelled: 'cancelled',
    closed: 'closed',
    declined: changed ? 'declinedNow' : 'declined',
    incomplete: 'incomplete',
    invited: 'invitation',
    not_eligible: 'notEligible',
    not_found: 'missing',
    not_open: 'notOpen',
    profile_incomplete: 'incomplete',
    profile_rejected: 'profileRejected',
    registration_required: 'registration',
    rejected: 'rejected',
    removed: 'removed',
    selected: changed ? 'selectedNow' : 'selected',
    withdrawn: 'withdrawn',
  }[outcome] ?? 'notEligible'

  return castingBotText(language, key)
}
