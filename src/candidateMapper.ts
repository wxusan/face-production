import type { ApiCandidate } from './api'
import type { Candidate, CandidateStatus } from './platformData'

function toStatus(status: string): CandidateStatus {
  if (['approved', 'verified'].includes(status)) {
    return 'Verified'
  }

  if (status === 'rejected') {
    return 'Blacklisted'
  }

  if (status === 'incomplete') {
    return 'Incomplete'
  }

  return 'Needs moderation'
}

function toQuality(candidate: ApiCandidate) {
  const requiredFields = [
    candidate.name,
    candidate.phone,
    candidate.age,
    candidate.city,
    candidate.gender,
    candidate.height,
    candidate.weight,
    candidate.fullBodyPhotoPath,
    candidate.closeShotPhotoPath,
    candidate.leftProfilePhotoPath,
    candidate.rightProfilePhotoPath,
    candidate.portraitPhotoPath,
    candidate.introVideoPath,
  ]
  const completed = requiredFields.filter(Boolean).length
  const consentPenalty = candidate.consent === 'missing' ? 20 : 0

  return Math.max(20, Math.min(100, Math.round((completed / requiredFields.length) * 100) - consentPenalty))
}

function formatList(value?: string | string[]) {
  if (Array.isArray(value)) {
    return value.join(', ')
  }

  return value
}

function toLastActivity(candidate: ApiCandidate) {
  if (!candidate.updatedAt && !candidate.createdAt) {
    return 'Нет данных'
  }

  const timestamp = new Date(candidate.updatedAt ?? candidate.createdAt ?? '')

  if (Number.isNaN(timestamp.getTime())) {
    return 'Недавно'
  }

  return timestamp.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function mapApiCandidate(candidate: ApiCandidate): Candidate {
  const age = candidate.age ?? 0
  const tags = [
    candidate.source ?? 'telegram',
    candidate.status,
    age > 0 && age < 18 ? 'minor' : '',
  ].filter(Boolean)

  return {
    age,
    appearance: formatList(candidate.appearance),
    availability: candidate.availability,
    braces: candidate.braces,
    city: candidate.city ?? 'Не указан',
    closeShotPhotoPath: candidate.closeShotPhotoPath,
    district: candidate.district,
    duplicateScore: 0,
    experience: candidate.experience,
    experienceLevel: candidate.experienceLevel,
    facialHair: candidate.facialHair,
    gender: candidate.gender,
    glasses: candidate.glasses,
    guardianContact: candidate.guardianContact,
    guardianConsent: candidate.consent !== 'missing',
    hair: candidate.hair,
    height: candidate.height,
    id: candidate.id,
    instagram: candidate.instagram,
    introVideoPath: candidate.introVideoPath,
    languageSkills: formatList(candidate.languageSkills),
    lastActivity: toLastActivity(candidate),
    leftProfilePhotoPath: candidate.leftProfilePhotoPath,
    name: candidate.name,
    phone: candidate.phone,
    playableAge: candidate.playableAge,
    photoFileId: candidate.photoFileId,
    photoPath: candidate.photoPath,
    fullBodyPhotoPath: candidate.fullBodyPhotoPath,
    performanceTalents: formatList(candidate.performanceTalents),
    physicalSkills: formatList(candidate.physicalSkills),
    portraitPhotoPath: candidate.portraitPhotoPath,
    profileQuality: toQuality(candidate),
    rawStatus: candidate.status,
    role: candidate.role ?? 'Кандидат',
    rightProfilePhotoPath: candidate.rightProfilePhotoPath,
    skills: candidate.skills,
    skillsMediaPath: candidate.skillsMediaPath,
    sportsTalents: formatList(candidate.sportsTalents),
    source: candidate.source ?? 'telegram',
    status: toStatus(candidate.status),
    tattoos: candidate.tattoos,
    tags,
    telegramChatId: candidate.telegramChatId,
    telegramUsername: candidate.telegramUsername,
    weight: candidate.weight,
  }
}
