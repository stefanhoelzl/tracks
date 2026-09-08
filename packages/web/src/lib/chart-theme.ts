/**
 * What ECharts is allowed to paint with, and the one scale it paints from.
 *
 * The second file to claim the exception `colour.ts` documents. A chart's colours are
 * JS values, and the SVG renderer writes them straight into presentation attributes —
 * where `var(--ink-2)` is not a colour but a string nothing reports as wrong. Reading
 * the tokens back out through `getComputedStyle` was rejected for the palette and is
 * rejected here for the same reason: its only failure mode is silent.
 *
 * So the handful of tokens a chart needs are *mirrored* here, which means a change on
 * either side is a change on both. The list is short on purpose.
 *
 * `GRADE` below is the exception to that exception: it mirrors nothing, because no CSS
 * rule will ever want it. It is the gradient ramp, and it lives here rather than in the
 * token file because here is the only place that reads it.
 */
export const CHART = {
  /**
   * `--ink-2`. What the profile draws where its gradient is unknown.
   *
   * It was the profile's whole line once, when terrain was drawn as terrain and not as
   * effort. The colour survived the change by becoming a value: a stretch too close to
   * a dropout for the window to measure across is drawn in neutral ink, which says we
   * do not know rather than picking a colour that would claim we do.
   */
  ink: '#3e4945',
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

/**
 * The gradient ramp: where each colour sits on the slope.
 *
 * Anchors and colours are one table because they are one decision — an anchor moved
 * without its colour is a scale nobody chose.
 *
 * Absolute, never normalised per track: 8% is 8% on every activity, so a towpath draws
 * all green and an alpine col reds out. A scale restretched per ride would make dark
 * red mean "4%" on a flat one, and the colour would carry nothing you could take to
 * the next activity.
 *
 * Level ground is *light green*, not yellow: green means this is not costing you
 * anything, which is as true of flat as of downhill. Descent saturates at −8%, which
 * real descents reach constantly, rather than mirroring +15% onto ground almost
 * nothing reaches. The warm half tightens towards the top, because the difference
 * between 11% and 15% is one a rider feels and the difference between −8% and −12% is
 * not.
 *
 * The greens are the accent family's, so the profile belongs to this app rather than
 * to a generic cycling widget; the warms are a step back from full saturation so they
 * sit on white beside muted grey without shouting.
 *
 * Under deuteranopia the two ends of this ramp collapse into each other — dark green
 * and dark red both read as dark olive. That is known and accepted: red-for-steep is
 * the convention in this domain, the profile's *shape* is the first read and its
 * colour the second, and a hover gives the figure in digits.
 */
export const GRADE = [
  { at: -8, colour: '#0a6e4c' },
  { at: 0, colour: '#6fbf8e' },
  { at: 4, colour: '#e3c033' },
  { at: 8, colour: '#dd8531' },
  { at: 11.5, colour: '#c4382c' },
  { at: 15, colour: '#7d1a18' },
] as const

/** Which two anchors a gradient falls between, and how far along it is between them. */
function locate(gradient: number): { index: number; within: number } {
  const last = GRADE.length - 1
  if (gradient <= GRADE[0].at) return { index: 0, within: 0 }
  if (gradient >= GRADE[last]!.at) return { index: last - 1, within: 1 }

  for (let i = 1; i <= last; i++) {
    const upper = GRADE[i]!
    if (gradient > upper.at) continue
    const lower = GRADE[i - 1]!
    return { index: i - 1, within: (gradient - lower.at) / (upper.at - lower.at) }
  }
  return { index: last - 1, within: 1 }
}

/**
 * A gradient in percent, as a position along the ramp between 0 and 1.
 *
 * The anchors are not evenly spaced, so this is the warp that makes them look it: the
 * six stops land on 0, 0.2, 0.4, 0.6, 0.8 and 1 whatever percentages they sit at.
 * Clamped at both ends — past +15% there is nothing left to say.
 */
export function rampPosition(gradient: number): number {
  const { index, within } = locate(gradient)
  return (index + within) / (GRADE.length - 1)
}

function channels(hex: string): [number, number, number] {
  const packed = Number.parseInt(hex.slice(1), 16)
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255]
}

/**
 * The ramp's colour at a gradient, interpolated between the two anchors it falls
 * between — in sRGB, which is what the browser interpolates an SVG gradient in, so the
 * figure in the tooltip is the colour of the line under it and not a near miss.
 */
export function gradeColour(gradient: number): string {
  const { index, within } = locate(gradient)
  const from = channels(GRADE[index]!.colour)
  const to = channels(GRADE[index + 1]!.colour)

  const mixed = from.map((value, channel) => Math.round(value + (to[channel]! - value) * within))
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

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
