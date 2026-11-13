import type { WordSpan } from '@/lib/git/wordDiff';
import { TEXT_WRAP } from './types';

export function LineContent({
  content,
  spans,
  changedClass,
}: {
  content: string;
  spans?: WordSpan[] | null;
  changedClass?: string;
}) {
  return (
    <span className={TEXT_WRAP}>
      {spans
        ? spans.map((span, i) =>
            span.changed ? (
              <span key={i} className={changedClass}>
                {span.text}
              </span>
            ) : (
              <span key={i}>{span.text}</span>
            )
          )
        : content}
    </span>
  );
}
