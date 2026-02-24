'use client';

import { useEffect, useRef } from 'react';

export type ContextMenuOption =
  | { type: 'separator' }
  | { type: 'header'; label: string }
  | {
      type?: 'item';
      label: string;
      icon?: string;
      action?: () => void;
      danger?: boolean;
    };

interface ContextMenuProps {
  x: number;
  y: number;
  options: ContextMenuOption[];
  onClose: () => void;
}

export function ContextMenu({ x, y, options, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Adjust position if menu goes off screen
  const menuWidth = 160;
  const itemHeight = 28;
  const menuHeight = options.reduce((acc, opt) => {
    if (opt.type === 'separator') return acc + 9;
    if (opt.type === 'header') return acc + 24;
    return acc + itemHeight;
  }, 10);

  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={menuRef}
      className="fixed z-[200] w-44 overflow-hidden rounded-lg border border-white/10 bg-[#0a0a10]/95 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in duration-100"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <div className="py-1">
        {options.map((option, i) => {
          if (option.type === 'separator') {
            return <div key={i} className="my-1 border-t border-white/5" />;
          }

          if (option.type === 'header') {
            return (
              <div
                key={i}
                className="px-3 py-1 text-[9px] font-bold text-foreground-muted/50 uppercase tracking-wider"
              >
                {option.label}
              </div>
            );
          }

          return (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation();
                option.action?.();
                onClose();
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors ${
                option.danger
                  ? 'text-red-400 hover:bg-red-500/10'
                  : 'text-foreground-muted hover:bg-primary/10 hover:text-foreground'
              }`}
            >
              {option.icon && (
                <span className="material-symbols-outlined text-[14px]">{option.icon}</span>
              )}
              <span className="font-medium">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
