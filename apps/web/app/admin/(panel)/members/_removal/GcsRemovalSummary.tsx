import type { GcsRemovalItem, GcsRemovalNote } from "@gcs/core";
import { GcsCard } from "@gcs/ui";
import { GcsIcon } from "@gcs/ui/icons";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { GcsAcpTitleIcon } from "../../_components/GcsAcpTitle";

/** Un card ACP cu titlu (aceeași formă ca secțiunile din fișa membrului). */
export function GcsRemovalSection({ title, icon, children, testId, className }: { title: string; icon: string; children: ReactNode; testId?: string; className?: string }) {
  return (
    <GcsCard as="section" aria-label={title} data-testid={testId} className={className}>
      <div className="gcs-acpWidget__header">
        <h2 className="gcs-acpWidget__title">
          <GcsAcpTitleIcon name={icon} />
          {title}
        </h2>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
    </GcsCard>
  );
}

/** „Ce are membrul”: numerele nenule, în ordinea pașilor (forum, profil, mesaje…). */
export async function GcsRemovalItems({ items, empty }: { items: GcsRemovalItem[]; empty: string }) {
  const t = await getTranslations("acp.removal.items");
  const format = await getFormatter();
  if (items.length === 0) return <p style={{ margin: 0, color: "var(--gcs-muted)", fontSize: 14 }}>{empty}</p>;
  return (
    <ul className="gcs-removalItems" data-testid="gcs-removal-items">
      {items.map((i) => (
        <li key={`${i.step}.${i.key}`} className="gcs-removalItem" data-key={i.key}>
          <span className="gcs-removalItem__count">{format.number(i.count)}</span>
          <span className="gcs-removalItem__label">{t.has(i.key) ? t(i.key) : i.key}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Observațiile handler-elor (cine preia un clan, ce VIP rămâne…). Parametrul `until` vine ca dată ISO (gol = permanent) și
 * se formatează aici.
 */
export async function GcsRemovalNotes({ notes }: { notes: GcsRemovalNote[] }) {
  const t = await getTranslations("acp.removal");
  const format = await getFormatter();
  if (notes.length === 0) return null;
  return (
    <ul className="gcs-removalNotes" data-testid="gcs-removal-notes">
      {notes.map((n, i) => {
        const params = Object.fromEntries(
          Object.entries(n.params ?? {}).map(([k, v]) => [k, k === "until" ? (v ? format.dateTime(new Date(String(v)), { dateStyle: "medium" }) : t("permanent")) : v]),
        );
        const key = `notes.${n.key}`;
        return (
          <li key={i} className={`gcs-removalNote gcs-removalNote--${n.level}`} data-note={n.key}>
            <GcsIcon name={n.level === "warn" ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-circle-info"} />
            <span>{t.has(key) ? t(key, params) : n.key}</span>
          </li>
        );
      })}
    </ul>
  );
}
