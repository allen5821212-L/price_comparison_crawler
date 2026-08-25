type WeeklyQualityReport = {
  startDate: string;
  endDate: string;
  summary: {
    totalMatches: number;
    highConfidenceMatches: number;
    lowConfidenceMatches: number;
    specDiffMatches: number;
    autoQualityRate: number;
  };
  days: Array<{
    date: string;
    totalMatches: number;
    highConfidenceMatches: number;
    lowConfidenceMatches: number;
    specDiffMatches: number;
    autoQualityRate: number;
  }>;
  riskSources?: Array<{
    category: string;
    totalMatches: number;
    riskMatches: number;
    riskRate: number;
  }>;
};

/** CSV rows explain that the reported rate is an automatic quality proxy, not human-verification accuracy. */
export function buildWeeklyQualityCsvRows(report: WeeklyQualityReport): Array<Array<string | number>> {
  return [
    ["每週配對品質報表", `${report.startDate} 至 ${report.endDate}`],
    ["品質指標說明", "高信心且未偵測規格差異的自動配對占比；非人工驗證準確率"],
    ["配對總數", report.summary.totalMatches],
    ["高信心配對", report.summary.highConfidenceMatches],
    ["低信心配對", report.summary.lowConfidenceMatches],
    ["規格差異配對", report.summary.specDiffMatches],
    ["自動配對品質指標", `${report.summary.autoQualityRate}%`],
    [],
    ["日期", "配對總數", "高信心配對", "低信心配對", "規格差異", "自動配對品質指標"],
    ...report.days.map(day => [day.date, day.totalMatches, day.highConfidenceMatches, day.lowConfidenceMatches, day.specDiffMatches, `${day.autoQualityRate}%`]),
    [],
    ["風險來源分類", "分類配對總數", "風險配對數", "風險率"],
    ...(report.riskSources ?? []).map(source => [source.category, source.totalMatches, source.riskMatches, `${source.riskRate}%`]),
  ];
}
