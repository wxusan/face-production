import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cloud,
  Download,
  Filter,
  LockKeyhole,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  UserCheck,
  Users,
  BarChart3,
  ClipboardList,
  Copy,
  UserCog,
} from 'lucide-react'
import './App.css'
import {
  approveCandidate,
  getCandidateExportUrl,
  getCandidateMediaUrl,
  getHealth,
  getAdminSession,
  getBriefAttachmentUrl,
  inviteApiAdmin,
  listApiAdmins,
  listApiBriefs,
  listApiCandidates,
  listAuditEvents,
  rejectCandidate,
  updateApiAdmin,
  updateApiBrief,
  type ApiAdmin,
  type ApiBrief,
  type AuditEvent,
} from './api'
import { mapApiCandidate } from './candidateMapper'
import { candidates, type Candidate } from './platformData'

type AdminLang = 'ru' | 'uz'
type ViewId = 'overview' | 'briefs' | 'candidates' | 'admins' | 'campaigns' | 'governance' | 'vendors'

const text = {
  ru: {
    active: 'Активно',
    activity: 'Активность',
    adminPasscode: 'Код администратора',
    age: 'Возраст',
    aiGuardrail: 'Решения по кандидатам, рассылкам, экспортам и блокировкам принимает человек. AI-функции сейчас отключены.',
    appearance: 'Внешность',
    apiChecking: 'API проверяется',
    apiOffline: 'API недоступен',
    apiOnline: 'API онлайн',
    approve: 'Одобрить',
    auditEmpty: 'Разблокируйте панель, чтобы видеть последние действия.',
    auditTitle: 'Последние события',
    blocked: 'Заблокировано',
    broad: 'Широкая',
    campaignGate: 'Рассылки только после проверки аудитории и усталости уведомлений.',
    campaigns: 'Кампании',
    candidate: 'Кандидат',
    candidateBase: 'База кандидатов',
    candidateBaseDetail: 'Тестовые и Telegram-заявки',
    candidateRejected: 'Кандидат отклонен',
    candidates: 'Кандидаты',
    city: 'Город',
    consent: 'Согласие',
    confirmed: 'Есть',
    district: 'Район',
    conversion: 'Конверсия регистрации',
    conversionDetail: 'Заявка до проверки',
    dataQuality: 'Качество данных',
    dataQualityText: 'Обязательные поля, согласие для несовершеннолетних, проверка дублей.',
    detail: 'Карточка',
    duplicate: 'Дубликаты',
    duplicateDetail: 'Контроль по телефону и Telegram ID',
    export: 'Экспорт',
    experience: 'Опыт',
    facialHair: 'Лицо',
    gender: 'Пол',
    glasses: 'Очки',
    guardianContact: 'Контакт родителя',
    hair: 'Волосы',
    height: 'Рост',
    instagram: 'Instagram',
    introVideo: 'Интро-видео',
    fatigue: 'Усталость уведомлений',
    fatigueText: 'Массовые рассылки запрещены без сегментации.',
    governance: 'Управление',
    governanceCheck: 'Проверка',
    governanceTitle: 'Правила управления',
    incomplete: 'Неполная',
    language: 'Язык',
    lock: 'Закрыть',
    mainTitle: 'Платформа талантов',
    missing: 'Нет',
    newIntake: 'Новая заявка',
    noAuth: 'Введите код администратора, чтобы загрузить реальные Telegram-заявки и включить действия.',
    noPhone: 'Не указан',
    noCandidates: 'Пока нет реальных заявок. Заполните форму через Telegram-бот.',
    noTelegram: 'Не связан',
    overview: 'Обзор',
    pending: 'На проверке',
    phone: 'Телефон',
    photo: 'Фото',
    fullBodyPhoto: 'Фото в полный рост',
    closeShotPhoto: 'Фото ближе',
    leftProfilePhoto: 'Левый профиль',
    rightProfilePhoto: 'Правый профиль',
    languageSkills: 'Языки',
    media: 'Медиа',
    performanceTalents: 'Сценические таланты',
    playableAge: 'Выглядит на',
    noPhoto: 'Фото не загружено',
    quality: 'Качество',
    refresh: 'Обновить',
    reject: 'Отклонить',
    reviewOk: 'готово к проверяемому использованию',
    role: 'Роль',
    search: 'Поиск по имени, городу, роли, источнику',
    security: 'Безопасность',
    securityText: 'Доступ администратора, экспорт, видимость детей и инциденты требуют правил.',
    source: 'Источник',
    sourceSeed: 'Демо',
    status: 'Статус',
    targeted: 'Целевая',
    telegram: 'Telegram',
    title: 'Консоль MVP',
    unlock: 'Войти',
    validation: 'Правила проверки',
    vendors: 'Поставщики',
    skills: 'Навыки',
    sportsTalents: 'Спорт',
    physicalSkills: 'Физические навыки',
    skillsMedia: 'Медиа навыков',
    tattoos: 'Татуировки',
    availability: 'Доступность',
    weight: 'Вес',
    admins: 'Администраторы',
    briefs: 'Новые заявки',
    noBriefs: 'Новых заявок с сайта пока нет.',
    client: 'Клиент',
    project: 'Проект',
    shoot: 'Съёмка',
    contactInfo: 'Контакт',
    rolesNeeded: 'Нужные роли',
    budget: 'Бюджет',
    usageRights: 'Права использования',
    references: 'Референсы',
    notes: 'Комментарий клиента',
    internalNotes: 'Внутренние заметки',
    attachments: 'Файлы',
    save: 'Сохранить',
    inviteAdmin: 'Пригласить администратора',
    adminName: 'Имя администратора',
    adminEmail: 'Email',
    telegramId: 'Telegram ID',
    telegramUsername: 'Telegram username',
    allowNotifications: 'Разрешить Telegram-уведомления',
    receiveNotifications: 'Получать уведомления о заявках',
    accessCode: 'Одноразовый код доступа — скопируйте сейчас',
    superAdmin: 'Супер-администратор',
    regularAdmin: 'Администратор',
    disabled: 'Отключён',
    copy: 'Копировать',
    adminOnly: 'Только супер-администратор может приглашать и отключать администраторов.',
  },
  uz: {
    active: 'Faol',
    activity: 'Faollik',
    adminPasscode: 'Admin kodi',
    age: 'Yosh',
    aiGuardrail: 'Nomzodlar, xabarlar, eksport va bloklash qarorlarini inson tasdiqlaydi. AI funksiyalari hozir o‘chirilgan.',
    appearance: 'Ko‘rinish',
    apiChecking: 'API tekshirilmoqda',
    apiOffline: 'API ishlamayapti',
    apiOnline: 'API onlayn',
    approve: 'Tasdiqlash',
    auditEmpty: 'Oxirgi amallarni ko‘rish uchun panelni oching.',
    auditTitle: 'Oxirgi hodisalar',
    blocked: 'Bloklangan',
    broad: 'Keng',
    campaignGate: 'Xabarlar faqat auditoriya va charchash xavfi tekshirilgandan keyin.',
    campaigns: 'Kampaniyalar',
    candidate: 'Nomzod',
    candidateBase: 'Nomzodlar bazasi',
    candidateBaseDetail: 'Test va Telegram arizalari',
    candidateRejected: 'Nomzod rad etildi',
    candidates: 'Nomzodlar',
    city: 'Shahar',
    consent: 'Rozilik',
    confirmed: 'Bor',
    district: 'Tuman',
    conversion: 'Ro‘yxatdan o‘tish konversiyasi',
    conversionDetail: 'Arizadan tekshiruvgacha',
    dataQuality: 'Ma’lumot sifati',
    dataQualityText: 'Majburiy maydonlar, voyaga yetmaganlar roziligi, dubl tekshiruvi.',
    detail: 'Karta',
    duplicate: 'Dublikatlar',
    duplicateDetail: 'Telefon va Telegram ID nazorati',
    export: 'Eksport',
    experience: 'Tajriba',
    facialHair: 'Yuz',
    gender: 'Jins',
    glasses: 'Ko‘zoynak',
    guardianContact: 'Ota-ona kontakti',
    hair: 'Soch',
    height: 'Bo‘y',
    instagram: 'Instagram',
    introVideo: 'Intro video',
    fatigue: 'Xabar charchashi',
    fatigueText: 'Segmentatsiyasiz ommaviy xabarlar taqiqlanadi.',
    governance: 'Boshqaruv',
    governanceCheck: 'Tekshiruv',
    governanceTitle: 'Boshqaruv qoidalari',
    incomplete: 'To‘liq emas',
    language: 'Til',
    lock: 'Yopish',
    mainTitle: 'Talent platformasi',
    missing: 'Yo‘q',
    newIntake: 'Yangi ariza',
    noAuth: 'Real Telegram arizalarini yuklash va amallarni yoqish uchun admin kodini kiriting.',
    noPhone: 'Kiritilmagan',
    noCandidates: 'Hozircha real arizalar yo‘q. Telegram bot orqali formani to‘ldiring.',
    noTelegram: 'Ulanmagan',
    overview: 'Ko‘rinish',
    pending: 'Tekshiruvda',
    phone: 'Telefon',
    photo: 'Foto',
    fullBodyPhoto: 'To‘liq bo‘y foto',
    closeShotPhoto: 'Yaqinroq foto',
    leftProfilePhoto: 'Chap profil',
    rightProfilePhoto: 'O‘ng profil',
    languageSkills: 'Tillar',
    media: 'Media',
    performanceTalents: 'Sahna talantlari',
    playableAge: 'Ko‘rinadigan yosh',
    noPhoto: 'Foto yuklanmagan',
    quality: 'Sifat',
    refresh: 'Yangilash',
    reject: 'Rad etish',
    reviewOk: 'nazorat ostida foydalanishga tayyor',
    role: 'Rol',
    search: 'Ism, shahar, rol, manba bo‘yicha qidirish',
    security: 'Xavfsizlik',
    securityText: 'Admin kirishi, eksport, bolalar ko‘rinishi va hodisalar qoidalarga bog‘liq.',
    source: 'Manba',
    sourceSeed: 'Demo',
    status: 'Holat',
    targeted: 'Maqsadli',
    telegram: 'Telegram',
    title: 'MVP konsoli',
    unlock: 'Kirish',
    validation: 'Tekshiruv qoidalari',
    vendors: 'Ta’minotchilar',
    skills: 'Ko‘nikmalar',
    sportsTalents: 'Sport',
    physicalSkills: 'Jismoniy ko‘nikmalar',
    skillsMedia: 'Ko‘nikma mediasi',
    tattoos: 'Tatuirovka',
    availability: 'Vaqt',
    weight: 'Vazn',
    admins: 'Administratorlar',
    briefs: 'Yangi so‘rovlar',
    noBriefs: 'Saytdan yangi kasting so‘rovlari hali kelmadi.',
    client: 'Mijoz',
    project: 'Loyiha',
    shoot: 'Suratga olish',
    contactInfo: 'Aloqa',
    rolesNeeded: 'Kerakli rollar',
    budget: 'Byudjet',
    usageRights: 'Foydalanish huquqi',
    references: 'Namunalar',
    notes: 'Mijoz izohi',
    internalNotes: 'Ichki izohlar',
    attachments: 'Fayllar',
    save: 'Saqlash',
    inviteAdmin: 'Administrator taklif qilish',
    adminName: 'Administrator ismi',
    adminEmail: 'Email',
    telegramId: 'Telegram ID',
    telegramUsername: 'Telegram username',
    allowNotifications: 'Telegram xabarlariga ruxsat berish',
    receiveNotifications: 'Kasting so‘rovlari haqida xabar olish',
    accessCode: 'Bir martalik kirish kodi — hozir nusxalang',
    superAdmin: 'Bosh administrator',
    regularAdmin: 'Administrator',
    disabled: 'O‘chirilgan',
    copy: 'Nusxalash',
    adminOnly: 'Faqat bosh administrator yangi admin taklif qilishi va adminni o‘chirishi mumkin.',
  },
}

const navIcons: Record<ViewId, typeof Users> = {
  campaigns: MessageCircle,
  briefs: ClipboardList,
  candidates: Users,
  admins: UserCog,
  governance: ShieldCheck,
  overview: BarChart3,
  vendors: Cloud,
}

function App() {
  const [lang, setLang] = useState<AdminLang>(() => (localStorage.getItem('face-admin-lang') as AdminLang) || 'ru')
  const t = text[lang]
  const navigation = useMemo(() => [
    { id: 'briefs' as ViewId, label: t.briefs },
    { id: 'candidates' as ViewId, label: t.candidates },
    { id: 'admins' as ViewId, label: t.admins },
  ], [t])
  const [activeView, setActiveView] = useState<ViewId>(() => {
    const requested = new URLSearchParams(window.location.search).get('view') as ViewId | null
    return requested === 'briefs' || requested === 'admins' || requested === 'candidates' ? requested : 'briefs'
  })
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'offline'>('checking')
  const [adminToken, setAdminToken] = useState(() => localStorage.getItem('face-admin-token') ?? '')
  const [tokenInput, setTokenInput] = useState(adminToken)
  const [authError, setAuthError] = useState('')
  const [candidateRows, setCandidateRows] = useState(candidates)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [actionMessage, setActionMessage] = useState('')
  const [query, setQuery] = useState('')
  const [selectedCandidate, setSelectedCandidate] = useState(candidates[0].id)
  const [campaignMode, setCampaignMode] = useState<'targeted' | 'broad'>('targeted')
  const [sessionAdmin, setSessionAdmin] = useState<ApiAdmin | null>(null)
  const [briefRows, setBriefRows] = useState<ApiBrief[]>([])
  const [selectedBrief, setSelectedBrief] = useState(() => new URLSearchParams(window.location.search).get('brief') ?? '')
  const [adminRows, setAdminRows] = useState<ApiAdmin[]>([])
  const [invite, setInvite] = useState({ name: '', email: '', telegramUserId: '', telegramNotificationsAllowed: true, telegramNotifications: true })
  const [newAdminCode, setNewAdminCode] = useState('')
  const isAuthed = Boolean(adminToken)

  const filteredCandidates = useMemo(() => {
    const normalized = query.trim().toLowerCase()

    if (!normalized) {
      return candidateRows
    }

    return candidateRows.filter((candidate) => {
      return [candidate.name, candidate.city, candidate.role, candidate.source, candidate.rawStatus, candidate.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    })
  }, [candidateRows, query])

  const activeCandidate =
    filteredCandidates.find((candidate) => candidate.id === selectedCandidate) ??
    filteredCandidates[0]
  const activeBrief = briefRows.find((brief) => brief.id === selectedBrief) ?? briefRows[0]
  const activeCandidateHasMedia = Boolean(
    activeCandidate &&
      (activeCandidate.portraitPhotoPath ||
        activeCandidate.photoPath ||
        activeCandidate.fullBodyPhotoPath ||
        activeCandidate.closeShotPhotoPath ||
        activeCandidate.leftProfilePhotoPath ||
        activeCandidate.rightProfilePhotoPath ||
        activeCandidate.introVideoPath),
  )

  const pendingCount = candidateRows.filter((candidate) => candidate.rawStatus === 'pending_review').length
  const approvedCount = candidateRows.filter((candidate) => ['approved', 'verified'].includes(candidate.rawStatus ?? '')).length
  const blockedCount = candidateRows.filter((candidate) => candidate.rawStatus === 'rejected').length

  useEffect(() => {
    localStorage.setItem('face-admin-lang', lang)
  }, [lang])

  useEffect(() => {
    const controller = new AbortController()

    getHealth()
      .then(() => {
        if (!controller.signal.aborted) {
          setApiStatus('connected')
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setApiStatus('offline')
        }
      })

    return () => controller.abort()
  }, [])

  const loadAdminData = useCallback(async (token = adminToken) => {
    if (!token) {
      return
    }

    setAuthError('')

    try {
      const [apiCandidates, events, admin, briefs, admins] = await Promise.all([
        listApiCandidates(token),
        listAuditEvents(token),
        getAdminSession(token),
        listApiBriefs(token),
        listApiAdmins(token),
      ])
      const mappedCandidates = apiCandidates.map(mapApiCandidate)
      setCandidateRows(mappedCandidates)
      setAuditEvents(events.slice(-8).reverse())
      setSessionAdmin(admin)
      setBriefRows(briefs)
      setAdminRows(admins)

      if (!mappedCandidates.some((candidate) => candidate.id === selectedCandidate)) {
        setSelectedCandidate(mappedCandidates[0]?.id ?? '')
      }
      if (!briefs.some((brief) => brief.id === selectedBrief)) {
        setSelectedBrief(briefs[0]?.id ?? '')
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Ошибка доступа')
      setAdminToken('')
      localStorage.removeItem('face-admin-token')
    }
  }, [adminToken, selectedBrief, selectedCandidate])

  useEffect(() => {
    const refresh = window.setTimeout(() => {
      void loadAdminData()
    }, 0)

    return () => window.clearTimeout(refresh)
  }, [adminToken, loadAdminData])

  useEffect(() => {
    if (!adminToken) {
      return undefined
    }

    const refresh = window.setInterval(() => {
      void loadAdminData(adminToken)
    }, 5000)

    return () => window.clearInterval(refresh)
  }, [adminToken, loadAdminData])

  const saveAdminToken = () => {
    const token = tokenInput.trim()
    setAdminToken(token)
    localStorage.setItem('face-admin-token', token)
  }

  const clearAdminToken = () => {
    setAdminToken('')
    setTokenInput('')
    setCandidateRows(candidates)
    setAuditEvents([])
    setSessionAdmin(null)
    setBriefRows([])
    setAdminRows([])
    localStorage.removeItem('face-admin-token')
  }

  const updateLanguage = (nextLang: AdminLang) => {
    setLang(nextLang)
  }

  const updateCandidateDecision = async (decision: 'approve' | 'reject') => {
    if (!adminToken) {
      setAuthError(t.noAuth)
      return
    }

    if (!activeCandidate) {
      setActionMessage(t.noCandidates)
      return
    }

    const request = decision === 'approve' ? approveCandidate : rejectCandidate

    try {
      await request(activeCandidate.id, adminToken)
      await loadAdminData(adminToken)
      setActionMessage(`${activeCandidate.id}: ${decision === 'approve' ? t.approve : t.reject}.`)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Ошибка')
    }
  }

  const exportCandidates = () => {
    if (!adminToken) {
      return
    }

    window.location.href = getCandidateExportUrl(adminToken)
  }

  const saveBrief = async (changes: Partial<ApiBrief>) => {
    if (!adminToken || !activeBrief) return
    try {
      const brief = await updateApiBrief(activeBrief.id, changes, adminToken)
      setBriefRows((rows) => rows.map((item) => item.id === brief.id ? brief : item))
      setActionMessage(`${brief.id}: ${t.save}.`)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Ошибка')
    }
  }

  const inviteAdmin = async () => {
    if (!adminToken) return
    setActionMessage('')
    try {
      const result = await inviteApiAdmin(invite, adminToken)
      setAdminRows((rows) => [...rows, result.admin])
      setNewAdminCode(result.accessToken)
      setInvite({ name: '', email: '', telegramUserId: '', telegramNotificationsAllowed: true, telegramNotifications: true })
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Ошибка')
    }
  }

  const saveAdmin = async (id: string, changes: Partial<ApiAdmin>) => {
    if (!adminToken) return
    try {
      const updated = await updateApiAdmin(id, changes, adminToken)
      setAdminRows((rows) => rows.map((item) => item.id === id ? updated : item))
      if (sessionAdmin?.id === id) setSessionAdmin(updated)
      setActionMessage(`${updated.name}: ${t.save}.`)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Ошибка')
    }
  }

  if (!isAuthed) {
    return (
      <main className="loginShell">
        <section className="loginPanel">
          <div className="brandMark">FP</div>
          <div>
            <p className="eyebrow">FACE Production</p>
            <h1>{t.mainTitle}</h1>
          </div>
          <label className="loginField">
            <LockKeyhole size={20} />
            <input
              aria-label={t.adminPasscode}
              autoFocus
              onChange={(event) => setTokenInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  saveAdminToken()
                }
              }}
              placeholder={t.adminPasscode}
              type="password"
              value={tokenInput}
            />
          </label>
          {authError && <p className="loginError">{authError}</p>}
          <button className="primaryButton loginButton" onClick={saveAdminToken} type="button">
            {t.unlock}
          </button>
          <div className="segmentedControl loginLanguage" aria-label={t.language}>
            <button className={lang === 'ru' ? 'active' : ''} onClick={() => updateLanguage('ru')} type="button">RU</button>
            <button className={lang === 'uz' ? 'active' : ''} onClick={() => updateLanguage('uz')} type="button">UZ</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="appShell">
      <aside className="sidebar" aria-label={t.governance}>
        <div className="brandBlock">
          <div className="brandMark">FP</div>
          <div>
            <p className="eyebrow">FACE Production</p>
            <h1>{t.mainTitle}</h1>
          </div>
        </div>

        <nav className="navList">
          {navigation.map((item) => {
            const Icon = navIcons[item.id]

            return (
              <button
                className={activeView === item.id ? 'navButton active' : 'navButton'}
                key={item.id}
                onClick={() => setActiveView(item.id)}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <section className="sidebarPanel" aria-label={t.governanceTitle}>
          <ShieldCheck size={18} />
          <p>{t.aiGuardrail}</p>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t.title}</p>
            <h2>{navigation.find((item) => item.id === activeView)?.label}</h2>
          </div>

          <div className="topbarActions">
            <div className="segmentedControl languageControl" aria-label={t.language}>
              <button className={lang === 'ru' ? 'active' : ''} onClick={() => updateLanguage('ru')} type="button">RU</button>
              <button className={lang === 'uz' ? 'active' : ''} onClick={() => updateLanguage('uz')} type="button">UZ</button>
            </div>
            <span className={`apiStatus ${apiStatus}`}>
              {apiStatus === 'connected' ? t.apiOnline : apiStatus === 'offline' ? t.apiOffline : t.apiChecking}
            </span>
            <button className="secondaryButton compactButton" onClick={clearAdminToken} type="button">
              <LockKeyhole size={16} />
              <span>{t.lock}</span>
            </button>
            <button className="iconButton" onClick={() => loadAdminData()} title={t.refresh} type="button">
              <RefreshCw size={18} />
            </button>
            <button className="iconButton" onClick={exportCandidates} title={t.export} type="button">
              <Download size={18} />
            </button>
            <button className="primaryButton" type="button">
              <Plus size={18} />
              <span>{t.newIntake}</span>
            </button>
          </div>
        </header>

        {activeView === 'overview' && (
          <div className="viewStack">
            <section className="metricGrid" aria-label={t.overview}>
              {[
                { label: t.candidateBase, value: String(candidateRows.length), detail: t.candidateBaseDetail, trend: 'up' },
                { label: t.pending, value: String(pendingCount), detail: t.conversionDetail, trend: 'flat' },
                { label: t.active, value: String(approvedCount), detail: t.reviewOk, trend: 'up' },
                { label: t.blocked, value: String(blockedCount), detail: t.candidateRejected, trend: 'down' },
              ].map((metric) => (
                <article className="metricCard" key={metric.label}>
                  <div className={`trendDot ${metric.trend}`} />
                  <p>{metric.label}</p>
                  <strong>{metric.value}</strong>
                  <span>{metric.detail}</span>
                </article>
              ))}
            </section>

            <section className="splitLayout">
              <InfoPanel
                icon={<AlertTriangle size={19} />}
                items={[
                  [t.dataQuality, t.dataQualityText],
                  [t.fatigue, t.fatigueText],
                  [t.security, t.securityText],
                ]}
                title={t.governanceTitle}
              />
              <InfoPanel
                icon={<ArrowRight size={19} />}
                items={[
                  ['Telegram', t.candidates],
                  ['Dashboard', t.approve],
                  ['Audit', t.auditTitle],
                ]}
                title="MVP"
              />
            </section>
          </div>
        )}

        {activeView === 'briefs' && (
          <div className="viewStack">
            {(authError || actionMessage) && (
              <section className={authError ? 'noticeBox dangerNotice' : 'noticeBox'}>
                <AlertTriangle size={18} />
                <span>{authError || actionMessage}</span>
              </section>
            )}
            {activeBrief ? (
              <section className="candidateLayout">
                <div className="tablePanel">
                  <table>
                    <thead><tr><th>{t.client}</th><th>{t.project}</th><th>{t.shoot}</th><th>{t.status}</th></tr></thead>
                    <tbody>
                      {briefRows.map((brief) => (
                        <tr className={brief.id === activeBrief.id ? 'selectedRow' : ''} key={brief.id} onClick={() => setSelectedBrief(brief.id)}>
                          <td><button className="tableSelect" type="button"><strong>{brief.company || brief.clientName}</strong><span>{brief.id} · {new Date(brief.createdAt).toLocaleString()}</span></button></td>
                          <td>{brief.projectTitle || brief.projectType}</td>
                          <td>{brief.shootingDate || '—'} · {brief.location || '—'}</td>
                          <td><span className={`statusPill ${brief.status === 'new' ? 'statusWarn' : brief.status === 'closed' ? 'statusIdle' : 'statusGood'}`}>{brief.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <aside className="detailPanel briefDetail">
                  <div className="panelHeader">
                    <div><p className="eyebrow">{activeBrief.id} · {activeBrief.locale.toUpperCase()}</p><h3>{activeBrief.projectTitle || activeBrief.projectType}</h3></div>
                    <select className="adminSelect" value={activeBrief.status} onChange={(event) => void saveBrief({ status: event.target.value as ApiBrief['status'] })}>
                      <option value="new">new</option><option value="contacted">contacted</option><option value="qualified">qualified</option><option value="closed">closed</option>
                    </select>
                  </div>
                  <div className="profileFacts">
                    <Fact label={t.client} value={`${activeBrief.clientName}${activeBrief.company ? ` · ${activeBrief.company}` : ''}`} />
                    <Fact label={t.contactInfo} value={[activeBrief.phoneOrTelegram, activeBrief.email].filter(Boolean).join(' · ')} />
                    <Fact label={t.project} value={activeBrief.projectType} />
                    <Fact label={t.shoot} value={[activeBrief.shootingDate, activeBrief.location].filter(Boolean).join(' · ') || '—'} />
                    <Fact label={t.budget} value={activeBrief.budget || '—'} />
                    <Fact label={t.usageRights} value={activeBrief.usageRights || '—'} />
                  </div>
                  <BriefFact label={t.rolesNeeded} value={activeBrief.rolesNeeded} />
                  <BriefFact label={t.references} value={activeBrief.referenceLinks || '—'} />
                  <BriefFact label={t.notes} value={activeBrief.notes || '—'} />
                  {activeBrief.attachments?.length ? (
                    <section className="briefAttachments"><p className="eyebrow">{t.attachments}</p>{activeBrief.attachments.map((attachment, index) => (
                      <a href={getBriefAttachmentUrl(activeBrief.id, index, adminToken)} key={`${attachment.name}-${index}`} rel="noreferrer" target="_blank">{attachment.name}<span>{Math.ceil(attachment.size / 1024)} KB ↗</span></a>
                    ))}</section>
                  ) : null}
                  <label className="adminField"><span>{t.internalNotes}</span><textarea rows={4} value={activeBrief.internalNotes ?? ''} onChange={(event) => setBriefRows((rows) => rows.map((brief) => brief.id === activeBrief.id ? { ...brief, internalNotes: event.target.value } : brief))} /></label>
                  <button className="primaryButton" onClick={() => void saveBrief({ internalNotes: activeBrief.internalNotes ?? '' })} type="button">{t.save}</button>
                </aside>
              </section>
            ) : <section className="emptyState"><ClipboardList size={28} /><strong>{t.noBriefs}</strong></section>}
          </div>
        )}

        {activeView === 'admins' && (
          <div className="viewStack">
            {(authError || actionMessage) && <section className={authError ? 'noticeBox dangerNotice' : 'noticeBox'}><AlertTriangle size={18} /><span>{authError || actionMessage}</span></section>}
            {newAdminCode && <section className="accessCodeBox"><div><p className="eyebrow">{t.accessCode}</p><strong>{newAdminCode}</strong></div><button className="secondaryButton" onClick={() => void navigator.clipboard.writeText(newAdminCode)} type="button"><Copy size={16} />{t.copy}</button></section>}
            {sessionAdmin?.role === 'super_admin' ? (
              <section className="panel adminInvitePanel">
                <div className="panelHeader"><div><p className="eyebrow">{t.superAdmin}</p><h3>{t.inviteAdmin}</h3></div><UserCog size={20} /></div>
                <div className="adminFormGrid">
                  <label className="adminField"><span>{t.adminName}</span><input value={invite.name} onChange={(event) => setInvite((value) => ({ ...value, name: event.target.value }))} /></label>
                  <label className="adminField"><span>{t.adminEmail}</span><input type="email" value={invite.email} onChange={(event) => setInvite((value) => ({ ...value, email: event.target.value }))} /></label>
                  <label className="adminField"><span>{t.telegramId}</span><input value={invite.telegramUserId} onChange={(event) => setInvite((value) => ({ ...value, telegramUserId: event.target.value }))} /></label>
                  <label className="adminCheck"><input checked={invite.telegramNotificationsAllowed} onChange={(event) => setInvite((value) => ({ ...value, telegramNotificationsAllowed: event.target.checked, telegramNotifications: event.target.checked && value.telegramNotifications }))} type="checkbox" /><span>{t.allowNotifications}</span></label>
                  <label className="adminCheck"><input checked={invite.telegramNotifications} disabled={!invite.telegramNotificationsAllowed} onChange={(event) => setInvite((value) => ({ ...value, telegramNotifications: event.target.checked }))} type="checkbox" /><span>{t.receiveNotifications}</span></label>
                </div>
                <button className="primaryButton" disabled={!invite.name.trim()} onClick={() => void inviteAdmin()} type="button"><Plus size={17} />{t.inviteAdmin}</button>
              </section>
            ) : <section className="noticeBox"><ShieldCheck size={18} /><span>{t.adminOnly}</span></section>}

            <section className="adminCards">
              {adminRows.map((admin) => {
                const editable = sessionAdmin?.role === 'super_admin' || sessionAdmin?.id === admin.id
                return <article className="panel adminCard" key={admin.id}>
                  <div className="panelHeader"><div><p className="eyebrow">{admin.id}</p><h3>{admin.name}</h3><span className="adminRole">{admin.role === 'super_admin' ? t.superAdmin : t.regularAdmin}</span></div><span className={`statusPill ${admin.status === 'active' ? 'statusGood' : 'statusBad'}`}>{admin.status === 'active' ? t.active : t.disabled}</span></div>
                  <div className="adminFormGrid">
                    <label className="adminField"><span>{t.telegramId}</span><input disabled={!editable} value={admin.telegramUserId ?? ''} onChange={(event) => setAdminRows((rows) => rows.map((item) => item.id === admin.id ? { ...item, telegramUserId: event.target.value } : item))} /></label>
                    <label className="adminField"><span>{t.telegramUsername}</span><input disabled={!editable} value={admin.telegramUsername ?? ''} onChange={(event) => setAdminRows((rows) => rows.map((item) => item.id === admin.id ? { ...item, telegramUsername: event.target.value } : item))} /></label>
                    <label className="adminCheck"><input checked={admin.telegramNotificationsAllowed} disabled={sessionAdmin?.role !== 'super_admin' || admin.role === 'super_admin'} onChange={(event) => setAdminRows((rows) => rows.map((item) => item.id === admin.id ? { ...item, telegramNotificationsAllowed: event.target.checked, telegramNotifications: event.target.checked && item.telegramNotifications } : item))} type="checkbox" /><span>{t.allowNotifications}</span></label>
                    <label className="adminCheck"><input checked={admin.telegramNotifications} disabled={!editable || !admin.telegramNotificationsAllowed} onChange={(event) => setAdminRows((rows) => rows.map((item) => item.id === admin.id ? { ...item, telegramNotifications: event.target.checked } : item))} type="checkbox" /><span>{t.receiveNotifications}</span></label>
                  </div>
                  {editable && <button className="primaryButton" onClick={() => void saveAdmin(admin.id, { telegramUserId: admin.telegramUserId, telegramUsername: admin.telegramUsername, telegramNotifications: admin.telegramNotifications, telegramNotificationsAllowed: admin.telegramNotificationsAllowed })} type="button">{t.save}</button>}
                </article>
              })}
            </section>
          </div>
        )}

        {activeView === 'candidates' && (
          <div className="viewStack">
            <section className="toolbar">
              <label className="searchBox">
                <Filter size={17} />
                <input
                  aria-label={t.search}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t.search}
                  type="search"
                  value={query}
                />
              </label>
              <button className="secondaryButton" type="button">
                <SlidersHorizontal size={17} />
                <span>{t.validation}</span>
              </button>
            </section>

            {(authError || actionMessage) && (
              <section className={authError ? 'noticeBox dangerNotice' : 'noticeBox'}>
                <AlertTriangle size={18} />
                <span>{authError || actionMessage}</span>
              </section>
            )}

            {activeCandidate ? (
              <section className="candidateLayout">
                <div className="tablePanel">
                  <table>
                    <thead>
                      <tr>
                        <th>{t.candidate}</th>
                        <th>{t.city}</th>
                        <th>{t.gender}</th>
                        <th>{t.age}</th>
                        <th>{t.status}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCandidates.map((candidate) => (
                        <tr
                          className={candidate.id === selectedCandidate ? 'selectedRow' : ''}
                          key={candidate.id}
                          onClick={() => setSelectedCandidate(candidate.id)}
                        >
                          <td>
                            <button className="tableSelect" type="button">
                              <strong>{candidate.name}</strong>
                              <span>{candidate.id} · {candidate.city}</span>
                            </button>
                          </td>
                        <td>{candidate.city || '-'}</td>
                        <td>{candidate.gender || '-'}</td>
                        <td>{candidate.age || '-'}</td>
                          <td>
                            <span className={`statusPill ${statusClass(candidate)}`}>{statusLabel(candidate, t)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <aside className="detailPanel">
                <div className="profileHeader">
                  {activeCandidate.portraitPhotoPath || activeCandidate.photoPath ? (
                    <img
                      alt={t.photo}
                      className="profilePhoto"
                      src={getCandidateMediaUrl(activeCandidate.id, 'portraitPhoto', adminToken)}
                    />
                  ) : (
                    <div className="avatar">{activeCandidate.name.slice(0, 1)}</div>
                  )}
                  <div>
                    <p className="eyebrow">{activeCandidate.id}</p>
                    <h3>{activeCandidate.name}</h3>
                    <span>{activeCandidate.role} · {activeCandidate.age} · {activeCandidate.city}</span>
                  </div>
                </div>

                {!activeCandidate.portraitPhotoPath && !activeCandidate.photoPath && (
                  <section className="photoEmpty">
                    <span>{t.noPhoto}</span>
                  </section>
                )}

                {activeCandidateHasMedia && (
                  <section className="mediaPanel" aria-label={t.media}>
                    <p className="eyebrow">{t.media}</p>
                    <div className="mediaGrid">
                      {activeCandidate.fullBodyPhotoPath ? (
                        <figure className="mediaTile">
                          <img alt={t.fullBodyPhoto} src={getCandidateMediaUrl(activeCandidate.id, 'fullBodyPhoto', adminToken)} />
                          <figcaption>{t.fullBodyPhoto}</figcaption>
                        </figure>
                      ) : null}
                      {activeCandidate.closeShotPhotoPath ? (
                        <figure className="mediaTile">
                          <img alt={t.closeShotPhoto} src={getCandidateMediaUrl(activeCandidate.id, 'closeShotPhoto', adminToken)} />
                          <figcaption>{t.closeShotPhoto}</figcaption>
                        </figure>
                      ) : null}
                      {activeCandidate.leftProfilePhotoPath ? (
                        <figure className="mediaTile">
                          <img alt={t.leftProfilePhoto} src={getCandidateMediaUrl(activeCandidate.id, 'leftProfilePhoto', adminToken)} />
                          <figcaption>{t.leftProfilePhoto}</figcaption>
                        </figure>
                      ) : null}
                      {activeCandidate.rightProfilePhotoPath ? (
                        <figure className="mediaTile">
                          <img alt={t.rightProfilePhoto} src={getCandidateMediaUrl(activeCandidate.id, 'rightProfilePhoto', adminToken)} />
                          <figcaption>{t.rightProfilePhoto}</figcaption>
                        </figure>
                      ) : null}
                      {activeCandidate.portraitPhotoPath || activeCandidate.photoPath ? (
                        <figure className="mediaTile">
                          <img alt={t.photo} src={getCandidateMediaUrl(activeCandidate.id, 'portraitPhoto', adminToken)} />
                          <figcaption>{t.photo}</figcaption>
                        </figure>
                      ) : null}
                      {activeCandidate.introVideoPath ? (
                        <figure className="mediaTile mediaVideo">
                          <video controls preload="metadata" src={getCandidateMediaUrl(activeCandidate.id, 'introVideo', adminToken)} />
                          <figcaption>{t.introVideo}</figcaption>
                        </figure>
                      ) : null}
                    </div>
                  </section>
                )}

                <div className="profileFacts">
                  <Fact label={t.source} value={sourceLabel(activeCandidate, t)} />
                  <Fact label={t.consent} value={activeCandidate.guardianConsent ? t.confirmed : t.missing} />
                  <Fact label={t.duplicate} value={`${activeCandidate.duplicateScore}%`} />
                  <Fact label={t.activity} value={activeCandidate.lastActivity} />
                  <Fact label={t.telegram} value={activeCandidate.telegramUsername ? `@${activeCandidate.telegramUsername}` : activeCandidate.telegramChatId ? t.confirmed : t.noTelegram} />
                  <Fact label={t.phone} value={activeCandidate.phone || t.noPhone} />
                  <Fact label={t.instagram} value={activeCandidate.instagram || '-'} />
                  <Fact label={t.gender} value={activeCandidate.gender || '-'} />
                  <Fact label={t.city} value={activeCandidate.city || '-'} />
                  <Fact label={t.district} value={activeCandidate.district || '-'} />
                  <Fact label={t.appearance} value={activeCandidate.appearance || '-'} />
                  <Fact label={t.hair} value={activeCandidate.hair || '-'} />
                  <Fact label={t.facialHair} value={activeCandidate.facialHair || '-'} />
                  <Fact label={t.glasses} value={activeCandidate.glasses || '-'} />
                  <Fact label={t.tattoos} value={activeCandidate.tattoos || '-'} />
                  <Fact label={t.height} value={activeCandidate.height || '-'} />
                  <Fact label={t.weight} value={activeCandidate.weight || '-'} />
                  <Fact label={t.playableAge} value={activeCandidate.playableAge || '-'} />
                  <Fact label={t.skills} value={activeCandidate.skills || '-'} />
                  <Fact label={t.performanceTalents} value={activeCandidate.performanceTalents || '-'} />
                  <Fact label={t.sportsTalents} value={activeCandidate.sportsTalents || '-'} />
                  <Fact label={t.physicalSkills} value={activeCandidate.physicalSkills || '-'} />
                  <Fact label={t.languageSkills} value={activeCandidate.languageSkills || '-'} />
                  <Fact label={t.skillsMedia} value={activeCandidate.skillsMediaPath ? t.confirmed : t.missing} />
                  <Fact label={t.experience} value={activeCandidate.experience || '-'} />
                  <Fact label={t.introVideo} value={activeCandidate.introVideoPath ? t.confirmed : t.missing} />
                  <Fact label={t.availability} value={activeCandidate.availability || '-'} />
                  <Fact label={t.guardianContact} value={activeCandidate.guardianContact || '-'} />
                </div>

                <div className="tagCloud">
                  <span>{sourceLabel(activeCandidate, t)}</span>
                  <span>{statusLabel(activeCandidate, t)}</span>
                  {activeCandidate.age > 0 && activeCandidate.age < 18 && <span>{t.consent}</span>}
                </div>

                <section className="reviewBox">
                  <CheckCircle2 size={18} />
                  <div>
                    <p className="eyebrow">{t.governanceCheck}</p>
                    <strong>{reviewText(activeCandidate, t)}</strong>
                  </div>
                </section>

                <div className="buttonRow">
                  <button
                    className="primaryButton"
                    disabled={!isAuthed || ['approved', 'verified'].includes(activeCandidate.rawStatus ?? '')}
                    onClick={() => updateCandidateDecision('approve')}
                    type="button"
                  >
                    <UserCheck size={18} />
                    <span>{t.approve}</span>
                  </button>
                  <button
                    className="dangerButton"
                    disabled={!isAuthed || activeCandidate.rawStatus === 'rejected'}
                    onClick={() => updateCandidateDecision('reject')}
                    type="button"
                  >
                    <LockKeyhole size={18} />
                    <span>{t.reject}</span>
                  </button>
                </div>
                </aside>
              </section>
            ) : (
              <section className="emptyState">
                <Users size={28} />
                <strong>{t.noCandidates}</strong>
              </section>
            )}
          </div>
        )}

        {activeView === 'campaigns' && (
          <div className="viewStack">
            <section className="toolbar">
              <div className="segmentedControl" aria-label={t.campaigns}>
                <button className={campaignMode === 'targeted' ? 'active' : ''} onClick={() => setCampaignMode('targeted')} type="button">
                  {t.targeted}
                </button>
                <button className={campaignMode === 'broad' ? 'active' : ''} onClick={() => setCampaignMode('broad')} type="button">
                  {t.broad}
                </button>
              </div>
              <button className="primaryButton" type="button">
                <Send size={18} />
                <span>{t.campaigns}</span>
              </button>
            </section>
            <section className="campaignGrid">
              {[t.fatigue, t.dataQuality, t.security].map((title) => (
                <article className="campaignCard" key={title}>
                  <div className="campaignHeader">
                    <div>
                      <p className="eyebrow">{t.governanceCheck}</p>
                      <h3>{title}</h3>
                    </div>
                    <span className="statusPill statusWarn">{t.pending}</span>
                  </div>
                  <p>{t.campaignGate}</p>
                </article>
              ))}
            </section>
          </div>
        )}

        {activeView === 'governance' && (
          <div className="viewStack">
            <section className="splitLayout">
              <InfoPanel
                icon={<ShieldCheck size={19} />}
                items={[
                  [t.security, t.securityText],
                  [t.dataQuality, t.dataQualityText],
                  [t.fatigue, t.fatigueText],
                ]}
                title={t.governanceTitle}
              />
              <InfoPanel
                icon={<LockKeyhole size={19} />}
                items={[
                  [t.adminPasscode, isAuthed ? t.confirmed : t.missing],
                  [t.export, t.governanceCheck],
                  [t.telegram, t.apiOnline],
                ]}
                title={t.security}
              />
            </section>
            <section className="panel">
              <div className="panelHeader">
                <div>
                  <p className="eyebrow">{t.governance}</p>
                  <h3>{t.auditTitle}</h3>
                </div>
                <RefreshCw size={19} />
              </div>
              <div className="auditList">
                {auditEvents.length ? (
                  auditEvents.map((event) => (
                    <article className="auditRow" key={`${event.at}-${event.action}-${event.candidateId ?? ''}`}>
                      <div>
                        <strong>{event.action}</strong>
                        <p>{event.candidateId ? `${t.candidate}: ${event.candidateId}` : t.governance}</p>
                      </div>
                      <span>{new Date(event.at).toLocaleString()}</span>
                    </article>
                  ))
                ) : (
                  <article className="auditRow">
                    <div>
                      <strong>{t.auditTitle}</strong>
                      <p>{t.auditEmpty}</p>
                    </div>
                  </article>
                )}
              </div>
            </section>
          </div>
        )}

        {activeView === 'vendors' && (
          <div className="viewStack">
            <section className="vendorGrid">
              {[
                ['Telegram', t.candidates, 'MessagingProvider'],
                ['Google Sheets', t.export, 'CandidateRepository'],
                ['Storage', t.source, 'StorageProvider'],
              ].map(([name, area, abstraction]) => (
                <article className="vendorCard" key={name}>
                  <div className="vendorHeader">
                    <div>
                      <p className="eyebrow">{area}</p>
                      <h3>{name}</h3>
                    </div>
                    <span className="statusPill statusWarn">{t.pending}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>{t.governanceCheck}</dt>
                      <dd>{abstraction}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </section>
          </div>
        )}
      </section>
    </main>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function BriefFact({ label, value }: { label: string; value: string }) {
  return <section className="briefFact"><span>{label}</span><p>{value}</p></section>
}

function InfoPanel({ icon, items, title }: { icon: ReactNode; items: string[][]; title: string }) {
  return (
    <div className="panel">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">FACE Production</p>
          <h3>{title}</h3>
        </div>
        {icon}
      </div>
      <div className="riskList">
        {items.map(([name, value]) => (
          <article className="riskRow" key={name}>
            <div>
              <strong>{name}</strong>
              <p>{value}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function statusClass(candidate: Candidate) {
  if (['approved', 'verified'].includes(candidate.rawStatus ?? '')) {
    return 'statusGood'
  }

  if (candidate.rawStatus === 'rejected') {
    return 'statusBad'
  }

  if (candidate.rawStatus === 'incomplete') {
    return 'statusIdle'
  }

  return 'statusWarn'
}

function statusLabel(candidate: Candidate, t: typeof text.ru) {
  if (['approved', 'verified'].includes(candidate.rawStatus ?? '')) {
    return t.active
  }

  if (candidate.rawStatus === 'rejected') {
    return t.blocked
  }

  if (candidate.rawStatus === 'incomplete') {
    return t.incomplete
  }

  return t.pending
}

function sourceLabel(candidate: Candidate, t: typeof text.ru) {
  if (candidate.source.toLowerCase().includes('telegram')) {
    return 'Telegram'
  }

  if (candidate.source.toLowerCase().includes('seed')) {
    return t.sourceSeed
  }

  return candidate.source
}

function reviewText(candidate: Candidate, t: typeof text.ru) {
  const issues = []

  if (candidate.age < 18 && !candidate.guardianConsent) {
    issues.push(t.consent)
  }

  if (candidate.profileQuality < 60) {
    issues.push(t.quality)
  }

  if (candidate.rawStatus === 'rejected') {
    issues.push(t.blocked)
  }

  return issues.length ? issues.join(', ') : t.reviewOk
}

export default App
