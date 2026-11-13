export interface FrontendError {
  message: string;
  source: string | null;
  lineno: number | null;
  colno: number | null;
  stack: string | null;
  componentStack: string | null;
  errorType: string;
}

import { invoke } from './invoke';

export async function reportFrontendCrash(error: FrontendError): Promise<string> {
  return await invoke<string>('report_frontend_crash', { error });
}
