import { type NewType, parseTag, type RegisteredType, validateTag } from '@tracks/core'
import { useMemo, useRef, useState } from 'react'
import { type ColourScale, neutralColour } from '../lib/colour.ts'
import styles from './TagInput.module.css'
import { Dot } from './ui/Dot.tsx'

/**
 * Where a tag is typed — in the sidebar over the whole filter, and in the detail panel
 * over one activity.
 *
 * One field taking `<type>:<value>` exactly as the grammar defines it, rather than a
 * type picker and a value picker: the grammar is already the thing shown under every
 * sidebar group and written into every URL, and three keystrokes with a suggestion
 * under them beats two controls. The suggestions are the whole typo guard, now that a
 * type declares no vocabulary — so they are drawn from every value in use, not from
 * the ones the current filter happens to match.
 *
 * An unknown type is not refused outright, because the alternative would be a
 * create-type screen somewhere else and a journey back. It opens a two-field form
 * here, and the type is created in the same request as its first tag.
 */

/** How many suggestions fit before the list is a page of its own. */
const LIMIT = 6

function suggestionsFor(tagTypes: RegisteredType[], text: string): string[] {
  // Nothing until something is typed: the values are already listed above, in the
  // facets, and a list that is always open would push them off the panel.
  const query = text.trim().toLowerCase()
  if (query === '') return []

  return tagTypes
    .flatMap((type) => type.values.map((v) => `${type.name}:${v.value}`))
    .filter((tag) => tag.toLowerCase().includes(query))
    .slice(0, LIMIT)
}

/** `gear` → `Gear`: a first guess at the label, so the form is one keystroke to accept. */
function labelFor(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ')
}

export function TagInput({
  tagTypes,
  scale,
  placeholder,
  disabled = false,
  pending = false,
  onSubmit,
}: {
  tagTypes: RegisteredType[]
  scale: ColourScale
  placeholder: string
  disabled?: boolean
  pending?: boolean
  /** Rejects by throwing; the field keeps its text so the mistake can be corrected. */
  onSubmit: (tag: string, newType?: NewType) => Promise<unknown>
}) {
  const [text, setText] = useState('')
  const [active, setActive] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  // Set when the typed tag names a type that does not exist: the form for it opens
  // below the field, prefilled, rather than sending you somewhere else to make one.
  const [newType, setNewType] = useState<NewType | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const registry = useMemo(() => new Map(tagTypes.map((t) => [t.name, t])), [tagTypes])
  const suggestions = useMemo(() => suggestionsFor(tagTypes, text), [tagTypes, text])

  const reset = () => {
    setText('')
    setActive(-1)
    setError(null)
    setNewType(null)
    // The next application is nearly always a different subset of a filter you are
    // about to change, so the text goes; the caret stays where you are working.
    input.current?.focus()
  }

  const apply = async (tag: string, type?: NewType) => {
    try {
      await onSubmit(tag, type)
      reset()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  const submit = async (raw: string) => {
    const tag = raw.trim()
    if (tag === '') return

    const parsed = parseTag(tag)
    if (!parsed) {
      setError(`'${tag}' is not a <type>:<value> tag`)
      return
    }

    if (!registry.has(parsed.type)) {
      setError(null)
      setText(tag)
      setNewType({ name: parsed.type, label: labelFor(parsed.type), singleValued: false })
      return
    }

    const problem = validateTag(registry, tag)
    if (problem) {
      setError(problem)
      return
    }

    await apply(tag)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((current) => {
        const next = current + step
        if (next < -1) return suggestions.length - 1
        return next >= suggestions.length ? -1 : next
      })
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      void submit(suggestions[active] ?? text)
      return
    }

    if (event.key === 'Escape' && (newType || text !== '')) {
      event.preventDefault()
      reset()
    }
  }

  return (
    <div className={styles.field}>
      <div className={styles.row}>
        <span className={styles.plus}>+</span>
        <input
          ref={input}
          className={styles.input}
          type="text"
          value={text}
          placeholder={placeholder}
          aria-label={placeholder}
          disabled={disabled || pending}
          onChange={(event) => {
            setText(event.target.value)
            setActive(-1)
            setError(null)
            setNewType(null)
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      {newType ? (
        <div className={styles.newType}>
          {/* Two questions, because they are the two things a value cannot carry for
              itself. Everything else a type used to hold is gone: no vocabulary to
              declare, no colour to pick, and no deletion to plan for. */}
          <p className={styles.newTypeHead}>
            New tag type <code>{newType.name}:</code>
          </p>
          <input
            className={styles.newTypeLabel}
            type="text"
            value={newType.label}
            aria-label="Label"
            onChange={(event) => setNewType({ ...newType, label: event.target.value })}
          />
          <label className={styles.newTypeSingle}>
            <input
              type="checkbox"
              checked={newType.singleValued}
              onChange={(event) => setNewType({ ...newType, singleValued: event.target.checked })}
            />
            One value per activity
          </label>
          <button
            type="button"
            className={styles.newTypeCreate}
            disabled={newType.label.trim() === '' || pending}
            onClick={() => void apply(text.trim(), newType)}
          >
            Create and apply
          </button>
        </div>
      ) : suggestions.length > 0 ? (
        <ul className={styles.suggestions}>
          {suggestions.map((tag, index) => {
            const parsed = parseTag(tag)
            return (
              <li key={tag}>
                <button
                  type="button"
                  className={[styles.suggestion, index === active ? styles.active : ''].join(' ')}
                  disabled={pending}
                  onClick={() => void submit(tag)}
                >
                  <Dot
                    colour={parsed ? scale.colour(parsed.type, parsed.value) : neutralColour()}
                  />
                  <span className={styles.suggestionType}>{parsed?.type}:</span>
                  <span className={styles.suggestionValue}>{parsed?.value}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  )
}
