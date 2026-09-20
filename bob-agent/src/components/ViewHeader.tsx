import type { ReactNode } from "react";

// Shared section header for the data-heavy tabs (Dashboard, Workshop,
// Notes) — gives each one a product-style title + one-line description
// instead of dropping straight into panels, and a slot on the right for
// live meta (a count, a last-updated stamp, an action).
export function ViewHeader({
  icon,
  title,
  subtitle,
  meta,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  meta?: ReactNode;
}) {
  return (
    <div className="view-header">
      <div className="view-header__icon">{icon}</div>
      <div className="view-header__text">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {meta && <div className="view-header__meta">{meta}</div>}
    </div>
  );
}
