// TEMPORARY PROBE: the smallest thing that can answer, with no imports at all.
// If this answers, the runtime and the zone are fine and something in our bundle
// fails at module load. If it 508s too, the loop is in the pull zone, not the code.
export default {
  fetch: () => new Response('probe ok', { headers: { 'content-type': 'text/plain' } }),
}
