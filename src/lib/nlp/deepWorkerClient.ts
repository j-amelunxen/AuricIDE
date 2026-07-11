import type { NerEntity, ClassifyResult, WorkerResponse } from './deepAnalysisWorker';

/** Minimal Worker surface, injectable for tests. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

/**
 * Correlates deep-analysis worker requests with responses.
 *
 * Every request settles: error responses, worker crashes, and disposal all
 * reject the pending promise. (Previously error responses were silently
 * ignored, the promise never settled, and the caller's "analyzing" latch
 * stayed locked — one failed model load killed deep analysis for the whole
 * session.)
 */
export class DeepWorkerClient {
  private pending = new Map<string, PendingRequest>();
  private idCounter = 0;

  constructor(private worker: WorkerLike) {
    worker.onmessage = (event: MessageEvent) => {
      const { status, id, output, error } = (event.data ?? {}) as WorkerResponse;
      if (status === 'progress') return;
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);
      if (status === 'complete') {
        request.resolve(output);
      } else {
        request.reject(new Error(error ?? 'Deep analysis worker error'));
      }
    };
    worker.onerror = () => this.rejectAll(new Error('Deep analysis worker crashed'));
  }

  /** Fire-and-forget model preload; completion is not awaited. */
  warmup(): void {
    this.worker.postMessage({ type: 'warmup', id: this.nextId() });
  }

  runNER(text: string): Promise<NerEntity[]> {
    return this.request<NerEntity[]>({ type: 'ner', text });
  }

  runClassify(text: string, labels: string[]): Promise<ClassifyResult> {
    return this.request<ClassifyResult>({ type: 'classify', text, labels });
  }

  dispose(): void {
    this.rejectAll(new Error('Deep analysis worker disposed'));
    this.worker.terminate();
  }

  private nextId(): string {
    return `deep-ext-${++this.idCounter}`;
  }

  private request<T>(message: Record<string, unknown>): Promise<T> {
    const id = this.nextId();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ ...message, id });
    });
  }

  private rejectAll(error: Error): void {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}
