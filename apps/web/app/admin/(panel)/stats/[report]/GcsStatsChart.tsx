"use client";

import { useState, type PointerEvent } from "react";

type Series = { key: string; label: string };

type Props = {
  /** Etichetele intervalelor (deja formatate), cea mai veche prima. */
  buckets: string[];
  series: Series[];
  /** `values[i][s]` = valoarea seriei `s` în intervalul `i`. */
  values: number[][];
  locale: string;
  title: string;
};

const W = 760;
const H = 280;
const PAD = { top: 16, right: 16, bottom: 32, left: 44 };
const CW = W - PAD.left - PAD.right;
const CH = H - PAD.top - PAD.bottom;

function niceMax(max: number): number {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

/**
 * Graficul rapoartelor din Statistici (SVG): linii (sau coloane, la puține intervale) pentru până la trei serii, fiecare
 * pe scara ei relativă la maximul comun, legendă cu comutatoare, linie de urmărire cu tooltip la hover / focus (săgețile
 * mută intervalul) și tabelul datelor pentru cititoarele de ecran.
 */
export function GcsStatsChart({ buckets, series, values, locale, title }: Props) {
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  const [kind, setKind] = useState<"line" | "bar">(buckets.length <= 14 ? "bar" : "line");
  const n = buckets.length;
  const visible = series.map((_, s) => s).filter((s) => !hidden.has(s));
  const max = niceMax(Math.max(1, ...values.flatMap((row) => visible.map((s) => row[s] ?? 0))));
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const x = (i: number) => PAD.left + (n <= 1 ? CW / 2 : (i * CW) / (n - 1));
  const slot = CW / Math.max(1, n);
  const xb = (i: number) => PAD.left + slot * i;
  const y = (v: number) => PAD.top + CH - (v / max) * CH;
  const baseline = PAD.top + CH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const step = Math.max(1, Math.ceil(n / 7));

  const line = (s: number) =>
    values
      .map((row, i) => {
        const v = row[s] ?? 0;
        if (i === 0) return `M${x(0).toFixed(1)},${y(v).toFixed(1)}`;
        const xm = ((x(i - 1) + x(i)) / 2).toFixed(1);
        return `C${xm},${y(values[i - 1]![s] ?? 0).toFixed(1)} ${xm},${y(v).toFixed(1)} ${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      })
      .join(" ");

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = kind === "bar" ? Math.floor((px - PAD.left) / slot) : Math.round(((px - PAD.left) / CW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  }
  const hx = hover === null ? 0 : kind === "bar" ? xb(hover) + slot / 2 : x(hover);

  return (
    <figure className="gcs-statsChart" data-testid="gcs-stats-chart">
      <div className="gcs-statsChart__bar">
        <ul className="gcs-statsChart__legend">
          {series.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                className={`gcs-statsChart__key gcs-statsChart__key--${i + 1}`}
                aria-pressed={!hidden.has(i)}
                onClick={() =>
                  setHidden((h) => {
                    const next = new Set(h);
                    if (next.has(i)) next.delete(i);
                    else if (visible.length > 1) next.add(i);
                    return next;
                  })
                }
              >
                <span aria-hidden="true" />
                {s.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="gcs-segLinks gcs-statsChart__kind" role="group" aria-label={title}>
          {(["line", "bar"] as const).map((k) => (
            <button key={k} type="button" className={`gcs-segLink${kind === k ? " gcs-segLink--active" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === "line" ? "∿" : "▮▮"}
            </button>
          ))}
        </div>
      </div>
      <div className="gcs-statsChart__plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={title}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover((h) => h ?? n - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? n) - 1));
            if (e.key === "ArrowRight") setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="gcs-statsChart__grid" />
              <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="gcs-statsChart__tick">
                {fmt.format(t)}
              </text>
            </g>
          ))}
          {buckets.map((b, i) =>
            i % step === 0 || i === n - 1 ? (
              <text key={b} x={kind === "bar" ? xb(i) + slot / 2 : x(i)} y={H - 10} textAnchor="middle" className="gcs-statsChart__tick">
                {b}
              </text>
            ) : null,
          )}
          {kind === "line"
            ? visible.map((s) => <path key={s} d={line(s)} className={`gcs-statsChart__line gcs-statsChart__line--${s + 1}`} />)
            : values.map((row, i) => {
                const w = Math.max(2, (slot - 6) / Math.max(1, visible.length));
                return visible.map((s, j) => {
                  const v = row[s] ?? 0;
                  return <rect key={`${i}-${s}`} x={xb(i) + 3 + j * w} y={y(v)} width={w - 1} height={Math.max(0, baseline - y(v))} rx={2} className={`gcs-statsChart__col gcs-statsChart__col--${s + 1}`} />;
                });
              })}
          {hover !== null && <line x1={hx} x2={hx} y1={PAD.top} y2={baseline} className="gcs-statsChart__cursor" />}
        </svg>
        {hover !== null && (
          <div className={`gcs-statsChart__tip${hover > n * 0.6 ? " gcs-statsChart__tip--flip" : ""}`} style={{ left: `${(hx / W) * 100}%` }} role="status">
            <strong>{buckets[hover]}</strong>
            {visible.map((s) => (
              <span key={s} className={`gcs-statsChart__tipRow gcs-statsChart__tipRow--${s + 1}`}>
                {series[s]!.label}: {fmt.format(values[hover]?.[s] ?? 0)}
              </span>
            ))}
          </div>
        )}
      </div>
      <table className="gcs-srOnly">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">—</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((b, i) => (
            <tr key={b}>
              <th scope="row">{b}</th>
              {series.map((s, j) => (
                <td key={s.key}>{fmt.format(values[i]?.[j] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
