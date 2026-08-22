import {
  BarChart3,
  Bot,
  BrainCircuit,
  Cloud,
  Database,
  GraduationCap,
  HardDrive,
  KeyRound,
  MessageCircle,
  Search,
  ShieldCheck,
  Siren,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type CandidateStatus = 'Verified' | 'Needs moderation' | 'Incomplete' | 'Blacklisted'
export type RiskLevel = 'Low' | 'Medium' | 'High'
export type ApprovalState = 'Approved' | 'Human review' | 'Blocked'

export type Candidate = {
  id: string
  name: string
  age: number
  appearance?: string
  availability?: string
  braces?: string
  city: string
  closeShotPhotoPath?: string
  district?: string
  experience?: string
  experienceLevel?: string
  facialHair?: string
  gender?: string
  glasses?: string
  guardianContact?: string
  hair?: string
  height?: string
  instagram?: string
  introVideoPath?: string
  role: string
  source: string
  guardianConsent: boolean
  status: CandidateStatus
  duplicateScore: number
  profileQuality: number
  lastActivity: string
  phone?: string
  photoFileId?: string
  photoPath?: string
  playableAge?: string
  fullBodyPhotoPath?: string
  languageSkills?: string
  leftProfilePhotoPath?: string
  performanceTalents?: string
  physicalSkills?: string
  portraitPhotoPath?: string
  rightProfilePhotoPath?: string
  rawStatus?: string
  skills?: string
  skillsMediaPath?: string
  sportsTalents?: string
  tattoos?: string
  telegramChatId?: number | null
  telegramUsername?: string
  weight?: string
  tags: string[]
}

export type Campaign = {
  id: string
  name: string
  audience: string
  channel: string
  responseRate: number
  fatigueRisk: RiskLevel
  approval: ApprovalState
}

export type VendorDependency = {
  name: string
  area: string
  owner: string
  abstraction: string
  risk: RiskLevel
}

export type GovernanceDecision = {
  title: string
  owner: string
  status: ApprovalState
  reason: string
}

export type Metric = {
  label: string
  value: string
  detail: string
  trend: 'up' | 'down' | 'flat'
}

export type NavigationItem = {
  id: string
  label: string
  icon: LucideIcon
}

export const navigation: NavigationItem[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'candidates', label: 'Candidates', icon: Users },
  { id: 'campaigns', label: 'Campaigns', icon: MessageCircle },
  { id: 'governance', label: 'Governance', icon: ShieldCheck },
  { id: 'vendors', label: 'Vendors', icon: Cloud },
]

export const metrics: Metric[] = [
  {
    label: 'Candidate base',
    value: '12,480',
    detail: '+8.4% this month',
    trend: 'up',
  },
  {
    label: 'Registration conversion',
    value: '64%',
    detail: 'Intake to complete profile',
    trend: 'up',
  },
  {
    label: 'Duplicate rate',
    value: '3.8%',
    detail: 'Target below 5%',
    trend: 'down',
  },
  {
    label: 'Admin efficiency',
    value: '31 min',
    detail: 'Median review cycle',
    trend: 'flat',
  },
]

export const candidates: Candidate[] = [
  {
    id: 'FC-1048',
    name: 'Anisa Karimova',
    age: 16,
    city: 'Tashkent',
    role: 'Актер',
    source: 'Telegram',
    guardianConsent: true,
    status: 'Verified',
    duplicateScore: 8,
    profileQuality: 92,
    lastActivity: 'Сегодня',
    tags: ['telegram', 'approved'],
  },
  {
    id: 'FC-1081',
    name: 'Bekzod Yunusov',
    age: 24,
    city: 'Samarkand',
    role: 'Модель',
    source: 'Админ',
    guardianConsent: true,
    status: 'Needs moderation',
    duplicateScore: 42,
    profileQuality: 71,
    lastActivity: 'Вчера',
    tags: ['review'],
  },
  {
    id: 'FC-1119',
    name: 'Madina Rasulova',
    age: 13,
    city: 'Tashkent',
    role: 'Голос',
    source: 'Telegram',
    guardianConsent: false,
    status: 'Incomplete',
    duplicateScore: 12,
    profileQuality: 58,
    lastActivity: '2 дня назад',
    tags: ['minor'],
  },
  {
    id: 'FC-1174',
    name: 'Oybek Sattarov',
    age: 31,
    city: 'Bukhara',
    role: 'Массовка',
    source: 'Google Sheet',
    guardianConsent: true,
    status: 'Verified',
    duplicateScore: 4,
    profileQuality: 86,
    lastActivity: '4 дня назад',
    tags: ['approved'],
  },
  {
    id: 'FC-1220',
    name: 'Закрытый профиль',
    age: 15,
    city: 'Tashkent',
    role: 'Танцор',
    source: 'Telegram',
    guardianConsent: false,
    status: 'Blacklisted',
    duplicateScore: 91,
    profileQuality: 33,
    lastActivity: '1 неделя назад',
    tags: ['blocked'],
  },
]

export const campaigns: Campaign[] = [
  {
    id: 'CMP-021',
    name: 'Teen actors for studio callback',
    audience: 'Verified minors with guardian consent',
    channel: 'Telegram targeted broadcast',
    responseRate: 28,
    fatigueRisk: 'Low',
    approval: 'Human review',
  },
  {
    id: 'CMP-022',
    name: 'Fashion model refresh',
    audience: 'Adult models, Tashkent and Samarkand',
    channel: 'Telegram + admin follow-up',
    responseRate: 34,
    fatigueRisk: 'Medium',
    approval: 'Approved',
  },
  {
    id: 'CMP-023',
    name: 'Bulk all-candidate message',
    audience: 'All active profiles',
    channel: 'Telegram broadcast',
    responseRate: 7,
    fatigueRisk: 'High',
    approval: 'Blocked',
  },
]

export const vendorDependencies: VendorDependency[] = [
  {
    name: 'Telegram Bot API',
    area: 'candidate intake and messaging',
    owner: 'Growth ops',
    abstraction: 'MessagingProvider interface',
    risk: 'High',
  },
  {
    name: 'AI model API',
    area: 'profile tagging and duplicate hints',
    owner: 'Product',
    abstraction: 'AiReviewProvider interface',
    risk: 'Medium',
  },
  {
    name: 'Google Sheets',
    area: 'MVP records and exports',
    owner: 'Operations',
    abstraction: 'CandidateRepository interface',
    risk: 'High',
  },
  {
    name: 'Cloud object storage',
    area: 'media and backups',
    owner: 'Engineering',
    abstraction: 'StorageProvider interface',
    risk: 'Medium',
  },
]

export const governanceDecisions: GovernanceDecision[] = [
  {
    title: 'Launch campaign to minor candidates',
    owner: 'Casting director',
    status: 'Human review',
    reason: 'Requires guardian consent and child profile visibility check.',
  },
  {
    title: 'Enable AI duplicate merge suggestions',
    owner: 'Product governance',
    status: 'Approved',
    reason: 'AI can suggest, but admins must approve every merge.',
  },
  {
    title: 'Add external client search portal',
    owner: 'Executive sponsor',
    status: 'Blocked',
    reason: 'Future commercialization feature, not part of MVP rollout.',
  },
]

export const securityRules = [
  { label: 'Admin access', value: 'Role scoped' },
  { label: 'Exports', value: 'Approval required' },
  { label: 'Blacklist authority', value: 'Senior admin only' },
  { label: 'Child visibility', value: 'Restricted by default' },
  { label: 'Credential rotation', value: 'Quarterly' },
  { label: 'Incidents', value: 'Runbook required' },
]

export const maintenanceQueue = [
  { icon: MessageCircle, label: 'Telegram API checks', cadence: 'Weekly' },
  { icon: KeyRound, label: 'Credential rotation audit', cadence: 'Quarterly' },
  { icon: Bot, label: 'AI model review', cadence: 'Monthly' },
  { icon: HardDrive, label: 'Backup restore test', cadence: 'Monthly' },
  { icon: Siren, label: 'Security patch review', cadence: 'Weekly' },
]

export const migrationSteps = [
  { icon: Database, from: 'Google Sheets', to: 'Candidate database', state: 'MVP now' },
  { icon: HardDrive, from: 'Google Drive', to: 'Cloud object storage', state: 'Phase 2' },
  { icon: Search, from: 'Basic search', to: 'Search engine', state: 'Phase 2' },
  { icon: BrainCircuit, from: 'Manual tags', to: 'AI indexing with review', state: 'Phase 3' },
  { icon: GraduationCap, from: 'Ad hoc reporting', to: 'Analytics layer', state: 'Phase 3' },
]

export const architecturePrinciples = [
  'Human approval is required for AI-generated decisions.',
  'Vendor dependencies must sit behind provider interfaces.',
  'Every data store must support export, backup control, and migration.',
  'Feature work requires prioritization before live architecture changes.',
  'Reliability and auditability win over flashy automation.',
]

export const productRisks = [
  {
    title: 'Overengineering',
    impact: 'Building too much too early',
    mitigation: 'Phased rollout',
    level: 'Medium' as RiskLevel,
  },
  {
    title: 'Admin misuse',
    impact: 'Bad internal processes',
    mitigation: 'Training and permissions',
    level: 'High' as RiskLevel,
  },
  {
    title: 'Notification fatigue',
    impact: 'Candidates mute the platform',
    mitigation: 'Targeted campaigns',
    level: 'Medium' as RiskLevel,
  },
  {
    title: 'Data quality',
    impact: 'Garbage in, garbage out',
    mitigation: 'Validation and moderation',
    level: 'High' as RiskLevel,
  },
]

export const approvalClass: Record<ApprovalState, string> = {
  Approved: 'statusGood',
  'Human review': 'statusWarn',
  Blocked: 'statusBad',
}

export const riskClass: Record<RiskLevel, string> = {
  Low: 'statusGood',
  Medium: 'statusWarn',
  High: 'statusBad',
}

export const candidateClass: Record<CandidateStatus, string> = {
  Verified: 'statusGood',
  'Needs moderation': 'statusWarn',
  Incomplete: 'statusIdle',
  Blacklisted: 'statusBad',
}

export function getCandidateReview(candidate: Candidate) {
  const failures = []

  if (candidate.age < 18 && !candidate.guardianConsent) {
    failures.push('guardian consent missing')
  }

  if (candidate.duplicateScore >= 80) {
    failures.push('high duplicate score')
  }

  if (candidate.profileQuality < 60) {
    failures.push('profile quality below threshold')
  }

  if (candidate.status === 'Blacklisted') {
    failures.push('blacklist authority required')
  }

  return failures.length ? failures.join(', ') : 'ready for governed use'
}

export function getCampaignGate(campaign: Campaign) {
  if (campaign.fatigueRisk === 'High') {
    return 'blocked by notification fatigue policy'
  }

  if (campaign.approval === 'Human review') {
    return 'awaiting human approval'
  }

  return 'ready to send'
}
