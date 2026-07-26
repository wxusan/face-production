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
} from 'lucide-react'
import './App.css'
import {
  approveCandidate,
  getCandidateExportUrl,
  getCandidateMediaUrl,
  getHealth,
  loginAdmin,
  listApiCandidates,
  listAuditEvents,
  logoutAdmin,
  rejectCandidate,
  type AuditEvent,
} from './api'
import { mapApiCandidate } from './candidateMapper'
import { candidates, type Candidate } from './platformData'

type AdminLang = 'ru' | 'uz'
type ViewId = 'overview' | 'candidates' | 'campaigns' | 'governance' | 'vendors'

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
  },
}

const navIcons: Record<ViewId, typeof Users> = {
  campaigns: MessageCircle,
  candidates: Users,
  governance: ShieldCheck,
  overview: BarChart3,
  vendors: Cloud,
}

function App() {
  const [lang, setLang] = useState<AdminLang>(() => (localStorage.getItem('face-admin-lang') as AdminLang) || 'ru')
  const t = text[lang]
  const navigation = useMemo(() => [
    { id: 'candidates' as ViewId, label: t.candidates },
  ], [t])
  const [activeView, setActiveView] = useState<ViewId>('candidates')
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'offline'>('checking')
  const [isAuthed, setIsAuthed] = useState(false)
  const [tokenInput, setTokenInput] = useState('')
  const [authError, setAuthError] = useState('')
  const [candidateRows, setCandidateRows] = useState(candidates)
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
  const [actionMessage, setActionMessage] = useState('')
  const [query, setQuery] = useState('')
  const [selectedCandidate, setSelectedCandidate] = useState(candidates[0].id)
  const [campaignMode, setCampaignMode] = useState<'targeted' | 'broad'>('targeted')

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

  const loadAdminData = useCallback(async () => {
    setAuthError('')

    try {
      const [apiCandidates, events] = await Promise.all([
        listApiCandidates(),
        listAuditEvents(),
      ])
      setIsAuthed(true)
      const mappedCandidates = apiCandidates.map(mapApiCandidate)
      setCandidateRows(mappedCandidates)
      setAuditEvents(events.slice(-8).reverse())

      if (!mappedCandidates.some((candidate) => candidate.id === selectedCandidate)) {
        setSelectedCandidate(mappedCandidates[0]?.id ?? '')
      }
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Ошибка доступа')
      setIsAuthed(false)
    }
  }, [selectedCandidate])

  useEffect(() => {
    const refresh = window.setTimeout(() => {
      void loadAdminData()
    }, 0)

    return () => window.clearTimeout(refresh)
  }, [loadAdminData])

  useEffect(() => {
    if (!isAuthed) {
      return undefined
    }

    const refresh = window.setInterval(() => {
      void loadAdminData()
    }, 5000)

    return () => window.clearInterval(refresh)
  }, [isAuthed, loadAdminData])

  const saveAdminToken = async () => {
    const token = tokenInput.trim()
    if (!token) return

    try {
      await loginAdmin(token)
      setTokenInput('')
      setIsAuthed(true)
      await loadAdminData()
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Ошибка доступа')
      setIsAuthed(false)
    }
  }

  const clearAdminToken = () => {
    void logoutAdmin().catch(() => undefined)
    setIsAuthed(false)
    setTokenInput('')
    setCandidateRows(candidates)
    setAuditEvents([])
  }

  const updateLanguage = (nextLang: AdminLang) => {
    setLang(nextLang)
  }

  const updateCandidateDecision = async (decision: 'approve' | 'reject') => {
    if (!isAuthed) {
      setAuthError(t.noAuth)
      return
    }

    if (!activeCandidate) {
      setActionMessage(t.noCandidates)
      return
    }

    const request = decision === 'approve' ? approveCandidate : rejectCandidate

    try {
      await request(activeCandidate.id)
      await loadAdminData()
      setActionMessage(`${activeCandidate.id}: ${decision === 'approve' ? t.approve : t.reject}.`)
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Ошибка')
    }
  }

  const exportCandidates = () => {
    if (!isAuthed) {
      return
    }

    window.location.href = getCandidateExportUrl()
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
                      src={getCandidateMediaUrl(activeCandidate.id, 'portraitPhoto')}
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
                          <img alt={t.fullBodyPhoto} src={getCandidateMediaUrl(activeCandidate.id, 'fullBodyPhoto')} />
                          <figcaption>{t.fullBodyPhoto}</figcaption>
                        </figure>
                      ) : null}
                      {activeCandidate.closeShotPhotoPath ? (
                        <figure className="mediaTile">
                          <img alt={t.closeShotPhoto} src={getCandidateMediaUrl(activeCandidate.id, 'closeShotPhoto')} />
                          <figcaption>{t.closeShotPhoto}</figcaption>
                        </figure>
                      ) : null}
                      {activeCandidate.leftProfilePhotoPath ? (
                        <figure className="mediaTile">
                          <img alt={t.leftProfilePhoto} src={getCandidateMediaUrl(activeCandidate.id, 'leftProfilePhoto')} />
                          <figcaption>{t.leftProfilePhoto}</figcaption>
                        </figure>
                      ) : null}
                      {activeCandidate.rightProfilePhotoPath ? (
                        <figure className="mediaTile">
                          <img alt={t.rightProfilePhoto} src={getCandidateMediaUrl(activeCandidate.id, 'rightProfilePhoto')} />
                          <figcaption>{t.rightProfilePhoto}</figcaption>
                        </figure>
                      ) : null}
                      {activeCandidate.portraitPhotoPath || activeCandidate.photoPath ? (
                        <figure className="mediaTile">
                          <img alt={t.photo} src={getCandidateMediaUrl(activeCandidate.id, 'portraitPhoto')} />
                          <figcaption>{t.photo}</figcaption>
                        </figure>
                      ) : null}
                      {activeCandidate.introVideoPath ? (
                        <figure className="mediaTile mediaVideo">
                          <video controls preload="metadata" src={getCandidateMediaUrl(activeCandidate.id, 'introVideo')} />
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
