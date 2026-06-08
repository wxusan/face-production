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
  const localPath = resolve(mediaRoot, folder, fileName)
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`)

  if (!response.ok) {
    throw new Error(`Telegram file download failed: ${response.status}`)
  }

  const fileBuffer = Buffer.from(await response.arrayBuffer())
  let storagePath

  await mkdir(resolve(mediaRoot, folder), { recursive: true })
  await writeFile(localPath, fileBuffer)

  if (objectStorageConfigured()) {
    storagePath = await putObject({
      body: fileBuffer,
      contentType: contentTypeForExtension(extension),
      key: `candidate-media/${folder}/${fileName}`,
    })
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
