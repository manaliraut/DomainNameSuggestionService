/** Name.com Core API — CheckAvailability client (ported from Python). */

export const NAMECOM_CHECK_PATH = "/core/v1/domains:checkAvailability";
export const MAX_DOMAINS_PER_REQUEST = 50;
const MAX_429_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 45_000;

export type AvailabilityResult = {
  domainName: string;
  sld: string;
  tld: string;
  purchasable: boolean;
  premium?: boolean | null;
  purchasePrice?: number | null;
  renewalPrice?: number | null;
  purchaseType?: string | null;
  reason?: string | null;
};

export class NameComError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null = null,
    readonly body: unknown = undefined,
  ) {
    super(message);
    this.name = "NameComError";
  }
}

export class NameComAuthError extends NameComError {
  constructor(message: string, statusCode = 401, body?: unknown) {
    super(message, statusCode, body);
    this.name = "NameComAuthError";
  }
}

export class NameComRateLimitError extends NameComError {
  constructor(message: string, statusCode = 429, body?: unknown) {
    super(message, statusCode, body);
    this.name = "NameComRateLimitError";
  }
}

function normalizeDomainList(domainNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of domainNames) {
    const d = raw.trim().toLowerCase();
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

function parseResetWaitMs(headers: Headers): number | null {
  const raw = headers.get("x-ratelimit-reset");
  if (raw === null) return null;
  const resetTs = Number(raw);
  if (Number.isNaN(resetTs)) return null;
  const waitSec = Math.max(0, resetTs - Date.now() / 1000);
  return waitSec * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function parseResults(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new NameComError("Name.com returned unexpected JSON (expected object).", null, data);
  }
  const rawResults = (data as { results?: unknown }).results;
  if (!Array.isArray(rawResults)) {
    throw new NameComError("Name.com response missing 'results' list.", null, data);
  }
  return rawResults.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object");
}

function toAvailabilityResult(row: Record<string, unknown>): AvailabilityResult {
  const domainName = String(row.domainName ?? "");
  const sld = String(row.sld ?? "");
  const tld = String(row.tld ?? "");
  const purchasable = Boolean(row.purchasable);
  const premium = row.premium == null ? undefined : Boolean(row.premium);
  const purchasePrice =
    row.purchasePrice == null ? undefined : Number(row.purchasePrice);
  const renewalPrice =
    row.renewalPrice == null ? undefined : Number(row.renewalPrice);
  const purchaseType =
    row.purchaseType == null ? undefined : String(row.purchaseType);
  const reason = row.reason == null ? undefined : String(row.reason);

  return {
    domainName,
    sld,
    tld,
    purchasable,
    premium,
    purchasePrice: Number.isNaN(purchasePrice) ? undefined : purchasePrice,
    renewalPrice: Number.isNaN(renewalPrice) ? undefined : renewalPrice,
    purchaseType,
    reason,
  };
}

async function postBatch(
  url: string,
  batch: string[],
  authHeader: string,
  attempt: number,
): Promise<Record<string, unknown>[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ domainNames: batch }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401) {
    throw new NameComAuthError(
      "Name.com authentication failed (check NAMECOM_USERNAME / NAMECOM_TOKEN).",
      401,
      await safeJson(response),
    );
  }

  if (response.status === 429) {
    const waitMs = parseResetWaitMs(response.headers);
    if (waitMs != null && attempt < MAX_429_RETRIES) {
      const capped = Math.min(waitMs + 500, 90_000);
      await sleep(capped);
      return postBatch(url, batch, authHeader, attempt + 1);
    }
    throw new NameComRateLimitError(
      "Name.com rate limit exceeded.",
      429,
      await safeJson(response),
    );
  }

  if (!response.ok) {
    throw new NameComError(
      `Name.com API error: ${response.status}`,
      response.status,
      await safeJson(response),
    );
  }

  const data = await safeJson(response);
  return parseResults(data);
}

export async function checkAvailability(
  domainNames: readonly string[],
  options: {
    username: string;
    token: string;
    baseUrl?: string;
  },
): Promise<AvailabilityResult[]> {
  const domains = normalizeDomainList(domainNames);
  if (domains.length === 0) return [];

  const root = (options.baseUrl ?? "https://api.name.com").replace(/\/+$/, "");
  const url = `${root}${NAMECOM_CHECK_PATH}`;
  const authHeader = `Basic ${Buffer.from(`${options.username}:${options.token}`, "utf8").toString("base64")}`;


  console.log("USERNAME: "+ options.username);
  console.log("TOKEN: "+ options.token);

  const results: AvailabilityResult[] = [];
  for (const batch of chunks(domains, MAX_DOMAINS_PER_REQUEST)) {
    const rows = await postBatch(url, batch, authHeader, 0);
    for (const row of rows) {
      results.push(toAvailabilityResult(row));
    }
  }
  return results;
}
