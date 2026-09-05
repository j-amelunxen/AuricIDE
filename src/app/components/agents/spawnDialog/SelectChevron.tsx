import { AuricIcon } from '@/app/components/ui/AuricIcon';

/** Dropdown affordance for `appearance-none` selects. */
export function SelectChevron() {
  return (
    <AuricIcon
      name="expand_more"
      aria-hidden="true"
      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-base text-foreground-muted"
    />
  );
}
