"use client";

import { faArrowDown, faArrowUp, faCopy, faFileExport, faFileImport, faGripVertical, faLayerGroup } from "@fortawesome/free-solid-svg-icons";
import { GcsBadgeArt, GcsButton, GcsIconSvg, GcsTooltip } from "@gcs/ui";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { GcsConfirmDialog } from "../../../_components/GcsConfirmDialog";
import { applyRankPreset, duplicateRank, exportRanks, importRanks, reorderRanks } from "../actions";

export type GcsLadderCard = {
  id: number;
  name: string;
  art: string;
  image: string | null;
  tier: string;
  animated: boolean;
  members: number;
  /** Pragurile, ca text scurt („100 XP · 50 ore jucate”). */
  summary: string;
  perks: string[];
};

/**
 * Scara rangurilor (Realizări v2): cardurile cu emblema pe trepte, de la cel mai înalt la primul, câți membri are fiecare
 * (link spre lista filtrată), reordonarea prin tragere sau cu săgețile, copia, exportul / importul și scările
 * prestabilite (cu confirmare în pagină).
 */
export function GcsRankLadder({ ranks, presets, unranked }: { ranks: GcsLadderCard[]; presets: { key: string; label: string }[]; unranked: number }) {
  const t = useTranslations("acp.achievements.v2");
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  // Ordinea internă e de jos în sus (poziția 0 = primul rang); afișarea e de sus în jos.
  const [order, setOrder] = useState(ranks);
  const [drag, setDrag] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "preset"; key: string; label: string } | { kind: "import"; text: string } | null>(null);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = [...order].reverse();

  async function save(next: GcsLadderCard[]) {
    const prev = order;
    setOrder(next);
    const res = await reorderRanks(next.map((r) => r.id));
    if (!res.ok) {
      setOrder(prev);
      setError(errorMessage(res.error));
    } else setError(null);
  }

  function move(id: number, delta: number) {
    const i = order.findIndex((r) => r.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    const [row] = next.splice(i, 1);
    next.splice(j, 0, row!);
    void save(next);
  }

  function dropOn(targetId: number) {
    if (drag === null || drag === targetId) return;
    const next = order.filter((r) => r.id !== drag);
    const at = next.findIndex((r) => r.id === targetId);
    next.splice(at + 1, 0, order.find((r) => r.id === drag)!);
    setDrag(null);
    void save(next);
  }

  async function run<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: Parameters<typeof errorMessage>[0] }>, done?: (d: T) => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return setError(errorMessage(res.error));
    done?.(res.data);
    router.refresh();
  }

  return (
    <section className="gcs-card gcs-rankLadder" aria-labelledby="gcs-rank-ladder-title" data-testid="gcs-rank-ladder">
      <div className="gcs-ruleList__head">
        <h2 id="gcs-rank-ladder-title" className="gcs-acpWidget__title">
          {t("ladderTitle")}
        </h2>
        <div className="gcs-ruleList__tools">
          <label className="gcs-field gcs-rankLadder__preset">
            <span className="gcs-srOnly">{t("presets")}</span>
            <select
              className="gcs-input"
              aria-label={t("presets")}
              value=""
              onChange={(e) => {
                const p = presets.find((x) => x.key === e.target.value);
                if (p) setConfirm({ kind: "preset", key: p.key, label: p.label });
              }}
              data-testid="gcs-rank-preset"
            >
              <option value="">{t("presets")}</option>
              {presets.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <GcsButton
            variant="ghost"
            size="sm"
            icon={<GcsIconSvg icon={faFileExport} />}
            onClick={() =>
              run(
                () => exportRanks(),
                (data) => {
                  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "gcs-ranks.json";
                  a.click();
                  URL.revokeObjectURL(url);
                },
              )
            }
          >
            {t("export")}
          </GcsButton>
          <GcsButton variant="ghost" size="sm" icon={<GcsIconSvg icon={faFileImport} />} onClick={() => fileRef.current?.click()}>
            {t("import")}
          </GcsButton>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label={t("import")}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) setConfirm({ kind: "import", text: await f.text() });
            }}
          />
        </div>
      </div>
      <ol className="gcs-rankLadder__list">
        {shown.map((r, i) => (
          <li
            key={r.id}
            className={`gcs-rankCard gcs-rankCard--${r.tier}${drag === r.id ? " is-dragging" : ""}`}
            draggable
            onDragStart={() => setDrag(r.id)}
            onDragEnd={() => setDrag(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dropOn(r.id)}
            data-testid="gcs-rank-card"
            data-rank={r.name}
          >
            <span className="gcs-rankCard__grip" aria-hidden="true">
              <GcsIconSvg icon={faGripVertical} />
            </span>
            <span className="gcs-rankCard__level">{shown.length - i}</span>
            <span className={`gcs-rankEmblem${r.animated ? " gcs-rankEmblem--animated" : ""}`}>
              <GcsBadgeArt badge={{ name: r.name, art: r.art, image: r.image }} size={48} decorative />
            </span>
            <span className="gcs-rankCard__body">
              <strong className="gcs-rankCard__name">{r.name}</strong>
              <span className="gcs-rankCard__summary">{r.summary || t("noThreshold")}</span>
              {r.perks.length > 0 && (
                <span className="gcs-rankCard__perks">
                  {r.perks.map((p) => (
                    <span key={p} className="gcs-chip gcs-rankCard__perk">
                      {p}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <Link href={`/admin/members?rank=${r.id}`} className="gcs-rankCard__count" data-testid="gcs-rank-members">
              <b>{format.number(r.members)}</b> {t("members", { count: r.members })}
            </Link>
            <span className="gcs-ruleList__actions">
              <GcsTooltip content={t("moveUpRank")}>
                <button type="button" className="gcs-iconBtn" aria-label={t("moveUpNamed", { name: r.name })} disabled={i === 0} onClick={() => move(r.id, 1)}>
                  <GcsIconSvg icon={faArrowUp} />
                </button>
              </GcsTooltip>
              <GcsTooltip content={t("moveDownRank")}>
                <button type="button" className="gcs-iconBtn" aria-label={t("moveDownNamed", { name: r.name })} disabled={i === shown.length - 1} onClick={() => move(r.id, -1)}>
                  <GcsIconSvg icon={faArrowDown} />
                </button>
              </GcsTooltip>
              <GcsTooltip content={t("copy")}>
                <button type="button" className="gcs-iconBtn" aria-label={t("copyNamed", { name: r.name })} disabled={busy} onClick={() => run(() => duplicateRank(r.id))}>
                  <GcsIconSvg icon={faCopy} />
                </button>
              </GcsTooltip>
            </span>
          </li>
        ))}
      </ol>
      <p className="gcs-muted gcs-rankLadder__unranked">
        <GcsIconSvg icon={faLayerGroup} /> {t("unranked", { count: unranked })}
      </p>
      {error && (
        <p role="alert" className="gcs-field__error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="gcs-ruleB__notice">
          {notice}
        </p>
      )}
      {confirm?.kind === "preset" && (
        <GcsConfirmDialog
          title={t("presetTitle", { name: confirm.label })}
          body={t("presetBody")}
          confirmLabel={t("presetApply")}
          danger
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            run(
              () => applyRankPreset(confirm.key),
              (r) => {
                setConfirm(null);
                setNotice(t("ranksImported", r));
              },
            )
          }
        />
      )}
      {confirm?.kind === "import" && (
        <GcsConfirmDialog
          title={t("import")}
          body={t("importRanksBody")}
          confirmLabel={t("import")}
          danger={replace}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            run(
              () => importRanks(confirm.text, replace),
              (r) => {
                setConfirm(null);
                setNotice(t("ranksImported", r));
              },
            )
          }
        >
          <label className="gcs-check">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            {t("replaceLadder")}
          </label>
        </GcsConfirmDialog>
      )}
    </section>
  );
}
