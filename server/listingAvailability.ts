export type ListingPlatformKey = "sinya" | "coolpc" | "pchome" | "momo";

export type ListingPlatform = {
  key: ListingPlatformKey;
  label: string;
  shortLabel: string;
  listedCount: number;
  catalogCount: number;
  listingRate: number;
};

export type ListingCategory = {
  category: string;
  sourceCount: number;
  coolpc: { listedCount: number; listingRate: number };
  pchome: { listedCount: number; listingRate: number };
  momo: { listedCount: number; listingRate: number };
};

type ListingAvailabilityInput = {
  sourceTotal: number;
  catalogTotals: Record<ListingPlatformKey, number>;
  listedCounts: Record<ListingPlatformKey, number>;
  allPlatformsListedCount: number;
};

type CategorySourceInput = { category: string | null; sourceCount: number | string };
type CategoryMatchInput = {
  category: string | null;
  coolpcCount: number | string;
  pchomeCount: number | string;
  momoCount: number | string;
};

const PLATFORM_LABELS: Record<ListingPlatformKey, { label: string; shortLabel: string }> = {
  sinya: { label: "欣亞數位", shortLabel: "欣亞" },
  coolpc: { label: "原價屋", shortLabel: "原價屋" },
  pchome: { label: "PChome 24h", shortLabel: "PChome" },
  momo: { label: "momo 購物網", shortLabel: "momo" },
};

function nonNegative(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

/** Uses the Sinya catalog as the single reference denominator for comparable listings. */
export function calculateListingRate(listedCount: number | string, sourceTotal: number | string): number {
  const source = nonNegative(sourceTotal);
  if (source === 0) return 0;
  return Number(((nonNegative(listedCount) / source) * 100).toFixed(1));
}

export function buildListingAvailability(input: ListingAvailabilityInput) {
  const sourceTotal = nonNegative(input.sourceTotal);
  const platforms: ListingPlatform[] = (Object.keys(PLATFORM_LABELS) as ListingPlatformKey[]).map(key => ({
    key,
    label: PLATFORM_LABELS[key].label,
    shortLabel: PLATFORM_LABELS[key].shortLabel,
    listedCount: key === "sinya" ? sourceTotal : nonNegative(input.listedCounts[key]),
    catalogCount: nonNegative(input.catalogTotals[key]),
    listingRate: key === "sinya" && sourceTotal > 0
      ? 100
      : calculateListingRate(input.listedCounts[key], sourceTotal),
  }));

  const allPlatformsListedCount = nonNegative(input.allPlatformsListedCount);
  return {
    referencePlatform: "sinya" as const,
    sourceTotal,
    allPlatformsListedCount,
    allPlatformsListingRate: calculateListingRate(allPlatformsListedCount, sourceTotal),
    platforms,
  };
}

export function buildListingCategories(
  sourceRows: CategorySourceInput[],
  matchRows: CategoryMatchInput[],
): ListingCategory[] {
  const matchedByCategory = new Map(
    matchRows
      .filter(row => Boolean(row.category?.trim()))
      .map(row => [row.category!.trim(), row]),
  );

  return sourceRows
    .filter(row => Boolean(row.category?.trim()))
    .map(row => {
      const category = row.category!.trim();
      const sourceCount = nonNegative(row.sourceCount);
      const matched = matchedByCategory.get(category);
      const coolpcListed = nonNegative(matched?.coolpcCount);
      const pchomeListed = nonNegative(matched?.pchomeCount);
      const momoListed = nonNegative(matched?.momoCount);
      return {
        category,
        sourceCount,
        coolpc: { listedCount: coolpcListed, listingRate: calculateListingRate(coolpcListed, sourceCount) },
        pchome: { listedCount: pchomeListed, listingRate: calculateListingRate(pchomeListed, sourceCount) },
        momo: { listedCount: momoListed, listingRate: calculateListingRate(momoListed, sourceCount) },
      };
    });
}
