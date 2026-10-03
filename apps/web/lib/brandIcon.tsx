/**
 * The "pp" (prakai POS) monogram as JSX, for icons rendered by next/og.
 * Keep in step with app/icon.svg. `padded` shrinks the mark into the maskable safe zone.
 */
export function BrandMark({ size, padded = false }: { size: number; padded?: boolean }) {
  const inner = padded ? 0.72 : 1;
  return (
    <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#17784A', borderRadius: padded ? 0 : size * 0.22 }}>
      <svg width={size * inner} height={size * inner} viewBox="0 0 64 64">
        <g fill="none" stroke="#fff" strokeWidth={6} strokeLinecap="round">
          <path d="M12 21v30" /><circle cx="21" cy="28.5" r="8.5" />
          <path d="M35 21v30" /><circle cx="44" cy="28.5" r="8.5" />
        </g>
        <path d="M55 6l1.3 3.7L60 11l-3.7 1.3L55 16l-1.3-3.7L50 11l3.7-1.3z" fill="#F5D46B" />
      </svg>
    </div>
  );
}
