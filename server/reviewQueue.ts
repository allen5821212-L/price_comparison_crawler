import { createHash } from "node:crypto";

export type ReviewPlatform = "coolpc" | "pchome" | "momo";
export type ReviewSeverity = "medium" | "high" | "critical";

export type ReviewMatchSource = {
  id: number;
  sourceKey: string;
  sinyaName: string;
  category: string | null;
  sinyaPrice: number | string;
  coolpcName: string | null;
  coolpcPrice: number | string | null;
  pchomeName: string | null;
  pchomePrice: number | string | null;
  momoName: string | null;
  momoPrice: number | string | null;
  score: number | string;
  hasSpecDiff: boolean | number;
};

export type ReviewTarget = {
  platform: ReviewPlatform;
  name: string;
  price: number;
};

export type MatchReviewItem = {
  id: number;
  sourceKey: string;
  fingerprint: string;
  sinyaName: string;
  category: string;
  sinyaPrice: number;
  score: number;
  hasSpecDiff: boolean;
  priceSpread: number;
  riskScore: number;
  severity: ReviewSeverity;
  reasons: string[];
  targets: ReviewTarget[];
};

export type MatchReviewSummary = {
  total: number;
  mediumTotal: number;
  highTotal: number;
  criticalTotal: number;
  highRiskTotal: number;
};

const LOW_CONFIDENCE_THRESHOLD = 0.86;
const HIGH_PRICE_SPREAD = 0.5;

function asNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, value));
}

export function calculatePriceSpread(prices: Array<number | string | null | undefined>): number {
  const usable = prices.map(asNumber).filter(price => price > 0);
  if (usable.length < 2) return 0;
  const lowest = Math.min(...usable);
  const highest = Math.max(...usable);
  return Number(((highest - lowest) / lowest).toFixed(3));
}

/** Same candidates have the same fingerprint; changed target names must be reviewed again. */
export function createReviewFingerprint(source: Pick<ReviewMatchSource, "sourceKey" | "coolpcName" | "pchomeName" | "momoName" | "hasSpecDiff">): string {
  const payload = [
    source.sourceKey,
    source.coolpcName?.trim() ?? "",
    source.pchomeName?.trim() ?? "",
    source.momoName?.trim() ?? "",
    Boolean(source.hasSpecDiff) ? "spec-diff" : "no-spec-diff",
  ].join("\u001f");
  return createHash("sha256").update(payload).digest("hex");
}

export function buildMatchReviewItem(source: ReviewMatchSource): MatchReviewItem | null {
  const score = clamp(asNumber(source.score), 0, 1);
  const hasSpecDiff = Boolean(source.hasSpecDiff);
  const targets: ReviewTarget[] = [
    { platform: "coolpc", name: source.coolpcName, price: source.coolpcPrice },
    { platform: "pchome", name: source.pchomeName, price: source.pchomePrice },
    { platform: "momo", name: source.momoName, price: source.momoPrice },
  ].filter((target): target is ReviewTarget => Boolean(target.name?.trim())).map(target => ({
    ...target,
    name: target.name.trim(),
    price: asNumber(target.price),
  }));
  const priceSpread = calculatePriceSpread([source.sinyaPrice, ...targets.map(target => target.price)]);
  const reasons: string[] = [];
  const confidenceRisk = Math.round((1 - score) * 100);
  const priceRisk = priceSpread >= HIGH_PRICE_SPREAD ? Math.min(90, Math.round(priceSpread * 100)) : 0;

  if (hasSpecDiff) reasons.push("已偵測到型號或規格差異");
  if (score < LOW_CONFIDENCE_THRESHOLD) reasons.push(`配對信心偏低（${Math.round(score * 100)}%）`);
  if (priceSpread >= HIGH_PRICE_SPREAD) reasons.push(`跨平台價格落差 ${Math.round(priceSpread * 100)}%`);
  if (reasons.length === 0) return null;

  const riskScore = Math.max(hasSpecDiff ? 85 : 0, confidenceRisk, priceRisk);
  const severity: ReviewSeverity = riskScore >= 80 ? "critical" : riskScore >= 55 ? "high" : "medium";
  return {
    id: source.id,
    sourceKey: source.sourceKey,
    fingerprint: createReviewFingerprint(source),
    sinyaName: source.sinyaName,
    category: source.category?.trim() || "未分類",
    sinyaPrice: asNumber(source.sinyaPrice),
    score,
    hasSpecDiff,
    priceSpread,
    riskScore,
    severity,
    reasons,
    targets,
  };
}

export function filterAndSortReviewItems(
  rows: ReviewMatchSource[],
  options: { severity?: ReviewSeverity; platform?: ReviewPlatform; search?: string; skippedFingerprints?: ReadonlySet<string> } = {},
): MatchReviewItem[] {
  const needle = options.search?.trim().toLowerCase() ?? "";
  return rows
    .map(buildMatchReviewItem)
    .filter((item): item is MatchReviewItem => item !== null)
    .filter(item => !options.skippedFingerprints?.has(item.fingerprint))
    .filter(item => !options.severity || item.severity === options.severity)
    .filter(item => !options.platform || item.targets.some(target => target.platform === options.platform))
    .filter(item => !needle || [item.sinyaName, item.category, ...item.targets.map(target => target.name)]
      .join(" ").toLowerCase().includes(needle))
    .sort((left, right) => right.riskScore - left.riskScore || left.score - right.score || left.sinyaName.localeCompare(right.sinyaName, "zh-Hant"));
}

export function summarizeReviewItems(items: MatchReviewItem[]): MatchReviewSummary {
  const mediumTotal = items.filter(item => item.severity === "medium").length;
  const highTotal = items.filter(item => item.severity === "high").length;
  const criticalTotal = items.filter(item => item.severity === "critical").length;
  return {
    total: items.length,
    mediumTotal,
    highTotal,
    criticalTotal,
    highRiskTotal: highTotal + criticalTotal,
  };
}
