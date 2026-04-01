import { z } from "zod";
import type { Env } from "./env.js";
import {
  openRouterChatCompletion,
  openRouterChatRaw,
} from "./openrouter.js";
import { checkAvailability, type AvailabilityResult } from "./namecom.js";
import { scoreDomain } from "./scoring.js";

const NameTaglineSchema = z.object({
  names: z.array(
    z.object({
      name: z.string().min(1),
      tagline: z.string().min(1),
    }),
  ),
});

export type SuggestionRow = {
  startupName: string;
  tagline: string;
  domain: string;
  sld: string;
  tld: string;
  purchasable: boolean;
  purchasePrice: number | null;
  premium: boolean | null;
  reason: string | null;
  score: number;
};

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 63);
}

function expandDomains(
  pairs: { name: string; tagline: string }[],
  tlds: string[],
): { startupName: string; tagline: string; domain: string; sld: string; tld: string }[] {
  const out: {
    startupName: string;
    tagline: string;
    domain: string;
    sld: string;
    tld: string;
  }[] = [];
  const seen = new Set<string>();
  for (const { name, tagline } of pairs) {
    const sld = slugifyName(name);
    if (!sld) continue;
    for (let tld of tlds) {
      tld = tld.startsWith(".") ? tld.slice(1) : tld;
      const fqdn = `${sld}.${tld}`;
      if (seen.has(fqdn)) continue;
      seen.add(fqdn);
      out.push({ startupName: name, tagline, domain: fqdn, sld, tld });
    }
  }
  return out;
}

function byAvailabilityMap(rows: AvailabilityResult[]): Map<string, AvailabilityResult> {
  const m = new Map<string, AvailabilityResult>();
  for (const r of rows) {
    m.set(r.domainName.toLowerCase(), r);
  }
  return m;
}

function namingUserPrompt(idea: string, nameCount: number): string {
  return `For this product idea, generate ${nameCount} distinct, short, brandable startup names and a one-line tagline for each.
Idea: ${idea.trim()}

Think through options carefully, then we will ask for JSON only in the next message.`;
}

function jsonOnlyFollowUp(nameCount: number): string {
  return `Now reply with ONLY valid JSON (no markdown fences, no explanation). Shape:
{"names":[{"name":"string","tagline":"string"}, ...]}

Include exactly ${nameCount} items in "names".`;
}

async function fetchNamesJson(env: Env, idea: string, nameCount: number): Promise<string> {
  const system = "You are a naming expert for startups.";

  if (!env.OPENROUTER_REASONING_ENABLED) {
    return openRouterChatCompletion(env, {
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a naming expert. Respond only with valid JSON matching the schema. No markdown.",
        },
        {
          role: "user",
          content: `${namingUserPrompt(idea, nameCount)}\n\nReturn JSON now: {"names":[{"name":"...","tagline":"..."}, ...]}`,
        },
      ],
    });
  }

  // OpenRouter reasoning: first call with reasoning enabled; second call passes reasoning_details back (unchanged).
  const user1 = namingUserPrompt(idea, nameCount);
  const msg1 = await openRouterChatRaw(env, {
    reasoning: true,
    temperature: 0.9,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user1 },
    ],
  });

  const assistantContent = msg1.content ?? "";

  const msg2 = await openRouterChatRaw(env, {
    reasoning: false,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are a naming expert. Output only valid JSON. No markdown." },
      { role: "user", content: user1 },
      {
        role: "assistant",
        content: assistantContent,
        ...(msg1.reasoning_details !== undefined
          ? { reasoning_details: msg1.reasoning_details }
          : {}),
      },
      { role: "user", content: jsonOnlyFollowUp(nameCount) },
    ],
  });

  const raw = msg2.content;
  if (raw == null || raw === "") {
    throw new Error("OpenRouter returned empty content on JSON follow-up.");
  }
  return raw;
}

export async function generateSuggestions(input: {
  env: Env;
  idea: string;
  nameCount: number;
  tlds: string[];
  maxDomains?: number;
}): Promise<{ idea: string; suggestions: SuggestionRow[] }> {
  const { env, idea } = input;
  const nameCount = Math.min(20, Math.max(3, input.nameCount));
  const tlds =
    input.tlds.length > 0
      ? input.tlds
      : [".com", ".io", ".ai", ".app"];
  const maxDomains = Math.min(200, input.maxDomains ?? 200);

  const raw = await fetchNamesJson(env, idea, nameCount);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OpenRouter returned non-JSON.");
  }

  const validated = NameTaglineSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error("OpenRouter JSON did not match expected shape.");
  }

  let expanded = expandDomains(validated.data.names, tlds);
  if (expanded.length > maxDomains) {
    expanded = expanded.slice(0, maxDomains);
  }

  if (!env.NAMECOM_USERNAME || !env.NAMECOM_TOKEN) {
    throw new Error("NAMECOM_USERNAME and NAMECOM_TOKEN must be set for availability checks.");
  }

  const availability = await checkAvailability(
    expanded.map((e) => e.domain),
    {
      username: env.NAMECOM_USERNAME,
      token: env.NAMECOM_TOKEN,
      baseUrl: env.NAMECOM_BASE_URL,
    },
  );
  const map = byAvailabilityMap(availability);

  const suggestions: SuggestionRow[] = expanded.map((row) => {
    const hit = map.get(row.domain.toLowerCase());
    const purchasable = hit?.purchasable ?? false;
    const { score } = scoreDomain(row.sld, row.tld, idea);
    return {
      startupName: row.startupName,
      tagline: row.tagline,
      domain: row.domain,
      sld: row.sld,
      tld: row.tld,
      purchasable,
      purchasePrice:
        hit?.purchasePrice != null && !Number.isNaN(hit.purchasePrice)
          ? hit.purchasePrice
          : null,
      premium: hit?.premium ?? null,
      reason: hit?.reason ?? null,
      score,
    };
  });

  return { idea: idea.trim(), suggestions };
}
