'use client';

import type { PmTestCase } from '@/lib/tauri/pm';

interface TestCaseEditorProps {
  testCases: PmTestCase[];
  onAdd: () => void;
  onUpdate: (id: string, updates: Partial<PmTestCase>) => void;
  onDelete: (id: string) => void;
}

export function TestCaseEditor({ testCases, onAdd, onUpdate, onDelete }: TestCaseEditorProps) {
  return (
    <div className="flex flex-col gap-2">
      {testCases.length === 0 && <p className="text-xs text-foreground-muted">No test cases</p>}

      {testCases.map((tc) => (
        <div
          key={tc.id}
          className="group flex flex-col gap-1 rounded-lg border border-white/10 bg-white/5 p-2"
        >
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={tc.title}
              onChange={(e) => onUpdate(tc.id, { title: e.target.value })}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              placeholder="Test case title"
            />
            <button
              type="button"
              aria-label="Delete test case"
              onClick={() => onDelete(tc.id)}
              className="rounded-lg px-1.5 py-1 text-foreground-muted opacity-50 hover:opacity-100 hover:bg-white/10 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
          <textarea
            value={tc.body}
            onChange={(e) => onUpdate(tc.id, { body: e.target.value })}
            className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none resize-none"
            rows={4}
            placeholder="Test case body"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={onAdd}
        className="rounded-lg px-3 py-1.5 text-xs font-medium text-foreground-muted hover:bg-white/5 transition-colors self-start"
      >
        + Add Test Case
      </button>
    </div>
  );
}
