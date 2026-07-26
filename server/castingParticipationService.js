import {
  candidateCastingProfileMissingFields,
  findCandidate,
  findCandidateByTelegramId,
  isCandidateEligibleForCastingApplication,
} from './candidateRepository.js'
import { findCasting, findCastingByPublicToken } from './castingRepository.js'
import { isCastingOpen } from './castingLifecycle.js'
import {
  findCastingParticipation,
  snapshotCandidateProfile,
  transitionCastingParticipation,
  upsertCastingParticipation,
} from './castingParticipationRepository.js'
import { recordAuditEvent } from './auditLog.js'

function participationOutcome(participation) {
  return participation?.status ?? undefined
}

function castingClosed(casting, now) {
  if (['closed', 'cancelled', 'archived'].includes(casting?.status)) {
    return true
  }
  return Boolean(casting?.endsAt && new Date(casting.endsAt) <= now)
}

export async function getCastingParticipationContext({
  now = new Date(),
  publicToken,
  telegramUserId,
}) {
  const current = now instanceof Date ? now : new Date(now)
  const casting = await findCastingByPublicToken(publicToken)

  if (!casting) {
    return { outcome: 'not_found' }
  }
  if (castingClosed(casting, current)) {
    return { casting, outcome: 'closed' }
  }
  if (!isCastingOpen(casting, current)) {
    return { casting, outcome: 'not_open' }
  }

  const candidate = await findCandidateByTelegramId(telegramUserId)
  if (!candidate) {
    return { casting, outcome: 'registration_required' }
  }

  const missingFields = candidateCastingProfileMissingFields(candidate)
  if (missingFields.length > 0) {
    return { candidate, casting, missingFields, outcome: 'profile_incomplete' }
  }
  if (candidate.status === 'rejected') {
    return { candidate, casting, outcome: 'profile_rejected' }
  }

  const participation = await findCastingParticipation(casting.id, candidate.id)
  const existingOutcome = participationOutcome(participation)
  if (existingOutcome) {
    return { candidate, casting, outcome: existingOutcome, participation }
  }

  if (
    !isCandidateEligibleForCastingApplication(candidate)
  ) {
    return { candidate, casting, outcome: 'not_eligible' }
  }

  return { candidate, casting, outcome: 'can_apply' }
}

export async function applyToCastingByToken({
  now = new Date(),
  publicToken,
  telegramUserId,
}) {
  const context = await getCastingParticipationContext({ now, publicToken, telegramUserId })
  if (context.outcome === 'applied' || context.outcome === 'selected') {
    return { ...context, changed: false }
  }
  if (!['can_apply', 'invited'].includes(context.outcome)) {
    return { ...context, changed: false }
  }

  const status = context.outcome === 'invited' ? 'selected' : 'applied'
  const result = context.participation
    ? await transitionCastingParticipation({
        actor: `telegram:${telegramUserId}`,
        candidateId: context.candidate.id,
        castingId: context.casting.id,
        status,
      })
    : await upsertCastingParticipation({
        actor: `telegram:${telegramUserId}`,
        candidateId: context.candidate.id,
        castingId: context.casting.id,
        profileSnapshot: snapshotCandidateProfile(context.candidate),
        source: 'self_apply',
        status,
      })

  await recordAuditEvent({
    action: status === 'selected' ? 'casting.invitation_accepted' : 'casting.application_created',
    actor: `telegram:${telegramUserId}`,
    actorTelegramId: telegramUserId,
    candidateId: context.candidate.id,
    castingId: context.casting.id,
    outcome: result.changed ? 'updated' : 'unchanged',
    participationId: result.participation?.id,
  })

  return {
    ...context,
    changed: result.changed,
    outcome: status,
    participation: result.participation,
  }
}

export async function respondToCastingInvitationByToken({
  now = new Date(),
  publicToken,
  response,
  telegramUserId,
}) {
  const normalizedResponse = String(response ?? '').trim()
  if (!['accept', 'decline'].includes(normalizedResponse)) {
    const error = new Error('Casting invitation response must be accept or decline')
    error.code = 'CASTING_INVITATION_RESPONSE_INVALID'
    error.statusCode = 400
    throw error
  }

  const context = await getCastingParticipationContext({ now, publicToken, telegramUserId })
  const targetStatus = normalizedResponse === 'accept' ? 'selected' : 'declined'
  if (context.outcome === targetStatus) {
    return { ...context, changed: false }
  }
  if (context.outcome !== 'invited') {
    return { ...context, changed: false }
  }

  const result = await transitionCastingParticipation({
    actor: `telegram:${telegramUserId}`,
    candidateId: context.candidate.id,
    castingId: context.casting.id,
    status: targetStatus,
  })
  await recordAuditEvent({
    action: normalizedResponse === 'accept'
      ? 'casting.invitation_accepted'
      : 'casting.invitation_declined',
    actor: `telegram:${telegramUserId}`,
    actorTelegramId: telegramUserId,
    candidateId: context.candidate.id,
    castingId: context.casting.id,
    outcome: result.changed ? 'updated' : 'unchanged',
    participationId: result.participation?.id,
  })

  return {
    ...context,
    changed: result.changed,
    outcome: targetStatus,
    participation: result.participation,
  }
}

export async function setCastingApplicationStatus({
  actor = 'web_admin',
  applicationMessage = '',
  candidate,
  candidateId,
  castingId,
  metadata = {},
  recordAudit = true,
  source = 'admin_added',
  status,
}) {
  const resolvedCandidate = candidate ?? await findCandidate(candidateId)
  if (!resolvedCandidate) {
    return { changed: false, outcome: 'registration_required' }
  }
  const casting = await findCasting(castingId)
  if (!casting) {
    return { changed: false, outcome: 'not_found' }
  }

  const existing = await findCastingParticipation(castingId, resolvedCandidate.id)
  const result = existing
    ? await transitionCastingParticipation({
        actor,
        candidateId: resolvedCandidate.id,
        castingId,
        metadata,
        status,
      })
    : await upsertCastingParticipation({
        actor,
        applicationMessage,
        candidateId: resolvedCandidate.id,
        castingId,
        metadata,
        profileSnapshot: snapshotCandidateProfile(resolvedCandidate),
        source,
        status,
      })

  if (recordAudit) {
    await recordAuditEvent({
      action: `casting.participation_${status}`,
      actor,
      candidateId: resolvedCandidate.id,
      castingId,
      outcome: result.changed ? 'updated' : 'unchanged',
      participationId: result.participation?.id,
    })
  }

  return {
    candidate: resolvedCandidate,
    casting,
    changed: result.changed,
    outcome: result.participation?.status ?? status,
    participation: result.participation,
  }
}
