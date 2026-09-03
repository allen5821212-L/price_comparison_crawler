export type NegativeFeaturePair = {
  sourceFeature: string;
  targetFeature: string;
};

type FeatureDetector = {
  key: string;
  read: (value: string) => string | null;
};

const normalize = (value: string) => value.toUpperCase().replace(/[－–]/g, "-");

const firstMatch = (value: string, pattern: RegExp, format: (match: RegExpMatchArray) => string) => {
  const match = normalize(value).match(pattern);
  return match ? format(match) : null;
};

const detectors: FeatureDetector[] = [
  { key: "color", read: value => firstMatch(value, /白(?:色)?|\bWHITE\b/, () => "white") || firstMatch(value, /黑(?:色)?|\bBLACK\b/, () => "black") || firstMatch(value, /灰(?:色)?|\b(?:GRAY|GREY)\b/, () => "gray") },
  { key: "wifi", read: value => firstMatch(value, /無\s*(?:WI-?FI|WIFI)|\bNO\s*-?\s*WI-?FI\b/, () => "no-wifi") || firstMatch(value, /\bWI-?FI(?:\s*[67])?\b/, () => "wifi") },
  { key: "ddr", read: value => firstMatch(value, /\bDDR\s*([45])\b/, match => `ddr${match[1]}`) },
  { key: "pcie", read: value => firstMatch(value, /\bPCI\s*E?\s*([45])(?:\.0)?\b/, match => `pcie${match[1]}`) },
  { key: "capacity", read: value => firstMatch(value, /(?<![A-Z0-9])(1024|512|256|128|64|32|16|8|4|2|1)\s*(GB|TB|G|T)(?![A-Z0-9])/, match => {
    const unit = match[2].startsWith("T") ? "T" : "G";
    const amount = match[1] === "1024" && unit === "G" ? "1T" : `${match[1]}${unit}`;
    return amount;
  }) },
  { key: "suffix", read: value => firstMatch(value, /(?:\d|\b)(TI|SUPER|XTX|XT|NON[ -]?OC|OC|PLUS|PRO|MAX)(?![A-Z0-9])/, match => match[1].replace(/[ -]/g, "")) },
];

/** Returns only contradictory features; identical or missing attributes are not learned as penalties. */
export function extractMutuallyExclusiveFeatures(sourceName: string, targetName: string): NegativeFeaturePair[] {
  const pairs = detectors.flatMap(detector => {
    const source = detector.read(sourceName);
    const target = detector.read(targetName);
    if (detector.key === "suffix" && source !== target && (source || target)) {
      return [{
        sourceFeature: `${detector.key}:${source ?? "none"}`,
        targetFeature: `${detector.key}:${target ?? "none"}`,
      }];
    }
    return source && target && source !== target
      ? [{ sourceFeature: `${detector.key}:${source}`, targetFeature: `${detector.key}:${target}` }]
      : [];
  });
  return Array.from(new Map(pairs.map(pair => [`${pair.sourceFeature}\u001f${pair.targetFeature}`, pair])).values());
}

/** A learned signal only affects matching after independent human rejection evidence accumulates. */
export function calculateNegativePenalty(rejectionCount: number): number {
  if (rejectionCount < 2) return 0;
  return Math.min(0.36, Number((0.09 * rejectionCount).toFixed(2)));
}
