import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURE_DIR, generateAppFixtures } from './app-fixtures.ts'

describe('the fixtures the Kotlin ports are pinned to', () => {
  for (const [name, content] of Object.entries(generateAppFixtures())) {
    it(`${name} is what the TypeScript answers today`, () => {
      // A failure here is a codec that changed without the phone hearing about it. Run
      // `pnpm fixtures:app`, then `./gradlew :shared:jvmTest` in `app/`, and carry the
      // change to the Kotlin until it passes.
      expect(readFileSync(join(FIXTURE_DIR, name), 'utf8')).toBe(content)
    })
  }
})
