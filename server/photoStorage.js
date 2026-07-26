import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import {
  getObject,
  isObjectStorageReference,
  objectStorageConfigured,
  putObject,
} from './objectStorage.js'

const mediaRoot = resolve(process.cwd(), 'var/candidate-media')
const legacyPhotoDir = resolve(process.cwd(), 'var/candidate-photos')
export const MAX_TELEGRAM_FILE_BYTES = positiveInteger(process.env.TELEGRAM_MAX_FILE_BYTES, 20 * 1024 * 1024)
const TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS = positiveInteger(process.env.TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS, 30_000)

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function isWithinTelegramFileLimit(fileSize, maxBytes = MAX_TELEGRAM_FILE_BYTES) {
  if (fileSize === undefined || fileSize === null) {
    return true
  }

  const bytes = Number(fileSize)
  return Number.isFinite(bytes) && bytes >= 0 && bytes <= maxBytes
}

async function fetchTelegramFile(url, timeoutMs) {
  const controller = new AbortController()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(url, { signal: controller.signal })
    return {
      didTimeout: () => timedOut,
      release: () => clearTimeout(timeout),
      response,
    }
  } catch (error) {
    clearTimeout(timeout)

    if (timedOut) {
      throw new Error(`Telegram file download timed out after ${timeoutMs}ms`)
    }

    throw error
  }
}

async function readResponseBuffer(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length'))

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Telegram file exceeds the ${maxBytes}-byte limit`)
  }

  if (!response.body) {
    throw new Error('Telegram file download returned no body')
  }

  const chunks = []
  let total = 0

  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk)
    total += buffer.length

    if (total > maxBytes) {
      throw new Error(`Telegram file exceeds the ${maxBytes}-byte limit`)
    }

    chunks.push(buffer)
  }

  return Buffer.concat(chunks, total)
}

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

export async function saveTelegramFile({
  filePath,
  fileUniqueId,
  folder = 'files',
  maxBytes = MAX_TELEGRAM_FILE_BYTES,
  token,
}) {
  const byteLimit = Number(maxBytes)
  if (!Number.isSafeInteger(byteLimit) || byteLimit <= 0) {
    throw new Error('Telegram file size limit must be a positive number')
  }

  const extension = extname(filePath) || '.bin'
  const fileName = `${fileUniqueId}${extension}`
  const download = await fetchTelegramFile(
    `https://api.telegram.org/file/bot${token}/${filePath}`,
    TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS,
  )

  let fileBuffer
  try {
    if (!download.response.ok) {
      throw new Error(`Telegram file download failed: ${download.response.status}`)
    }

    fileBuffer = await readResponseBuffer(download.response, byteLimit)
  } catch (error) {
    if (download.didTimeout()) {
      throw new Error(`Telegram file download timed out after ${TELEGRAM_FILE_DOWNLOAD_TIMEOUT_MS}ms`)
    }

    throw error
  } finally {
    download.release()
  }
  const isVercel = Boolean(process.env.VERCEL)
  const hasObjectStorage = objectStorageConfigured()

  if (!hasObjectStorage && isVercel) {
    throw new Error(
      'Cannot save Telegram file on Vercel without object storage. Set OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_ENDPOINT, OBJECT_STORAGE_ACCESS_KEY_ID, OBJECT_STORAGE_SECRET_ACCESS_KEY.',
    )
  }

  let storagePath
  let localPath

  if (hasObjectStorage) {
    storagePath = await putObject({
      body: fileBuffer,
      contentType: contentTypeForExtension(extension),
      key: `candidate-media/${folder}/${fileName}`,
    })

    if (!isVercel) {
      try {
        const localFile = resolve(mediaRoot, folder, fileName)
        await mkdir(resolve(mediaRoot, folder), { recursive: true })
        await writeFile(localFile, fileBuffer)
        localPath = localFile
      } catch (error) {
        console.warn(`Local media cache write failed (S3 upload already succeeded): ${error.message}`)
      }
    }
  } else {
    localPath = resolve(mediaRoot, folder, fileName)
    await mkdir(resolve(mediaRoot, folder), { recursive: true })
    await writeFile(localPath, fileBuffer)
  }

  return {
    fileName,
    localPath,
    storagePath,
  }
}

export async function saveTelegramPhoto({ filePath, fileUniqueId, token }) {
  const saved = await saveTelegramFile({
    filePath,
    fileUniqueId,
    folder: 'photos',
    token,
  })

  return saved
}

export async function readCandidatePhoto(candidate) {
  const photoPath = candidate?.portraitPhotoPath ?? candidate?.photoPath

  if (!photoPath) {
    return undefined
  }

  return readMediaReference(photoPath)
}

export async function readCandidateMedia(candidate, kind) {
  const mediaPath = {
    closeShotPhoto: candidate?.closeShotPhotoPath,
    fullBodyPhoto: candidate?.fullBodyPhotoPath,
    introVideo: candidate?.introVideoPath,
    leftProfilePhoto: candidate?.leftProfilePhotoPath,
    portraitPhoto: candidate?.portraitPhotoPath ?? candidate?.photoPath,
    rightProfilePhoto: candidate?.rightProfilePhotoPath,
  }[kind]

  if (!mediaPath) {
    return undefined
  }

  return readMediaReference(mediaPath)
}

export async function readLegacyCandidatePhoto(candidate) {
  if (!candidate?.photoPath) {
    return undefined
  }

  return readFile(resolve(legacyPhotoDir, candidate.photoPath))
}

export async function readMediaReference(reference) {
  if (isObjectStorageReference(reference)) {
    return getObject(reference)
  }

  return readFile(reference)
}
