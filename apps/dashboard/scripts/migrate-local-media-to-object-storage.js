import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { loadLocalEnv } from '../server/env.js'
import { listCandidates, updateCandidateMetadata } from '../server/candidateRepository.js'
import { isObjectStorageReference, objectStorageConfigured, putObject } from '../server/objectStorage.js'

loadLocalEnv()

const mediaFields = [
  'photoPath',
  'portraitPhotoPath',
  'fullBodyPhotoPath',
  'closeShotPhotoPath',
  'leftProfilePhotoPath',
  'rightProfilePhotoPath',
  'introVideoPath',
  'skillsMediaPath',
]

function contentTypeForExtension(extension) {
  return {
    '.heic': 'image/heic',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }[extension.toLowerCase()] ?? 'application/octet-stream'
}

function storageKey(candidateId, field, path) {
  const cleanName = basename(path).replace(/[^a-zA-Z0-9._-]/g, '_')
  return `candidate-media/migrated/${candidateId}/${field}-${cleanName}`
}

async function migrateField(candidate, field) {
  const current = candidate[field]

  if (!current || isObjectStorageReference(current)) {
    return undefined
  }

  if (!String(current).startsWith('/')) {
    return undefined
  }

  await stat(current)
  const body = await readFile(current)
  const key = storageKey(candidate.id, field, current)

  return putObject({
    body,
    contentType: contentTypeForExtension(extname(current)),
    key,
  })
}

async function main() {
  if (!objectStorageConfigured()) {
    throw new Error('Object storage env is not configured')
  }

  const candidates = await listCandidates()
  const results = []

  for (const candidate of candidates) {
    const updates = {}

    for (const field of mediaFields) {
      try {
        const nextReference = await migrateField(candidate, field)

        if (nextReference) {
          updates[field] = nextReference
        }
      } catch (error) {
        results.push({
          candidateId: candidate.id,
          error: error.message,
          field,
          migrated: false,
        })
      }
    }

    if (Object.keys(updates).length > 0) {
      await updateCandidateMetadata(candidate.id, updates)
      results.push({
        candidateId: candidate.id,
        fields: Object.keys(updates),
        migrated: true,
      })
    }
  }

  console.log(JSON.stringify({ results }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
