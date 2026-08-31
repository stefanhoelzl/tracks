/**
 * Gzip through the platform, replacing `node:zlib`.
 *
 * Built on a hand-made `ReadableStream` rather than `new Blob([bytes]).stream()`,
 * which reads better but does not exist in jsdom — so the convenient spelling would
 * work in every real browser and fail only in the tests. One shape that works in both
 * is worth more than the nicer line.
 */
export function through(bytes: Uint8Array, transform: TransformStream): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
  return collect(source.pipeThrough(transform))
}

export function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  return through(bytes, new DecompressionStream('gzip'))
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let length = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    length += value.length
  }

  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
