import type { StateCreator } from 'zustand';
import { ENTITY_REGEX } from '@/lib/nlp/patterns';

export interface EntityOccurrence {
  filePath: string;
  lineNumber: number;
  lineText: string;
  charFrom: number;
  charTo: number;
}

export interface EntityIndexSlice {
  entityIndex: Map<string, EntityOccurrence[]>; // entityName -> occurrences
  updateEntitiesForFile: (filePath: string, content: string) => void;
  removeEntitiesForFile: (filePath: string) => void;
  findAllReferences: (entityName: string) => EntityOccurrence[];
  clearEntityIndex: () => void;
}

function scanEntities(filePath: string, content: string): Map<string, EntityOccurrence[]> {
  const result = new Map<string, EntityOccurrence[]>();
  if (!content) return result;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    ENTITY_REGEX.lastIndex = 0;
    let match;
    while ((match = ENTITY_REGEX.exec(line)) !== null) {
      const entityName = match[0];
      const occurrence: EntityOccurrence = {
        filePath,
        lineNumber: i + 1,
        lineText: line,
        charFrom: match.index,
        charTo: match.index + entityName.length,
      };
      const existing = result.get(entityName) ?? [];
      existing.push(occurrence);
      result.set(entityName, existing);
    }
  }

  return result;
}

export const createEntityIndexSlice: StateCreator<EntityIndexSlice> = (set, get) => ({
  entityIndex: new Map(),

  updateEntitiesForFile: (filePath: string, content: string) => {
    const currentIndex = get().entityIndex;
    const newIndex = new Map<string, EntityOccurrence[]>();

    // Copy existing entries, removing old occurrences from this file
    for (const [entityName, occurrences] of currentIndex) {
      const filtered = occurrences.filter((o) => o.filePath !== filePath);
      if (filtered.length > 0) {
        newIndex.set(entityName, filtered);
      }
    }

    // Add new occurrences from the scanned content
    const scanned = scanEntities(filePath, content);
    for (const [entityName, occurrences] of scanned) {
      const existing = newIndex.get(entityName) ?? [];
      newIndex.set(entityName, [...existing, ...occurrences]);
    }

    set({ entityIndex: newIndex });
  },

  removeEntitiesForFile: (filePath: string) => {
    const currentIndex = get().entityIndex;
    const newIndex = new Map<string, EntityOccurrence[]>();

    for (const [entityName, occurrences] of currentIndex) {
      const filtered = occurrences.filter((o) => o.filePath !== filePath);
      if (filtered.length > 0) {
        newIndex.set(entityName, filtered);
      }
    }

    set({ entityIndex: newIndex });
  },

  findAllReferences: (entityName: string) => {
    const occurrences = get().entityIndex.get(entityName) ?? [];
    return [...occurrences].sort((a, b) => {
      const pathCmp = a.filePath.localeCompare(b.filePath);
      if (pathCmp !== 0) return pathCmp;
      return a.lineNumber - b.lineNumber;
    });
  },

  clearEntityIndex: () => set({ entityIndex: new Map() }),
});
