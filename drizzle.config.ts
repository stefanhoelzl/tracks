import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/server/src/schema.ts',
  out: './migrations',
})
