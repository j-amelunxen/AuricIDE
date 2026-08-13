'use client';

import { type ActivityItem } from '@/app/components/ide/ActivityBar';

/**
 * The rail leads with the loop: Cockpit → Files → Git → Work.
 * Work is one place with four views. Everything below the separator is
 * a tool: a means, reachable but not shouting.
 */
export const activityItems: ActivityItem[] = [
  { id: 'cockpit', icon: 'space_dashboard', label: 'Mission Control' },
  { id: 'explorer', icon: 'folder', label: 'Explorer' },
  { id: 'source-control', icon: 'commit', label: 'Source Control', badge: 0 },
  { id: 'work', icon: 'task_alt', label: 'Work' },
  // Not primary: the top of the rail states the goal loop, and the inbox cuts
  // across it rather than being a step in it. Its badge shows here either way,
  // which is what actually brings you to it.
  {
    id: 'notifications',
    icon: 'notifications',
    label: 'Notifications',
    badge: 0,
    section: 'tools',
  },
  { id: 'outline', icon: 'toc', label: 'Outline', section: 'tools' },
  { id: 'scratches', icon: 'sticky_note_2', label: 'Scratches', section: 'tools' },
  { id: 'graph', icon: 'hub', label: 'Link Graph', section: 'tools' },
  { id: 'qa', icon: 'fact_check', label: 'QA', section: 'tools' },
  { id: 'blueprints', icon: 'library_books', label: 'Blueprints', section: 'tools' },
  { id: 'extensions', icon: 'extension', label: 'Extensions', section: 'tools' },
  { id: 'settings', icon: 'settings', label: 'Settings', section: 'tools' },
];

export const KBD = 'px-1.5 py-0.5 rounded bg-white/10 text-primary-light font-mono text-[11px]';

export const TIPS: { icon: string; text: React.ReactNode }[] = [
  {
    icon: 'keyboard',
    text: (
      <>
        Press <kbd className={KBD}>&#8984;I</kbd> in the terminal to insert a{' '}
        <span className="text-primary-light font-medium">Claude</span> prompt command. Type your
        prompt, close the quote, and hit Enter.
      </>
    ),
  },
  {
    icon: 'search',
    text: (
      <>
        Press <kbd className={KBD}>Shift</kbd> twice quickly to open{' '}
        <span className="text-primary-light font-medium">File Search</span>: find any file in your
        project instantly.
      </>
    ),
  },
  {
    icon: 'filter_list',
    text: (
      <>
        Press <kbd className={KBD}>&#8984;⌥F</kbd> to open{' '}
        <span className="text-primary-light font-medium">Copy File List</span>. Filter files by
        extension and line count to copy lists to your clipboard.
      </>
    ),
  },
  {
    icon: 'terminal',
    text: (
      <>
        Press <kbd className={KBD}>&#8984;K</kbd> to open the{' '}
        <span className="text-primary-light font-medium">Command Palette</span>. Quickly find and
        execute any IDE command by typing its name.
      </>
    ),
  },
];
