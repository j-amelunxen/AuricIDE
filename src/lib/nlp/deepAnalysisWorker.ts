/**
 * Web Worker for deep NLP analysis using Transformers.js.
 *
 * Pipelines:
 *   - NER: onnx-community/distilbert-NER-ONNX (q8) → PER, ORG, LOC, MISC
 *   - Classification: Xenova/mobilebert-uncased-mnli (q8) → Zero-shot Intent
 *
 * Message protocol:
 *   Request  → { type: 'ner' | 'classify' | 'warmup', text?, labels?, id }
 *   Response → { status: 'complete' | 'progress' | 'error', task, id, output?, data?, error? }
 */

import {
  pipeline,
  env,
  type TokenClassificationPipeline,
  type ZeroShotClassificationPipeline,
} from '@huggingface/transformers';

// Disable local model loading — always download from HF Hub / cache
env.allowLocalModels = false;

let nerPipeline: TokenClassificationPipeline | null = null;
let classifyPipeline: ZeroShotClassificationPipeline | null = null;

async function getNerPipeline(): Promise<TokenClassificationPipeline> {
  if (!nerPipeline) {
    const pipe = await pipeline('token-classification', 'Xenova/bert-base-NER', {
      dtype: 'q8',
      progress_callback: (data: Record<string, unknown>) => {
        self.postMessage({ status: 'progress', task: 'ner', data });
      },
    });
    nerPipeline = pipe as unknown as TokenClassificationPipeline;
  }
  return nerPipeline;
}

async function getClassifyPipeline(): Promise<ZeroShotClassificationPipeline> {
  if (!classifyPipeline) {
    const pipe = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli', {
      dtype: 'q8',
      progress_callback: (data: Record<string, unknown>) => {
        self.postMessage({ status: 'progress', task: 'classify', data });
      },
    });
    classifyPipeline = pipe as unknown as ZeroShotClassificationPipeline;
  }
  return classifyPipeline;
}

export interface WorkerRequest {
  type: 'ner' | 'classify' | 'warmup';
  text?: string;
  labels?: string[];
  id: string;
}

export interface NerEntity {
  entity_group: string;
  score: number;
  word: string;
  start: number;
  end: number;
}

export interface ClassifyResult {
  labels: string[];
  scores: number[];
}

export interface WorkerResponse {
  status: 'complete' | 'progress' | 'error';
  task: 'ner' | 'classify' | 'warmup';
  id: string;
  output?: NerEntity[] | ClassifyResult;
  data?: Record<string, unknown>;
  error?: string;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { type, text, labels, id } = event.data;

  try {
    switch (type) {
      case 'warmup': {
        await Promise.all([getNerPipeline(), getClassifyPipeline()]);
        self.postMessage({ status: 'complete', task: 'warmup', id } satisfies WorkerResponse);
        break;
      }

      case 'ner': {
        if (!text) {
          self.postMessage({
            status: 'error',
            task: 'ner',
            id,
            error: 'Missing text for NER',
          } satisfies WorkerResponse);
          break;
        }

        const ner = await getNerPipeline();
        const rawOutput = await ner(text);

        // Normalize output to our NerEntity interface
        const output: NerEntity[] = (rawOutput as Record<string, unknown>[]).map((item) => ({
          entity_group: String(item.entity_group ?? item.entity ?? ''),
          score: Number(item.score ?? 0),
          word: String(item.word ?? ''),
          start: Number(item.start ?? 0),
          end: Number(item.end ?? 0),
        }));

        self.postMessage({ status: 'complete', task: 'ner', id, output } satisfies WorkerResponse);
        break;
      }

      case 'classify': {
        if (!text || !labels?.length) {
          self.postMessage({
            status: 'error',
            task: 'classify',
            id,
            error: 'Missing text or labels for classification',
          } satisfies WorkerResponse);
          break;
        }

        const classifier = await getClassifyPipeline();
        const rawResult = await classifier(text, labels);

        const result = rawResult as unknown as { labels: string[]; scores: number[] };
        const output: ClassifyResult = {
          labels: result.labels,
          scores: result.scores,
        };

        self.postMessage({
          status: 'complete',
          task: 'classify',
          id,
          output,
        } satisfies WorkerResponse);
        break;
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown worker error';
    self.postMessage({ status: 'error', task: type, id, error } satisfies WorkerResponse);
  }
};
