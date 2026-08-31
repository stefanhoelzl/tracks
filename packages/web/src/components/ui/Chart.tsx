import { BarChart, type BarSeriesOption, LineChart, type LineSeriesOption } from 'echarts/charts'
import {
  AxisPointerComponent,
  GridComponent,
  type GridComponentOption,
  MarkAreaComponent,
  type MarkAreaComponentOption,
  TooltipComponent,
  type TooltipComponentOption,
} from 'echarts/components'
import { type ComposeOption, type EChartsType, init, registerTheme, use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'
import { THEME, THEME_DEFINITION } from '../../lib/chart-theme.ts'
import styles from './Chart.module.css'

/**
 * One ECharts instance, mounted.
 *
 * Hand-wired rather than through `echarts-for-react`, for the reason `MapView` gives
 * about MapLibre: an imperative library driven from a hook is a layer to use, and a
 * declarative wrapper over it is a layer to fight. What that wrapper would do for us —
 * init, `setOption`, dispose, a resize observer — is the body of this file.
 *
 * Everything above it builds an *option object* and hands it over. That is deliberate:
 * the option is where all the deciding happens (a span floor, a dimmed edge, how nulls
 * are drawn), it is a value, and a value is the thing worth testing.
 *
 * The SVG renderer, not canvas. jsdom has no canvas, and the sidebar mounts four of
 * these in a single component test; at 38 px tall and a few hundred marks, the fast
 * path canvas exists for is not the path anything here is on.
 */

// AxisPointerComponent is not optional decoration: it is what `tooltip.trigger: 'axis'`
// and `dispatchAction({ type: 'showTip' })` are both implemented on top of. Without it
// installed, both simply do nothing, and they do it silently.
use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  MarkAreaComponent,
  SVGRenderer,
])
registerTheme(THEME, THEME_DEFINITION)

/**
 * Every option this app can build, composed from exactly what is registered above.
 *
 * The point of the narrow type is the same as the point of the narrow `use` list: an
 * option naming a component nobody installed is a chart that silently does not draw
 * it, and this turns that into a compile error instead.
 */
export type ChartOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | MarkAreaComponentOption
>

export function Chart({
  option,
  height,
  className,
  onInit,
}: {
  option: ChartOption
  height: number
  className?: string
  /** The way out to the instance, for the one caller that dispatches into it. */
  onInit?: (chart: EChartsType) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const chart = useRef<EChartsType | null>(null)

  // The init effect runs once and reads these when it fires, which can be long after
  // this render — a stale closure would init against the first option and never the
  // one that arrived while the panel was still 0 px wide.
  const live = useRef({ option, onInit })
  live.current = { option, onInit }

  /**
   * Init is deferred until the box has been measured at a non-zero size.
   *
   * `init` on a 0×0 element gives ECharts nothing to lay out and earns a console
   * warning for it, which is exactly what a collapsed panel and a jsdom test both
   * look like. Observing first inverts that: the browser's ResizeObserver reports the
   * initial box immediately, so this costs nothing real, and in jsdom — where nothing
   * has a size — no chart is ever built and no warning is ever printed.
   */
  useEffect(() => {
    const element = box.current
    if (!element) return

    const observer = new ResizeObserver(() => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return
      if (chart.current) {
        chart.current.resize()
        return
      }
      chart.current = init(element, THEME, { renderer: 'svg' })
      chart.current.setOption(live.current.option, true)
      live.current.onInit?.(chart.current)
    })
    observer.observe(element)

    return () => {
      observer.disconnect()
      chart.current?.dispose()
      chart.current = null
    }
  }, [])

  // `notMerge`, because these options carry things that have to be able to *go*: a
  // markArea when a bound is cleared, a series when the altitude runs out. Merging
  // would leave the last one drawn.
  useEffect(() => {
    chart.current?.setOption(option, true)
  }, [option])

  return (
    <div
      ref={box}
      // Named the way the map is, and for the same reason: a test can then say a
      // chart is here, or is not, without reaching into what it drew.
      data-testid="chart"
      className={[styles.chart, className].filter(Boolean).join(' ')}
      style={{ height }}
    />
  )
}
