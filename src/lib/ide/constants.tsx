'use client';

import { type ActivityItem } from '@/app/components/ide/ActivityBar';

export const activityItems: ActivityItem[] = [
  { id: 'explorer', icon: 'folder', label: 'Explorer' },
  { id: 'outline', icon: 'toc', label: 'Outline' },
  { id: 'graph', icon: 'hub', label: 'Link Graph' },
  { id: 'source-control', icon: 'commit', label: 'Source Control', badge: 0 },
  { id: 'extensions', icon: 'extension', label: 'Extensions' },
  { id: 'qa', icon: 'fact_check', label: 'QA' },
  { id: 'blueprints', icon: 'library_books', label: 'Blueprints' },
  { id: 'project-mgmt', icon: 'task_alt', label: 'Project Management' },
  { id: 'settings', icon: 'settings', label: 'Settings' },
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
        <span className="text-primary-light font-medium">File Search</span> — find any file in your
        project instantly.
      </>
    ),
  },
  {
    icon: 'filter_list',
    text: (
      <>
        Press <kbd className={KBD}>&#8984;⌥F</kbd> to open{' '}
        <span className="text-primary-light font-medium">Advanced File Selection</span>. Filter
        files by extension and line count to copy lists to your clipboard.
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
