export function WaterBackground({ fade }: { fade: number }) {
  return (
    <svg className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <pattern id="water-waves" width="80" height="24" patternUnits="userSpaceOnUse">
          <path d="M0,12 C10,2 20,2 30,12 C40,22 50,22 60,12 C70,2 80,2 90,12" fill="none" stroke="var(--color-water-line)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill={`color-mix(in oklch, var(--color-water), transparent ${Math.round((1 - fade) * 100)}%)`} />
      <rect x="0" y="0" width="100%" height="100%" fill="url(#water-waves)" opacity={0.35 * fade} />
    </svg>
  );
}
