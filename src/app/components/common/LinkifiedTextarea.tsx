'use client';

import { useEffect, useRef, useState } from 'react';
import { hasLinks } from '@/lib/text/linkify';
import { LinkifiedText } from './LinkifiedText';

interface Props {
  value: string;
  onChange: (value: string) => void;
  rows: number;
  className: string;
  placeholder?: string;
  'data-testid'?: string;
}

/**
 * A textarea that shows its links as clickable while you are not typing.
 * A textarea cannot render links, so at rest (and only when the text has a link)
 * a read view takes its place; click the text or tab in to edit.
 */
export function LinkifiedTextarea({ value, onChange, rows, className, ...rest }: Props) {
  const [editing, setEditing] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const showReadView = !editing && hasLinks(value);

  useEffect(() => {
    if (editing) {
      const el = areaRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  if (showReadView) {
    return (
      <div
        data-testid={rest['data-testid'] ? `${rest['data-testid']}-links` : undefined}
        role="textbox"
        aria-multiline="true"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onFocus={(e) => {
          if (e.target === e.currentTarget) setEditing(true);
        }}
        style={{ minHeight: `${rows * 1.5 + 1}rem` }}
        className={`${className} cursor-text overflow-auto whitespace-pre-wrap break-words`}
      >
        <LinkifiedText text={value} />
      </div>
    );
  }

  return (
    <textarea
      ref={areaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => setEditing(false)}
      rows={rows}
      className={className}
      placeholder={rest.placeholder}
      data-testid={rest['data-testid']}
    />
  );
}
