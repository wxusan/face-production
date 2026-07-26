import path from 'node:path'

export const EXAMPLE_MEDIA_BUCKET = 'face-candidate-media'
export const EXAMPLE_MEDIA_GENDERS = Object.freeze(['male', 'female'])
export const EXAMPLE_MEDIA_STEPS = Object.freeze([
  'fullBodyPhoto',
  'closeShotPhoto',
  'leftProfilePhoto',
  'rightProfilePhoto',
  'portraitPhoto',
  'introVideo',
])

export class ExampleMediaConfigurationError extends Error {
  constructor(errors) {
    super(`Example media configuration is invalid:\n- ${errors.join('\n- ')}`)
    this.code = 'EXAMPLE_MEDIA_CONFIGURATION_INVALID'
    this.errors = errors
    this.name = 'ExampleMediaConfigurationError'
  }
}

function mediaEntry({
  contentType,
  gender,
  kind,
  maxBytes,
  objectName,
  preparedRelativePath,
  sourceRelativePath,
  step,
}) {
  const objectKey = `examples/${objectName}`

  return Object.freeze({
    contentType,
    gender,
    kind,
    maxBytes,
    objectKey,
    preparedRelativePath,
    reference: `s3://${EXAMPLE_MEDIA_BUCKET}/${objectKey}`,
    required: true,
    sourceRelativePath,
    step,
    uploadSource: preparedRelativePath ? 'prepared-repository' : 'source-library',
  })
}

const photoMaxBytes = 1024 * 1024
const videoMaxBytes = 49 * 1024 * 1024

export const exampleMediaManifest = Object.freeze({
  male: Object.freeze({
    fullBodyPhoto: mediaEntry({
      contentType: 'image/jpeg',
      gender: 'male',
      kind: 'photo',
      maxBytes: photoMaxBytes,
      objectName: 'male-full-body.jpg',
      preparedRelativePath: 'assets/example-media/male-full-body.jpg',
      sourceRelativePath: 'man, fully body front.PNG',
      step: 'fullBodyPhoto',
    }),
    closeShotPhoto: mediaEntry({
      contentType: 'image/jpeg',
      gender: 'male',
      kind: 'photo',
      maxBytes: photoMaxBytes,
      objectName: 'male-close-shot.jpg',
      preparedRelativePath: 'assets/example-media/male-close-shot.jpg',
      sourceRelativePath: 'man closer shot.PNG',
      step: 'closeShotPhoto',
    }),
    leftProfilePhoto: mediaEntry({
      contentType: 'image/jpeg',
      gender: 'male',
      kind: 'photo',
      maxBytes: photoMaxBytes,
      objectName: 'male-left-profile.jpg',
      preparedRelativePath: 'assets/example-media/male-left-profile.jpg',
      sourceRelativePath: 'man left.PNG',
      step: 'leftProfilePhoto',
    }),
    rightProfilePhoto: mediaEntry({
      contentType: 'image/jpeg',
      gender: 'male',
      kind: 'photo',
      maxBytes: photoMaxBytes,
      objectName: 'male-right-profile.jpg',
      preparedRelativePath: 'assets/example-media/male-right-profile.jpg',
      sourceRelativePath: 'man right.PNG',
      step: 'rightProfilePhoto',
    }),
    portraitPhoto: mediaEntry({
      contentType: 'image/jpeg',
      gender: 'male',
      kind: 'photo',
      maxBytes: photoMaxBytes,
      objectName: 'male-portrait.jpg',
      preparedRelativePath: 'assets/example-media/male-portrait.jpg',
      sourceRelativePath: 'man portait.PNG',
      step: 'portraitPhoto',
    }),
    introVideo: mediaEntry({
      contentType: 'video/mp4',
      gender: 'male',
      kind: 'video',
      maxBytes: videoMaxBytes,
      objectName: 'male-intro.mp4',
      preparedRelativePath: null,
      sourceRelativePath: 'telegram-ready/male-intro.mp4',
      step: 'introVideo',
    }),
  }),
  female: Object.freeze({
    fullBodyPhoto: mediaEntry({
      contentType: 'image/jpeg',
      gender: 'female',
      kind: 'photo',
      maxBytes: photoMaxBytes,
      objectName: 'female-full-body.jpg',
      preparedRelativePath: 'assets/example-media/female-full-body.jpg',
      sourceRelativePath: 'woman full body.jpeg',
      step: 'fullBodyPhoto',
    }),
    closeShotPhoto: mediaEntry({
      contentType: 'image/jpeg',
      gender: 'female',
      kind: 'photo',
      maxBytes: photoMaxBytes,
      objectName: 'female-close-shot.jpg',
      preparedRelativePath: 'assets/example-media/female-close-shot.jpg',
      sourceRelativePath: 'woman closer shot.jpeg',
      step: 'closeShotPhoto',
    }),
    leftProfilePhoto: mediaEntry({
      contentType: 'image/jpeg',
      gender: 'female',
      kind: 'photo',
      maxBytes: photoMaxBytes,
      objectName: 'female-left-profile.jpg',
      preparedRelativePath: 'assets/example-media/female-left-profile.jpg',
      sourceRelativePath: 'woman left.jpeg',
      step: 'leftProfilePhoto',
    }),
    rightProfilePhoto: mediaEntry({
      contentType: 'image/jpeg',
      gender: 'female',
      kind: 'photo',
      maxBytes: photoMaxBytes,
      objectName: 'female-right-profile.jpg',
      preparedRelativePath: 'assets/example-media/female-right-profile.jpg',
      sourceRelativePath: 'woman right.jpeg',
      step: 'rightProfilePhoto',
    }),
    portraitPhoto: mediaEntry({
      contentType: 'image/jpeg',
      gender: 'female',
      kind: 'photo',
      maxBytes: photoMaxBytes,
      objectName: 'female-portrait.jpg',
      preparedRelativePath: 'assets/example-media/female-portrait.jpg',
      sourceRelativePath: 'woman portrait.jpeg',
      step: 'portraitPhoto',
    }),
    introVideo: mediaEntry({
      contentType: 'video/mp4',
      gender: 'female',
      kind: 'video',
      maxBytes: videoMaxBytes,
      objectName: 'female-intro.mp4',
      preparedRelativePath: null,
      sourceRelativePath: 'telegram-ready/female-intro.mp4',
      step: 'introVideo',
    }),
  }),
})

export const exampleMediaReferences = Object.freeze(
  Object.fromEntries(
    EXAMPLE_MEDIA_GENDERS.map((gender) => [
      gender,
      Object.freeze(
        Object.fromEntries(
          EXAMPLE_MEDIA_STEPS.map((step) => [step, exampleMediaManifest[gender][step].reference]),
        ),
      ),
    ]),
  ),
)

export function allExampleMedia() {
  return EXAMPLE_MEDIA_GENDERS.flatMap((gender) =>
    EXAMPLE_MEDIA_STEPS.map((step) => exampleMediaManifest[gender][step]),
  )
}

export function getRequiredExampleMedia(gender, step) {
  if (!EXAMPLE_MEDIA_GENDERS.includes(gender)) {
    throw new ExampleMediaConfigurationError([`Unknown gender "${gender}"`])
  }

  const normalizedStep = step === 'video' ? 'introVideo' : step
  if (!EXAMPLE_MEDIA_STEPS.includes(normalizedStep)) {
    throw new ExampleMediaConfigurationError([`Unknown example-media step "${step}"`])
  }

  const entry = exampleMediaManifest[gender]?.[normalizedStep]
  if (!entry?.reference) {
    throw new ExampleMediaConfigurationError([`Missing required ${gender}.${normalizedStep} example`])
  }

  return entry
}

export function resolveExampleMediaUploadSource(entry, { projectRoot, sourceRoot }) {
  if (!entry?.required) {
    throw new ExampleMediaConfigurationError(['Cannot resolve an unknown example-media entry'])
  }

  if (entry.preparedRelativePath) {
    if (!projectRoot) {
      throw new ExampleMediaConfigurationError([`projectRoot is required for ${entry.gender}.${entry.step}`])
    }
    return path.resolve(projectRoot, entry.preparedRelativePath)
  }

  if (!sourceRoot) {
    throw new ExampleMediaConfigurationError([`sourceRoot is required for ${entry.gender}.${entry.step}`])
  }
  return path.resolve(sourceRoot, entry.sourceRelativePath)
}

export function exampleMediaUploadPlan({ projectRoot, sourceRoot }) {
  return allExampleMedia().map((entry) => ({
    contentType: entry.contentType,
    gender: entry.gender,
    maxBytes: entry.maxBytes,
    objectKey: entry.objectKey,
    reference: entry.reference,
    sourcePath: resolveExampleMediaUploadSource(entry, { projectRoot, sourceRoot }),
    step: entry.step,
  }))
}

export function validateExampleMediaManifest(manifest = exampleMediaManifest) {
  const errors = []
  const references = new Set()
  const objectKeys = new Set()
  let photos = 0
  let videos = 0

  for (const gender of EXAMPLE_MEDIA_GENDERS) {
    for (const step of EXAMPLE_MEDIA_STEPS) {
      const entry = manifest?.[gender]?.[step]
      if (!entry) {
        errors.push(`Missing required ${gender}.${step} entry`)
        continue
      }
      if (entry.gender !== gender || entry.step !== step) {
        errors.push(`${gender}.${step} has inconsistent identity metadata`)
      }
      if (!['photo', 'video'].includes(entry.kind)) {
        errors.push(`${gender}.${step} has unsupported kind "${entry.kind}"`)
      } else if (entry.kind === 'photo') {
        photos += 1
      } else {
        videos += 1
      }
      if (!entry.sourceRelativePath || path.isAbsolute(entry.sourceRelativePath)) {
        errors.push(`${gender}.${step} must have a relative source path`)
      }
      if (!entry.objectKey?.startsWith('examples/')) {
        errors.push(`${gender}.${step} must use an examples/ object key`)
      }
      const expectedReference = `s3://${EXAMPLE_MEDIA_BUCKET}/${entry.objectKey}`
      if (entry.reference !== expectedReference) {
        errors.push(`${gender}.${step} reference does not match its object key`)
      }
      if (!Number.isInteger(entry.maxBytes) || entry.maxBytes <= 0) {
        errors.push(`${gender}.${step} must have a positive byte limit`)
      }
      if (references.has(entry.reference)) {
        errors.push(`${gender}.${step} reuses reference "${entry.reference}"`)
      }
      if (objectKeys.has(entry.objectKey)) {
        errors.push(`${gender}.${step} reuses object key "${entry.objectKey}"`)
      }
      references.add(entry.reference)
      objectKeys.add(entry.objectKey)
    }
  }

  if (errors.length > 0) {
    throw new ExampleMediaConfigurationError(errors)
  }

  return Object.freeze({
    photos,
    references: Object.freeze([...references]),
    total: references.size,
    videos,
  })
}

export const exampleMediaValidation = validateExampleMediaManifest()
