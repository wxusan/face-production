import { loadLocalEnv } from './env.js'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { recordAuditEvent } from './auditLog.js'
import { listActiveCastingsForCandidate } from './castingRepository.js'
import { deleteBotSession, getBotSession, saveBotSession } from './botSessionRepository.js'
import {
  createCandidateIntake,
  findCandidateByPhone,
  findCandidateByTelegramId,
  replaceCandidateIntake,
  updateCandidateMetadata,
  updateCandidateStatus,
} from './candidateRepository.js'
import { readMediaReference, saveTelegramFile } from './photoStorage.js'
import { talentLabel, talentTaxonomy } from './taxonomy.js'

loadLocalEnv()

const token = process.env.TELEGRAM_BOT_TOKEN
const adminIds = String(process.env.TELEGRAM_ADMIN_ID ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const adminId = adminIds[0] ?? ''
const apiBase = `https://api.telegram.org/bot${token}`
const telegramChannelUrl = String(process.env.TELEGRAM_CHANNEL_URL ?? '').trim()
const sessions = new Map()
const exampleFileIdCache = new Map()

if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is missing')
}

const totalProgressSteps = 18

const exampleMediaPaths = {
  fallbackIntroVideo: 's3://face-candidate-media/examples/male-intro.mp4',
  female: {
    introVideo: 's3://face-candidate-media/examples/female-intro.mp4',
  },
  male: {
    introVideo: 's3://face-candidate-media/examples/male-intro.mp4',
  },
}

const telegramExampleVideoMaxBytes = 49 * 1024 * 1024

const text = {
  en: {
    adminHelp: 'FACE Production admin bot.\nCommands: /whoami, /status.',
    adminApproved: 'Candidate approved.',
    adminApproveButton: 'Approve',
    adminRejected: 'Candidate rejected.',
    adminRejectButton: 'Reject',
    adminRegister: 'This account is admin. Use another Telegram account to test the user form.',
    adminStatus: 'Bot is online. User registration is open.',
    approved: 'Your profile card has been sent to admin.',
    approveProfile: 'Approve card',
    askAge: 'Your age:',
    askCity: 'Which city are you based in?',
    askGender: 'Gender:',
    askHeight: 'Your height in cm:',
    askLanguage: 'Choose interface language:',
    askLanguages: 'Languages:',
    askLook: 'Ethnicity / look:',
    askMode: 'Who is this profile for?',
    askName: 'Full name:',
    askPhone: 'Phone number:',
    askSports: 'Sports talents:',
    askPerformance: 'Performance talents:',
    askPhysical: 'Physical skills:',
    askCloseShotPhoto: 'Send a closer shot photo:',
    askFullBodyPhoto: 'Send a full-body photo:',
    askLeftProfilePhoto: 'Send a left profile side photo:',
    askPortraitPhoto: 'Send a portrait photo:',
    askRightProfilePhoto: 'Send a right profile side photo:',
    askVideo:
      'Send intro video. Max 90 seconds (1:30). Say your name, age, city, talents, then show happiness, anger, sadness, surprise, excitement, and fear.',
    askWeight: 'Weight:',
    badAge: 'Age must be digits only and not more than 130.',
    badHeight: 'Height must be digits only and not more than 250.',
    badName: 'Full name must contain only letters and spaces. Example: Abdukarim Salomov',
    badPhone: 'Please use the phone button or send a valid phone number.',
    badPhoto: 'Please send a photo.',
    badVideo: 'Please send a video up to 90 seconds (1:30).',
    badWeight: 'Weight must be digits only.',
    cancel: 'Registration cancelled. Send /start to begin again.',
    castingList: 'Current castings:',
    currentValue: 'Current value',
    duplicatePhone: 'This phone number already exists. Send another phone number or /cancel.',
    edit: 'Edit',
    editPrompt: 'Which section do you want to edit?',
    examplePhoto: 'Example photo',
    keepCurrent: 'Leave current',
    menuCastings: '🎬 Current Projects',
    menuFriend: '👥 Register a friend',
    menuProfile: '👤 My Current Profile',
    menuText: 'Choose an action:',
    menuUpdate: '✏️ Update profile',
    minOne: 'Choose at least one option.',
    next: 'Next',
    noCastings: 'No current castings right now.',
    noProfile: 'No submitted profile found yet. Please register first.',
    none: 'None',
    other: 'Other',
    phoneButton: '📱 Share phone number',
    profile: '👤 Profile card',
    proxyApproved:
      'The profile you submitted for your friend was approved for the internal FACE Production talent database.',
    proxyRejected:
      'The profile you submitted for your friend was reviewed and not approved at this stage.',
    registerFriend: 'Register a friend',
    registerSelf: 'Register myself',
    reviewActions: 'Check your card. It will be sent to admin only after you approve it:',
    savedAfterEdit: 'Updated card has been sent to admin.',
    selectDone: 'Select options, then press Next.',
    sendCustom: 'Type your custom value:',
    start:
      'Welcome to our Telegram bot.\nДобро пожаловать в наш Telegram-бот.\nTelegram botimizga xush kelibsiz.',
    unknownAdmin: 'Unknown admin command. Send /help.',
    whoami: 'Your Telegram ID is',
  },
  ru: {
    adminHelp: 'Админ-бот FACE Production.\nКоманды: /whoami, /status.',
    adminApproved: 'Кандидат одобрен.',
    adminApproveButton: 'Одобрить',
    adminRejected: 'Кандидат отклонен.',
    adminRejectButton: 'Отклонить',
    adminRegister: 'Этот аккаунт администратор. Для теста формы используйте другой Telegram-аккаунт.',
    adminStatus: 'Бот онлайн. Регистрация пользователей открыта.',
    approved: 'Ваша карточка отправлена администратору.',
    approveProfile: 'Подтвердить карточку',
    askAge: 'Ваш возраст:',
    askCity: 'В каком городе/регионе вы находитесь?',
    askGender: 'Пол:',
    askHeight: 'Ваш рост в см:',
    askLanguage: 'Выберите язык интерфейса:',
    askLanguages: 'Языки:',
    askLook: 'Этнический тип / внешность:',
    askMode: 'Для кого заполняем анкету?',
    askName: 'Полное имя:',
    askPhone: 'Номер телефона:',
    askSports: 'Спортивные таланты:',
    askPerformance: 'Сценические таланты:',
    askPhysical: 'Физические навыки:',
    askCloseShotPhoto: 'Отправьте фото ближе к камере:',
    askFullBodyPhoto: 'Отправьте фото в полный рост:',
    askLeftProfilePhoto: 'Отправьте фото левого профиля:',
    askPortraitPhoto: 'Отправьте портретное фото:',
    askRightProfilePhoto: 'Отправьте фото правого профиля:',
    askVideo:
      'Отправьте интро-видео до 90 секунд (1:30). Скажите имя, возраст, город, таланты, затем покажите эмоции: радость, злость, грусть, удивление, восторг и страх.',
    askWeight: 'Вес:',
    badAge: 'Возраст должен быть только цифрами и не больше 130.',
    badHeight: 'Рост должен быть только цифрами и не больше 250.',
    badName: 'Имя должно содержать только буквы и пробелы. Пример: Abdukarim Salomov',
    badPhone: 'Используйте кнопку телефона или отправьте корректный номер.',
    badPhoto: 'Отправьте фото.',
    badVideo: 'Отправьте видео до 90 секунд (1:30).',
    badWeight: 'Вес должен быть только цифрами.',
    cancel: 'Регистрация отменена. Отправьте /start, чтобы начать заново.',
    castingList: 'Актуальные кастинги:',
    currentValue: 'Текущее значение',
    duplicatePhone: 'Этот номер уже есть в базе. Отправьте другой номер или /cancel.',
    edit: 'Редактировать',
    editPrompt: 'Какой раздел хотите изменить?',
    examplePhoto: 'Пример фото',
    keepCurrent: 'Оставить текущее',
    menuCastings: '🎬 Текущие проекты',
    menuFriend: '👥 Зарегистрировать друга',
    menuProfile: '👤 Моя текущая анкета',
    menuText: 'Выберите действие:',
    menuUpdate: '✏️ Обновить профиль',
    minOne: 'Выберите минимум один вариант.',
    next: 'Далее',
    noCastings: 'Сейчас нет актуальных кастингов.',
    noProfile: 'Анкета пока не найдена. Сначала пройдите регистрацию.',
    none: 'Нет',
    other: 'Другое',
    phoneButton: '📱 Отправить номер телефона',
    profile: '👤 Карточка профиля',
    proxyApproved:
      'Анкета, которую вы отправили за друга, одобрена для внутренней базы талантов FACE Production.',
    proxyRejected:
      'Анкета, которую вы отправили за друга, рассмотрена и не одобрена на этом этапе.',
    registerFriend: 'Зарегистрировать друга',
    registerSelf: 'Зарегистрировать себя',
    reviewActions: 'Проверьте карточку. Она уйдет администратору только после вашего подтверждения:',
    savedAfterEdit: 'Обновленная карточка отправлена администратору.',
    selectDone: 'Выберите варианты, затем нажмите Далее.',
    sendCustom: 'Напишите свой вариант:',
    start:
      'Welcome to our Telegram bot.\nДобро пожаловать в наш Telegram-бот.\nTelegram botimizga xush kelibsiz.',
    unknownAdmin: 'Неизвестная команда администратора. Отправьте /help.',
    whoami: 'Ваш Telegram ID',
  },
  uz: {
    adminHelp: 'FACE Production admin boti.\nBuyruqlar: /whoami, /status.',
    adminApproved: 'Nomzod tasdiqlandi.',
    adminApproveButton: 'Tasdiqlash',
    adminRejected: 'Nomzod rad etildi.',
    adminRejectButton: 'Rad etish',
    adminRegister: 'Bu akkaunt admin. Formani test qilish uchun boshqa Telegram akkauntdan foydalaning.',
    adminStatus: 'Bot onlayn. Foydalanuvchi ro‘yxatdan o‘tishi ochiq.',
    approved: 'Profil kartangiz adminga yuborildi.',
    approveProfile: 'Kartani tasdiqlash',
    askAge: 'Yoshingiz:',
    askCity: 'Qaysi shahar/viloyatdasiz?',
    askGender: 'Jins:',
    askHeight: 'Bo‘yingiz sm da:',
    askLanguage: 'Interfeys tilini tanlang:',
    askLanguages: 'Tillar:',
    askLook: 'Etnik ko‘rinish / tashqi ko‘rinish:',
    askMode: 'Anketa kim uchun?',
    askName: 'To‘liq ism:',
    askPhone: 'Telefon raqam:',
    askSports: 'Sport talantlari:',
    askPerformance: 'Sahna talantlari:',
    askPhysical: 'Jismoniy ko‘nikmalar:',
    askCloseShotPhoto: 'Kameraga yaqinroq fotosurat yuboring:',
    askFullBodyPhoto: 'To‘liq bo‘y fotosuratini yuboring:',
    askLeftProfilePhoto: 'Chap profil fotosuratini yuboring:',
    askPortraitPhoto: 'Portret fotosurat yuboring:',
    askRightProfilePhoto: 'O‘ng profil fotosuratini yuboring:',
    askVideo:
      '90 sekundgacha (1:30) intro video yuboring. Ism, yosh, shahar, talantlarni ayting, keyin hissiyotlarni ko‘rsating: quvonch, jahldorlik, xafa bo‘lish, hayrat, hayajon va qo‘rquv.',
    askWeight: 'Vazn:',
    badAge: 'Yosh faqat raqam bo‘lishi kerak va 130 dan oshmasligi kerak.',
    badHeight: 'Bo‘y faqat raqam bo‘lishi kerak va 250 dan oshmasligi kerak.',
    badName: 'Ism faqat harflar va bo‘sh joylardan iborat bo‘lishi kerak. Masalan: Abdukarim Salomov',
    badPhone: 'Telefon tugmasidan foydalaning yoki to‘g‘ri raqam yuboring.',
    badPhoto: 'Fotosurat yuboring.',
    badVideo: '90 sekundgacha (1:30) video yuboring.',
    badWeight: 'Vazn faqat raqam bo‘lishi kerak.',
    cancel: 'Ro‘yxatdan o‘tish bekor qilindi. Qayta boshlash uchun /start yuboring.',
    castingList: 'Aktual kastinglar:',
    currentValue: 'Joriy qiymat',
    duplicatePhone: 'Bu telefon raqami bazada bor. Boshqa raqam yuboring yoki /cancel.',
    edit: 'Tahrirlash',
    editPrompt: 'Qaysi bo‘limni o‘zgartirasiz?',
    examplePhoto: 'Foto namunasi',
    keepCurrent: 'Joriyni qoldirish',
    menuCastings: '🎬 Joriy loyihalar',
    menuFriend: '👥 Do‘stni ro‘yxatdan o‘tkazish',
    menuProfile: '👤 Mening joriy profilim',
    menuText: 'Harakatni tanlang:',
    menuUpdate: '✏️ Profilni yangilash',
    minOne: 'Kamida bitta variant tanlang.',
    next: 'Keyingi',
    noCastings: 'Hozircha aktual kastinglar yo‘q.',
    noProfile: 'Hali topshirilgan profil topilmadi. Avval ro‘yxatdan o‘ting.',
    none: 'Yo‘q',
    other: 'Boshqa',
    phoneButton: '📱 Telefon raqamni yuborish',
    profile: '👤 Profil kartasi',
    proxyApproved:
      'Do‘stingiz uchun yuborgan anketa FACE Production ichki talentlar bazasi uchun tasdiqlandi.',
    proxyRejected:
      'Do‘stingiz uchun yuborgan anketa ko‘rib chiqildi va bu bosqichda tasdiqlanmadi.',
    registerFriend: 'Do‘stni ro‘yxatdan o‘tkazish',
    registerSelf: 'O‘zimni ro‘yxatdan o‘tkazish',
    reviewActions: 'Kartani tekshiring. U adminga faqat siz tasdiqlagandan keyin yuboriladi:',
    savedAfterEdit: 'Yangilangan karta adminga yuborildi.',
    selectDone: 'Variantlarni tanlang, keyin Keyingi tugmasini bosing.',
    sendCustom: 'O‘zingizning variantingizni yozing:',
    start:
      'Welcome to our Telegram bot.\nДобро пожаловать в наш Telegram-бот.\nTelegram botimizga xush kelibsiz.',
    unknownAdmin: 'Noma’lum admin buyrug‘i. /help yuboring.',
    whoami: 'Sizning Telegram ID',
  },
}

const languageOptions = [
  { code: 'ru', label: '🇷🇺 Русский' },
  { code: 'en', label: '🇬🇧 English' },
  { code: 'uz', label: '🇺🇿 O‘zbek' },
]

const cityOptions = [
  { code: 'tashkent_city', en: 'Tashkent city', ru: 'Ташкент', uz: 'Toshkent shahri' },
  { code: 'tashkent_region', en: 'Tashkent region', ru: 'Ташкентская область', uz: 'Toshkent viloyati' },
  { code: 'andijan', en: 'Andijan', ru: 'Андижан', uz: 'Andijon' },
  { code: 'bukhara', en: 'Bukhara', ru: 'Бухара', uz: 'Buxoro' },
  { code: 'fergana', en: 'Fergana', ru: 'Фергана', uz: 'Farg‘ona' },
  { code: 'jizzakh', en: 'Jizzakh', ru: 'Джизак', uz: 'Jizzax' },
  { code: 'namangan', en: 'Namangan', ru: 'Наманган', uz: 'Namangan' },
  { code: 'navoiy', en: 'Navoiy', ru: 'Навои', uz: 'Navoiy' },
  { code: 'kashkadarya', en: 'Kashkadarya', ru: 'Кашкадарья', uz: 'Qashqadaryo' },
  { code: 'samarkand', en: 'Samarkand', ru: 'Самарканд', uz: 'Samarqand' },
  { code: 'sirdarya', en: 'Sirdarya', ru: 'Сырдарья', uz: 'Sirdaryo' },
  { code: 'surkhandarya', en: 'Surkhandarya', ru: 'Сурхандарья', uz: 'Surxondaryo' },
  { code: 'khorezm', en: 'Khorezm', ru: 'Хорезм', uz: 'Xorazm' },
  { code: 'karakalpakstan', en: 'Karakalpakstan', ru: 'Каракалпакстан', uz: 'Qoraqalpog‘iston' },
]

const genderOptions = [
  { code: 'male', en: 'Male', ru: 'Мужской', uz: 'Erkak' },
  { code: 'female', en: 'Female', ru: 'Женский', uz: 'Ayol' },
]

const multiGroups = {
  performance: {
    field: 'performanceTalents',
    options: talentTaxonomy.performance,
  },
  sports: {
    field: 'sportsTalents',
    options: talentTaxonomy.sports,
  },
  physical: {
    field: 'physicalSkills',
    options: talentTaxonomy.physical,
  },
  languages: {
    field: 'languageSkills',
    required: true,
    options: talentTaxonomy.languages,
  },
  look: {
    field: 'appearance',
    required: true,
    options: talentTaxonomy.appearance,
  },
}

const stepOrder = [
  'name',
  'phone',
  'age',
  'city',
  'gender',
  'height',
  'weight',
  'performance',
  'sports',
  'physical',
  'languages',
  'look',
  'fullBodyPhoto',
  'closeShotPhoto',
  'leftProfilePhoto',
  'rightProfilePhoto',
  'portraitPhoto',
  'video',
]

const editSections = [
  { code: 'name', en: 'Full name', ru: 'Полное имя', uz: 'To‘liq ism' },
  { code: 'phone', en: 'Phone number', ru: 'Телефон', uz: 'Telefon' },
  { code: 'age', en: 'Age', ru: 'Возраст', uz: 'Yosh' },
  { code: 'city', en: 'City', ru: 'Город', uz: 'Shahar' },
  { code: 'gender', en: 'Gender', ru: 'Пол', uz: 'Jins' },
  { code: 'height', en: 'Height', ru: 'Рост', uz: 'Bo‘y' },
  { code: 'weight', en: 'Weight', ru: 'Вес', uz: 'Vazn' },
  { code: 'performance', en: 'Performance talents', ru: 'Сценические таланты', uz: 'Sahna talantlari' },
  { code: 'sports', en: 'Sports talents', ru: 'Спортивные таланты', uz: 'Sport talantlari' },
  { code: 'physical', en: 'Physical skills', ru: 'Физические навыки', uz: 'Jismoniy ko‘nikmalar' },
  { code: 'languages', en: 'Languages', ru: 'Языки', uz: 'Tillar' },
  { code: 'look', en: 'Ethnicity / look', ru: 'Внешность', uz: 'Ko‘rinish' },
  { code: 'fullBodyPhoto', en: 'Full-body photo', ru: 'Фото в полный рост', uz: 'To‘liq bo‘y foto' },
  { code: 'closeShotPhoto', en: 'Closer shot', ru: 'Фото ближе к камере', uz: 'Yaqinroq foto' },
  { code: 'leftProfilePhoto', en: 'Left profile side', ru: 'Левый профиль', uz: 'Chap profil' },
  { code: 'rightProfilePhoto', en: 'Right profile side', ru: 'Правый профиль', uz: 'O‘ng profil' },
  { code: 'portraitPhoto', en: 'Portrait photo', ru: 'Портретное фото', uz: 'Portret foto' },
  { code: 'video', en: 'Video', ru: 'Видео', uz: 'Video' },
]

const stepIcons = {
  age: '🎂',
  city: '📍',
  gender: '⚧️',
  height: '📏',
  languages: '🗣️',
  look: '✨',
  name: '👤',
  performance: '🎭',
  phone: '📱',
  closeShotPhoto: '🔎',
  fullBodyPhoto: '🧍',
  leftProfilePhoto: '↙️',
  portraitPhoto: '🖼️',
  physical: '🤸',
  rightProfilePhoto: '↘️',
  sports: '🏅',
  video: '🎬',
  weight: '⚖️',
}

const photoSteps = {
  closeShotPhoto: {
    askKey: 'askCloseShotPhoto',
    fileIdField: 'closeShotPhotoFileId',
    pathField: 'closeShotPhotoPath',
  },
  fullBodyPhoto: {
    askKey: 'askFullBodyPhoto',
    fileIdField: 'fullBodyPhotoFileId',
    pathField: 'fullBodyPhotoPath',
  },
  leftProfilePhoto: {
    askKey: 'askLeftProfilePhoto',
    fileIdField: 'leftProfilePhotoFileId',
    pathField: 'leftProfilePhotoPath',
  },
  portraitPhoto: {
    askKey: 'askPortraitPhoto',
    fileIdField: 'portraitPhotoFileId',
    pathField: 'portraitPhotoPath',
  },
  rightProfilePhoto: {
    askKey: 'askRightProfilePhoto',
    fileIdField: 'rightProfilePhotoFileId',
    pathField: 'rightProfilePhotoPath',
  },
}

async function call(method, payload = {}) {
  const response = await fetch(`${apiBase}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json()

  if (!response.ok || !data.ok) {
    throw new Error(data.description ?? `${method} failed`)
  }

  return data.result
}

async function hydrateSession(userId) {
  if (sessions.has(userId)) {
    return
  }

  const stored = await getBotSession(userId)
  if (stored) {
    sessions.set(userId, stored)
  }
}

async function persistSession(userId) {
  if (sessions.has(userId)) {
    await saveBotSession(userId, sessions.get(userId))
    return
  }

  await deleteBotSession(userId)
}

async function send(chatId, messageText, options = {}) {
  return call('sendMessage', {
    chat_id: chatId,
    disable_web_page_preview: true,
    text: messageText,
    ...options,
  })
}

async function uploadFile(method, fields, fileField, filePath) {
  const form = new FormData()

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) {
      form.append(key, String(value))
    }
  }

  const file = await readMediaReference(filePath)
  const fileName = filePath.split('/').at(-1) ?? 'media'
  form.append(fileField, new Blob([file]), fileName)

  const response = await fetch(`${apiBase}/${method}`, {
    body: form,
    method: 'POST',
  })
  const data = await response.json()

  if (!response.ok || !data.ok) {
    throw new Error(data.description ?? `${method} failed`)
  }

  return data.result
}

async function sendLocalPhoto(chatId, filePath, caption) {
  const cachedFileId = exampleFileIdCache.get(filePath)
  if (cachedFileId) {
    return call('sendPhoto', { chat_id: chatId, photo: cachedFileId, caption })
  }
  const result = await uploadFile(
    'sendPhoto',
    {
      caption,
      chat_id: chatId,
    },
    'photo',
    filePath,
  )
  const fileId = result.photo.at(-1).file_id
  exampleFileIdCache.set(filePath, fileId)
  return result
}

async function sendLocalVideo(chatId, filePath, caption) {
  const cachedFileId = exampleFileIdCache.get(filePath)
  if (cachedFileId) {
    return call('sendVideo', { chat_id: chatId, video: cachedFileId, caption, supports_streaming: true })
  }
  const result = await uploadFile(
    'sendVideo',
    {
      caption,
      chat_id: chatId,
      supports_streaming: true,
    },
    'video',
    filePath,
  )
  const fileId = result.video.file_id
  exampleFileIdCache.set(filePath, fileId)
  return result
}

async function sendLocalMediaGroup(chatId, mediaItems) {
  const form = new FormData()
  const media = []

  form.append('chat_id', String(chatId))

  for (const [index, item] of mediaItems.entries()) {
    const attachmentName = `media_${index}`
    const file = await readMediaReference(item.filePath)
    const fileName = item.filePath.split('/').at(-1) ?? attachmentName
    const mediaItem = {
      media: `attach://${attachmentName}`,
      type: item.type,
    }

    if (item.caption) {
      mediaItem.caption = item.caption
    }

    if (item.type === 'video') {
      mediaItem.supports_streaming = true
    }

    media.push(mediaItem)
    form.append(attachmentName, new Blob([file]), fileName)
  }

  form.append('media', JSON.stringify(media))

  const response = await fetch(`${apiBase}/sendMediaGroup`, {
    body: form,
    method: 'POST',
  })
  const data = await response.json()

  if (!response.ok || !data.ok) {
    throw new Error(data.description ?? 'sendMediaGroup failed')
  }

  return data.result
}

async function sendPrompt(session, messageText, options = {}) {
  const sent = await send(session.chatId, messageText, options)
  session.promptMessageIds ??= []
  session.promptMessageIds.push(sent.message_id)
  return sent
}

async function editMessage(chatId, messageId, messageText, options = {}) {
  return call('editMessageText', {
    chat_id: chatId,
    disable_web_page_preview: true,
    message_id: messageId,
    text: messageText,
    ...options,
  })
}

async function answerCallback(callbackQueryId, messageText) {
  const payload = {
    callback_query_id: callbackQueryId,
  }

  if (messageText) {
    payload.text = messageText
  }

  return call('answerCallbackQuery', payload)
}

async function safeDelete(chatId, messageId) {
  if (!chatId || !messageId) {
    return
  }

  try {
    await call('deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    })
  } catch (error) {
    console.warn('Telegram message cleanup skipped', { code: error?.code ?? error?.name ?? 'unknown' })
  }
}

async function cleanupStep(session, incomingMessage) {
  const messageIds = session.promptMessageIds ?? []
  for (const messageId of messageIds) {
    await safeDelete(session.chatId, messageId)
  }
  session.promptMessageIds = []
  session.multiMessageId = undefined

  if (incomingMessage?.message_id) {
    await safeDelete(incomingMessage.chat.id, incomingMessage.message_id)
  }
}

async function cleanupPreview(session) {
  const messageIds = session.previewMessageIds ?? []
  for (const messageId of messageIds) {
    await safeDelete(session.chatId, messageId)
  }
  session.previewMessageIds = []
}

function inlineKeyboard(rows) {
  return {
    reply_markup: {
      inline_keyboard: rows,
    },
  }
}

function currentCallbackMessageIds(session) {
  return new Set([
    ...(session.promptMessageIds ?? []),
    ...(session.previewMessageIds ?? []),
    session.multiMessageId,
  ].filter(Boolean))
}

async function ignoreStaleCallback(query, session) {
  const messageId = query.message?.message_id
  const currentIds = currentCallbackMessageIds(session)

  if (!messageId || currentIds.size === 0 || currentIds.has(messageId)) {
    return false
  }

  await answerCallback(query.id)
  return true
}

async function isStaleCallback(query, session, expectedStep) {
  if (expectedStep && session.step !== expectedStep) {
    await answerCallback(query.id)
    return true
  }

  return ignoreStaleCallback(query, session)
}

function contactKeyboard(lang) {
  return {
    reply_markup: {
      keyboard: [[{ request_contact: true, text: text[lang].phoneButton }]],
      one_time_keyboard: true,
      resize_keyboard: true,
    },
  }
}

function registrationModeKeyboard(lang) {
  const t = text[lang]
  return inlineKeyboard([
    [{ text: `🙋 ${t.registerSelf}`, callback_data: `mode:self:${lang}` }],
    [{ text: `👥 ${t.registerFriend}`, callback_data: `mode:friend:${lang}` }],
  ])
}

function userMenuKeyboard(lang) {
  return {
    reply_markup: {
      keyboard: [
        [text[lang].menuCastings],
        [text[lang].menuUpdate],
        [text[lang].menuProfile],
      ],
      is_persistent: true,
      resize_keyboard: true,
    },
  }
}

const candidateMenuKeyboard = userMenuKeyboard

function channelKeyboard(lang) {
  if (!telegramChannelUrl) {
    return userMenuKeyboard(lang)
  }

  return inlineKeyboard([[{ text: text[lang].menuCastings, url: telegramChannelUrl }]])
}

function removeKeyboard() {
  return {
    reply_markup: {
      remove_keyboard: true,
    },
  }
}

function progress(step) {
  const index = Math.max(1, stepOrder.indexOf(step) + 1)
  const percent = Math.round((index / totalProgressSteps) * 100)
  const filled = Math.round(percent / 10)
  const icon = stepIcons[step] ?? '📝'
  return `${icon} ${'🟩'.repeat(filled)}${'⬜'.repeat(10 - filled)} ${percent}%`
}

function promptText(lang, step, body) {
  return `${progress(step)}\n\n${body}`
}

function optionLabel(option, lang) {
  return option[lang] ?? option.en ?? option.label
}

function genderCodeForData(data) {
  if (data?.genderCode === 'female' || data?.genderCode === 'male') {
    return data.genderCode
  }

  const gender = String(data?.gender ?? '').trim().toLowerCase()
  const femaleLabels = genderOptions
    .filter((option) => option.code === 'female')
    .flatMap((option) => [option.en, option.ru, option.uz])
    .map((value) => String(value).trim().toLowerCase())

  return femaleLabels.includes(gender) ? 'female' : 'male'
}

function exampleMediaPath(session, kind) {
  const genderCode = genderCodeForData(session.data)
  return exampleMediaPaths[genderCode]?.[kind] ?? exampleMediaPaths.male[kind] ?? null
}

async function videoExamplePath(session) {
  const preferredPath = exampleMediaPath(session, 'introVideo')

  if (preferredPath == null) {
    return exampleMediaPaths.fallbackIntroVideo
  }

  if (preferredPath.startsWith('s3://')) {
    return preferredPath
  }

  try {
    const info = await stat(preferredPath)
    if (info.size <= telegramExampleVideoMaxBytes) {
      return preferredPath
    }

    console.info('Telegram video example exceeded the size limit; using fallback')
  } catch (error) {
    console.warn('Telegram video example unavailable; using fallback', { code: error?.code ?? error?.name ?? 'unknown' })
  }

  return exampleMediaPaths.fallbackIntroVideo
}

function chunk(items, size) {
  const rows = []
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size))
  }
  return rows
}

function commandOf(messageText) {
  return String(messageText ?? '').trim().split(/\s+/)[0].toLowerCase()
}

function languageForCandidate(candidate, fallback = 'ru') {
  return candidate?.language && text[candidate.language] ? candidate.language : fallback
}

function matchesMenuAction(messageText, key) {
  const value = String(messageText ?? '').trim()
  return Object.values(text).some((translation) => translation[key] === value)
}

function newSession(chatId, from, lang, existing, options = {}) {
  const proxy = options.proxy === true
  const baseData = proxy
    ? {
        source: 'telegram_proxy',
        submissionMode: 'friend',
        submittedByTelegramChatId: chatId,
        submittedByTelegramFirstName: from.first_name,
        submittedByTelegramUserId: String(from.id),
        submittedByTelegramUsername: from.username,
      }
    : {
        telegramChatId: chatId,
        telegramFirstName: from.first_name,
        telegramUserId: String(from.id),
        telegramUsername: from.username,
        ...(existing ?? {}),
      }

  return {
    chatId,
    data: baseData,
    editing: false,
    lang,
    proxy,
    replacingCandidateId: proxy ? undefined : existing?.id,
    step: 'name',
  }
}

function selectedSet(session, groupName) {
  const field = multiGroups[groupName].field
  session.data[field] ??= []
  return session.data[field]
}

function findMultiLabel(groupName, code, lang) {
  const option = multiGroups[groupName].options.find((item) => item.code === code)
  return option ? optionLabel(option, lang) : code
}

function isValidName(value) {
  return /^[\p{L} ]{2,80}$/u.test(String(value ?? '').trim())
}

function isDigits(value) {
  return /^\d+$/.test(String(value ?? '').trim())
}

function isValidPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15
}

function getPhone(message, from, options = {}) {
  if (message.contact?.phone_number) {
    if (!options.allowSharedContact && message.contact.user_id && String(message.contact.user_id) !== String(from.id)) {
      return undefined
    }

    return message.contact.phone_number
  }

  const raw = String(message.text ?? '').trim()
  return isValidPhone(raw) ? raw : undefined
}

function nextStepAfter(step) {
  return stepOrder[stepOrder.indexOf(step) + 1] ?? 'preview'
}

function allTalents(data) {
  return [
    ...(data.performanceTalents ?? []),
    ...(data.sportsTalents ?? []),
    ...(data.physicalSkills ?? []),
  ]
}

function listValue(value) {
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '-'
  }

  return value || '-'
}

function stepCurrentValue(data, step, lang) {
  if (step === 'performance') return listTalentValue(data.performanceTalents, lang)
  if (step === 'sports') return listTalentValue(data.sportsTalents, lang)
  if (step === 'physical') return listTalentValue(data.physicalSkills, lang)
  if (step === 'languages') return listTalentValue(data.languageSkills, lang)
  if (step === 'look') return listTalentValue(data.appearance, lang)
  if (step === 'fullBodyPhoto') return data.fullBodyPhotoPath ? uploadedLabel(lang) : ''
  if (step === 'closeShotPhoto') return data.closeShotPhotoPath ? uploadedLabel(lang) : ''
  if (step === 'leftProfilePhoto') return data.leftProfilePhotoPath ? uploadedLabel(lang) : ''
  if (step === 'rightProfilePhoto') return data.rightProfilePhotoPath ? uploadedLabel(lang) : ''
  if (step === 'portraitPhoto') return data.portraitPhotoPath ? uploadedLabel(lang) : ''
  if (step === 'video') return data.introVideoPath ? uploadedLabel(lang) : ''
  return data[step] ?? ''
}

function keepCurrentKeyboard(lang, step) {
  return inlineKeyboard([[{ text: `↩️ ${text[lang].keepCurrent}`, callback_data: `keep:${step}` }]])
}

function withCurrentValue(session, step, body) {
  const current = stepCurrentValue(session.data, step, session.lang)

  if (!session.replacingCandidateId || !current || current === '-') {
    return body
  }

  return `${body}\n\n${text[session.lang].currentValue}: ${current}`
}

function listTalentValue(value, lang) {
  if (!Array.isArray(value)) {
    return value || '-'
  }

  return value.length ? value.map((item) => talentLabel(item, lang)).join(', ') : '-'
}

function uploadedLabel(lang) {
  return {
    en: 'uploaded',
    ru: 'загружено',
    uz: 'yuklandi',
  }[lang]
}

function clipTelegramCaption(value) {
  const textValue = String(value)
  const maxLength = 1000

  if (textValue.length <= maxLength) {
    return textValue
  }

  return `${textValue.slice(0, maxLength - 1)}…`
}

function profileCard(data, lang) {
  const t = text[lang]
  const labels = {
    en: {
      age: 'Age',
      city: 'City',
      gender: 'Gender',
      height: 'Height',
      languages: 'Languages',
      look: 'Ethnicity / look',
      name: 'Full name',
      performance: 'Performance talents',
      phone: 'Phone number',
      fullBodyPhoto: 'Full-body photo',
      closeShotPhoto: 'Closer shot',
      leftProfilePhoto: 'Left profile side',
      physical: 'Physical skills',
      portraitPhoto: 'Portrait photo',
      rightProfilePhoto: 'Right profile side',
      sports: 'Sports talents',
      submittedBy: 'Submitted by',
      submissionMode: 'Submission',
      video: 'Video',
      weight: 'Weight',
    },
    ru: {
      age: 'Возраст',
      city: 'Город',
      gender: 'Пол',
      height: 'Рост',
      languages: 'Языки',
      look: 'Внешность',
      name: 'Полное имя',
      performance: 'Сценические таланты',
      phone: 'Телефон',
      fullBodyPhoto: 'Фото в полный рост',
      closeShotPhoto: 'Фото ближе',
      leftProfilePhoto: 'Левый профиль',
      physical: 'Физические навыки',
      portraitPhoto: 'Портретное фото',
      rightProfilePhoto: 'Правый профиль',
      sports: 'Спортивные таланты',
      submittedBy: 'Заполнил',
      submissionMode: 'Тип анкеты',
      video: 'Видео',
      weight: 'Вес',
    },
    uz: {
      age: 'Yosh',
      city: 'Shahar',
      gender: 'Jins',
      height: 'Bo‘y',
      languages: 'Tillar',
      look: 'Ko‘rinish',
      name: 'To‘liq ism',
      performance: 'Sahna talantlari',
      phone: 'Telefon',
      fullBodyPhoto: 'To‘liq bo‘y foto',
      closeShotPhoto: 'Yaqinroq foto',
      leftProfilePhoto: 'Chap profil',
      physical: 'Jismoniy ko‘nikmalar',
      portraitPhoto: 'Portret foto',
      rightProfilePhoto: 'O‘ng profil',
      sports: 'Sport talantlari',
      submittedBy: 'To‘ldirgan',
      submissionMode: 'Anketa turi',
      video: 'Video',
      weight: 'Vazn',
    },
  }[lang]
  return [
    `${t.profile}`,
    '',
    `👤 ${labels.name}: ${data.name ?? '-'}`,
    `📱 ${labels.phone}: ${data.phone ?? '-'}`,
    `🎂 ${labels.age}: ${data.age ?? '-'}`,
    `📍 ${labels.city}: ${data.city ?? '-'}`,
    `⚧️ ${labels.gender}: ${data.gender ?? '-'}`,
    `📏 ${labels.height}: ${data.height ?? '-'}`,
    `⚖️ ${labels.weight}: ${data.weight ?? '-'}`,
    `🎭 ${labels.performance}: ${listTalentValue(data.performanceTalents, lang)}`,
    `🏅 ${labels.sports}: ${listTalentValue(data.sportsTalents, lang)}`,
    `🤸 ${labels.physical}: ${listTalentValue(data.physicalSkills, lang)}`,
    `🗣️ ${labels.languages}: ${listTalentValue(data.languageSkills, lang)}`,
    `✨ ${labels.look}: ${listTalentValue(data.appearance, lang)}`,
    `🧍 ${labels.fullBodyPhoto}: ${data.fullBodyPhotoPath ? uploadedLabel(lang) : '-'}`,
    `🔎 ${labels.closeShotPhoto}: ${data.closeShotPhotoPath ? uploadedLabel(lang) : '-'}`,
    `↙️ ${labels.leftProfilePhoto}: ${data.leftProfilePhotoPath ? uploadedLabel(lang) : '-'}`,
    `↘️ ${labels.rightProfilePhoto}: ${data.rightProfilePhotoPath ? uploadedLabel(lang) : '-'}`,
    `🖼️ ${labels.portraitPhoto}: ${data.portraitPhotoPath ? uploadedLabel(lang) : '-'}`,
    `🎬 ${labels.video}: ${data.introVideoPath ? uploadedLabel(lang) : '-'}`,
    data.submissionMode === 'friend' ? `👥 ${labels.submissionMode}: ${text[lang].registerFriend}` : '',
    data.submissionMode === 'friend'
      ? `🧾 ${labels.submittedBy}: ${data.submittedByTelegramUsername ? `@${data.submittedByTelegramUsername}` : data.submittedByTelegramFirstName ?? data.submittedByTelegramUserId ?? '-'}`
      : '',
  ].filter(Boolean).join('\n')
}

function reviewMediaItems(data, caption) {
  const items = []

  if (data.fullBodyPhotoPath) {
    items.push({ caption: items.length === 0 ? caption : undefined, filePath: data.fullBodyPhotoPath, type: 'photo' })
  }

  if (data.closeShotPhotoPath) {
    items.push({ caption: items.length === 0 ? caption : undefined, filePath: data.closeShotPhotoPath, type: 'photo' })
  }

  if (data.leftProfilePhotoPath) {
    items.push({ caption: items.length === 0 ? caption : undefined, filePath: data.leftProfilePhotoPath, type: 'photo' })
  }

  if (data.rightProfilePhotoPath) {
    items.push({ caption: items.length === 0 ? caption : undefined, filePath: data.rightProfilePhotoPath, type: 'photo' })
  }

  if (data.portraitPhotoPath) {
    items.push({ caption: items.length === 0 ? caption : undefined, filePath: data.portraitPhotoPath, type: 'photo' })
  }

  if (data.introVideoPath) {
    items.push({ caption: items.length === 0 ? caption : undefined, filePath: data.introVideoPath, type: 'video' })
  }

  return items
}

async function sendReviewAlbum(chatId, data, lang) {
  const caption = clipTelegramCaption(profileCard(data, lang))
  const mediaItems = reviewMediaItems(data, caption)

  if (mediaItems.length >= 2) {
    return sendLocalMediaGroup(chatId, mediaItems)
  }

  if (mediaItems.length === 1) {
    const [item] = mediaItems
    const sent = item.type === 'video'
      ? await sendLocalVideo(chatId, item.filePath, caption)
      : await sendLocalPhoto(chatId, item.filePath, caption)
    return [sent]
  }

  return [await send(chatId, caption)]
}

async function sendPhotoStepPrompt(session, step) {
  const lang = session.lang
  const t = text[lang]
  const examplePath = exampleMediaPath(session, step)

  if (examplePath) {
    try {
      const example = await sendLocalPhoto(session.chatId, examplePath, `📌 ${t.examplePhoto}`)
      session.promptMessageIds ??= []
      session.promptMessageIds.push(example.message_id)
    } catch (error) {
      console.warn('Telegram photo example send failed', { code: error?.code ?? error?.name ?? 'unknown' })
    }
  }

  const current = stepCurrentValue(session.data, step, lang)
  await sendPrompt(
    session,
    promptText(lang, step, withCurrentValue(session, step, t[photoSteps[step].askKey])),
    current ? keepCurrentKeyboard(lang, step) : removeKeyboard(),
  )
}

async function sendVideoStepPrompt(session) {
  const lang = session.lang
  const t = text[lang]
  const examplePath = await videoExamplePath(session)

  if (examplePath) {
    try {
      const example = await sendLocalVideo(session.chatId, examplePath, `📌 ${t.examplePhoto}`)
      session.promptMessageIds ??= []
      session.promptMessageIds.push(example.message_id)
    } catch (error) {
      console.warn('Telegram video example send failed', { code: error?.code ?? error?.name ?? 'unknown' })
    }
  }

  const current = stepCurrentValue(session.data, 'video', lang)
  await sendPrompt(
    session,
    promptText(lang, 'video', withCurrentValue(session, 'video', t.askVideo)),
    current ? keepCurrentKeyboard(lang, 'video') : removeKeyboard(),
  )
}

function profileActions(lang, token) {
  const t = text[lang]
  return inlineKeyboard([
    [{ text: `✅ ${t.approveProfile}`, callback_data: `form:approve:${token}` }],
    [{ text: `✏️ ${t.edit}`, callback_data: `form:edit:${token}` }],
  ])
}

function adminDecisionKeyboard(candidateId) {
  const t = text.ru
  return inlineKeyboard([
    [
      { text: `✅ ${t.adminApproveButton}`, callback_data: `admin:approve:${candidateId}` },
      { text: `🚫 ${t.adminRejectButton}`, callback_data: `admin:reject:${candidateId}` },
    ],
  ])
}

function editKeyboard(lang) {
  return inlineKeyboard(
    chunk(
      editSections.map((section) => ({
        text: `✏️ ${optionLabel(section, lang)}`,
        callback_data: `edit:${section.code}`,
      })),
      2,
    ),
  )
}

function multiKeyboard(session, groupName) {
  const lang = session.lang
  const t = text[lang]
  const selected = selectedSet(session, groupName)
  const options = multiGroups[groupName].options.map((option) => {
    const label = optionLabel(option, lang)
    const prefix = selected.includes(option.code) ? '✅ ' : '▫️ '
    return { text: `${prefix}${label}`, callback_data: `toggle:${groupName}:${option.code}` }
  })
  const rows = chunk(options, 2)
  const utilityRow = [{ text: `✍️ ${t.other}`, callback_data: `other:${groupName}` }]
  if (!multiGroups[groupName].required) {
    utilityRow.push({ text: `🚫 ${t.none}`, callback_data: `none:${groupName}` })
  }
  rows.push(utilityRow)
  rows.push([{ text: `➡️ ${t.next}`, callback_data: `next:${groupName}` }])
  return inlineKeyboard(rows)
}

async function askLanguage(chatId) {
  await Promise.all([
    send(
      chatId,
      `${text.en.start}\n\n${text.en.askLanguage}`,
      inlineKeyboard([languageOptions.map((option) => ({ text: option.label, callback_data: `lang:${option.code}` }))]),
    ),
    send(chatId, text.ru.menuText, userMenuKeyboard('ru')),
  ])
}

async function askRegistrationMode(chatId, lang) {
  await send(chatId, text[lang].askMode, registrationModeKeyboard(lang))
}

async function askStep(session) {
  const lang = session.lang
  const t = text[lang]
  const chatId = session.chatId
  const step = session.step

  if (step === 'name') {
    const current = stepCurrentValue(session.data, step, lang)
    await sendPrompt(
      session,
      promptText(lang, step, withCurrentValue(session, step, `${t.askName}\nAbdukarim Salomov`)),
      current ? keepCurrentKeyboard(lang, step) : removeKeyboard(),
    )
    return
  }

  if (step === 'phone') {
    const current = stepCurrentValue(session.data, step, lang)
    await sendPrompt(
      session,
      promptText(lang, step, withCurrentValue(session, step, t.askPhone)),
      current ? keepCurrentKeyboard(lang, step) : session.proxy ? removeKeyboard() : contactKeyboard(lang),
    )
    return
  }

  if (step === 'age') {
    const current = stepCurrentValue(session.data, step, lang)
    await sendPrompt(session, promptText(lang, step, withCurrentValue(session, step, t.askAge)), current ? keepCurrentKeyboard(lang, step) : removeKeyboard())
    return
  }

  if (step === 'city') {
    const buttons = cityOptions.map((option) => ({ text: `📍 ${optionLabel(option, lang)}`, callback_data: `set:city:${option.code}` }))
    if (stepCurrentValue(session.data, step, lang)) {
      buttons.push({ text: `↩️ ${t.keepCurrent}`, callback_data: `keep:${step}` })
    }
    await sendPrompt(session, promptText(lang, step, t.askCity), inlineKeyboard(chunk(buttons, 2)))
    return
  }

  if (step === 'gender') {
    const buttons = genderOptions.map((option) => ({
      text: `${option.code === 'male' ? '👨' : '👩'} ${optionLabel(option, lang)}`,
      callback_data: `set:gender:${option.code}`,
    }))
    if (stepCurrentValue(session.data, step, lang)) {
      buttons.push({ text: `↩️ ${t.keepCurrent}`, callback_data: `keep:${step}` })
    }
    await sendPrompt(session, promptText(lang, step, t.askGender), inlineKeyboard([buttons]))
    return
  }

  if (step === 'height') {
    const current = stepCurrentValue(session.data, step, lang)
    await sendPrompt(session, promptText(lang, step, withCurrentValue(session, step, t.askHeight)), current ? keepCurrentKeyboard(lang, step) : removeKeyboard())
    return
  }

  if (step === 'weight') {
    const current = stepCurrentValue(session.data, step, lang)
    await sendPrompt(session, promptText(lang, step, withCurrentValue(session, step, t.askWeight)), current ? keepCurrentKeyboard(lang, step) : removeKeyboard())
    return
  }

  if (['performance', 'sports', 'physical', 'languages', 'look'].includes(step)) {
    const title = {
      languages: t.askLanguages,
      look: t.askLook,
      performance: t.askPerformance,
      physical: t.askPhysical,
      sports: t.askSports,
    }[step]
    const sent = await sendPrompt(session, promptText(lang, step, `${title}\n${t.selectDone}`), multiKeyboard(session, step))
    session.multiMessageId = sent.message_id
    return
  }

  if (photoSteps[step]) {
    await sendPhotoStepPrompt(session, step)
    return
  }

  if (step === 'video') {
    await sendVideoStepPrompt(session)
  }
}

async function showProfile(session) {
  session.step = 'preview'
  session.awaitingUserApproval = true
  session.previewToken = randomUUID().slice(0, 12)
  await cleanupPreview(session)

  session.previewMessageIds = []
  try {
    const albumMessages = await sendReviewAlbum(session.chatId, session.data, session.lang)
    session.previewMessageIds.push(...albumMessages.map((message) => message.message_id))
  } catch (error) {
    console.warn('Telegram user preview media failed', { code: error?.code ?? error?.name ?? 'unknown' })
    const fallback = await send(session.chatId, profileCard(session.data, session.lang))
    session.previewMessageIds.push(fallback.message_id)
  }

  const consentNotice = session.proxy
    ? '\n\nBy submitting, you confirm you are authorized to share this person\'s data. Their consent must be verified before any use or contact.'
    : Number(session.data.age) < 18
      ? '\n\nA parent or guardian must be verified by FACE Production before this minor\'s data can be used.'
      : ''
  const card = await send(session.chatId, `${text[session.lang].reviewActions}${consentNotice}`, profileActions(session.lang, session.previewToken))
  session.previewMessageIds.push(card.message_id)
}

function castingCard(casting) {
  return [
    `🎬 ${casting.title}`,
    '',
    casting.body,
    casting.startsAt ? `\n📅 ${new Date(casting.startsAt).toLocaleString('ru-RU')}` : '',
    casting.endsAt ? `⏱ ${new Date(casting.endsAt).toLocaleString('ru-RU')}` : '',
  ].filter(Boolean).join('\n')
}

async function sendCurrentCastings(chatId, candidate, lang) {
  const castings = await listActiveCastingsForCandidate(candidate)
  const channelAccess = telegramChannelUrl
    ? `\n\n${lang === 'ru' ? 'Открыть канал проектов:' : lang === 'uz' ? 'Loyihalar kanalini oching:' : 'Open project channel:'}`
    : ''

  if (!castings.length) {
    await send(chatId, `${text[lang].noCastings}${channelAccess}`, channelKeyboard(lang))
    return
  }

  await send(chatId, `${text[lang].castingList}\n\n${castings.map(castingCard).join('\n\n────────\n\n')}${channelAccess}`, channelKeyboard(lang))
}

async function sendCurrentProfile(chatId, candidate, lang) {
  try {
    await sendReviewAlbum(chatId, candidate, lang)
  } catch (error) {
    console.warn('Telegram current profile media failed', { code: error?.code ?? error?.name ?? 'unknown' })
    await send(chatId, profileCard(candidate, lang), userMenuKeyboard(lang))
    return
  }

  await send(chatId, text[lang].menuText, userMenuKeyboard(lang))
}

async function showCandidateMenu(chatId, candidate, lang) {
  await send(
    chatId,
    `${text[lang].profile}\n${candidate.name ?? candidate.id}\n\n${text[lang].menuText}`,
    candidateMenuKeyboard(lang),
  )
}

async function startForm(chatId, from, lang, options = {}) {
  const proxy = options.proxy === true
  const existing = proxy ? undefined : await findCandidateByTelegramId(from.id)
  const session = newSession(chatId, from, lang, existing, { proxy })
  sessions.set(String(from.id), session)

  if (!proxy && existing?.id && !options.forceUpdate) {
    sessions.delete(String(from.id))
    await showCandidateMenu(chatId, existing, lang)
    return
  }

  await askStep(session)
}

async function storeVideo(message) {
  const video = message.video
  if (!video || video.duration > 90) {
    return undefined
  }

  const file = await call('getFile', { file_id: video.file_id })
  const saved = await saveTelegramFile({
    filePath: file.file_path,
    fileUniqueId: video.file_unique_id,
    folder: 'videos',
    token,
  })

  return {
    duration: video.duration,
    fileId: video.file_id,
    path: saved.storagePath ?? saved.localPath,
  }
}

function largestPhoto(message) {
  const photos = message.photo ?? []
  return photos.at(-1)
}

async function storePhoto(message) {
  const photo = largestPhoto(message)
  if (!photo) {
    return undefined
  }

  const file = await call('getFile', { file_id: photo.file_id })
  const saved = await saveTelegramFile({
    filePath: file.file_path,
    fileUniqueId: photo.file_unique_id,
    folder: 'photos',
    token,
  })

  return {
    fileId: photo.file_id,
    path: saved.storagePath ?? saved.localPath,
  }
}

async function saveProfile(session) {
  if (!session.awaitingUserApproval || session.step !== 'preview') {
    throw new Error('User approval is required before admin notification')
  }

  const isMinor = Number(session.data.age) < 18
  const consent = session.proxy
    ? 'proxy_submitter_confirmed_pending_candidate_consent'
    : isMinor
      ? 'minor_pending_guardian_verification'
      : 'candidate_confirmed'
  const guardianConsent = isMinor
    ? 'requires_manual_guardian_verification'
    : 'not_required'

  const candidatePayload = {
    ...session.data,
    availability: '',
    consent,
    experience: '',
    guardianConsent,
    language: session.lang,
    role: 'Кандидат',
    skills: allTalents(session.data).join(', '),
    source: session.proxy ? 'telegram_proxy' : session.data.source ?? 'telegram',
    submissionMode: session.proxy ? 'friend' : session.data.submissionMode ?? 'self',
    submitterConsentConfirmedAt: new Date().toISOString(),
  }
  const saved = session.replacingCandidateId
    ? await replaceCandidateIntake(session.replacingCandidateId, candidatePayload)
    : await createCandidateIntake(candidatePayload)

  if (!saved) {
    throw new Error('Candidate save failed')
  }

  session.data = saved
  session.replacingCandidateId = saved.id
  session.awaitingUserApproval = false
  await notifyAdmin(saved)
  return saved
}

async function notifyAdmin(candidate) {
  if (!adminId) return

  try {
    await sendReviewAlbum(adminId, candidate, 'ru')
    const decisionMessage = await send(adminId, `ID: ${candidate.id}`, adminDecisionKeyboard(candidate.id))
    await updateCandidateMetadata(candidate.id, {
      adminDecisionChatId: decisionMessage.chat.id,
      adminDecisionMessageId: decisionMessage.message_id,
      adminDecisionMessageText: decisionMessage.text,
    })
  } catch (error) {
    console.warn('Telegram admin notification failed', { code: error?.code ?? error?.name ?? 'unknown' })
  }
}

async function handleAdminDecisionCallback(query) {
  if (!adminIds.includes(String(query.from.id))) {
    await answerCallback(query.id, 'Admin only')
    return
  }

  const [, action, candidateId] = query.data.split(':')
  const nextStatus = action === 'approve' ? 'approved' : 'rejected'
  const updated = await updateCandidateStatus(candidateId, nextStatus, String(query.from.id))
  const t = text.ru

  if (!updated) {
    await answerCallback(query.id, 'Кандидат не найден')
    await editMessage(
      query.message.chat.id,
      query.message.message_id,
      `${query.message.text}\n\n⚠️ Кандидат не найден. Запись была сброшена или уже удалена.`,
      { reply_markup: { inline_keyboard: [] } },
    )
    return
  }

  const resultText = nextStatus === 'approved' ? t.adminApproved : t.adminRejected
  await answerCallback(query.id, resultText)

  await recordAuditEvent({
    action: `telegram_admin.${nextStatus}`,
    actorTelegramId: String(query.from.id),
    candidateId,
    chatId: query.message.chat.id,
    outcome: 'updated',
  })

  if (updated.telegramChatId || updated.submittedByTelegramChatId) {
    const userLang = updated.language && text[updated.language] ? updated.language : 'ru'
    const message =
      nextStatus === 'approved'
        ? updated.submissionMode === 'friend'
          ? text[userLang].proxyApproved
          : {
              en: 'Your FACE Production profile was approved for the internal talent database.',
              ru: 'Ваш профиль FACE Production одобрен для внутренней базы талантов.',
              uz: 'FACE Production profilingiz ichki talentlar bazasi uchun tasdiqlandi.',
            }[userLang]
        : updated.submissionMode === 'friend'
          ? text[userLang].proxyRejected
          : {
              en: 'Your FACE Production registration was reviewed and not approved at this stage.',
              ru: 'Ваша заявка FACE Production рассмотрена и не одобрена на этом этапе.',
              uz: 'FACE Production arizangiz ko‘rib chiqildi va bu bosqichda tasdiqlanmadi.',
            }[userLang]

    await send(updated.telegramChatId ?? updated.submittedByTelegramChatId, message)
  }

  await editMessage(
    query.message.chat.id,
    query.message.message_id,
    `${query.message.text}\n\n${nextStatus === 'approved' ? '✅' : '🚫'} ${resultText}`,
    { reply_markup: { inline_keyboard: [] } },
  )
}

async function handleLanguageCallback(query) {
  const lang = query.data.split(':')[1]
  if (!text[lang]) {
    await answerCallback(query.id, 'Unknown language')
    return
  }

  await answerCallback(query.id, text[lang].askLanguage)
  await safeDelete(query.message.chat.id, query.message.message_id)
  await askRegistrationMode(query.message.chat.id, lang)
}

async function handleModeCallback(query) {
  const [, mode, lang] = query.data.split(':')

  if (!['self', 'friend'].includes(mode) || !text[lang]) {
    await answerCallback(query.id, 'Unknown')
    return
  }

  await answerCallback(query.id, text[lang].askMode)
  await safeDelete(query.message.chat.id, query.message.message_id)
  await startForm(query.message.chat.id, query.from, lang, { proxy: mode === 'friend' })
}

async function handleSetCallback(query, session) {
  const [, field, code] = query.data.split(':')
  const lang = session.lang
  const expectedStep = field === 'city' ? 'city' : field === 'gender' ? 'gender' : undefined

  if (await isStaleCallback(query, session, expectedStep)) {
    return
  }

  if (field === 'city') {
    const city = cityOptions.find((option) => option.code === code)
    session.data.city = optionLabel(city, lang)
  }

  if (field === 'gender') {
    const gender = genderOptions.find((option) => option.code === code)
    session.data.gender = optionLabel(gender, lang)
    session.data.genderCode = code
  }

  await answerCallback(query.id, 'OK')
  await cleanupStep(session, query.message)
  await afterStep(session)
}

async function handleKeepCallback(query, session) {
  const step = query.data.split(':')[1]

  if (!stepOrder.includes(step)) {
    await answerCallback(query.id, 'Unknown')
    return
  }

  if (await isStaleCallback(query, session, step)) {
    return
  }

  await answerCallback(query.id, text[session.lang].keepCurrent)
  await cleanupStep(session, query.message)
  await afterStep(session)
}

async function handleMultiCallback(query, session) {
  const [action, groupName, code] = query.data.split(':')
  const group = multiGroups[groupName]
  const t = text[session.lang]

  if (!group) {
    await answerCallback(query.id, 'Unknown')
    return
  }

  if (await isStaleCallback(query, session, groupName)) {
    return
  }

  const selected = selectedSet(session, groupName)

  if (action === 'toggle') {
    if (selected.includes(code)) {
      session.data[group.field] = selected.filter((item) => item !== code)
    } else {
      session.data[group.field] = [...selected.filter((item) => item !== t.none), code]
    }
    await answerCallback(query.id, 'OK')
    await updateMultiMessage(query, session, groupName)
    return
  }

  if (action === 'none') {
    if (group.required) {
      await answerCallback(query.id, t.minOne)
      return
    }
    session.data[group.field] = [t.none]
    await answerCallback(query.id, 'OK')
    await updateMultiMessage(query, session, groupName)
    return
  }

  if (action === 'other') {
    session.awaitingCustomGroup = groupName
    await answerCallback(query.id, t.other)
    await cleanupStep(session, query.message)
    await sendPrompt(session, t.sendCustom)
    return
  }

  if (action === 'next') {
    const activeSelected = selected.filter((item) => item !== t.none)
    if (group.required && activeSelected.length === 0) {
      await answerCallback(query.id, t.minOne)
      return
    }
    await answerCallback(query.id, t.next)
    await cleanupStep(session, query.message)
    await afterStep(session)
  }
}

async function updateMultiMessage(query, session, groupName) {
  const t = text[session.lang]
  const title = {
    languages: t.askLanguages,
    look: t.askLook,
    performance: t.askPerformance,
    physical: t.askPhysical,
    sports: t.askSports,
  }[groupName]
  await editMessage(
    session.chatId,
    query.message.message_id,
    promptText(session.lang, groupName, `${title}\n${t.selectDone}`),
    multiKeyboard(session, groupName),
  )
}

async function handleFormCallback(query, session) {
  const [, action, token] = query.data.split(':')
  const t = text[session.lang]

  if (!token || token !== session.previewToken) {
    await answerCallback(query.id)
    return
  }

  if (await isStaleCallback(query, session, 'preview')) {
    return
  }

  if (action === 'edit') {
    await answerCallback(query.id, t.edit)
    await cleanupPreview(session)
    await sendPrompt(session, t.editPrompt, editKeyboard(session.lang))
    return
  }

  if (action === 'approve') {
    if (!session.awaitingUserApproval || session.step !== 'preview') {
      await answerCallback(query.id, t.reviewActions)
      return
    }

    await answerCallback(query.id, t.approveProfile)
    await cleanupPreview(session)
    const wasUpdate = Boolean(session.replacingCandidateId)
    await saveProfile(session)
    await send(session.chatId, session.editing || wasUpdate ? t.savedAfterEdit : t.approved, candidateMenuKeyboard(session.lang))
    sessions.delete(String(query.from.id))
  }
}

async function handleEditCallback(query, session) {
  const step = query.data.split(':')[1]
  if (!stepOrder.includes(step)) {
    await answerCallback(query.id, 'Unknown')
    return
  }

  if (await ignoreStaleCallback(query, session)) {
    return
  }

  session.editing = true
  session.step = step

  if (['performance', 'sports', 'physical', 'languages', 'look'].includes(step)) {
    session.data[multiGroups[step].field] = []
  }

  await answerCallback(query.id, text[session.lang].edit)
  await safeDelete(query.message.chat.id, query.message.message_id)
  await askStep(session)
}

async function handleCallback(query) {
  if (query.data.startsWith('admin:')) {
    await handleAdminDecisionCallback(query)
    return
  }

  if (query.data.startsWith('lang:')) {
    if (sessions.has(String(query.from.id))) {
      await answerCallback(query.id)
      return
    }

    await handleLanguageCallback(query)
    return
  }

  if (query.data.startsWith('mode:')) {
    if (sessions.has(String(query.from.id))) {
      await answerCallback(query.id)
      return
    }

    await handleModeCallback(query)
    return
  }

  const session = sessions.get(String(query.from.id))
  if (!session) {
    await answerCallback(query.id, 'Send /start')
    return
  }

  if (query.data.startsWith('set:')) {
    await handleSetCallback(query, session)
    return
  }

  if (query.data.startsWith('keep:')) {
    await handleKeepCallback(query, session)
    return
  }

  if (query.data.startsWith('toggle:') || query.data.startsWith('next:') || query.data.startsWith('other:') || query.data.startsWith('none:')) {
    await handleMultiCallback(query, session)
    return
  }

  if (query.data.startsWith('form:')) {
    await handleFormCallback(query, session)
    return
  }

  if (query.data.startsWith('edit:')) {
    await handleEditCallback(query, session)
    return
  }
}

async function afterStep(session) {
  if (session.editing) {
    await showProfile(session)
    return
  }

  session.step = nextStepAfter(session.step)
  if (session.step === 'preview') {
    await showProfile(session)
    return
  }

  await askStep(session)
}

async function handleTextMessage(chatId, from, message) {
  const userId = String(from.id)
  const messageText = String(message.text ?? '').trim()
  const command = commandOf(messageText)

  if (adminIds.includes(String(from.id))) {
    if (command === '/friend' || command === '/register_friend') {
      sessions.delete(userId)
      await safeDelete(chatId, message.message_id)
      await askLanguage(chatId)
      return
    }

    await handleAdmin(chatId, from, command)
    return
  }

  if (command === '/start' || command === '/help') {
    sessions.delete(userId)
    safeDelete(chatId, message.message_id)
    await askLanguage(chatId)
    return
  }

  if (command === '/cancel') {
    sessions.delete(userId)
    safeDelete(chatId, message.message_id)
    await send(chatId, text.en.cancel, removeKeyboard())
    return
  }

  const session = sessions.get(userId)
  if (!session) {
    const existing = await findCandidateByTelegramId(from.id)
    if (matchesMenuAction(messageText, 'menuUpdate')) {
      await safeDelete(chatId, message.message_id)
      if (existing) {
        await startForm(chatId, from, languageForCandidate(existing), { forceUpdate: true })
      } else {
        await askLanguage(chatId)
      }
      return
    }

    if (matchesMenuAction(messageText, 'menuFriend')) {
      await safeDelete(chatId, message.message_id)
      const lang = existing ? languageForCandidate(existing) : 'ru'
      await startForm(chatId, from, lang, { proxy: true })
      return
    }

    if (matchesMenuAction(messageText, 'menuProfile')) {
      await safeDelete(chatId, message.message_id)
      const lang = existing ? languageForCandidate(existing) : 'ru'
      if (existing) {
        await sendCurrentProfile(chatId, existing, lang)
      } else {
        await send(chatId, text[lang].noProfile, userMenuKeyboard(lang))
      }
      return
    }

    if (matchesMenuAction(messageText, 'menuCastings')) {
      await safeDelete(chatId, message.message_id)
      await sendCurrentCastings(chatId, existing ?? {}, existing ? languageForCandidate(existing) : 'ru')
      return
    }

    await askLanguage(chatId)
    return
  }

  const t = text[session.lang]

  if (session.awaitingCustomGroup) {
    const groupName = session.awaitingCustomGroup
    const group = multiGroups[groupName]
    const custom = String(message.text ?? '').trim()
    if (custom) {
      session.data[group.field] = [...selectedSet(session, groupName).filter((item) => item !== t.none), custom]
    }
    session.awaitingCustomGroup = undefined
    await cleanupStep(session, message)
    await askStep(session)
    return
  }

  if (session.step === 'name') {
    if (!isValidName(messageText)) {
      await send(chatId, t.badName)
      return
    }
    session.data.name = messageText
    await cleanupStep(session, message)
    await afterStep(session)
    return
  }

  if (session.step === 'phone') {
    const phone = getPhone(message, from, { allowSharedContact: session.proxy })
    if (!phone) {
      await send(chatId, t.badPhone, session.proxy ? removeKeyboard() : contactKeyboard(session.lang))
      return
    }

    const duplicate = await findCandidateByPhone(phone)
    if (duplicate && duplicate.id !== session.replacingCandidateId) {
      await send(chatId, t.duplicatePhone, session.proxy ? removeKeyboard() : contactKeyboard(session.lang))
      return
    }

    session.data.phone = phone
    await cleanupStep(session, message)
    await afterStep(session)
    return
  }

  if (session.step === 'age') {
    if (!isDigits(messageText) || Number(messageText) > 130 || Number(messageText) < 1) {
      await send(chatId, t.badAge)
      return
    }
    session.data.age = Number(messageText)
    await cleanupStep(session, message)
    await afterStep(session)
    return
  }

  if (session.step === 'height') {
    if (!isDigits(messageText) || Number(messageText) > 250 || Number(messageText) < 1) {
      await send(chatId, t.badHeight)
      return
    }
    session.data.height = messageText
    await cleanupStep(session, message)
    await afterStep(session)
    return
  }

  if (session.step === 'weight') {
    if (!isDigits(messageText) || Number(messageText) < 1) {
      await send(chatId, t.badWeight)
      return
    }
    session.data.weight = messageText
    await cleanupStep(session, message)
    await afterStep(session)
    return
  }

  if (photoSteps[session.step]) {
    const photo = await storePhoto(message)
    if (!photo) {
      await send(chatId, t.badPhoto)
      return
    }
    const photoStep = photoSteps[session.step]
    session.data[photoStep.fileIdField] = photo.fileId
    session.data[photoStep.pathField] = photo.path

    if (session.step === 'portraitPhoto') {
      session.data.photoFileId = photo.fileId
      session.data.photoPath = photo.path
    }

    await cleanupStep(session, message)
    await afterStep(session)
    return
  }

  if (session.step === 'video') {
    const video = await storeVideo(message)
    if (!video) {
      await send(chatId, t.badVideo)
      return
    }
    session.data.introVideoFileId = video.fileId
    session.data.introVideoPath = video.path
    session.data.introVideoDuration = video.duration
    await cleanupStep(session, message)
    await afterStep(session)
  }
}

async function handleAdmin(chatId, from, command) {
  const t = text.ru

  if (command === '/start' || command === '/help') {
    await send(chatId, `${t.adminHelp}\n/friend - зарегистрировать друга`)
    return
  }

  if (command === '/whoami') {
    await send(chatId, `${t.whoami}: ${from.id}\nAdmin IDs: ${adminIds.join(', ')}`)
    return
  }

  if (command === '/status') {
    await send(chatId, t.adminStatus)
    return
  }

  await send(chatId, t.unknownAdmin)
}

export async function handleBotUpdate(update) {
  const query = update.callback_query
  const message = update.message
  const from = query?.from ?? message?.from
  const userId = from?.id ? String(from.id) : undefined

  const chat = query?.message?.chat ?? message?.chat

  if (chat?.type !== 'private') {
    if (query?.id) {
      await answerCallback(query.id, 'This bot is available in private chat only.')
    }
    return { handled: false, reason: 'private_chat_required' }
  }

  // Skip DB session load for commands that reset state immediately anyway
  const isStatelessCommand = !query && /^\/(start|help|cancel)\b/i.test(String(message?.text ?? '').trim())

  if (userId && !isStatelessCommand) {
    await hydrateSession(userId)
  }

  try {
    if (query) {
      console.info('Telegram callback received', { updateId: update.update_id })
      await handleCallback(query)
      return { handled: true, type: 'callback_query' }
    }

    if (!message?.chat?.id || !message.from?.id) {
      return { handled: false, reason: 'unsupported_update' }
    }

    console.info('Telegram message received', { updateId: update.update_id, contentType: message.text ? 'text' : message.contact ? 'contact' : message.photo ? 'photo' : message.video ? 'video' : 'other' })

    await handleTextMessage(message.chat.id, message.from, message)
    return { handled: true, type: 'message' }
  } finally {
    if (userId) {
      await persistSession(userId)
    }
  }
}
