import type { RefObject } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { shortPath } from './types';

interface VideoSelectStageProps {
  dropRef: RefObject<HTMLDivElement | null>;
  dragging: boolean;
  sourcePath: string;
  onChooseVideo: () => void;
}

export function VideoSelectStage({
  dropRef,
  dragging,
  sourcePath,
  onChooseVideo,
}: VideoSelectStageProps) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div
        ref={dropRef}
        className={`flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed px-8 text-center transition-[border-color,background-color] duration-150 ${
          dragging
            ? 'border-primary/60 bg-primary/10'
            : sourcePath
              ? 'border-[#2effa5]/30 bg-[#2effa5]/[0.04]'
              : 'border-white/15 bg-white/[0.015]'
        }`}
      >
        <AuricIcon
          name={sourcePath ? 'movie' : 'upload_file'}
          aria-hidden="true"
          className="text-4xl text-foreground-muted/50"
        />
        <p className="mt-3 text-sm font-semibold text-foreground">
          {sourcePath ? shortPath(sourcePath) : 'Drop a screen recording here'}
        </p>
        <p className="mt-1 max-w-md text-[11px] leading-relaxed text-foreground-muted">
          {sourcePath
            ? 'Ready to transcribe. Original stays untouched.'
            : 'MP4, MOV, MKV, WEBM or M4V.'}
        </p>
        <button
          onClick={onChooseVideo}
          className="mt-5 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-bold text-foreground transition-colors hover:bg-white/10"
        >
          {sourcePath ? 'Choose another video' : 'Choose video'}
        </button>
      </div>
      <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-black/20 px-4 py-3">
        <AuricIcon name="lock" aria-hidden="true" className="text-base text-primary-light" />
        <div>
          <p className="text-[11px] font-semibold text-foreground">Source kept</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-foreground-muted">
            Your transcript and screenshots stay available for review.
          </p>
        </div>
      </div>
    </div>
  );
}
