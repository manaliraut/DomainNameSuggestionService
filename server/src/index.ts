import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { getEnv } from "./env.js";
import {
  checkAvailability,
  NameComAuthError,
  NameComError,
  NameComRateLimitError,
} from "./namecom.js";
import { generateSuggestions } from "./generate.js";

const MAX_DOMAINS_PER_CALL = 200;

const checkBodySchema = z.object({
  domainNames: z.array(z.string()).min(1),
});

const suggestionsBodySchema = z.object({
  idea: z.string().min(3),
  nameCount: z.number().int().min(3).max(20).optional(),
  tlds: z.array(z.string()).optional(),
  maxDomains: z.number().int().min(1).max(200).optional(),
});

const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/api/domains/check-availability", async (c) => {
  const env = getEnv();
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const parsed = checkBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body.", details: parsed.error.flatten() }, 422);
  }

  if (parsed.data.domainNames.length > MAX_DOMAINS_PER_CALL) {
    return c.json(
      { error: `At most ${MAX_DOMAINS_PER_CALL} domains per request.` },
      422,
    );
  }

  if (!env.NAMECOM_USERNAME || !env.NAMECOM_TOKEN) {
    return c.json(
      {
        error:
          "Name.com API is not configured (set NAMECOM_USERNAME and NAMECOM_TOKEN).",
      },
      503,
    );
  }

  try {
    const results = await checkAvailability(parsed.data.domainNames, {
      username: env.NAMECOM_USERNAME,
      token: env.NAMECOM_TOKEN,
      baseUrl: env.NAMECOM_BASE_URL,
    });
    return c.json(results);
  } catch (e) {
    if (e instanceof NameComAuthError) {
      return c.json({ error: e.message }, 401);
    }
    if (e instanceof NameComRateLimitError) {
      return c.json({ error: e.message }, 429);
    }
    if (e instanceof NameComError) {
      const sc = e.statusCode;
      if (sc === 422 || sc === 502 || sc === 503 || sc === 504) {
        return c.json({ error: e.message }, sc);
      }
      return c.json({ error: e.message }, 502);
    }
    throw e;
  }
});

app.post("/api/suggestions", async (c) => {
  const env = getEnv();
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body." }, 400);
  }

  const parsed = suggestionsBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid body.", details: parsed.error.flatten() }, 422);
  }

  try {
    const out = await generateSuggestions({
      env,
      idea: parsed.data.idea,
      nameCount: parsed.data.nameCount ?? 10,
      tlds: parsed.data.tlds ?? [],
      maxDomains: parsed.data.maxDomains,
    });
    return c.json(out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes("OPENROUTER_API_KEY") || msg.includes("OPENAI_API_KEY")) {
      return c.json({ error: msg }, 503);
    }
    if (msg.includes("NAMECOM_")) {
      return c.json({ error: msg }, 503);
    }
    return c.json({ error: msg }, 502);
  }
});

const env = getEnv();
const port = env.PORT;

serve({ fetch: app.fetch, port }, (info) => {
  console.info(`Server listening on http://localhost:${info.port}`);
});
