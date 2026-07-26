import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { allExampleMedia, validateExampleMediaManifest } from '../server/exampleMedia.js'
import { loadLocalEnv } from '../server/env.js'
import {
  headObject,
  objectStorageConfigured,
  putObject,
} from '../server/objectStorage.js'
import { hasPostgres, query } from '../server/postgres.js'

loadLocalEnv()

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function uploadPreparedAsset(entry) {
  if (!entry.preparedRelativePath) {
    return false
  }

  const sourcePath = path.resolve(projectRoot, entry.preparedRelativePath)
  const info = await stat(sourcePath)

  if (!info.isFile() || info.size <= 0 || info.size > entry.maxBytes) {
    throw new Error(`${entry.gender}.${entry.step} prepared asset is invalid`)
  }

  await putObject({
    body: await readFile(sourcePath),
    contentType: entry.contentType,
    key: entry.objectKey,
  })
  return true
}

async function main() {
  const manifest = validateExampleMediaManifest()

  if (!objectStorageConfigured()) {
    throw new Error('Object storage must be configured before example media can be deployed')
  }
  if (!hasPostgres()) {
    throw new Error('DATABASE_URL is required to invalidate replaced Telegram example file IDs')
  }

  const verified = []
  let uploaded = 0

  for (const entry of allExampleMedia()) {
    if (await uploadPreparedAsset(entry)) {
      uploaded += 1
    }

    const remote = await headObject(entry.reference)
    if (
      !Number.isSafeInteger(remote.contentLength)
      || remote.contentLength <= 0
      || remote.contentLength > entry.maxBytes
    ) {
      throw new Error(`${entry.gender}.${entry.step} remote asset is missing or exceeds its byte limit`)
    }
    if (remote.contentType !== entry.contentType) {
      throw new Error(
        `${entry.gender}.${entry.step} remote asset has content type "${remote.contentType}" instead of "${entry.contentType}"`,
      )
    }

    verified.push({
      bytes: remote.contentLength,
      gender: entry.gender,
      kind: entry.kind,
      step: entry.step,
    })
  }

  await query('DELETE FROM telegram_example_files')

  process.stdout.write(`${JSON.stringify({
    invalidatedTelegramFileIds: true,
    manifest,
    ok: true,
    uploaded,
    verified,
  }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
