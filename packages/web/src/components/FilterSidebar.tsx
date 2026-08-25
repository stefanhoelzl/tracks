import type { FacetsResponse, Filter, RangeKey, TagType } from '@tracks/core'
import { RANGE_KEYS } from '@tracks/core'
import { CalendarDays, Check, ChevronDown, Square, X } from 'lucide-react'
import { useState } from 'react'
import { colourFor } from '../lib/colour.ts'
import {
  datePresets,
  excludeTag,
  setDates,
  setRange,
  termState,
  toggleTag,
} from '../lib/filter-ops.ts'
import { RANGE_UNITS } from '../lib/format.ts'
import styles from './FilterSidebar.module.css'
import { Histogram } from './ui/Histogram.tsx'
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
  onChange,
}: {
  type: TagType
  facet: FacetsResponse['tags'][number] | undefined
  filter: Filter
  onChange: (next: Filter, mode?: 'push' | 'replace') => void
}) {
  const values = facet?.values ?? []

  // A labelled region rather than a bare div: every group holds a *not set* row, so
  // without one, "not set" names three different controls on the same screen.
  return (
    <section className={styles.group} aria-label={type.label}>
      <div className={styles.groupHead}>
        <span className={styles.groupSwatch} style={{ background: type.color }} />
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
                colour={colourFor(`${type.name}:${value.value}`)}
                state={termState(filter, type.name, value.value)}
                onToggle={() => onChange(toggleTag(filter, type.name, value.value))}
                onExclude={() => onChange(excludeTag(filter, type.name, value.value))}
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
      <Histogram buckets={facet.buckets} />
      <RangeSlider
        label={units.label}
        axisMin={facet.min}
        axisMax={facet.max}
        min={bounds.min}
        max={bounds.max}
        format={units.format}
        // Replace, not push: a drag is one gesture and Back should step out of all
        // of it rather than through every frame.
        onChange={(next) => onChange(setRange(filter, rangeKey, next), 'replace')}
      />
    </div>
  )
}

export function FilterSidebar({
  tagTypes,
  facets,
  filter,
  areaFilter,
  onChange,
  onClearArea,
}: {
  tagTypes: TagType[]
  facets: FacetsResponse | undefined
  filter: Filter
  areaFilter: boolean
  onChange: (next: Filter, mode?: 'push' | 'replace') => void
  onClearArea: () => void
}) {
  const byType = new Map((facets?.tags ?? []).map((f) => [f.type, f]))

  return (
    <div className={styles.sidebar}>
      {areaFilter && filter.bbox ? (
        <div className={styles.area}>
          <div className={styles.areaHead}>
            <Square size={15} color="var(--accent)" strokeWidth={2} />
            <span className={styles.areaTitle}>Area selected</span>
            <button type="button" onClick={onClearArea} aria-label="Clear area filter">
              <X size={14} color="var(--accent)" />
            </button>
          </div>
          <div className={styles.areaCoords}>
            {filter.bbox[1].toFixed(2)}–{filter.bbox[3].toFixed(2)} N · {filter.bbox[0].toFixed(2)}–
            {filter.bbox[2].toFixed(2)} E
          </div>
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
              onChange={onChange}
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
