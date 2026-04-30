/**
 * DeepSeek LLM provider.
 *
 * Endpoint: https://api.deepseek.com/v1 (OpenAI-compatible chat completions).
 * Auth: Bearer <api_key>.
 *
 * Models used during dev:
 *   - deepseek-chat     (general; default for influence reports)
 *   - deepseek-reasoner (better for influence analysis but more expensive)
 *
 * JSON-output strategy:
 *   DeepSeek supports `response_format: { type: "json_object" }` on
 *   deepseek-chat. We pass it whenever the caller supplies `responseSchema`
 *   (the schema itself is only used inside the system prompt for the model
 *   to follow — DeepSeek does NOT enforce it server-side like OpenAI does).
 */

import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  LlmProvider,
} from "./provider";

declare const Zotero: any;

const ENDPOINT = "https://api.deepseek.com/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 120_000; // 2 min — influence reports can be slow

interface DeepSeekChoice {
  message: { role: string; content: string };
  finish_reason: string;
}
interface DeepSeekResponse {
  choices: DeepSeekChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class DeepSeekProvider implements LlmProvider {
  readonly name = "deepseek";

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("DeepSeekProvider: apiKey is required");
  }

  async chat(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
    };
    if (options.maxTokens != null) body.max_tokens = options.maxTokens;
    if (options.responseSchema) {
      // DeepSeek follows OpenAI's old "json_object" mode (no schema enforcement).
      // Caller is responsible for embedding the schema in the system prompt.
      body.response_format = { type: "json_object" };
    }

    // AbortController + setTimeout are not globals in the Zotero plugin
    // sandbox; reach into the main window for the implementations.
    const win: any = Zotero.getMainWindow();
    const ctrl = new win.AbortController();
    const timer = win.setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

    let resp: Response;
    try {
      resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new Error(
        `DeepSeek request failed: ${redact((err as Error).message, this.apiKey)}`,
      );
    } finally {
      win.clearTimeout(timer);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "(no body)");
      throw new Error(
        `DeepSeek ${resp.status} ${resp.statusText}: ${redact(text.slice(0, 400), this.apiKey)}`,
      );
    }

    const data = (await resp.json()) as unknown as DeepSeekResponse;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error("DeepSeek returned no choices");
    }

    Zotero.debug(
      `[Citation Radar] DeepSeek ok · model=${options.model} · ` +
        `prompt=${data.usage?.prompt_tokens ?? "?"} · ` +
        `completion=${data.usage?.completion_tokens ?? "?"}`,
    );

    return {
      content: choice.message.content,
      finishReason: choice.finish_reason,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
          }
        : undefined,
    };
  }
}

/** Strip the api key from any string before logging. Belt-and-suspenders. */
function redact(s: string, key: string): string {
  if (!key) return s;
  return s.split(key).join("***");
}
