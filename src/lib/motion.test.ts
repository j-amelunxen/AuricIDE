import { describe, it, expect, vi, afterEach } from 'vitest';
import { scrollBehavior } from './motion';

const mockMatchMedia = (matches: boolean) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches }))
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scrollBehavior', () => {
  it('scrolls smoothly by default', () => {
    mockMatchMedia(false);
    expect(scrollBehavior()).toBe('smooth');
  });

  it('jumps instantly when the user asked for reduced motion', () => {
    // The CSS reduced-motion block cannot reach an explicit
    // scrollIntoView({ behavior: 'smooth' }) — the option wins over the
    // stylesheet, so the preference has to be honoured at the call site.
    mockMatchMedia(true);
    expect(scrollBehavior()).toBe('auto');
  });

  it('defaults to smooth where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(scrollBehavior()).toBe('smooth');
  });
});
