import {
  findCandidate,
  findCandidatesByIds,
  isCandidateEligibleForMessaging,
  listCandidates,
} from './candidateRepository.js'
import {
  findCasting,
  listCastingPage,
  listCastings,
  transitionCastingStatus,
  updateCasting,
} from './castingRepository.js'
import {
  castingParticipationCounts,
  castingParticipationCountsByCastingIds,
  listCastingParticipationPage,
} from './castingParticipationRepository.js'
import { setCastingApplicationStatus } from './castingParticipationService.js'
import { enqueueCastingOutboxEvent } from './castingOutboxRepository.js'
import { getCastingChannelConfig } from './castingChannelRepository.js'

export async function listCastingsWithCounts() {
  const castings = await listCastings()
  const counts = await castingParticipationCountsByCastingIds(castings.map((casting) => casting.id))
  return castings.map((casting) => ({
    ...casting,
    counts: counts[casting.id],
  }))
}

export async function listCastingPageWithCounts(options = {}) {
  const page = await listCastingPage(options)
  const counts = await castingParticipationCountsByCastingIds(page.items.map((casting) => casting.id))
  return {
    castings: page.items.map((casting) => ({
      ...casting,
      counts: counts[casting.id],
    })),
    pageInfo: page.pageInfo,
  }
}

export async function getCastingWorkspace(castingId) {
  const casting = await findCasting(castingId)
  if (!casting) return undefined

  const participationPage = await listCastingParticipationPage(castingId, { limit: 300 })
  const participations = participationPage.items
  const candidates = await findCandidatesByIds(participations.map((item) => item.candidateId))
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const enriched = participations.map((participation) => ({
    ...participation,
    candidate: candidatesById.get(participation.candidateId) ?? participation.profileSnapshot,
  }))
  const active = enriched.filter((item) => !['removed', 'cancelled'].includes(item.status))
  const flattenCandidate = (item) => ({
    ...item.candidate,
    applicationMessage: item.applicationMessage,
    castingParticipation: item,
    participationId: item.id,
    participationSource: item.source,
    participationStatus: item.status,
  })

  return {
    applications: active.filter((item) => item.status === 'applied').map(flattenCandidate),
    candidates: active.filter((item) => item.status === 'selected').map(flattenCandidate),
    casting: {
      ...casting,
      counts: await castingParticipationCounts(castingId),
    },
    invitations: active.filter((item) => item.source === 'invitation'),
    pageInfo: participationPage.pageInfo,
  }
}

export async function manageCasting(castingId, action, payload = {}, actor = 'web_admin') {
  if (action === 'edit') {
    const allowedPatch = {}
    for (const field of ['title', 'body', 'startsAt', 'endsAt', 'targetCandidateIds']) {
      if (Object.hasOwn(payload, field)) allowedPatch[field] = payload[field]
    }
    return updateCasting(castingId, allowedPatch, actor)
  }
  if (action === 'publish') {
    return transitionCastingStatus(castingId, 'active', actor)
  }
  if (action === 'close') {
    const existing = await findCasting(castingId)
    if (!existing || existing.status === 'closed') {
      return existing
    }
    const updated = await transitionCastingStatus(castingId, 'closed', actor)
    if (updated?.channelMessageId) {
      await enqueueCastingOutboxEvent({
        castingId,
        eventType: 'casting.channel_status_update',
        operationId: `${payload.operationId ?? `close:${castingId}`}:channel-status`,
        payload: { castingId, language: payload.language ?? 'ru', status: 'closed' },
        recipientKey: `channel:${updated.channelChatId ?? 'configured'}`,
      })
    }
    return updated
  }
  if (action === 'cancel') {
    const existing = await findCasting(castingId)
    if (!existing || existing.status === 'cancelled') {
      return existing
    }
    const updated = await transitionCastingStatus(castingId, 'cancelled', actor)
    if (updated?.channelMessageId) {
      await enqueueCastingOutboxEvent({
        castingId,
        eventType: 'casting.channel_status_update',
        operationId: `${payload.operationId ?? `cancel:${castingId}`}:channel-status`,
        payload: { castingId, language: payload.language ?? 'ru', status: 'cancelled' },
        recipientKey: `channel:${updated.channelChatId ?? 'configured'}`,
      })
    }
    return updated
  }

  const error = new Error(`Unsupported casting action "${action}"`)
  error.statusCode = 400
  throw error
}

export async function inviteCandidatesToCasting({
  actor = 'web_admin',
  candidateIds,
  castingId,
  operationId,
}) {
  const casting = await findCasting(castingId)
  if (!casting) {
    return { casting: undefined, invited: [], skipped: [] }
  }

  const invited = []
  const skipped = []
  const uniqueIds = [...new Set((candidateIds ?? []).map(String).filter(Boolean))]

  for (const candidateId of uniqueIds) {
    const candidate = await findCandidate(candidateId)
    if (!candidate) {
      skipped.push({ candidateId, reason: 'candidate_not_found' })
      continue
    }
    if (!isCandidateEligibleForMessaging(candidate)) {
      skipped.push({ candidateId, reason: 'candidate_not_eligible' })
      continue
    }

    try {
      const result = await setCastingApplicationStatus({
        actor,
        candidate,
        candidateId,
        castingId,
        source: 'invitation',
        status: 'invited',
      })
      if (!result.changed) {
        skipped.push({ candidateId, reason: 'already_participating' })
        continue
      }
      const outbox = await enqueueCastingOutboxEvent({
        castingId,
        eventType: 'casting.invitation',
        operationId: `${operationId}:${candidateId}`,
        participationId: result.participation?.id,
        payload: { candidateId, castingId },
        recipientKey: candidateId,
      })
      invited.push({
        candidate,
        changed: result.changed,
        outbox: outbox.event,
        participation: result.participation,
      })
    } catch (error) {
      skipped.push({
        candidateId,
        reason: error.code ?? 'participation_transition_invalid',
      })
    }
  }

  return { casting, invited, skipped }
}

export async function publishCasting({
  actor = 'web_admin',
  audiences = ['channel', 'eligible_bot_users'],
  castingId,
  language = 'ru',
  operationId,
}) {
  const casting = await manageCasting(
    castingId,
    'publish',
    { operationId, publishToChannel: false },
    actor,
  )
  if (!casting) return undefined

  const queued = []
  const skipped = []
  const requestedAudiences = new Set(audiences)

  if (requestedAudiences.has('channel')) {
    const channel = await getCastingChannelConfig()
    if (channel.enabled && channel.telegramChatId) {
      const outbox = await enqueueCastingOutboxEvent({
        castingId,
        eventType: 'casting.channel_publish',
        operationId: `${operationId}:channel`,
        payload: { castingId, language },
        recipientKey: `channel:${channel.telegramChatId}`,
      })
      queued.push(outbox.event)
    } else {
      skipped.push({ audience: 'channel', reason: 'channel_unconfigured' })
    }
  }

  if (requestedAudiences.has('eligible_bot_users')) {
    const targetIds = new Set(casting.targetCandidateIds ?? [])
    const candidates = (await listCandidates()).filter(
      (candidate) =>
        isCandidateEligibleForMessaging(candidate)
        && (!targetIds.size || targetIds.has(candidate.id)),
    )
    for (const candidate of candidates) {
      const outbox = await enqueueCastingOutboxEvent({
        castingId,
        eventType: 'casting.publication',
        operationId: `${operationId}:candidate:${candidate.id}`,
        payload: { candidateId: candidate.id, castingId },
        recipientKey: candidate.id,
      })
      queued.push(outbox.event)
    }
  }

  return { casting, queued, skipped }
}
