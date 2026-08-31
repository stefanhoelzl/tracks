import type {
  ActivityRow,
  FacetsResponse,
  Filter,
  RangeKey,
  RegisteredType,
  TagWrite,
} from '@tracks/core'
import { RANGE_KEYS } from '@tracks/core'
import { CalendarDays, Check, ChevronDown, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { type ColourScale, TYPE_GROUP } from '../lib/colour.ts'
import {
  datePresets,
  excludeTag,
  setDates,
  setRange,
  setSearch,
  termState,
  toggleTag,
} from '../lib/filter-ops.ts'
import { RANGE_UNITS } from '../lib/format.ts'
import styles from './FilterSidebar.module.css'
import { TagInput } from './TagInput.tsx'
import { Label } from './ui/Label.tsx'
import { Popover } from './ui/Popover.tsx'
import { RangeSlider } from './ui/RangeSlider.tsx'
import { ValueRow } from './ui/ValueRow.tsx'

/**
 * The filter sidebar.
 *
 * Every group is driven by data rather than written out: the tag groups come from
 * the registry in its own sort order, and the four range groups come from one list.
 * Adding a fifth range, or a new tag type, is a row of data — which is the property
 * that keeps this file from growing a section per facet.
 */

function TagGroup({
  type,
  facet,
  filter,
  scale,
  inScope,
  onChange,
  onRemove,
}: {
  type: RegisteredType
  facet: FacetsResponse['tags'][number] | undefined
  filter: Filter
  scale: ColourScale
  /** The tags the activities on screen actually carry — what the trash is offered for. */
  inScope: ReadonlySet<string>
  onChange: (next: Filter, mode?: 'push' | 'replace') => void
  onRemove: ((tag: string) => void) | undefined
}) {
  const values = facet?.values ?? []

  // A labelled region rather than a bare div: every group holds a *not set* row, so
  // without one, "not set" names three different controls on the same screen.
  return (
    <section className={styles.group} aria-label={type.label}>
      <div className={styles.groupHead}>
        <span
          className={styles.groupSwatch}
          style={{ background: scale.colour(TYPE_GROUP, type.name) }}
        />
        <span className={styles.groupLabel}>{type.label}</span>
        <span className={styles.groupName}>{type.name}:</span>
      </div>

      <div className={styles.rows}>
        {values.length === 0 && (facet?.notSet ?? 0) === 0 ? (
          <div className={styles.none}>No {type.label.toLowerCase()} tags yet</div>
        ) : (
          <>
            {values.map((value) => (
              <ValueRow
                key={value.value}
                label={value.value}
                count={value.count}
                colour={scale.colour(type.name, value.value)}
                state={termState(filter, type.name, value.value)}
                onToggle={() => onChange(toggleTag(filter, type.name, value.value))}
                onExclude={() => onChange(excludeTag(filter, type.name, value.value))}
                // Counts here are self-excluded, so this row can read 41 while the
                // filter as it stands holds none of them. The trash writes over the
                // filter exactly, so it appears only where it would do something.
                onRemove={
                  onRemove && inScope.has(`${type.name}:${value.value}`)
                    ? () => onRemove(`${type.name}:${value.value}`)
                    : undefined
                }
              />
            ))}
            {(facet?.notSet ?? 0) > 0 || termState(filter, type.name, null) !== 'off' ? (
              <ValueRow
                label="not set"
                count={facet?.notSet ?? 0}
                colour={null}
                muted
                state={termState(filter, type.name, null)}
                onToggle={() => onChange(toggleTag(filter, type.name, null))}
                onExclude={() => onChange(excludeTag(filter, type.name, null))}
              />
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

function DateFilter({ filter, onChange }: { filter: Filter; onChange: (next: Filter) => void }) {
  const [open, setOpen] = useState(false)
  const presets = datePresets(new Date())

  const current =
    presets.find((p) => p.from === filter.from && p.to === filter.to)?.label ??
    `${filter.from ?? '…'} → ${filter.to ?? '…'}`

  return (
    <div className={styles.anchor}>
      <button
        type="button"
        className={[styles.field, open ? styles.fieldOpen : ''].join(' ')}
        onClick={() => setOpen((was) => !was)}
      >
        <CalendarDays size={15} color={open ? 'var(--accent)' : 'var(--muted)'} />
        <span className={styles.fieldValue}>{current}</span>
        <ChevronDown size={13} color="var(--muted)" />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} placement="right" width={230}>
        {presets.map((preset) => {
          const active = preset.from === filter.from && preset.to === filter.to
          return (
            <button
              key={preset.label}
              type="button"
              className={[styles.preset, active ? styles.presetActive : ''].join(' ')}
              onClick={() => {
                onChange(setDates(filter, preset.from, preset.to))
                setOpen(false)
              }}
            >
              <span className={styles.presetCheck}>
                {active ? <Check size={13} color="var(--accent)" strokeWidth={2.6} /> : null}
              </span>
              {preset.label}
            </button>
          )
        })}

        <div className={styles.divider} />
        <div className={styles.custom}>
          <Label>Custom</Label>
          <div className={styles.customRow}>
            <input
              type="date"
              className={styles.date}
              value={filter.from ?? ''}
              aria-label="From date"
              onChange={(e) => onChange(setDates(filter, e.target.value || null, filter.to))}
            />
            <span className={styles.to}>to</span>
            <input
              type="date"
              className={styles.date}
              value={filter.to ?? ''}
              aria-label="To date"
              onChange={(e) => onChange(setDates(filter, filter.from, e.target.value || null))}
            />
          </div>
        </div>
      </Popover>
    </div>
  )
}

function RangeGroup({
  rangeKey,
  facet,
  filter,
  onChange,
}: {
  rangeKey: RangeKey
  facet: FacetsResponse['ranges'][RangeKey] | undefined
  filter: Filter
  onChange: (next: Filter, mode?: 'push' | 'replace') => void
}) {
  const units = RANGE_UNITS[rangeKey]
  const bounds = filter.ranges[rangeKey]

  if (!facet || facet.min === null || facet.max === null) {
    return (
      <div className={styles.group}>
        <Label>{units.label}</Label>
        <div className={styles.none}>Nothing in range</div>
      </div>
    )
  }

  return (
    <div className={styles.group}>
      <div className={styles.rangeHead}>
        <Label>{units.label}</Label>
        <span className={styles.unit}>{units.unit}</span>
      </div>
      <RangeSlider
        label={units.label}
        axisMin={facet.min}
        axisMax={facet.max}
        min={bounds.min}
        max={bounds.max}
        buckets={facet.buckets}
        format={units.format}
        // Replace, not push: a drag is one gesture and Back should step out of all
        // of it rather than through every frame.
        onChange={(next) => onChange(setRange(filter, rangeKey, next), 'replace')}
      />
    </div>
  )
}

/**
 * Search by title.
 *
 * A filter term like any other, so it lives with the rest of them rather than over
 * the list it narrows — and at the top, because it is what you reach for first when
 * hunting the activities that a tag is missing from.
 *
 * Every keystroke replaces rather than pushes: typing is one gesture, and Back should
 * leave the search rather than walk back through it a letter at a time.
 */
function SearchField({
  filter,
  onChange,
}: {
  filter: Filter
  onChange: (next: Filter, mode?: 'push' | 'replace') => void
}) {
  return (
    <div className={styles.search}>
      <Search size={13} color="var(--muted)" strokeWidth={2.2} />
      <input
        type="search"
        className={styles.searchInput}
        placeholder="Search titles"
        aria-label="Search titles"
        value={filter.q ?? ''}
        onChange={(event) => onChange(setSearch(filter, event.target.value), 'replace')}
      />
      {filter.q !== null ? (
        <button
          type="button"
          className={styles.searchClear}
          aria-label="Clear search"
          onClick={() => onChange(setSearch(filter, ''))}
        >
          <X size={12} strokeWidth={2.4} />
        </button>
      ) : null}
    </div>
  )
}

export function FilterSidebar({
  tagTypes,
  facets,
  filter,
  scale,
  activities,
  writing,
  result,
  onChange,
  onWrite,
}: {
  tagTypes: RegisteredType[]
  facets: FacetsResponse | undefined
  filter: Filter
  scale: ColourScale
  /** The rows the filter matches, which the browser holds in full — see `inScope`. */
  activities: ActivityRow[] | undefined
  writing: boolean
  /** What the last write did, until the next action. */
  result: string | null
  onChange: (next: Filter, mode?: 'push' | 'replace') => void
  onWrite: ((write: TagWrite) => Promise<unknown>) | undefined
}) {
  const byType = new Map((facets?.tags ?? []).map((f) => [f.type, f]))

  /**
   * Which tags the activities on screen carry.
   *
   * Counted here rather than fetched: the client holds every matching row already, so
   * this is exact and free, where the facet counts cannot answer it — they are
   * self-excluded, and deliberately so.
   */
  const inScope = useMemo(() => {
    const tags = new Set<string>()
    for (const activity of activities ?? []) {
      for (const tag of activity.tags) tags.add(tag)
    }
    return tags
  }, [activities])

  const matching = facets?.summary.count ?? 0

  return (
    <div className={styles.sidebar}>
      <SearchField filter={filter} onChange={onChange} />

      {onWrite ? (
        <div className={styles.write}>
          {/* Directly under the search, because the two are one gesture: narrow to the
              activities a tag is missing from, then apply it to what is left. One field
              rather than one per group — the grammar carries the type. */}
          <Label>Tag all {matching}</Label>
          <TagInput
            tagTypes={tagTypes}
            scale={scale}
            placeholder="type:value"
            disabled={matching === 0}
            pending={writing}
            onSubmit={(tag, newType) => onWrite({ add: [tag], remove: [], newType })}
          />
          {result ? <p className={styles.result}>{result}</p> : null}
        </div>
      ) : null}

      <div className={styles.group}>
        <Label>Tags</Label>
        <div className={styles.tagGroups}>
          {tagTypes.map((type) => (
            <TagGroup
              key={type.name}
              type={type}
              facet={byType.get(type.name)}
              filter={filter}
              scale={scale}
              inScope={inScope}
              onChange={onChange}
              onRemove={onWrite && ((tag) => void onWrite({ add: [], remove: [tag] }))}
            />
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <Label>Date range</Label>
        <DateFilter filter={filter} onChange={onChange} />
      </div>

      {RANGE_KEYS.map((key) => (
        <RangeGroup
          key={key}
          rangeKey={key}
          facet={facets?.ranges[key]}
          filter={filter}
          onChange={onChange}
        />
      ))}
    </div>
  )
}
