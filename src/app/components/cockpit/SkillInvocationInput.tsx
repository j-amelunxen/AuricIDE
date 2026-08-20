'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ProjectSkill } from '@/lib/tauri/projectSkills';
import {
  applySkillInvocation,
  skillTokenAtCursor,
  suggestSkills,
} from '@/lib/quickAccess/skillSuggest';

type FieldElement = HTMLInputElement | HTMLTextAreaElement;

interface SkillInvocationInputProps {
  value: string;
  discovered: ProjectSkill[];
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  id?: string;
  /** Every keystroke, picked or typed — the field never blocks free text. */
  onChange: (value: string) => void;
  /** Only when a known skill was chosen, so a caller can fill in its name too. */
  onPick?: (skill: ProjectSkill) => void;
  /**
   * When true this field is only for naming a skill, so the list opens on an
   * empty value instead of waiting for a slash. Prompt fields leave this off.
   */
  suggestWhenEmpty?: boolean;
  /** Enter with no highlighted option — typed text the caller may accept. */
  onEnterWithoutPick?: (value: string) => void;
  /**
   * Complete the `/skill` word at the cursor instead of replacing the whole
   * field. For a prompt that may hold a skill plus the rest of the instruction.
   */
  completeToken?: boolean;
  /** Render a textarea so the value can be more than one line. */
  multiline?: boolean;
  fieldRef?: React.Ref<FieldElement | null>;
  onKeyDown?: React.KeyboardEventHandler<FieldElement>;
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T) {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as React.MutableRefObject<T>).current = value;
}

/**
 * A prompt field that completes the skills found on disk.
 *
 * The slash does the asking: a prompt is free text, so the popup stays out of
 * the way until the first `/` says the user is naming a skill rather than
 * writing a sentence. From there it behaves like every other completion —
 * arrows to walk, Enter to take, Escape to leave it alone — and an empty query
 * lists everything, which makes the same field the way to browse when the name
 * has been forgotten.
 */
export function SkillInvocationInput({
  value,
  discovered,
  ariaLabel,
  placeholder,
  className = '',
  id,
  onChange,
  onPick,
  suggestWhenEmpty = false,
  onEnterWithoutPick,
  completeToken = false,
  multiline = false,
  fieldRef,
  onKeyDown,
}: SkillInvocationInputProps) {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [cursor, setCursor] = useState(value.length);
  const optionRefs = useRef(new Map<number, HTMLLIElement>());
  const innerRef = useRef<FieldElement | null>(null);
  const pendingCursor = useRef<number | null>(null);

  const token = useMemo(
    () => (completeToken ? skillTokenAtCursor(value, cursor) : null),
    [completeToken, value, cursor]
  );

  // A prompt is prose until a slash says otherwise. Suggesting against every
  // keystroke would put a popup over the field for people writing sentences.
  // A dedicated skill picker is the other case: the field only ever names a
  // skill, so an empty value is "show me the catalogue".
  const suggestions = useMemo(() => {
    if (completeToken) {
      return token ? suggestSkills(token.query, discovered) : [];
    }
    const trimmed = value.trim();
    if (trimmed.startsWith('/')) return suggestSkills(value, discovered);
    if (suggestWhenEmpty) return suggestSkills(trimmed ? `/${trimmed}` : '/', discovered);
    return [];
  }, [value, discovered, suggestWhenEmpty, completeToken, token]);
  const expanded = open && suggestions.length > 0;

  useEffect(() => {
    if (!expanded || active < 0) return;
    optionRefs.current.get(active)?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, active]);

  useLayoutEffect(() => {
    if (pendingCursor.current === null) return;
    const next = pendingCursor.current;
    pendingCursor.current = null;
    innerRef.current?.setSelectionRange(next, next);
    setCursor(next);
  }, [value]);

  const setFieldRef = (element: FieldElement | null) => {
    innerRef.current = element;
    assignRef(fieldRef, element);
  };

  const pick = (skill: ProjectSkill) => {
    if (completeToken && token) {
      const next = applySkillInvocation(value, token, skill.invocation);
      pendingCursor.current = next.cursor;
      onChange(next.text);
    } else {
      onChange(skill.invocation);
    }
    onPick?.(skill);
    setOpen(false);
    setActive(-1);
  };

  const step = (offset: 1 | -1) =>
    setActive((current) => {
      if (current === -1) return offset === 1 ? 0 : suggestions.length - 1;
      return (current + offset + suggestions.length) % suggestions.length;
    });

  const handleKeyDown = (event: React.KeyboardEvent<FieldElement>) => {
    if (event.key === 'Escape') {
      if (!expanded) {
        onKeyDown?.(event);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // A prompt's ArrowUp recalls earlier instructions while the list is
      // closed. Steal the keys only once the popup is actually showing.
      if (suggestions.length === 0 || (completeToken && !open)) {
        onKeyDown?.(event);
        return;
      }
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      step(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    // Enter with nothing highlighted belongs to whatever typed text is there.
    if (event.key === 'Enter' && expanded && active >= 0) {
      event.preventDefault();
      pick(suggestions[active]);
      return;
    }
    if (event.key === 'Enter' && onEnterWithoutPick && value.trim()) {
      event.preventDefault();
      onEnterWithoutPick(value.trim());
      return;
    }
    onKeyDown?.(event);
  };

  const fieldProps = {
    id,
    role: 'combobox' as const,
    'aria-label': ariaLabel,
    'aria-expanded': expanded,
    'aria-controls': expanded ? listboxId : undefined,
    'aria-activedescendant': expanded && active >= 0 ? `${listboxId}-${active}` : undefined,
    'aria-autocomplete': 'list' as const,
    autoComplete: 'off',
    value,
    placeholder,
    onChange: (event: React.ChangeEvent<FieldElement>) => {
      onChange(event.target.value);
      setCursor(event.target.selectionStart ?? event.target.value.length);
      setOpen(true);
      setActive(-1);
    },
    onSelect: (event: React.SyntheticEvent<FieldElement>) => {
      setCursor(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
    },
    onFocus: () => setOpen(true),
    onBlur: () => {
      setOpen(false);
      setActive(-1);
    },
    onKeyDown: handleKeyDown,
    className,
  };

  return (
    <div className="relative min-w-0 flex-1">
      {multiline ? (
        <textarea ref={setFieldRef} aria-multiline="true" {...fieldProps} />
      ) : (
        <input ref={setFieldRef} {...fieldProps} />
      )}

      {expanded && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={`${ariaLabel} suggestions`}
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-surface-raised py-1 shadow-lg shadow-black/40"
        >
          {suggestions.map((skill, index) => (
            <li
              key={`${skill.sourceId}:${skill.path}`}
              id={`${listboxId}-${index}`}
              ref={(element) => {
                if (element) optionRefs.current.set(index, element);
                else optionRefs.current.delete(index);
              }}
              role="option"
              aria-selected={index === active}
              title={skill.description ?? undefined}
              // mouseDown, not click: the field's blur would close the list
              // before a click ever landed.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(skill);
              }}
              onMouseEnter={() => setActive(index)}
              className={`flex cursor-pointer items-baseline gap-2 px-2.5 py-1.5 ${
                index === active ? 'bg-primary/15' : ''
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] text-foreground">{skill.name}</span>
                <span className="block truncate font-mono text-[10px] text-foreground-muted">
                  {skill.invocation}
                </span>
              </span>
              {skill.scope === 'user' && (
                <span className="flex-shrink-0 text-[9px] uppercase tracking-wider text-foreground-muted/50">
                  yours
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
