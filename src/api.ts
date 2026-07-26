const API_BASE = ''

export function getCandidateExportUrl() {
  return `${API_BASE}/api/candidates/export.csv`
}

export function getCandidatePhotoUrl(candidateId: string) {
  return `${API_BASE}/api/candidates/${candidateId}/photo`
}

export function getCandidateMediaUrl(
  candidateId: string,
  kind: 'closeShotPhoto' | 'fullBodyPhoto' | 'introVideo' | 'leftProfilePhoto' | 'portraitPhoto' | 'rightProfilePhoto',
) {
  return `${API_BASE}/api/candidates/${candidateId}/media/${kind}`
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

type RequestOptions = {
  body?: unknown
  method?: string
}

async function apiRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
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
  const response = await fetch(`${API_BASE}/api/health`, { credentials: 'same-origin' })
  return response.json()
}

export async function loginAdmin(token: string) {
  return apiRequest<{ ok: true }>('/api/auth/login', { body: { token }, method: 'POST' })
}

export async function logoutAdmin() {
  return apiRequest<{ ok: true }>('/api/auth/logout', { method: 'POST' })
}

export async function listApiCandidates() {
  const data = await apiRequest<{ candidates: ApiCandidate[] }>('/api/candidates', {})
  return data.candidates
}

export async function approveCandidate(candidateId: string) {
  return apiRequest<{ candidate: ApiCandidate; ok: true }>(`/api/candidates/${candidateId}/approve`, {
    method: 'POST',
  })
}

export async function rejectCandidate(candidateId: string) {
  return apiRequest<{ candidate: ApiCandidate; ok: true }>(`/api/candidates/${candidateId}/reject`, {
    method: 'POST',
  })
}

export async function listAuditEvents() {
  const data = await apiRequest<{ events: AuditEvent[] }>('/api/audit', {})
  return data.events
}
