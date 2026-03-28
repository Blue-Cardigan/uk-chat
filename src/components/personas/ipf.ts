export function normalize(values: number[]): number[] {
  const sum = values.reduce((total, value) => total + value, 0);
  if (sum === 0) return values.map(() => 0);
  return values.map((value) => value / sum);
}

export function weightedSample<T>(items: T[], weights: number[], random: () => number): T {
  const normalized = normalize(weights);
  const target = random();
  let cumulative = 0;
  for (let index = 0; index < items.length; index += 1) {
    cumulative += normalized[index] ?? 0;
    if (target <= cumulative) return items[index];
  }
  return items[items.length - 1];
}
