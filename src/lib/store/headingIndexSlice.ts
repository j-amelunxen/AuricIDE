import type { StateCreator } from 'zustand';
import { extractHeadings, type HeadingRange } from '@/lib/editor/markdownHeadingParser';

export interface HeadingIndexSlice {
  headingIndex: Map<string, HeadingRange[]>;
  updateHeadingsForFile: (filePath: string, content: string) => void;
  removeHeadingsForFile: (filePath: string) => void;
  getHeadingsForFile: (filePath: string) => HeadingRange[];
  getFilesWithHeading: (title: string) => Array<{ filePath: string; heading: HeadingRange }>;
  clearHeadingIndex: () => void;
}

export const createHeadingIndexSlice: StateCreator<HeadingIndexSlice> = (set, get) => ({
  headingIndex: new Map(),

  updateHeadingsForFile: (filePath: string, content: string) => {
    const headings = extractHeadings(content);
    const newIndex = new Map(get().headingIndex);
    newIndex.set(filePath, headings);
    set({ headingIndex: newIndex });
  },

  removeHeadingsForFile: (filePath: string) => {
    const newIndex = new Map(get().headingIndex);
    newIndex.delete(filePath);
    set({ headingIndex: newIndex });
  },

  getHeadingsForFile: (filePath: string) => {
    return get().headingIndex.get(filePath) ?? [];
  },

  getFilesWithHeading: (title: string) => {
    const results: Array<{ filePath: string; heading: HeadingRange }> = [];
    for (const [filePath, headings] of get().headingIndex) {
      for (const heading of headings) {
        if (heading.title === title) {
          results.push({ filePath, heading });
        }
      }
    }
    return results;
  },

  clearHeadingIndex: () => set({ headingIndex: new Map() }),
});
