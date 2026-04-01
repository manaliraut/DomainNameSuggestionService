import type { Env } from "./env.js";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Message shape OpenRouter accepts; assistant may include `reasoning_details` on follow-up turns. */
export type OpenRouterRequestMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  reasoning_details?: unknown;
};

type OpenRouterAssistantMessage = {
  content?: string | null;
  reasoning_details?: unknown;
  role?: string;
};

type OpenRouterResponse = {
  choices?: Array<{ message?: OpenRouterAssistantMessage }>;
  error?: { message?: string };
};

function bearerToken(env: Env): string {
  const key = env.OPENROUTER_API_KEY || env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }
  return key;
}

function buildHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearerToken(env)}`,
    "Content-Type": "application/json",
  };
  if (env.OPENROUTER_HTTP_REFERER) {
    headers["HTTP-Referer"] = env.OPENROUTER_HTTP_REFERER;
  }
  if (env.OPENROUTER_SITE_TITLE) {
    headers["X-OpenRouter-Title"] = env.OPENROUTER_SITE_TITLE;
  }
  return headers;
}

/**
 * Raw chat completion: returns assistant `message` (content + optional reasoning_details).
 * First call: `reasoning: true` → body includes `"reasoning": {"enabled": true}`.
 * Follow-up: omit reasoning in body; pass assistant `reasoning_details` through unmodified.
 */
export async function openRouterChatRaw(
  env: Env,
  opts: {
    messages: OpenRouterRequestMessage[];
    temperature?: number;
    response_format?: { type: "json_object" };
    /** When true, sends `reasoning: { enabled: true }` (OpenRouter). */
    reasoning?: boolean;
  },
): Promise<OpenRouterAssistantMessage> {
  const body: Record<string, unknown> = {
    model: env.OPENROUTER_MODEL,
    messages: opts.messages,
  };
  if (opts.temperature !== undefined) {
    body.temperature = opts.temperature;
  }
  if (opts.response_format) {
    body.response_format = opts.response_format;
  }
  if (opts.reasoning) {
    body.reasoning = { enabled: true };
  }

  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: buildHeaders(env),
    body: JSON.stringify(body),
  });

  let data: OpenRouterResponse;
  try {
    data = (await res.json()) as OpenRouterResponse;
  } catch {
    throw new Error("OpenRouter returned non-JSON body.");
  }

  if (!res.ok) {
    const msg = data.error?.message ?? res.statusText;
    throw new Error(`OpenRouter error ${res.status}: ${msg}`);
  }

  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error("OpenRouter returned no choices.");
  }
  return message;
}

/**
 * Single string from assistant `content` (throws if missing).
 */
export async function openRouterChatCompletion(
  env: Env,
  opts: {
    messages: OpenRouterRequestMessage[];
    temperature?: number;
    response_format?: { type: "json_object" };
    reasoning?: boolean;
  },
): Promise<string> {
  const message = await openRouterChatRaw(env, opts);
  const content = message.content;
  if (content == null || content === "") {
    throw new Error("OpenRouter returned empty content.");
  }
  return content;
}
