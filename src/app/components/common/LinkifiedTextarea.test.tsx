import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkifiedTextarea } from './LinkifiedTextarea';

const openExternalUrl = vi.fn();
vi.mock('@/lib/tauri/opener', () => ({
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

const URL_IN_TEXT = 'https://example.com/browse/ABC-1';

function setup(value: string, onChange = vi.fn()) {
  render(
    <LinkifiedTextarea value={value} onChange={onChange} rows={4} className="box" data-testid="d" />
  );
  return onChange;
}

describe('LinkifiedTextarea', () => {
  beforeEach(() => {
    openExternalUrl.mockReset().mockResolvedValue(undefined);
  });

  it('stays a plain textarea when the text has no link', () => {
    setup('just words');
    expect(screen.getByTestId('d').tagName).toBe('TEXTAREA');
  });

  it('opens exactly the clicked URL in the browser', () => {
    setup(`See ${URL_IN_TEXT} for details`);
    fireEvent.click(screen.getByRole('link', { name: URL_IN_TEXT }));
    expect(openExternalUrl).toHaveBeenCalledWith(URL_IN_TEXT);
  });

  it('does not switch to editing when a link is clicked', () => {
    setup(`See ${URL_IN_TEXT}`);
    fireEvent.click(screen.getByRole('link'));
    expect(screen.getByTestId('d-links')).toBeTruthy();
  });

  it('switches to the textarea when the text around the link is clicked', () => {
    setup(`See ${URL_IN_TEXT}`);
    fireEvent.click(screen.getByTestId('d-links'));
    expect(screen.getByTestId('d').tagName).toBe('TEXTAREA');
  });

  it('passes edits through unchanged', () => {
    const onChange = setup(`See ${URL_IN_TEXT}`);
    fireEvent.click(screen.getByTestId('d-links'));
    fireEvent.change(screen.getByTestId('d'), { target: { value: 'changed' } });
    expect(onChange).toHaveBeenCalledWith('changed');
  });
});
