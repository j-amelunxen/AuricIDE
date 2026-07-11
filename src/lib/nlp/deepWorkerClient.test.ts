import { describe, expect, it } from 'vitest';
import { DeepWorkerClient, type WorkerLike } from './deepWorkerClient';

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: Array<Record<string, unknown>> = [];
  terminated = false;

  postMessage(message: unknown) {
    this.posted.push(message as Record<string, unknown>);
  }

  terminate() {
    this.terminated = true;
  }

  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

describe('DeepWorkerClient', () => {
  it('resolves a NER request on a complete response', async () => {
    const worker = new FakeWorker();
    const client = new DeepWorkerClient(worker);

    const promise = client.runNER('Sarah lives in London');
    const { id } = worker.posted[0];
    const entities = [{ entity_group: 'PER', score: 0.99, word: 'Sarah', start: 0, end: 5 }];
    worker.emit({ status: 'complete', task: 'ner', id, output: entities });

    await expect(promise).resolves.toEqual(entities);
  });

  it('rejects the pending request on an error response instead of hanging', async () => {
    const worker = new FakeWorker();
    const client = new DeepWorkerClient(worker);

    const promise = client.runNER('some text');
    const { id } = worker.posted[0];
    worker.emit({ status: 'error', task: 'ner', id, error: 'model download failed' });

    await expect(promise).rejects.toThrow('model download failed');
  });

  it('correlates two in-flight requests by id', async () => {
    const worker = new FakeWorker();
    const client = new DeepWorkerClient(worker);

    const nerPromise = client.runNER('text a');
    const classifyPromise = client.runClassify('text b', ['instruction']);
    const nerId = worker.posted[0].id;
    const classifyId = worker.posted[1].id;

    // Answer out of order — each promise must still get its own result.
    worker.emit({
      status: 'complete',
      task: 'classify',
      id: classifyId,
      output: { labels: ['instruction'], scores: [0.9] },
    });
    worker.emit({ status: 'complete', task: 'ner', id: nerId, output: [] });

    await expect(nerPromise).resolves.toEqual([]);
    await expect(classifyPromise).resolves.toEqual({ labels: ['instruction'], scores: [0.9] });
  });

  it('ignores progress messages while a request is pending', async () => {
    const worker = new FakeWorker();
    const client = new DeepWorkerClient(worker);

    const promise = client.runNER('text');
    const { id } = worker.posted[0];
    worker.emit({ status: 'progress', task: 'ner', id, data: { progress: 42 } });
    worker.emit({ status: 'complete', task: 'ner', id, output: [] });

    await expect(promise).resolves.toEqual([]);
  });

  it('rejects all pending requests when the worker itself errors', async () => {
    const worker = new FakeWorker();
    const client = new DeepWorkerClient(worker);

    const promise = client.runNER('text');
    worker.onerror?.(new ErrorEvent('error'));

    await expect(promise).rejects.toThrow();
  });

  it('dispose rejects pending requests and terminates the worker', async () => {
    const worker = new FakeWorker();
    const client = new DeepWorkerClient(worker);

    const promise = client.runNER('text');
    client.dispose();

    await expect(promise).rejects.toThrow();
    expect(worker.terminated).toBe(true);
  });

  it('warmup posts a warmup message', () => {
    const worker = new FakeWorker();
    const client = new DeepWorkerClient(worker);

    client.warmup();

    expect(worker.posted[0]).toMatchObject({ type: 'warmup' });
  });
});
