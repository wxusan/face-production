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

export async function saveTelegramFile({ filePath, fileUniqueId, folder = 'files', token }) {
  const extension = extname(filePath) || '.bin'
  const fileName = `${fileUniqueId}${extension}`
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`)

  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status}`)
  }

  const fileBuffer = Buffer.from(await response.arrayBuffer())
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
