import { useState, useCallback, useRef } from 'react';
import { useStore } from '@/lib/store';
import { llmCall, type LlmMessage, type LlmRequest } from '@/lib/tauri/llm';

export interface UseLLMOptions {
  temperature?: number;
  maxTokens?: number;
}

export function useLLM() {
  const rootPath = useStore((s) => s.rootPath);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // For cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  const call = useCallback(
    async (messages: LlmMessage[], options?: UseLLMOptions) => {
      if (!rootPath) {
        setError('No project open');
        return null;
      }

      setIsLoading(true);
      setError(null);

      // Create a new AbortController for this call
      // Note: Tauri invoke doesn't natively support AbortController yet,
      // but we can use it to track if we should ignore the result.
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const request: LlmRequest = {
          messages,
          projectPath: rootPath,
          temperature: options?.temperature,
          maxTokens: options?.maxTokens,
        };

        const result = await llmCall(request);

        if (controller.signal.aborted) {
          return null;
        }

        return result.content;
      } catch (err) {
        if (controller.signal.aborted) {
          return null;
        }
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return null;
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [rootPath]
  );

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsLoading(false);
    }
  }, []);

  return {
    call,
    abort,
    isLoading,
    error,
  };
}
