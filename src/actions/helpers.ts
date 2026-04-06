// Parse a numeric value from natural language text.
// Tries keyword-specific match first, then SOL amount, then any number.
export function parseNumber(
  text: string | undefined,
  keyword: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!text) return fallback;
  const patterns = [
    new RegExp(`${keyword}\\s+([\\d.]+)`, "i"),
    new RegExp(`([\\d.]+)\\s*(?:SOL|sol)`, "i"),
    new RegExp(`([\\d.]+)`, "i"),
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const n = parseFloat(m[1]);
      if (!isNaN(n) && n >= min && n <= max) return n;
    }
  }
  return fallback;
}
