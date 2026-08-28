export type ReviewQualitySourceRow = {
  date: string;
  totalMatches: number | string;
  highConfidenceMatches: number | string;
  lowConfidenceMatches: number | string;
  specDiffMatches: number | string;
};

export type ReviewQualityDay = {
  date: string;
  totalMatches: number;
  highConfidenceMatches: number;
  lowConfidenceMatches: number;
  specDiffMatches: number;
  autoQualityRate: number;
};

export type RiskSourceRow = {
  category: string | null;
  totalMatches: number | string;
  riskMatches: number | string;
};

export type RiskSourceRanking = {
  category: string;
  totalMatches: number;
  riskMatches: number;
  riskRate: number;
};

export type ReviewQualityMatchRow = {
  createdAt: Date | string;
  score: number | string;
  hasSpecDiff: boolean | number;
  category: string | null;
};

function asCount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export function buildReviewQualityDays(rows: ReviewQualitySourceRow[]): ReviewQualityDay[] {
  return rows.map(row => {
    const totalMatches = asCount(row.totalMatches);
    const highConfidenceMatches = asCount(row.highConfidenceMatches);
    return {
      date: row.date,
      totalMatches,
      highConfidenceMatches,
      lowConfidenceMatches: asCount(row.lowConfidenceMatches),
      specDiffMatches: asCount(row.specDiffMatches),
      autoQualityRate: totalMatches === 0 ? 0 : Number(((highConfidenceMatches / totalMatches) * 100).toFixed(1)),
    };
  });
}

export function summarizeReviewQuality(days: ReviewQualityDay[]) {
  const totalMatches = days.reduce((sum, day) => sum + day.totalMatches, 0);
  const highConfidenceMatches = days.reduce((sum, day) => sum + day.highConfidenceMatches, 0);
  const lowConfidenceMatches = days.reduce((sum, day) => sum + day.lowConfidenceMatches, 0);
  const specDiffMatches = days.reduce((sum, day) => sum + day.specDiffMatches, 0);
  return {
    totalMatches,
    highConfidenceMatches,
    lowConfidenceMatches,
    specDiffMatches,
    autoQualityRate: totalMatches === 0 ? 0 : Number(((highConfidenceMatches / totalMatches) * 100).toFixed(1)),
  };
}

export function buildRiskSourceRanking(rows: RiskSourceRow[]): RiskSourceRanking[] {
  return rows.map(row => {
    const totalMatches = asCount(row.totalMatches);
    const riskMatches = asCount(row.riskMatches);
    return {
      category: row.category?.trim() || "未分類",
      totalMatches,
      riskMatches,
      riskRate: totalMatches === 0 ? 0 : Number(((riskMatches / totalMatches) * 100).toFixed(1)),
    };
  }).sort((left, right) => right.riskMatches - left.riskMatches || right.riskRate - left.riskRate || left.category.localeCompare(right.category, "zh-Hant"));
}

/** Aggregates plain match rows in Node.js to avoid database-specific DATE/GROUP BY behavior. */
export function aggregateReviewQualityRows(rows: ReviewQualityMatchRow[]) {
  const byDay = new Map<string, { totalMatches: number; highConfidenceMatches: number; lowConfidenceMatches: number; specDiffMatches: number }>();
  const byCategory = new Map<string, { totalMatches: number; riskMatches: number }>();

  rows.forEach(row => {
    const date = row.createdAt instanceof Date ? row.createdAt.toISOString().slice(0, 10) : String(row.createdAt).slice(0, 10);
    const score = Number(row.score);
    const hasSpecDiff = Boolean(row.hasSpecDiff);
    const day = byDay.get(date) ?? { totalMatches: 0, highConfidenceMatches: 0, lowConfidenceMatches: 0, specDiffMatches: 0 };
    day.totalMatches += 1;
    if (score >= 0.86 && !hasSpecDiff) day.highConfidenceMatches += 1;
    if (score < 0.86) day.lowConfidenceMatches += 1;
    if (hasSpecDiff) day.specDiffMatches += 1;
    byDay.set(date, day);

    const category = row.category?.trim() || "未分類";
    const categoryMetrics = byCategory.get(category) ?? { totalMatches: 0, riskMatches: 0 };
    categoryMetrics.totalMatches += 1;
    if (score < 0.86 || hasSpecDiff) categoryMetrics.riskMatches += 1;
    byCategory.set(category, categoryMetrics);
  });

  return {
    days: buildReviewQualityDays(Array.from(byDay.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([date, metrics]) => ({ date, ...metrics }))),
    riskSources: buildRiskSourceRanking(Array.from(byCategory.entries()).map(([category, metrics]) => ({ category, ...metrics }))),
  };
}
