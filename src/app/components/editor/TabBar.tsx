'use client';

import { useState } from 'react';
import { ContextMenu, type ContextMenuOption } from '../ide/ContextMenu';

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

  if (tabs.length === 0) return null;

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const menuOptions: ContextMenuOption[] = contextMenu
    ? [
        { label: 'Close', icon: 'close', action: () => onClose(contextMenu.tabId) },
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
        { type: 'separator' } as const,
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
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          options={menuOptions}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
