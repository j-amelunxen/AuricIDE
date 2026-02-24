'use client';

import { useState, useEffect, useRef } from 'react';

export interface TabItem {
  id: string;
  name: string;
  isDirty?: boolean;
}

interface TabBarProps {
  tabs: TabItem[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers?: (id: string) => void;
  onCloseAll?: () => void;
  onCloseToRight?: (id: string) => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCloseToRight,
}: TabBarProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(
    null
  );
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [contextMenu]);

  if (tabs.length === 0) return null;

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const menuActions = contextMenu
    ? [
        {
          label: 'Close',
          icon: 'close',
          action: () => onClose(contextMenu.tabId),
        },
        {
          label: 'Close Others',
          icon: 'tab_close_right',
          action: () => onCloseOthers?.(contextMenu.tabId),
        },
        {
          label: 'Close to the Right',
          icon: 'keyboard_tab',
          action: () => onCloseToRight?.(contextMenu.tabId),
        },
        {
          label: 'Close All',
          icon: 'close_fullscreen',
          action: () => onCloseAll?.(),
          danger: true,
        },
      ]
    : [];

  return (
    <>
      <div
        data-testid="tab-bar"
        className="flex h-9 items-end gap-0 overflow-x-auto border-b border-border-dark bg-panel-bg"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              data-testid={`tab-${tab.id}`}
              onClick={() => onSelect(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              className={`group flex h-full items-center gap-2 border-r border-border-dark px-3 text-xs transition-colors ${
                isActive
                  ? 'border-t-2 border-t-primary bg-editor-bg text-foreground'
                  : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              <span className="truncate">{tab.name}</span>
              {tab.isDirty && (
                <span
                  data-testid={`dirty-${tab.id}`}
                  className="h-2 w-2 flex-shrink-0 rounded-full bg-foreground-muted"
                />
              )}
              <span
                data-testid={`close-${tab.id}`}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    onClose(tab.id);
                  }
                }}
                className="ml-1 hidden rounded p-0.5 text-foreground-muted hover:bg-border-dark hover:text-foreground group-hover:block"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </span>
            </button>
          );
        })}
      </div>

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-[200] w-48 overflow-hidden rounded-lg border border-white/10 bg-[#0a0a10]/95 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in duration-100"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="py-1">
            {menuActions.map((item) => (
              <button
                key={item.label}
                onClick={() => {
                  item.action();
                  setContextMenu(null);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors ${
                  item.danger
                    ? 'text-red-400 hover:bg-red-500/10'
                    : 'text-foreground-muted hover:bg-primary/10 hover:text-foreground'
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
