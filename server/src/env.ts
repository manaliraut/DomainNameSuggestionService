import { config } from "dotenv";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env") });

const envSchema = z.object({
  /** Primary key for https://openrouter.ai (Bearer token). */
  OPENROUTER_API_KEY: z.string().optional().default(""),
  /** Optional fallback if you still use the old name in `.env`. */
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENROUTER_MODEL: z.string().default("nvidia/nemotron-3-super-120b-a12b:free"),
  /** When true (default), first call uses `reasoning: { enabled: true }`, then a second call passes `reasoning_details` back for structured JSON (see OpenRouter reasoning docs). */
  OPENROUTER_REASONING_ENABLED: z
    .string()
    .optional()
    .default("true")
    .transform((v) =>
      ["1", "true", "yes", "on"].includes(String(v ?? "").toLowerCase()),
    ),
  OPENROUTER_HTTP_REFERER: z.string().optional().default(""),
  OPENROUTER_SITE_TITLE: z.string().optional().default(""),

  NAMECOM_USERNAME: z.string().optional().default(""),
  NAMECOM_TOKEN: z.string().optional().default(""),
  NAMECOM_BASE_URL: z.string().default("https://api.name.com"),
  PORT: z.coerce.number().default(8787),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) {
    cached = envSchema.parse(process.env);
  }
  return cached;
}
