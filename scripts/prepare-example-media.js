import { createHash } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  allExampleMedia,
  exampleMediaUploadPlan,
  resolveExampleMediaUploadSource,
  validateExampleMediaManifest,
} from '../server/exampleMedia.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.resolve(
  process.argv[2] ?? process.env.EXAMPLE_MEDIA_SOURCE_DIR ?? path.join(projectRoot, 'image and videos'),
)
const maxDimension = 1600
const jpegQuality = 78

function runSips(sourcePath, outputPath) {
  const result = spawnSync(
    'sips',
    [
      '--resampleHeightWidthMax',
      String(maxDimension),
      '--setProperty',
      'format',
      'jpeg',
      '--setProperty',
      'formatOptions',
      String(jpegQuality),
      sourcePath,
      '--out',
      outputPath,
    ],
    { encoding: 'utf8' },
  )

  if (result.error?.code === 'ENOENT') {
    throw new Error('Photo preparation requires macOS "sips"; prepare the JPEG assets on a Mac')
  }
  if (result.status !== 0) {
    throw new Error(`Could not optimize ${path.basename(sourcePath)}: ${result.stderr || result.stdout}`)
  }
}

async function fileMetadata(filePath) {
  const [buffer, info] = await Promise.all([readFile(filePath), stat(filePath)])
  return {
    bytes: info.size,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  }
}

async function requireSource(entry) {
  const sourcePath = path.resolve(sourceRoot, entry.sourceRelativePath)
  const info = await stat(sourcePath).catch(() => null)
  if (!info?.isFile()) {
    throw new Error(`Missing required ${entry.gender}.${entry.step} source: ${sourcePath}`)
  }
  return sourcePath
}

async function prepare() {
  const validation = validateExampleMediaManifest()
  const prepared = []

  for (const entry of allExampleMedia()) {
    const sourcePath = await requireSource(entry)

    if (entry.kind === 'photo') {
      const outputPath = resolveExampleMediaUploadSource(entry, { projectRoot, sourceRoot })
      await mkdir(path.dirname(outputPath), { recursive: true })
      runSips(sourcePath, outputPath)
      const metadata = await fileMetadata(outputPath)
      if (metadata.bytes > entry.maxBytes) {
        throw new Error(`${entry.gender}.${entry.step} is ${metadata.bytes} bytes after optimization`)
      }
      prepared.push({ ...metadata, gender: entry.gender, outputPath, step: entry.step })
      continue
    }

    const metadata = await fileMetadata(sourcePath)
    if (metadata.bytes > entry.maxBytes) {
      throw new Error(`${entry.gender}.${entry.step} is ${metadata.bytes} bytes and exceeds Telegram's limit`)
    }
    prepared.push({ ...metadata, gender: entry.gender, outputPath: sourcePath, step: entry.step })
  }

  const uploadPlan = exampleMediaUploadPlan({ projectRoot, sourceRoot })
  process.stdout.write(`${JSON.stringify({
    jpegQuality,
    maxDimension,
    prepared,
    sourceRoot,
    uploadPlan,
    validation,
  }, null, 2)}\n`)
}

prepare().catch((error) => {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
