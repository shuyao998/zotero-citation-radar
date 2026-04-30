/**
 * DeepSeek LLM provider.
 * Endpoint: https://api.deepseek.com/v1 (OpenAI-compatible chat completions).
 *
 * Models used during dev:
 *   - deepseek-chat (general)
 *   - deepseek-reasoner (better for influence analysis but more expensive)
 */

import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  LlmProvider,
} from "./provider";

export class DeepSeekProvider implements LlmProvider {
  readonly name = "deepseek";

  constructor(private readonly apiKey: string) {}

  async chat(_options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    throw new Error("DeepSeekProvider.chat: not implemented");
  }
}
