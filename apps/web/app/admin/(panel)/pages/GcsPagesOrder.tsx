"use client";

import { GcsIcon } from "@/lib/pages-icons";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { reorderPagesCategories, reorderPagesNodes } from "./actions";

/**
 * Săgețile „Mai sus” / „Mai jos” ale unui rând (paginile între frați, categoriile unei baze): mută rândul cu o poziție
 * și salvează ordinea întreagă.
 */
export function GcsPagesOrder({ id, parentId, siblings, databaseId }: { id: number; parentId: number | null; siblings: number[]; databaseId?: number }) {
  const t = useTranslations("acp.pages");
  const router = useRouter();
  const [pending, start] = useTransition();
  const at = siblings.indexOf(id);
  const move = (delta: number) =>
    start(async () => {
      const next = [...siblings];
      const to = at + delta;
      if (to < 0 || to >= next.length) return;
      [next[at], next[to]] = [next[to]!, next[at]!];
      const res = databaseId ? await reorderPagesCategories(databaseId, next) : await reorderPagesNodes(parentId, next);
      if (res.ok) router.refresh();
    });
  return (
    <span className="gcs-pgOrder" role="group" aria-label={t("order")}>
      <button type="button" className="gcs-iconBtn" disabled={pending || at <= 0} onClick={() => move(-1)} aria-label={t("moveUp")} title={t("moveUp")}>
        <GcsIcon name="fa-solid fa-chevron-up" />
      </button>
      <button type="button" className="gcs-iconBtn" disabled={pending || at === siblings.length - 1} onClick={() => move(1)} aria-label={t("moveDown")} title={t("moveDown")}>
        <GcsIcon name="fa-solid fa-chevron-down" />
      </button>
    </span>
  );
}
