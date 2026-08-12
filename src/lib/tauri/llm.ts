import { invoke } from './invoke';

export interface LlmMessage {
  role: string;
  content: string;
  /** Optional OpenAI-compatible multimodal content appended after content. */
  parts?: LlmContentPart[];
}

export type LlmContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; imageUrl: string };

export interface LlmRequest {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  projectPath: string;
  /**
   * Which provider config to use. 'judge' targets a separately configured
   * model (the `judge_llm_settings` namespace) so a review runs independently
   * of the implementer. Omitted uses the default provider.
   */
  role?: 'default' | 'judge';
}

export interface LlmResponse {
  content: string;
}

export async function llmCall(request: LlmRequest): Promise<LlmResponse> {
  return invoke<LlmResponse>('llm_call', { request });
}
