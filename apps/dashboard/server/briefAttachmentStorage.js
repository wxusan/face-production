import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  getObject,
  isObjectStorageReference,
  objectStorageConfigured,
  putObject,
} from './objectStorage.js'

const MAX_FILES = 3
const MAX_BYTES = 5 * 1024 * 1024

function safeName(value) {
  return basename(String(value ?? 'file'))
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .slice(0, 100) || 'file'
}

export async function saveBriefAttachments(briefId, files = []) {
  validateBriefAttachments(files)
  if (!Array.isArray(files) || files.length === 0) return []

  const saved = []
  for (const [index, file] of files.entries()) {
    const match = String(file.data ?? '').match(/^data:([^;,]+);base64,(.+)$/s)
    if (!match) {
      const error = new Error('Attachment data is invalid')
      error.statusCode = 400
      throw error
    }
    const contentType = match[1]
    const body = Buffer.from(match[2], 'base64')
    if (body.length > MAX_BYTES) {
      const error = new Error('Each attachment must be 5 MB or smaller')
      error.statusCode = 400
      throw error
    }
    const name = safeName(file.name)
    const key = `briefs/${briefId}/${index + 1}-${name}`
    let path
    if (objectStorageConfigured()) {
      path = await putObject({ body, contentType, key })
    } else {
      path = resolve(process.cwd(), 'var/brief-files', briefId, `${index + 1}-${name}`)
      await mkdir(resolve(process.cwd(), 'var/brief-files', briefId), { recursive: true })
      await writeFile(path, body)
    }
    saved.push({ name, contentType, path, size: body.length })
  }
  return saved
}

export function validateBriefAttachments(files = []) {
  if (!Array.isArray(files) || files.length === 0) return
  if (files.length > MAX_FILES) {
    const error = new Error(`A maximum of ${MAX_FILES} files is allowed`)
    error.statusCode = 400
    throw error
  }
  for (const file of files) {
    const match = String(file.data ?? '').match(/^data:([^;,]+);base64,(.+)$/s)
    if (!match) {
      const error = new Error('Attachment data is invalid')
      error.statusCode = 400
      throw error
    }
    if (Buffer.from(match[2], 'base64').length > MAX_BYTES) {
      const error = new Error('Each attachment must be 5 MB or smaller')
      error.statusCode = 400
      throw error
    }
  }
}

export async function readBriefAttachment(attachment) {
  return isObjectStorageReference(attachment.path)
    ? getObject(attachment.path)
    : readFile(attachment.path)
}
