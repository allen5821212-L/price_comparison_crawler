export function formatCategoryListingMetricLabel(
  platformLabel: string,
  listedCount: number,
  listingRate: number,
): string {
  const count = Math.max(0, Number.isFinite(listedCount) ? listedCount : 0);
  const rate = Math.max(0, Math.min(100, Number.isFinite(listingRate) ? listingRate : 0));
  const formattedRate = rate.toLocaleString("zh-TW", {
    minimumFractionDigits: rate % 1 ? 1 : 0,
    maximumFractionDigits: 1,
  });
  return `${platformLabel}：已上架 ${count.toLocaleString("zh-TW")} 項；上架率 ${formattedRate}%`;
}
