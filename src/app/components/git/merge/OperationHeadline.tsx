import { operationCopy, roleOf, type SideLabels } from './mergeCopy';
import type { GitOperation } from '@/lib/tauri/gitMerge';

/** "Merging feature/x (incoming) into main (yours)", worded for the operation in progress. */
export function OperationHeadline({
  labels,
  operation,
}: {
  labels: SideLabels;
  operation: GitOperation | undefined;
}) {
  const copy = operationCopy(operation);
  return (
    <p className="truncate text-[11px] text-foreground-muted" data-testid="operation-headline">
      {copy.lead} <span className="font-medium text-orange-200">{labels.theirs}</span> (
      {roleOf(labels, 'theirs')}) {copy.join}{' '}
      <span className="font-medium text-sky-200">{labels.ours}</span> ({roleOf(labels, 'ours')})
    </p>
  );
}
