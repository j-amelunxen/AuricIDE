import { invoke } from '@tauri-apps/api/core';

export interface LlmMessage {
  role: string;
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  projectPath: string;
}

export interface LlmResponse {
  content: string;
}

export async function llmCall(request: LlmRequest): Promise<LlmResponse> {
  return invoke<LlmResponse>('llm_call', { request });
}
