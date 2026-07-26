import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  EXAMPLE_MEDIA_BUCKET,
  EXAMPLE_MEDIA_GENDERS,
  EXAMPLE_MEDIA_STEPS,
  ExampleMediaConfigurationError,
  allExampleMedia,
  exampleMediaManifest,
  exampleMediaUploadPlan,
  getRequiredExampleMedia,
  validateExampleMediaManifest,
} from '../server/exampleMedia.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const expectedSources = {
  female: {
    closeShotPhoto: 'woman closer shot.jpeg',
    fullBodyPhoto: 'woman full body.jpeg',
    introVideo: 'telegram-ready/female-intro.mp4',
    leftProfilePhoto: 'woman left.jpeg',
    portraitPhoto: 'woman portrait.jpeg',
    rightProfilePhoto: 'woman right.jpeg',
  },
  male: {
    closeShotPhoto: 'man closer shot.PNG',
    fullBodyPhoto: 'man, fully body front.PNG',
    introVideo: 'telegram-ready/male-intro.mp4',
    leftProfilePhoto: 'man left.PNG',
    portraitPhoto: 'man portait.PNG',
    rightProfilePhoto: 'man right.PNG',
  },
}

function jpegDimensions(buffer) {
  assert.equal(buffer[0], 0xff)
  assert.equal(buffer[1], 0xd8)

  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = buffer[offset + 1]
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      }
    }

    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }

    offset += 2 + buffer.readUInt16BE(offset + 2)
  }

  throw new Error('JPEG dimensions were not found')
}

test('manifest contains the exact required male and female mapping', () => {
  const validation = validateExampleMediaManifest()
  assert.deepEqual(EXAMPLE_MEDIA_GENDERS, ['male', 'female'])
  assert.deepEqual(EXAMPLE_MEDIA_STEPS, [
    'fullBodyPhoto',
    'closeShotPhoto',
    'leftProfilePhoto',
    'rightProfilePhoto',
    'portraitPhoto',
    'introVideo',
  ])
  assert.deepEqual(validation.total, 12)
  assert.equal(validation.photos, 10)
  assert.equal(validation.videos, 2)

  for (const gender of EXAMPLE_MEDIA_GENDERS) {
    for (const step of EXAMPLE_MEDIA_STEPS) {
      const entry = exampleMediaManifest[gender][step]
      assert.equal(entry.sourceRelativePath, expectedSources[gender][step])
      assert.equal(entry.reference, `s3://${EXAMPLE_MEDIA_BUCKET}/${entry.objectKey}`)
      assert.match(entry.objectKey, /^examples\//)
      assert.equal(entry.required, true)
    }
  }
})

test('required lookup never silently returns a missing mapping', () => {
  assert.equal(
    getRequiredExampleMedia('female', 'fullBodyPhoto'),
    exampleMediaManifest.female.fullBodyPhoto,
  )
  assert.equal(getRequiredExampleMedia('male', 'video'), exampleMediaManifest.male.introVideo)
  assert.throws(
    () => getRequiredExampleMedia('unknown', 'fullBodyPhoto'),
    ExampleMediaConfigurationError,
  )
  assert.throws(
    () => getRequiredExampleMedia('male', 'unknown'),
    ExampleMediaConfigurationError,
  )
})

test('all optimized photo examples are valid, compact JPEGs', async () => {
  const photos = allExampleMedia().filter((entry) => entry.kind === 'photo')
  assert.equal(photos.length, 10)

  for (const entry of photos) {
    const filePath = path.resolve(projectRoot, entry.preparedRelativePath)
    const [buffer, info] = await Promise.all([readFile(filePath), stat(filePath)])
    const dimensions = jpegDimensions(buffer)

    assert.ok(info.size > 10_000, `${entry.gender}.${entry.step} is unexpectedly small`)
    assert.ok(info.size <= entry.maxBytes, `${entry.gender}.${entry.step} exceeds its byte limit`)
    assert.ok(dimensions.width <= 1600, `${entry.gender}.${entry.step} is too wide`)
    assert.ok(dimensions.height <= 1600, `${entry.gender}.${entry.step} is too tall`)
  }
})

test('upload plan uses repository photos, source-library videos, and unique keys', () => {
  const sourceRoot = '/tmp/example-source'
  const plan = exampleMediaUploadPlan({ projectRoot, sourceRoot })
  assert.equal(plan.length, 12)
  assert.equal(new Set(plan.map((entry) => entry.objectKey)).size, 12)

  for (const entry of plan) {
    if (entry.step === 'introVideo') {
      assert.ok(entry.sourcePath.startsWith(sourceRoot))
    } else {
      assert.ok(entry.sourcePath.startsWith(path.join(projectRoot, 'assets/example-media')))
    }
  }
})
