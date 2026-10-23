"use client";

import { faGrip, faList, faListUl, faTableList } from "@fortawesome/free-solid-svg-icons";
import { GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";

const ICONS = { rows: faList, grid: faGrip, list: faListUl, snippet: faTableList } as const;

/**
 * Comutatorul vederii (rânduri / grilă pentru forumuri, listă / cu fragment pentru topicuri): membrul alege, alegerea
 * stă într-un cookie, iar pagina se reîncarcă cu noua vedere (randată pe server).
 */
export function GcsViewToggle<V extends keyof typeof ICONS>({ cookie, value, options, labels, label }: { cookie: string; value: V; options: readonly V[]; labels: Record<V, string>; label: string }) {
  const router = useRouter();
  return (
    <div className="gcs-seg__group gcs-viewToggle" role="radiogroup" aria-label={label} data-testid={`gcs-view-${cookie}`}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          aria-label={labels[o]}
          className={o === value ? "gcs-seg gcs-seg--active" : "gcs-seg"}
          onClick={() => {
            document.cookie = `${cookie}=${o}; path=/; max-age=31536000; samesite=lax`;
            router.refresh();
          }}
          data-testid={`gcs-view-${o}`}
        >
          <GcsIconSvg icon={ICONS[o]} />
        </button>
      ))}
    </div>
  );
}
