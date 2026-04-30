/**
 * Provider-agnostic LLM interface.
 * Implementations: deepseek.ts, openai.ts (v0.2), anthropic.ts (v0.2), gemini.ts (v0.2).
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** If provided, prompt the model for JSON output matching this JSON Schema. */
  responseSchema?: object;
}

export interface ChatCompletionResult {
  content: string;
  finishReason: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface LlmProvider {
  readonly name: string;
  chat(options: ChatCompletionOptions): Promise<ChatCompletionResult>;
}
