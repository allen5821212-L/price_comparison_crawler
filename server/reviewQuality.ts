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
