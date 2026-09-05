import { createContext, useContext } from 'react';
import type { LineCommentApi } from './types';

export const LineCommentContext = createContext<LineCommentApi | null>(null);

export function useLineComment(): LineCommentApi {
  const ctx = useContext(LineCommentContext);
  if (!ctx) {
    throw new Error('LineCommentContext missing');
  }
  return ctx;
}
