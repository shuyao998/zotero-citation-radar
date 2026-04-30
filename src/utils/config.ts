/**
 * Reads plugin configuration with the following precedence:
 *   1. Zotero preferences (extensions.zotero.citation-radar.*) — production
 *   2. process.env / `.env` file — development only
 *
 * API keys MUST come from preferences in production. Dev .env support exists
 * only so that `npm start` doesn't require manually clicking through the prefs
 * pane on every reload.
 */

declare const Zotero: any;

import { config as pkgConfig } from "../../package.json";

const PREFS_PREFIX = pkgConfig.prefsPrefix;

export interface CitationRadarConfig {
  openAlexApiKey: string;
  semanticScholarApiKey: string;
  llmProvider: "deepseek" | "openai" | "anthropic" | "gemini";
  llmModel: string;
  llmApiKey: string;
}

function getPref(key: string): string {
  try {
    const value = Zotero?.Prefs?.get(`${PREFS_PREFIX}.${key}`);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function getEnv(key: string): string {
  // In dev, zotero-plugin-scaffold injects process.env at build time.
  // In prod build, these resolve to empty strings.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (globalThis as any).process?.env ?? {};
  return env[key] ?? "";
}

export function readConfig(): CitationRadarConfig {
  return {
    openAlexApiKey:
      getPref("openAlexApiKey") || getEnv("OPENALEX_API_KEY"),
    semanticScholarApiKey:
      getPref("semanticScholarApiKey") || getEnv("SEMANTIC_SCHOLAR_API_KEY"),
    llmProvider: (getPref("llmProvider") as CitationRadarConfig["llmProvider"]) || "deepseek",
    llmModel: getPref("llmModel") || "deepseek-chat",
    llmApiKey: getPref("llmApiKey") || getEnv("DEEPSEEK_API_KEY"),
  };
}
