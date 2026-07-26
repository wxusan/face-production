import {
  candidateCastingProfileMissingFields,
  findCandidate,
  updateCandidateStatus,
} from './candidateRepository.js'
import { findCasting } from './castingRepository.js'
import {
  findCastingParticipation,
  restoreCastingParticipation,
} from './castingParticipationRepository.js'
import { setCastingApplicationStatus } from './castingParticipationService.js'
import { hasPostgres, withPostgresAdvisoryLock } from './postgres.js'

const localDecisionChains = new Map()

async function withDecisionLock(castingId, candidateId, task) {
  const key = `${castingId}:${candidateId}`
  if (hasPostgres()) {
    return withPostgresAdvisoryLock(164733, `casting-decision:${key}`, task)
  }
  const previous = localDecisionChains.get(key) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(task)
  localDecisionChains.set(key, current)
  try {
    return await current
  } finally {
    if (localDecisionChains.get(key) === current) {
      localDecisionChains.delete(key)
    }
  }
}

export async function applyCastingAndProfileDecision({
  actor,
  candidateId,
  castingDecision,
  castingId,
  profileDecision = 'unchanged',
}) {
  const [candidate, casting, previousParticipation] = await Promise.all([
    findCandidate(candidateId),
    findCasting(castingId),
    findCastingParticipation(castingId, candidateId),
  ])
  if (!candidate || !casting) {
    return undefined
  }

  if (
    profileDecision === 'approve'
    && candidateCastingProfileMissingFields(candidate).length > 0
  ) {
    const error = new Error('Incomplete profile cannot be approved')
    error.code = 'CANDIDATE_PROFILE_INCOMPLETE'
    error.statusCode = 409
    throw error
  }

  return withDecisionLock(
    castingId,
    candidateId,
    async () => {
      const castingResult = await setCastingApplicationStatus({
        actor,
        candidate,
        candidateId,
        castingId,
        recordAudit: false,
        source: 'admin_added',
        status: castingDecision === 'accept' ? 'selected' : 'rejected',
      })
      let updatedCandidate = candidate

      try {
        if (profileDecision !== 'unchanged') {
          updatedCandidate = await updateCandidateStatus(
            candidateId,
            profileDecision === 'approve' ? 'approved' : 'rejected',
            actor,
          )
          if (!updatedCandidate) {
            const error = new Error('Profile decision could not be applied')
            error.code = 'CANDIDATE_PROFILE_DECISION_FAILED'
            error.statusCode = 409
            throw error
          }
        }
      } catch (error) {
        await restoreCastingParticipation({
          candidateId,
          castingId,
          participation: previousParticipation,
        })
        throw error
      }

      return {
        candidate: updatedCandidate,
        casting,
        castingResult,
        previousCandidate: candidate,
        previousParticipation,
      }
    },
  )
}
