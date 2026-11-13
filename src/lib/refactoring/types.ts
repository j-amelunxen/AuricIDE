export interface ReferenceResult {
  type: 'heading' | 'entity' | 'wikilink';
  filePath: string;
  lineNumber: number;
  lineText: string;
  charFrom: number;
  charTo: number;
}
