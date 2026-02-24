'use client';

import { useState } from 'react';

interface InfoTooltipProps {
  description: string;
  label?: string; // Optional custom label, default is an info icon
}

export function InfoTooltip({ description, label }: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-flex items-center ml-1 group">
      <button
        type="button"
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/20 bg-white/5 text-[9px] font-bold text-foreground-muted hover:bg-white/10 hover:text-foreground transition-all cursor-help select-none"
      >
        {label || <span className="material-symbols-outlined text-[12px]">info</span>}
      </button>

      {isVisible && (
        <div className="absolute left-0 top-full mt-2 z-[500] w-56 rounded-lg border border-white/10 bg-[#0a0a10] p-3 shadow-2xl animate-in fade-in zoom-in duration-200 pointer-events-none">
          <p className="text-[11px] leading-relaxed text-foreground-muted whitespace-normal font-mono">
            {description}
          </p>
          <div className="absolute left-1.5 bottom-full border-8 border-transparent border-b-[#0a0a10]" />
        </div>
      )}
    </div>
  );
}
