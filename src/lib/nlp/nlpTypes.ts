export interface NerEntity {
  entity_group: string;
  score: number;
  word: string;
  start: number;
  end: number;
}
