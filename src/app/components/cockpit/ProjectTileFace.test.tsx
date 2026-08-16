import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectTileFace } from './ProjectTileFace';
import { clearImageIconCache } from '@/lib/quickAccess/imageIconCache';
import { clearIconHueCache } from '@/lib/quickAccess/iconHueCache';

const mockReadImageAsDataUri = vi.fn<() => Promise<string | null>>();
const mockLoadIconHue = vi.fn<() => Promise<number | null>>();

vi.mock('@/lib/tauri/projectIcons', () => ({
  readImageAsDataUri: () => mockReadImageAsDataUri(),
  findProjectIconCandidates: vi.fn(),
}));

vi.mock('@/lib/quickAccess/iconHueCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/quickAccess/iconHueCache')>();
  return { ...actual, loadIconHue: () => mockLoadIconHue() };
});

const PROJECT = '/a/website';
const FAVICON = '/a/website/public/favicon.ico';
const DATA_URI = 'data:image/png;base64,AAA';

const face = () => screen.getByTestId(`tile-face-${PROJECT}`);
const image = { kind: 'image', value: FAVICON } as const;

describe('ProjectTileFace', () => {
  beforeEach(() => {
    clearImageIconCache();
    clearIconHueCache();
    mockReadImageAsDataUri.mockResolvedValue(DATA_URI);
    mockLoadIconHue.mockResolvedValue(null);
  });

  it('keeps the generated gradient for a tile with no mark of its own', () => {
    render(<ProjectTileFace path={PROJECT} />);
    expect(face()).toHaveAttribute('data-surface', 'generated');
  });

  describe('sizes', () => {
    it('is a full 40×40 tile by default', () => {
      render(<ProjectTileFace path={PROJECT} />);
      expect(face().className).toContain('h-10 w-10');
    });

    // A className override cannot be relied on for this: two height utilities
    // land in the same stylesheet group and the sheet's order decides, not the
    // call site's. The mark inside would keep its own size regardless.
    it('shrinks the mark along with the tile', () => {
      render(<ProjectTileFace path={PROJECT} size="sm" icon={{ kind: 'emoji', value: '🚀' }} />);
      expect(face().className).toContain('h-5 w-5');
      expect(face().querySelector('span')?.className).toContain('text-[11px]');
    });
  });

  it('keeps the generated gradient behind a glyph, so picked marks stay one family', () => {
    render(<ProjectTileFace path={PROJECT} icon={{ kind: 'glyph', value: 'rocket_launch' }} />);
    expect(face()).toHaveAttribute('data-surface', 'generated');
  });

  it('keeps the generated gradient behind an emoji', () => {
    render(<ProjectTileFace path={PROJECT} icon={{ kind: 'emoji', value: '🚀' }} />);
    expect(face()).toHaveAttribute('data-surface', 'generated');
  });

  it('takes its background from the favicon’s own hue', async () => {
    mockLoadIconHue.mockResolvedValue(140);
    render(<ProjectTileFace path={PROJECT} icon={image} />);
    await waitFor(() => expect(face()).toHaveAttribute('data-surface', 'icon'));
    expect(face()).toHaveAttribute('data-surface-hue', '140');
  });

  it('does not oppose the mark — the surface carries the mark’s hue, not its complement', async () => {
    mockLoadIconHue.mockResolvedValue(140);
    render(<ProjectTileFace path={PROJECT} icon={image} />);
    await waitFor(() => expect(face()).toHaveAttribute('data-surface-hue', '140'));
    expect(face()).not.toHaveAttribute('data-surface-hue', '320');
  });

  it('falls back to a neutral surface for a greyscale mark, not a random hue', async () => {
    mockLoadIconHue.mockResolvedValue(null);
    render(<ProjectTileFace path={PROJECT} icon={image} />);
    await waitFor(() => expect(face()).toHaveAttribute('data-surface', 'neutral'));
    expect(face()).not.toHaveAttribute('data-surface-hue');
  });

  it('keeps the generated gradient while the icon is still being read', () => {
    render(<ProjectTileFace path={PROJECT} icon={image} />);
    // First frame: nothing has come off disk yet, so nothing is known about the
    // mark. Anything but the tile's existing gradient would be a flash.
    expect(face()).toHaveAttribute('data-surface', 'generated');
  });

  it('returns to the generated gradient when the icon file has gone', async () => {
    mockReadImageAsDataUri.mockResolvedValue(null);
    render(<ProjectTileFace path={PROJECT} icon={image} />);
    await waitFor(() => expect(face()).toHaveAttribute('data-icon-kind', 'initials'));
    expect(face()).toHaveAttribute('data-surface', 'generated');
  });

  it('rounds the hue it reports, so the attribute stays readable', async () => {
    mockLoadIconHue.mockResolvedValue(139.6182);
    render(<ProjectTileFace path={PROJECT} icon={image} />);
    await waitFor(() => expect(face()).toHaveAttribute('data-surface-hue', '140'));
  });
});
