'use client';

import { useEffect, useState } from 'react';
import { generateProjectIcon } from '@/lib/projectIcon';
import { getCachedImageIcon, loadImageIcon } from '@/lib/quickAccess/imageIconCache';
import { getCachedIconHue, loadIconHue } from '@/lib/quickAccess/iconHueCache';
import { imageTileSurface, NEUTRAL_TILE_SURFACE } from '@/lib/quickAccess/iconColor';
import { resolveTileIcon } from '@/lib/quickAccess/icon';
import type { ProjectIconOverride } from '@/lib/store/starredProjectsSlice';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

interface ProjectTileFaceProps {
  path: string;
  icon?: ProjectIconOverride | null;
  className?: string;
}

/**
 * The 40×40 face of a Quick Access tile: a surface, plus whichever mark the
 * project carries.
 *
 * For a glyph, an emoji or generated initials the surface stays generated from
 * the path — those marks are drawn in the app's own white, so the tile behind
 * them is the only thing distinguishing one project from the next, and the
 * curated hue wheel keeps the row reading as one set.
 *
 * A favicon is the exception, because it arrives with a brand colour of its
 * own. Pairing it with a hue keyed to the path is a coin toss that lands on a
 * clash about as often as not, and a row of those reads as noise. So an image
 * tile borrows the hue from the mark itself — the same hue, taken deep and
 * quiet, never its complement. Two saturated colours at this size compete, and
 * the mark has to win; underneath it the surface should read as the icon's own
 * shadow. Saturation and lightness stay fixed across every hue, which is where
 * the family resemblance moves to once the hue is no longer ours to choose.
 *
 * Shared with the settings dialog's live preview on purpose: "what you pick"
 * and "what you get" cannot drift apart if they are the same component.
 */
export function ProjectTileFace({ path, icon, className = '' }: ProjectTileFaceProps) {
  const gradient = generateProjectIcon(path);
  const resolved = resolveTileIcon(path, icon);
  const imagePath = resolved.kind === 'image' ? resolved.path : null;
  // Seeded from the cache so an already-loaded icon paints on the first frame
  // instead of flashing initials on every remount.
  const [dataUri, setDataUri] = useState(() =>
    imagePath ? (getCachedImageIcon(imagePath) ?? null) : null
  );

  // undefined = not sampled yet (keep the generated gradient rather than
  // flashing a second colour), null = sampled and the mark has no hue.
  const [iconHue, setIconHue] = useState<number | null | undefined>(() =>
    imagePath ? getCachedIconHue(imagePath) : undefined
  );

  useEffect(() => {
    if (!imagePath) return;
    let cancelled = false;
    void loadImageIcon(imagePath).then((loaded) => {
      if (cancelled) return;
      setDataUri(loaded);
      if (loaded === null) return;
      void loadIconHue(imagePath, loaded).then((hue) => {
        if (!cancelled) setIconHue(hue);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [imagePath]);

  // A file that moved or went away leaves the tile exactly as it was before
  // anyone picked an icon, rather than as a broken image.
  const showImage = resolved.kind === 'image' && dataUri !== null;
  const initials = generateProjectIcon(path).initials;

  // Only a mark that is actually on screen may colour the tile under it.
  const derived = showImage && iconHue !== undefined;
  const surface = !derived
    ? { from: gradient.gradientFrom, to: gradient.gradientTo }
    : iconHue === null
      ? NEUTRAL_TILE_SURFACE
      : imageTileSurface(iconHue);

  return (
    <span
      data-testid={`tile-face-${path}`}
      data-icon-kind={resolved.kind === 'image' && !showImage ? 'initials' : resolved.kind}
      // Where the background came from. Read by tests, and the fastest way to
      // tell a sampled surface from a fallback when a tile looks wrong.
      data-surface={!derived ? 'generated' : iconHue === null ? 'neutral' : 'icon'}
      data-surface-hue={derived && iconHue !== null ? String(Math.round(iconHue)) : undefined}
      className={`flex h-10 w-10 items-center justify-center rounded-xl text-[13px] font-black text-white/95 ${className}`}
      style={{
        backgroundImage: `linear-gradient(135deg, ${surface.from}, ${surface.to})`,
      }}
    >
      {showImage ? (
        /* A data URI from the user's own disk, not a remote asset next/image
           could optimise. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUri ?? ''}
          alt=""
          aria-hidden="true"
          className="h-7 w-7 rounded object-contain"
        />
      ) : resolved.kind === 'glyph' ? (
        <AuricIcon name={resolved.name} aria-hidden="true" className="text-[20px]" />
      ) : resolved.kind === 'emoji' ? (
        <span aria-hidden="true" className="text-[18px] leading-none">
          {resolved.char}
        </span>
      ) : resolved.kind === 'initials' ? (
        resolved.initials
      ) : (
        initials
      )}
    </span>
  );
}
