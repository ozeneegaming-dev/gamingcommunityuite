"use client";

import type { GcsServerHistory } from "@gcs/modules";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** Lățimea implicită (randarea pe server); în browser, viewBox-ul ia lățimea reală a graficului. */
const DEFAULT_W = 720;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 36 };
const CH = H - PAD.top - PAD.bottom;
/** Coloanele: cel mult 24 px, cu 2 px de spațiu între ele (macheta și regulile graficelor). */
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

/** O coloană cu capătul de sus rotunjit (4 px) și baza dreaptă. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/**
 * Graficul jucătorilor (specul 2026-10-07-servere §5.2), desenat direct în SVG: o singură serie (media jucătorilor pe
 * coloană), coloane pentru 24 h și 30 de zile (coloana curentă în `accentInk`), linie cu o spălare de 10 % pentru cele
 * 7 zile. Axa Y merge până la sloturi. Tooltip la hover și la focus (săgețile mută selecția), plus un tabel ascuns
 * vizual cu toate valorile, pentru cititoarele de ecran.
 */
export function GcsServerChart({ history }: { history: GcsServerHistory }) {
  const t = useTranslations("servers.chart");
  const format = useFormatter();
  const id = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  // Un viewBox de lățimea reală: textul axelor are mereu ~11 px (pe telefon, o scalare a 720 px l-ar face ilizibil).
  const [W, setW] = useState(DEFAULT_W);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry?.contentRect.width ?? DEFAULT_W);
      if (width > 0) setW(Math.max(280, Math.min(1200, width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const CW = W - PAD.left - PAD.right;
  const { buckets, range } = history;
  const n = buckets.length;
  const hasData = buckets.some((b) => b.avg !== null);
  const peakMax = Math.max(0, ...buckets.map((b) => b.peak ?? 0));
  // Axa Y merge până la sloturi (o coloană plină = server plin), sau până la vârf, dacă a fost mai mare.
  const max = Math.max(history.maxPlayers, peakMax) || 4;
  const slot = CW / n;
  const barW = Math.max(1, Math.min(MAX_BAR, slot - GAP));
  const xCenter = (i: number) => PAD.left + slot * i + slot / 2;
  const y = (v: number) => PAD.top + CH - (v / max) * CH;
  const baseline = PAD.top + CH;
  const asLine = range === "7d";

  const label = (at: string, long = false) => {
    const d = new Date(at);
    if (range === "30d") return format.dateTime(d, { day: "numeric", month: "short" });
    if (range === "7d" && long) return format.dateTime(d, { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    if (range === "7d") return format.dateTime(d, { weekday: "short" });
    return format.dateTime(d, { hour: "2-digit", minute: "2-digit" });
  };
  // Etichetele axei X: ~5 repere, ultimul „acum”.
  const step = range === "24h" ? 6 : range === "7d" ? 24 : 6;
  // Un reper prea aproape de „acum” (sub ~56 px, ex. pe telefon) se sare, ca etichetele să nu se lipească.
  const xTicks = buckets
    .map((b, i) => ({ i, text: i === n - 1 ? t("now") : label(b.at) }))
    .filter(({ i }) => i === n - 1 || (i % step === 0 && n - 1 - i >= step / 2 && (n - 1 - i) * slot >= 56));
  const yTicks = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f)))];

  const value = (v: number | null) => (v === null ? null : format.number(v, { maximumFractionDigits: 1 }));

  function pick(e: PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    setActive(Math.max(0, Math.min(n - 1, Math.floor((x - PAD.left) / slot))));
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in moves) {
      e.preventDefault();
      setActive((a) => Math.max(0, Math.min(n - 1, (a ?? n - 1) + moves[e.key]!)));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : n - 1);
    } else if (e.key === "Escape") {
      setActive(null);
    }
  }

  if (!hasData) return <p className="gcs-serverChart__empty">{t("empty")}</p>;

  // Linia pe 7 zile: segmente între golurile fără date (o lipsă nu se unește peste).
  const segments: string[] = [];
  const areas: string[] = [];
  if (asLine) {
    let run: number[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const pts = run.map((i) => `${xCenter(i).toFixed(1)},${y(buckets[i]!.avg!).toFixed(1)}`);
      segments.push(`M${pts.join(" L")}`);
      areas.push(`M${xCenter(run[0]!).toFixed(1)},${baseline} L${pts.join(" L")} L${xCenter(run[run.length - 1]!).toFixed(1)},${baseline} Z`);
      run = [];
    };
    buckets.forEach((b, i) => (b.avg === null ? flush() : run.push(i)));
    flush();
  }

  const current = active === null ? null : buckets[active]!;
  const tipLeft = active === null ? 0 : (xCenter(active) / W) * 100;

  return (
    <div
      ref={boxRef}
      className="gcs-serverChart"
      tabIndex={0}
      role="group"
      aria-label={`${t(`title.${range}`)}. ${t("hint")}`}
      onKeyDown={onKey}
      onBlur={() => setActive(null)}
      data-testid="gcs-server-chart"
      data-range={range}
    >
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" onPointerMove={pick} onPointerLeave={() => setActive(null)}>
        {yTicks.map((v) => (
          <g key={v}>
            <line className="gcs-serverChart__grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="gcs-serverChart__tick" x={PAD.left - 8} y={y(v) + 4} textAnchor="end">
              {format.number(v)}
            </text>
          </g>
        ))}
        {asLine ? (
          <>
            {areas.map((d, i) => (
              <path key={`a${i}`} className="gcs-serverChart__area" d={d} />
            ))}
            {segments.map((d, i) => (
              <path key={`l${i}`} className="gcs-serverChart__line" d={d} />
            ))}
            {current && current.avg !== null && (
              <>
                <line className="gcs-serverChart__cursor" x1={xCenter(active!)} x2={xCenter(active!)} y1={PAD.top} y2={baseline} />
                <circle className="gcs-serverChart__dot" cx={xCenter(active!)} cy={y(current.avg)} r={5} />
              </>
            )}
          </>
        ) : (
          buckets.map((b, i) =>
            b.avg === null || b.avg <= 0 ? null : (
              <path
                key={b.at}
                className={`gcs-serverChart__bar${i === n - 1 ? " gcs-serverChart__bar--now" : ""}${i === active ? " gcs-serverChart__bar--active" : ""}`}
                d={barPath(xCenter(i) - barW / 2, y(b.avg), barW, baseline - y(b.avg))}
              />
            ),
          )
        )}
        {!asLine && active !== null && <line className="gcs-serverChart__cursor" x1={xCenter(active)} x2={xCenter(active)} y1={baseline} y2={baseline + 4} />}
        {xTicks.map(({ i, text }) => (
          <text key={i} className="gcs-serverChart__tick" x={xCenter(i)} y={H - 6} textAnchor={i === n - 1 ? "end" : "middle"}>
            {text}
          </text>
        ))}
      </svg>
      {current && (
        <div className="gcs-serverChart__tip" style={{ left: `${Math.min(88, Math.max(12, tipLeft))}%` }} data-testid="gcs-server-chart-tip">
          <strong>{current.avg === null ? t("noData") : t("avg", { value: Math.round(current.avg * 10) / 10 })}</strong>
          {label(current.at, true)}
          {current.peak !== null && current.peak > 0 && ` · ${t("peak", { value: format.number(current.peak) })}`}
        </div>
      )}
      {/* Tabelul stă într-un `div` ascuns vizual: un `<table>` nu respectă înălțimea de 1 px și ar lungi pagina. */}
      <div className="gcs-srOnly">
        <table id={`${id}-table`}>
          <caption>{t("table")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("time")}</th>
              <th scope="col">{t("tableAvg")}</th>
              <th scope="col">{t("tablePeak")}</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.at}>
                <th scope="row">{label(b.at, true)}</th>
                <td>{value(b.avg) ?? t("noData")}</td>
                <td>{b.peak === null ? t("noData") : format.number(b.peak)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
