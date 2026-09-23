import Anthropic from "@anthropic-ai/sdk";

/**
 * Which LLM backend the assistant talks to.
 *
 * Everything in agent/ speaks Anthropic's Messages API shape — the tool
 * definitions, the streaming loop, the propose-then-confirm gate in chat.ts and
 * the message format the web app stores in localStorage. DeepSeek serves that
 * same shape at /anthropic, so swapping providers is a base-URL + key change
 * and nothing downstream has to know.
 *
 * Set DEEPSEEK_API_KEY to use DeepSeek; otherwise it falls back to Anthropic.
 */
export type Provider = "deepseek" | "anthropic";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/anthropic";

const deepseekKey = process.env.DEEPSEEK_API_KEY ?? "";
const anthropicKey = process.env.ANTHROPIC_API_KEY ?? "";

export const provider: Provider = deepseekKey ? "deepseek" : "anthropic";

// Don't leave a claude-* id pointing at DeepSeek: DeepSeek silently maps Claude
// names onto its own models (claude-opus-* bills at V4 Pro rates), so a stale
// AGENT_MODEL would quietly cost ~4x more than the Flash tier we're asking for.
const DEFAULT_MODEL = provider === "deepseek" ? "deepseek-flash" : "claude-sonnet-5";

export const MODEL = process.env.AGENT_MODEL || DEFAULT_MODEL;

export const agentEnabled = Boolean(deepseekKey || anthropicKey);

export const client = agentEnabled
  ? provider === "deepseek"
    ? new Anthropic({ apiKey: deepseekKey, baseURL: DEEPSEEK_BASE_URL })
    : new Anthropic({ apiKey: anthropicKey })
  : null;

export const notConfiguredMessage =
  "The assistant is not configured — set DEEPSEEK_API_KEY (or ANTHROPIC_API_KEY) on the API.";

const EFFORT = process.env.AGENT_EFFORT || "medium";

/**
 * Reasoning knobs, per provider. DeepSeek accepts `thinking` and
 * `output_config.effort` on the compat endpoint but not Anthropic's `adaptive`
 * mode, and Flash is quick and cheap enough that a spoken assistant is better
 * off without a thinking pass — set AGENT_THINKING=on if you want it.
 */
export const reasoningParams: Record<string, unknown> =
  provider === "deepseek"
    ? process.env.AGENT_THINKING === "on"
      ? { thinking: { type: "enabled" }, output_config: { effort: EFFORT } }
      : {}
    : { thinking: { type: "adaptive" }, output_config: { effort: EFFORT } };
