export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand ${compact ? "compact" : ""}`}>
      <svg className="brand-symbol" viewBox="0 0 50 34" aria-hidden="true">
        <path
          className="brand-symbol-bridge"
          d="M2 24V11l7-7h8M33 30h8l7-7V10"
        />
        {[7, 19, 31].map((x) => (
          <g className="brand-cube" transform={`translate(${x} 10)`} key={x}>
            <path className="cube-top" d="m0 4 6-4 6 4-6 4z" />
            <path className="cube-left" d="m0 4 6 4v7l-6-4z" />
            <path className="cube-right" d="m6 8 6-4v7l-6 4z" />
          </g>
        ))}
      </svg>
      {!compact && (
        <strong aria-hidden="true">
          SAVE MY<span aria-hidden="true">…</span>
        </strong>
      )}
      <span className="sr-only">SAVE MY…</span>
    </span>
  );
}
