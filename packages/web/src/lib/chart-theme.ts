/**
 * What ECharts is allowed to paint with.
 *
 * The second file to claim the exception `colour.ts` documents. A chart's colours are
 * JS values, and the SVG renderer writes them straight into presentation attributes —
 * where `var(--ink-2)` is not a colour but a string nothing reports as wrong. Reading
 * the tokens back out through `getComputedStyle` was rejected for the palette and is
 * rejected here for the same reason: its only failure mode is silent.
 *
 * So the handful of tokens a chart needs are *mirrored* here, which means a change on
 * either side is a change on both. The list is short on purpose.
 */
export const CHART = {
  /** `--ink-2`. The profile's own line: neutral, because terrain is not a category. */
  ink: '#3e4945',
  /** `--ink-2` at a twelfth, for the area under it. */
  fill: 'rgba(62, 73, 69, 0.12)',
  /** `--muted`. Axis labels, at the size the slider's own bounds are set in. */
  muted: '#77837e',
  /** `--accent` at the 0.8 the histogram has always drawn its bars at. */
  bar: 'rgba(13, 138, 95, 0.8)',
  /**
   * What lies over the buckets outside the selection.
   *
   * `--surface`, two thirds opaque, drawn *over* the bars rather than as a second bar
   * colour: the bars stay one flat series, and the edge of the wash can sit anywhere —
   * including mid-bucket, which is where a continuous handle usually leaves it.
   *
   * White rather than grey so it only ever pales the bars it covers. A tinted wash
   * would also tint the panel showing between them, which turns a dimmed *range* into
   * a grey box drawn on the sidebar.
   */
  dim: 'rgba(255, 255, 255, 0.66)',
  /** `--ink`, near-opaque: the tooltip's own plate. */
  tip: 'rgba(15, 21, 19, 0.92)',
  /** `--surface`, on it. */
  tipInk: '#ffffff',
} as const

/** `--font-mono`. Every figure in this app is set in it; a chart's are no exception. */
const MONO = '"JetBrains Mono Variable", ui-monospace, Menlo, monospace'

export const THEME = 'tracks'

/**
 * Registered once, so no option builder repeats the type ramp.
 *
 * Only what every chart shares lives here. Anything one chart decides — a bar colour,
 * an axis it hides — belongs in that chart's option, where it can be read beside the
 * data it describes.
 */
export const THEME_DEFINITION = {
  textStyle: { fontFamily: MONO, fontSize: 10 },
  /* 10px is `--text-xs`, which is what the slider's bounds row is set in. */
  animationDuration: 160,
  animationDurationUpdate: 160,
} as const
