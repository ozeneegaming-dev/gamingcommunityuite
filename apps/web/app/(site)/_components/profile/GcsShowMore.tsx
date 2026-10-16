"use client";

import { Children, useId, useState, type ReactNode } from "react";

/**
 * O listă care arată primele `initial` rânduri și „arată mai mult” pentru restul (panoul se deschide cu înălțime +
 * opacitate). Rândurile vin gata randate (componente server).
 */
export function GcsShowMore({ children, initial, labels, className, testId }: { children: ReactNode; initial: number; labels: { more: string; less: string }; className?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const rows = Children.toArray(children);
  const hidden = rows.slice(initial);
  return (
    <div className={className} data-testid={testId}>
      <ul className="gcs-showMore__list">{rows.slice(0, initial)}</ul>
      {hidden.length > 0 && (
        <>
          <div id={id} className="gcs-collapse" data-open={open ? "true" : "false"} aria-hidden={!open}>
            <ul className="gcs-showMore__list" {...(open ? {} : { inert: true })}>
              {hidden}
            </ul>
          </div>
          <button type="button" className="gcs-btn gcs-btn--ghost gcs-btn--sm gcs-showMore__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} data-testid={testId ? `${testId}-more` : undefined}>
            {open ? labels.less : labels.more}
          </button>
        </>
      )}
    </div>
  );
}
