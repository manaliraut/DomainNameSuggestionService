/** Deterministic domain scoring: length, TLD preference, keyword overlap. */

const TLD_WEIGHT: Record<string, number> = {
  com: 1.0,
  io: 0.92,
  app: 0.9,
  ai: 0.88,
  co: 0.85,
  dev: 0.82,
  net: 0.8,
  org: 0.78,
  xyz: 0.55,
};

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/** SLD length score: ~1 for short names, decays toward 0 for long. */
function lengthScore(sld: string): number {
  const n = sld.length;
  if (n <= 6) return 1;
  if (n <= 10) return 0.85;
  if (n <= 14) return 0.65;
  return 0.45;
}

function keywordOverlapScore(sld: string, ideaTokens: Set<string>): number {
  if (ideaTokens.size === 0) return 0.5;
  const s = sld.toLowerCase();
  let hits = 0;
  for (const w of ideaTokens) {
    if (s.includes(w)) hits += 1;
  }
  return Math.min(1, hits / 3 + 0.35);
}

export function scoreDomain(
  sld: string,
  tld: string,
  idea: string,
): { score: number; breakdown: { length: number; tld: number; keywords: number } } {
  const ideaTokens = tokenize(idea);
  const len = lengthScore(sld);
  const tldKey = tld.replace(/^\./, "").toLowerCase();
  const tldW = TLD_WEIGHT[tldKey] ?? 0.7;
  const kw = keywordOverlapScore(sld, ideaTokens);
  const score = 0.35 * len + 0.35 * tldW + 0.3 * kw;
  return {
    score: Math.round(score * 1000) / 1000,
    breakdown: { length: len, tld: tldW, keywords: kw },
  };
}
