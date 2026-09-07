/**
 * The two lines of Deno the edge script uses.
 *
 * Not `@types/deno`: the script reads two environment variables and nothing else, and a
 * whole runtime's types would invite the rest of it into a package that is deliberately
 * the same code the Node dev server runs.
 */
declare const Deno: {
  env: { get(name: string): string | undefined }
}
