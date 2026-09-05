import { createContext, useContext } from 'react';
import type { LineEditApi } from './types';

export const LineEditContext = createContext<LineEditApi | null>(null);

export function useLineEdit(): LineEditApi {
  const ctx = useContext(LineEditContext);
  if (!ctx) {
    throw new Error('LineEditContext missing');
  }
  return ctx;
}
