import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

let client

export function objectStorageConfigured() {
  return Boolean(
    process.env.OBJECT_STORAGE_BUCKET &&
      process.env.OBJECT_STORAGE_ENDPOINT &&
      process.env.OBJECT_STORAGE_ACCESS_KEY_ID &&
      process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
  )
}

function getClient() {
  if (!objectStorageConfigured()) {
    throw new Error('Object storage is not configured')
  }

  if (!client) {
    client = new S3Client({
      credentials: {
        accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
        secretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
      },
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT,
      forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== 'false',
      region: process.env.OBJECT_STORAGE_REGION ?? 'auto',
    })
  }

  return client
}

export function toObjectStorageReference(key) {
  return `s3://${process.env.OBJECT_STORAGE_BUCKET}/${key}`
}

export function isObjectStorageReference(value) {
  return String(value ?? '').startsWith('s3://')
}

export function objectKeyFromReference(reference) {
  const raw = String(reference ?? '')
  const prefix = `s3://${process.env.OBJECT_STORAGE_BUCKET}/`

  if (raw.startsWith(prefix)) {
    return raw.slice(prefix.length)
  }

  const withoutProtocol = raw.replace(/^s3:\/\//, '')
  return withoutProtocol.split('/').slice(1).join('/')
}

export async function putObject({ body, contentType, key }) {
  await getClient().send(
    new PutObjectCommand({
      Body: body,
      Bucket: process.env.OBJECT_STORAGE_BUCKET,
      ContentType: contentType,
      Key: key,
    }),
  )

  return toObjectStorageReference(key)
}

export async function getObject(reference) {
  const result = await getClient().send(
    new GetObjectCommand({
      Bucket: process.env.OBJECT_STORAGE_BUCKET,
      Key: objectKeyFromReference(reference),
    }),
  )

  const chunks = []

  for await (const chunk of result.Body) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

export async function headObject(reference) {
  const result = await getClient().send(
    new HeadObjectCommand({
      Bucket: process.env.OBJECT_STORAGE_BUCKET,
      Key: objectKeyFromReference(reference),
    }),
  )

  return {
    contentLength: Number(result.ContentLength ?? 0),
    contentType: result.ContentType ?? '',
    etag: result.ETag ?? '',
  }
}

export async function deleteObject(reference) {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: process.env.OBJECT_STORAGE_BUCKET,
      Key: objectKeyFromReference(reference),
    }),
  )
}
