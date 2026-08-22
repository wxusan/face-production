const API_BASE = ''

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
