import type { ActivityRow, FacetsResponse, Filter, SortKey, TagType } from '@tracks/core'
import { SORT_KEYS } from '@tracks/core'
import { ArrowDownUp, Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { activityColour, colourFor, neutralColour } from '../lib/colour.ts'
import { isNarrowed, narrowingFacets } from '../lib/filter-ops.ts'
import { duration, km, metres, shortDate } from '../lib/format.ts'
import styles from './ActivityList.module.css'
import { Dot } from './ui/Dot.tsx'
import { Popover } from './ui/Popover.tsx'

const SORT_LABELS: Record<SortKey, string> = {
  date: 'Date',
  distance: 'Distance',
  elevation: 'Elevation',
  duration: 'Duration',
  speed: 'Speed',
}

function Row({
  activity,
  colourBy,
  hovered,
  selected,
  onHover,
  onSelect,
}: {
  activity: ActivityRow
  colourBy: string | null
  hovered: boolean
  selected: boolean
  onHover: (id: number | null) => void
  onSelect: (id: number) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)

  // Hovering a track scrolls the list to it — the other half of the two-way link.
  useEffect(() => {
    if (hovered) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [hovered])

  return (
    <button
      ref={ref}
      type="button"
      className={[styles.row, hovered ? styles.hovered : '', selected ? styles.selected : ''].join(
        ' ',
      )}
      onMouseEnter={() => onHover(activity.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(activity.id)}
      aria-current={selected}
    >
      <span
        className={styles.bar}
        style={{
          background: activityColour(
            activity.tags,
            Number(activity.localDate.slice(0, 4)),
            colourBy,
          ),
        }}
      />
      <span className={styles.body}>
        <span className={styles.title}>{activity.title ?? 'Untitled'}</span>
        <span className={styles.metrics}>
          <span className={styles.primary}>{km(activity.distanceM)} km</span>
          <span className={styles.metric}>↑{metres(activity.elevationGainM)}</span>
          <span className={styles.metric}>{duration(activity.durationS)}</span>
        </span>
      </span>
      <span className={styles.date}>{shortDate(activity.localDate)}</span>
    </button>
  )
}

/**
 * The legend, and the selector that drives it.
 *
 * Values come from the facets already on screen, so the legend lists what is
 * actually drawn rather than everything that could be — and it is a legend, not a
 * control: clicking a value belongs to the sidebar, which is where filtering lives.
 */
function ColourByRow({
  tagTypes,
  facets,
  colourBy,
  onChange,
}: {
  tagTypes: TagType[]
  facets: FacetsResponse | undefined
  colourBy: string | null
  onChange: (next: string | null) => void
}) {
  const [open, setOpen] = useState(false)

  const options: Array<{ value: string | null; label: string }> = [
    { value: null, label: 'Nothing' },
    ...tagTypes.map((t) => ({ value: t.name, label: t.label })),
    { value: 'year', label: 'Year' },
  ]
  const current = options.find((o) => o.value === colourBy)?.label ?? 'Nothing'

  const facet = facets?.tags.find((t) => t.type === colourBy)
  const entries =
    colourBy === null
      ? []
      : colourBy === 'year'
        ? []
        : (facet?.values ?? [])
            .filter((v) => v.count > 0)
            .map((v) => ({ label: v.value, colour: colourFor(`${colourBy}:${v.value}`) }))

  return (
    <div className={styles.colourBy}>
      <div className={styles.anchor}>
        <button type="button" className={styles.selector} onClick={() => setOpen((was) => !was)}>
          <span className={styles.selectorLabel}>Colour by</span>
          <span className={styles.selectorValue}>{current}</span>
          <ChevronDown size={12} color="var(--muted)" />
        </button>

        <Popover open={open} onClose={() => setOpen(false)} width={170}>
          {options.map((option) => (
            <button
              key={option.label}
              type="button"
              className={[styles.option, option.value === colourBy ? styles.optionActive : ''].join(
                ' ',
              )}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
            >
              <span className={styles.optionCheck}>
                {option.value === colourBy ? (
                  <Check size={13} color="var(--accent)" strokeWidth={2.6} />
                ) : null}
              </span>
              {option.label}
            </button>
          ))}
        </Popover>
      </div>

      <div className={styles.legend}>
        {entries.map((entry) => (
          <span key={entry.label} className={styles.legendItem}>
            <Dot colour={entry.colour} size={8} />
            {entry.label}
          </span>
        ))}
        {colourBy !== null && colourBy !== 'year' && (facet?.notSet ?? 0) > 0 ? (
          <span className={[styles.legendItem, styles.legendMuted].join(' ')}>
            <Dot colour={null} size={8} />
            not set
          </span>
        ) : null}
        {colourBy === 'year' ? <span className={styles.legendNote}>one hue per year</span> : null}
        {colourBy === null ? (
          <span className={styles.legendItem}>
            <Dot colour={neutralColour()} size={8} />
            all tracks
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function ActivityList({
  activities,
  facets,
  tagTypes,
  filter,
  colourBy,
  hoveredId,
  selectedId,
  loading,
  error,
  onHover,
  onSelect,
  onColourBy,
  onSort,
  onClear,
}: {
  activities: ActivityRow[] | undefined
  facets: FacetsResponse | undefined
  tagTypes: TagType[]
  filter: Filter
  colourBy: string | null
  hoveredId: number | null
  selectedId: number | null
  loading: boolean
  error: string | null
  onHover: (id: number | null) => void
  onSelect: (id: number) => void
  onColourBy: (next: string | null) => void
  onSort: (key: SortKey, order: 'asc' | 'desc') => void
  onClear: () => void
}) {
  const [sortOpen, setSortOpen] = useState(false)
  const count = facets?.summary.count ?? activities?.length ?? 0

  return (
    <>
      <div className={styles.header}>
        <div className={styles.count}>
          {count} {count === 1 ? 'activity' : 'activities'}
        </div>
        <div className={styles.spacer} />
        <div className={styles.anchor}>
          <button type="button" className={styles.sort} onClick={() => setSortOpen((was) => !was)}>
            <ArrowDownUp size={12} color="var(--muted)" />
            <span>{SORT_LABELS[filter.sortKey]}</span>
            <ChevronDown size={13} color="var(--muted)" />
          </button>

          <Popover open={sortOpen} onClose={() => setSortOpen(false)} width={190}>
            {SORT_KEYS.flatMap((key) =>
              (['desc', 'asc'] as const).map((order) => {
                const active = filter.sortKey === key && filter.sortOrder === order
                return (
                  <button
                    key={`${key}-${order}`}
                    type="button"
                    className={[styles.option, active ? styles.optionActive : ''].join(' ')}
                    onClick={() => {
                      onSort(key, order)
                      setSortOpen(false)
                    }}
                  >
                    <span className={styles.optionCheck}>
                      {active ? <Check size={13} color="var(--accent)" strokeWidth={2.6} /> : null}
                    </span>
                    {SORT_LABELS[key]}
                    <span className={styles.optionHint}>
                      {order === 'desc' ? 'high → low' : 'low → high'}
                    </span>
                  </button>
                )
              }),
            )}
          </Popover>
        </div>
      </div>

      <ColourByRow tagTypes={tagTypes} facets={facets} colourBy={colourBy} onChange={onColourBy} />

      <div className={styles.rows}>
        {error ? (
          <div className={styles.banner}>
            <strong>Could not load activities</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {!error && activities === undefined && loading
          ? Array.from({ length: 8 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders with no identity
              <div key={i} className={styles.skeleton} />
            ))
          : null}

        {!error && activities?.length === 0 ? (
          <div className={styles.empty}>
            <strong>Nothing matches</strong>
            {isNarrowed(filter) ? (
              <>
                <span>
                  Narrowed by{' '}
                  {narrowingFacets(filter, new Map(tagTypes.map((t) => [t.name, t.label]))).join(
                    ', ',
                  )}
                  .
                </span>
                <button type="button" className={styles.clear} onClick={onClear}>
                  Clear filters
                </button>
              </>
            ) : (
              <span>Import some activities to get started.</span>
            )}
          </div>
        ) : null}

        {activities?.map((activity) => (
          <Row
            key={activity.id}
            activity={activity}
            colourBy={colourBy}
            hovered={hoveredId === activity.id}
            selected={selectedId === activity.id}
            onHover={onHover}
            onSelect={onSelect}
          />
        ))}
      </div>
    </>
  )
}
