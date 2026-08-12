'use client';

import { useEffect, useState } from 'react';
import { generateProjectIcon } from '@/lib/projectIcon';
import { getCachedImageIcon, loadImageIcon } from '@/lib/quickAccess/imageIconCache';
import { resolveTileIcon } from '@/lib/quickAccess/icon';
import type { ProjectIconOverride } from '@/lib/store/starredProjectsSlice';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

interface ProjectTileFaceProps {
  path: string;
  icon?: ProjectIconOverride | null;
  className?: string;
}

/**
 * The 40×40 face of a Quick Access tile: the gradient generated from the path,
 * plus whichever mark the project carries.
 *
 * The gradient stays generated even for a customized tile — the mark is the
 * user's, the family resemblance is the app's, and a row of tiles has to keep
 * reading as one set.
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

  useEffect(() => {
    if (!imagePath) return;
    let cancelled = false;
    void loadImageIcon(imagePath).then((loaded) => {
      if (!cancelled) setDataUri(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [imagePath]);

  // A file that moved or went away leaves the tile exactly as it was before
  // anyone picked an icon, rather than as a broken image.
  const showImage = resolved.kind === 'image' && dataUri !== null;
  const initials = generateProjectIcon(path).initials;

  return (
    <span
      data-testid={`tile-face-${path}`}
      data-icon-kind={resolved.kind === 'image' && !showImage ? 'initials' : resolved.kind}
      className={`flex h-10 w-10 items-center justify-center rounded-xl text-[13px] font-black text-white/95 ${className}`}
      style={{
        backgroundImage: `linear-gradient(135deg, ${gradient.gradientFrom}, ${gradient.gradientTo})`,
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
