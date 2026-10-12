import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useShortcutSheet } from './ShortcutSheet';
import { ariaKeyshortcuts, isShortcutSheetKey, spokenKeys } from './shortcutKeys';

function Host() {
  const { open, sheet } = useShortcutSheet({
    title: 'Merge shortcuts',
    groups: [{ label: 'Move', items: [{ keys: ['⌥', '↓'], action: 'Next open conflict' }] }],
  });
  return (
    <>
      <button type="button" onClick={open}>
        Shortcuts
      </button>
      {sheet}
    </>
  );
}

describe('ShortcutSheet', () => {
  it('turns glyphs into words and into aria-keyshortcuts', () => {
    expect(spokenKeys(['⌥', '↓'])).toBe('Option Down arrow');
    expect(spokenKeys(['⌥', 'b'])).toBe('Option B');
    expect(ariaKeyshortcuts(['⌘', '↵'])).toBe('Meta+Enter');
    expect(ariaKeyshortcuts(['⌥', 'b'])).toBe('Alt+B');
  });

  it('ignores ? typed into a text field', () => {
    const base = { key: '?', metaKey: false, ctrlKey: false, altKey: false };
    expect(isShortcutSheetKey({ ...base, target: document.body })).toBe(true);
    expect(isShortcutSheetKey({ ...base, target: document.createElement('textarea') })).toBe(false);
  });

  it('opens as a labelled dialog with spoken keys, and gives focus back on Escape', async () => {
    const user = userEvent.setup();
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Shortcuts' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Merge shortcuts' });
    expect(dialog).toHaveTextContent('Next open conflict');
    expect(dialog).toHaveTextContent('Option Down arrow');
    expect(dialog.querySelector('kbd')?.parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
