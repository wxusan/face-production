const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export function getCandidateExportUrl(token: string) {
  return `${API_BASE}/api/candidates/export.csv?token=${encodeURIComponent(token)}`
}

export function getCandidatePhotoUrl(candidateId: string, token: string) {
  return `${API_BASE}/api/candidates/${candidateId}/photo?token=${encodeURIComponent(token)}`
}

export function getCandidateMediaUrl(
  candidateId: string,
  kind: 'closeShotPhoto' | 'fullBodyPhoto' | 'introVideo' | 'leftProfilePhoto' | 'portraitPhoto' | 'rightProfilePhoto',
  token: string,
) {
  return `${API_BASE}/api/candidates/${candidateId}/media/${kind}?token=${encodeURIComponent(token)}`
}

export type ApiCandidate = {
  age?: number
  appearance?: string | string[]
  availability?: string
  braces?: string
  city?: string
  closeShotPhotoFileId?: string
  closeShotPhotoPath?: string
  consent?: string
  createdAt?: string
  district?: string
  experience?: string
  experienceLevel?: string
  facialHair?: string
  gender?: string
  glasses?: string
  guardianConsent?: string
  guardianContact?: string
  hair?: string
  height?: string
  id: string
  instagram?: string
  introVideoFileId?: string
  introVideoPath?: string
  languageSkills?: string[]
  leftProfilePhotoFileId?: string
  leftProfilePhotoPath?: string
  name: string
  phone?: string
  photoFileId?: string
  photoPath?: string
  playableAge?: string
  portraitPhotoFileId?: string
  portraitPhotoPath?: string
  rightProfilePhotoFileId?: string
  rightProfilePhotoPath?: string
  fullBodyPhotoFileId?: string
  fullBodyPhotoPath?: string
  performanceTalents?: string[]
  physicalSkills?: string[]
  role?: string
  skills?: string
  skillsMediaPath?: string
  sportsTalents?: string[]
  source?: string
  status: string
  tattoos?: string
  telegramChatId?: number | null
  telegramUsername?: string
  updatedAt?: string
  weight?: string
}

export type AuditEvent = {
  action: string
  at: string
  candidateId?: string
  outcome?: string
}

export type ApiBrief = {
  id: string
  status: 'new' | 'contacted' | 'qualified' | 'closed'
  locale: 'ru' | 'en' | 'uz'
  clientName: string
  company?: string
  phoneOrTelegram: string
  email?: string
  projectTitle?: string
  projectType: string
  rolesNeeded: string
  shootingDate?: string
  location?: string
  budget?: string
  usageRights?: string
  referenceLinks?: string
  notes?: string
  internalNotes?: string
  assignedTo?: string
  attachments?: Array<{ name: string; contentType: string; size: number }>
  createdAt: string
  updatedAt: string
}

export type ApiAdmin = {
  id: string
  name: string
  email?: string
  role: 'super_admin' | 'admin'
  status: 'active' | 'disabled'
  telegramUserId?: string
  telegramUsername?: string
  telegramNotifications: boolean
  telegramNotificationsAllowed: boolean
  createdAt: string
}

type RequestOptions = {
  body?: unknown
  method?: string
  token: string
}

async function apiRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      'x-admin-token': options.token,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.error ?? 'API request failed')
  }

  return data
}

export async function getHealth() {
  const response = await fetch(`${API_BASE}/api/health`)
  return response.json()
}

export async function listApiCandidates(token: string) {
  const data = await apiRequest<{ candidates: ApiCandidate[] }>('/api/candidates', { token })
  return data.candidates
}

export async function approveCandidate(candidateId: string, token: string) {
  return apiRequest<{ candidate: ApiCandidate; ok: true }>(`/api/candidates/${candidateId}/approve`, {
    method: 'POST',
    token,
  })
}

export async function rejectCandidate(candidateId: string, token: string) {
  return apiRequest<{ candidate: ApiCandidate; ok: true }>(`/api/candidates/${candidateId}/reject`, {
    method: 'POST',
    token,
  })
}

export async function listAuditEvents(token: string) {
  const data = await apiRequest<{ events: AuditEvent[] }>('/api/audit', { token })
  return data.events
}

export async function getAdminSession(token: string) {
  const data = await apiRequest<{ admin: ApiAdmin }>('/api/session', { token })
  return data.admin
}

export async function listApiBriefs(token: string) {
  const data = await apiRequest<{ briefs: ApiBrief[] }>('/api/briefs', { token })
  return data.briefs
}

export async function updateApiBrief(id: string, changes: Partial<ApiBrief>, token: string) {
  const data = await apiRequest<{ brief: ApiBrief }>(`/api/briefs/${encodeURIComponent(id)}`, {
    body: changes,
    method: 'PATCH',
    token,
  })
  return data.brief
}

export function getBriefAttachmentUrl(briefId: string, index: number, token: string) {
  return `${API_BASE}/api/briefs/${encodeURIComponent(briefId)}/attachments/${index}?token=${encodeURIComponent(token)}`
}

export async function listApiAdmins(token: string) {
  const data = await apiRequest<{ admins: ApiAdmin[] }>('/api/admins', { token })
  return data.admins
}

export async function inviteApiAdmin(input: Partial<ApiAdmin>, token: string) {
  return apiRequest<{ accessToken: string; admin: ApiAdmin }>('/api/admins', { body: input, method: 'POST', token })
}

export async function updateApiAdmin(id: string, changes: Partial<ApiAdmin>, token: string) {
  const data = await apiRequest<{ admin: ApiAdmin }>(`/api/admins/${encodeURIComponent(id)}`, {
    body: changes,
    method: 'PATCH',
    token,
  })
  return data.admin
}
