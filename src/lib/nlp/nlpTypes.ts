export interface NerEntity {
  entity_group: string;
  score: number;
  word: string;
  start: number;
  end: number;
}

export interface EntityOccurrence {
  filePath: string;
  lineNumber: number;
  lineText: string;
  charFrom: number;
  charTo: number;
}
