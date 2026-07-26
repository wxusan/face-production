export const CASTING_STATUSES = Object.freeze([
  'draft',
  'scheduled',
  'active',
  'paused',
  'closed',
  'cancelled',
  'archived',
])

export const CASTING_PARTICIPATION_SOURCES = Object.freeze([
  'self_apply',
  'invitation',
  'admin_added',
])

export const CASTING_PARTICIPATION_STATUSES = Object.freeze([
  'applied',
  'invited',
  'selected',
  'rejected',
  'declined',
  'withdrawn',
  'removed',
  'cancelled',
])

export const CASTING_STATUS_TRANSITIONS = Object.freeze({
  active: Object.freeze(['paused', 'closed', 'cancelled', 'archived']),
  archived: Object.freeze([]),
  cancelled: Object.freeze(['archived']),
  closed: Object.freeze(['archived']),
  draft: Object.freeze(['scheduled', 'active', 'cancelled', 'archived']),
  paused: Object.freeze(['active', 'closed', 'cancelled', 'archived']),
  scheduled: Object.freeze(['active', 'paused', 'closed', 'cancelled', 'archived']),
})

export const CASTING_PARTICIPATION_STATUS_TRANSITIONS = Object.freeze({
  applied: Object.freeze(['selected', 'rejected', 'withdrawn', 'removed', 'cancelled']),
  cancelled: Object.freeze(['invited', 'applied', 'removed']),
  declined: Object.freeze(['invited', 'removed']),
  invited: Object.freeze(['applied', 'selected', 'rejected', 'declined', 'removed', 'cancelled']),
  rejected: Object.freeze(['selected', 'removed']),
  removed: Object.freeze(['invited', 'applied']),
  selected: Object.freeze(['rejected', 'removed', 'cancelled']),
  withdrawn: Object.freeze(['applied', 'invited', 'removed']),
})

export class CastingLifecycleError extends Error {
  constructor(message, code = 'CASTING_LIFECYCLE_INVALID', statusCode = 409) {
    super(message)
    this.code = code
    this.name = 'CastingLifecycleError'
    this.statusCode = statusCode
  }
}

export function assertCastingStatus(status) {
  const normalized = String(status ?? '').trim()
  if (!CASTING_STATUSES.includes(normalized)) {
    throw new CastingLifecycleError(
      `Unknown casting status "${normalized}"`,
      'CASTING_STATUS_INVALID',
      400,
    )
  }
  return normalized
}

export function assertCastingParticipationSource(source) {
  const normalized = String(source ?? '').trim()
  if (!CASTING_PARTICIPATION_SOURCES.includes(normalized)) {
    throw new CastingLifecycleError(
      `Unknown casting participation source "${normalized}"`,
      'CASTING_PARTICIPATION_SOURCE_INVALID',
      400,
    )
  }
  return normalized
}

export function assertCastingParticipationStatus(status) {
  const normalized = String(status ?? '').trim()
  if (!CASTING_PARTICIPATION_STATUSES.includes(normalized)) {
    throw new CastingLifecycleError(
      `Unknown casting participation status "${normalized}"`,
      'CASTING_PARTICIPATION_STATUS_INVALID',
      400,
    )
  }
  return normalized
}

export function canTransitionCastingStatus(fromStatus, toStatus) {
  const from = assertCastingStatus(fromStatus)
  const to = assertCastingStatus(toStatus)
  return from === to || CASTING_STATUS_TRANSITIONS[from].includes(to)
}

export function canTransitionCastingParticipationStatus(fromStatus, toStatus) {
  const from = assertCastingParticipationStatus(fromStatus)
  const to = assertCastingParticipationStatus(toStatus)
  return from === to || CASTING_PARTICIPATION_STATUS_TRANSITIONS[from].includes(to)
}

export function assertCastingStatusTransition(fromStatus, toStatus) {
  if (!canTransitionCastingStatus(fromStatus, toStatus)) {
    throw new CastingLifecycleError(
      `Casting cannot transition from "${fromStatus}" to "${toStatus}"`,
      'CASTING_STATUS_TRANSITION_INVALID',
    )
  }
  return assertCastingStatus(toStatus)
}

export function assertCastingParticipationStatusTransition(fromStatus, toStatus) {
  if (!canTransitionCastingParticipationStatus(fromStatus, toStatus)) {
    throw new CastingLifecycleError(
      `Casting participation cannot transition from "${fromStatus}" to "${toStatus}"`,
      'CASTING_PARTICIPATION_TRANSITION_INVALID',
    )
  }
  return assertCastingParticipationStatus(toStatus)
}

export function isCastingOpen(casting, now = new Date()) {
  if (!casting || !['active', 'scheduled'].includes(casting.status)) {
    return false
  }

  const current = now instanceof Date ? now : new Date(now)
  if (Number.isNaN(current.getTime())) {
    throw new CastingLifecycleError('Current date is invalid', 'CASTING_DATE_INVALID', 400)
  }
  if (casting.startsAt && new Date(casting.startsAt) > current) {
    return false
  }
  if (casting.endsAt && new Date(casting.endsAt) <= current) {
    return false
  }
  return true
}

export function publishedCastingStatus(casting, now = new Date()) {
  const current = now instanceof Date ? now : new Date(now)
  return casting?.startsAt && new Date(casting.startsAt) > current ? 'scheduled' : 'active'
}
