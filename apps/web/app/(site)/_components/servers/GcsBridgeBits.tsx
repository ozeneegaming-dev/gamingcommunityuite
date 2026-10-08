import { GcsIcon } from "@gcs/ui/icons";
import Link from "next/link";
import type { CSSProperties } from "react";
import { getTranslations } from "next-intl/server";
import { playerHref } from "./types";

/**
 * Piesele comune ale paginilor punții (specul 2026-10-08-servere-pagini §2): eticheta identității (tipul + încrederea,
 * culoarea mereu cu text), tipul și starea unei sancțiuni, numele unui jucător cu link spre profil, forma (ultimele
 * meciuri) și graficul ELO. Textele din joc (nume, hărți, motive) sunt date neîncredere: doar text.
 */

const KIND_ICON: Record<string, string> = { STEAM: "fa-brands fa-steam", NONSTEAM: "fa-solid fa-gamepad", NAME: "fa-solid fa-signature" };
const TRUST_ICON: Record<string, string> = { HIGH: "fa-solid fa-shield-halved", MEDIUM: "fa-solid fa-shield", LOW: "fa-regular fa-circle-question" };

/** Tipul identității și încrederea ei; cu `value`, și ID-ul (monospace: se compară caracter cu caracter). */
export async function GcsIdentityTag({ kind, trust, value, compact = false }: { kind: string; trust: string; value?: string | null; compact?: boolean }) {
  const t = await getTranslations("bridge.identity");
  return (
    <span className={`gcs-identity${compact ? " gcs-identity--compact" : ""}`} data-trust={trust} data-testid="gcs-identity">
      <span className="gcs-identity__kind">
        <GcsIcon name={KIND_ICON[kind] ?? "fa-solid fa-gamepad"} />
        {t(`kind.${kind}`)}
      </span>
      <span className="gcs-identity__trust" title={t(`trustHint.${trust}`)}>
        <GcsIcon name={TRUST_ICON[trust] ?? "fa-solid fa-shield"} />
        {compact ? t(`trustShort.${trust}`) : t(`trust.${trust}`)}
      </span>
      {value && kind !== "NAME" && <code className="gcs-identity__id">{value}</code>}
    </span>
  );
}

const TYPE_ICON: Record<string, string> = { BAN: "fa-solid fa-gavel", MUTE: "fa-solid fa-microphone-slash", GAG: "fa-solid fa-comment-slash" };

/** Tipul unei sancțiuni (ban / mute / gag), cu iconița și textul. */
export async function GcsSanctionType({ type }: { type: string }) {
  const t = await getTranslations("bridge.sanction.type");
  return (
    <span className="gcs-sanctionType" data-type={type}>
      <GcsIcon name={TYPE_ICON[type] ?? "fa-solid fa-gavel"} />
      {t(type)}
    </span>
  );
}

/** Starea unei sancțiuni: activă / expirată / ridicată (punctul are mereu textul lângă el). */
export async function GcsSanctionStatus({ status }: { status: string }) {
  const t = await getTranslations("bridge.sanction.status");
  return (
    <span className="gcs-sanctionStatus" data-status={status}>
      <span className="gcs-dot" aria-hidden="true" />
      {t(status)}
    </span>
  );
}

/** Numele unui jucător (sau ID-ul, dacă nu are nume), cu link spre profilul lui de jucător. */
export function GcsPlayerLink({ player, className }: { player: { id: number; name: string; value?: string }; className?: string }) {
  const label = player.name || player.value || `#${player.id}`;
  return (
    <Link href={playerHref({ id: player.id, name: label })} className={`gcs-playerLink${className ? ` ${className}` : ""}`}>
      {label}
    </Link>
  );
}

/** Rezultatul unui meci pentru o echipă: victorie / înfrângere / egal (litera are mereu și textul pentru cititoare). */
export type GcsResult = "win" | "loss" | "draw" | "open";

export function matchResult(team: string | null | undefined, winner: string | null): GcsResult {
  if (!winner) return "open";
  if (winner === "DRAW") return "draw";
  return winner === team ? "win" : "loss";
}

/** Forma: ultimele meciuri, ca pastile (V / Î / E), cea mai veche în stânga. */
export async function GcsFormGuide({ results, label }: { results: GcsResult[]; label: string }) {
  const t = await getTranslations("bridge.result");
  const shown = results.filter((r) => r !== "open");
  if (shown.length === 0) return null;
  return (
    <ol className="gcs-formGuide" aria-label={label} data-testid="gcs-form-guide">
      {shown.map((r, i) => (
        <li key={i} className="gcs-formGuide__pip" data-result={r} title={t(r)}>
          <span aria-hidden="true">{t(`short.${r}`)}</span>
          <span className="gcs-srOnly">{t(r)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Graficul ELO (fără JavaScript): linia și spălarea într-un SVG întins pe toată caseta (fără text în SVG, deci nimic
 * nu se deformează), etichetele axei și punctele meciurilor ca elemente HTML poziționate în procente; ultimul punct în
 * `accentInk`. Un tabel ascuns vizual dă aceleași valori cititoarelor de ecran.
 */
export async function GcsEloChart({ history, start, height = 200, compact = false }: { history: { matchId: number; at: string; elo: number }[]; start: number; height?: number; compact?: boolean }) {
  const t = await getTranslations("bridge.elo");
  if (history.length === 0) return <p className="gcs-serverNote">{t("empty")}</p>;
  const points = [{ elo: start, at: null as string | null, matchId: 0 }, ...history];
  const values = points.map((p) => p.elo);
  const step = 50;
  const min = Math.floor((Math.min(...values) - 10) / step) * step;
  const max = Math.ceil((Math.max(...values) + 10) / step) * step;
  // Coordonatele în procente (0–100): x pe meciuri, y de sus în jos.
  const x = (i: number) => (points.length === 1 ? 50 : (i / (points.length - 1)) * 100);
  const y = (v: number) => 100 - ((v - min) / Math.max(1, max - min)) * 100;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.elo).toFixed(2)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(2)},100 L${x(0).toFixed(2)},100 Z`;
  const every = Math.max(1, Math.ceil((max - min) / step / 4));
  const grid: number[] = [];
  for (let v = min; v <= max; v += step * every) grid.push(v);
  const last = points.at(-1)!;
  return (
    <figure className={`gcs-eloChart${compact ? " gcs-eloChart--compact" : ""}`} data-testid="gcs-elo-chart" style={{ "--gcs-chart-h": `${height}px` } as CSSProperties}>
      <div className="gcs-eloChart__plot" role="img" aria-label={t("chartLabel", { from: start, to: last.elo, count: history.length })}>
        {!compact && (
          <div className="gcs-eloChart__ticks" aria-hidden="true">
            {grid.map((v) => (
              <span key={v} style={{ top: `${y(v)}%` }}>
                {v}
              </span>
            ))}
          </div>
        )}
        <div className="gcs-eloChart__area">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {grid.map((v) => (
              <line key={v} className="gcs-eloChart__grid" x1={0} x2={100} y1={y(v)} y2={y(v)} />
            ))}
            <path className="gcs-eloChart__fill" d={area} />
            <path className="gcs-eloChart__line" d={line} />
          </svg>
          {!compact &&
            points.length <= 60 &&
            points.slice(1, -1).map((p, i) => <span key={p.matchId} className="gcs-eloChart__dot" style={{ left: `${x(i + 1)}%`, top: `${y(p.elo)}%` }} aria-hidden="true" />)}
          <span className="gcs-eloChart__dot gcs-eloChart__dot--last" style={{ left: `${x(points.length - 1)}%`, top: `${y(last.elo)}%` }} aria-hidden="true" />
        </div>
      </div>
      <table className="gcs-srOnly">
        <caption>{t("tableCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("match")}</th>
            <th scope="col">{t("value")}</th>
          </tr>
        </thead>
        <tbody>
          {history.map((p) => (
            <tr key={p.matchId}>
              <td>#{p.matchId}</td>
              <td>{p.elo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Timpul de joc: ore și minute (sub o oră, doar minutele). */
export function playtimeText(seconds: number, t: (key: string, values: Record<string, number>) => string): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? t("hours", { h, m }) : t("minutes", { m });
}
