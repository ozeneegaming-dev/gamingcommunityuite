"use client";

import type { GcsNameStyle } from "@gcs/core";
import { GcsButton } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { useErrorMessage } from "../../_components/GcsActionForm";
import { updateGroupStyle } from "../actions";

type Props = {
  groupId: number;
  name: string;
  initial: GcsNameStyle;
  fallbackColor: string;
  labels: {
    color: string;
    useGradient: string;
    gradientColor: [string, string, string];
    animated: string;
    glow: string;
    bold: string;
    italic: string;
    icon: string;
    preview: string;
    save: string;
    saved: string;
  };
};

/** Previzualizarea folosește aceleași reguli ca `compileNameStylesCss` (gradient repetat, glow 0.55). */
function previewStyle(s: { color: string; gradient: string[] | null; animated: boolean; glow: string | null; bold: boolean; italic: boolean }): CSSProperties {
  const style: CSSProperties = { fontSize: 22, fontWeight: s.bold ? 700 : 600, fontStyle: s.italic ? "italic" : "normal" };
  if (s.gradient) {
    Object.assign(style, {
      background: `linear-gradient(90deg,${[...s.gradient, s.gradient[0]].join(",")})`,
      backgroundSize: "200% auto",
      WebkitBackgroundClip: "text",
      backgroundClip: "text",
      color: "transparent",
      animation: s.animated ? "gcsShimmer 3s linear infinite" : undefined,
    });
  } else {
    style.color = s.color;
  }
  if (s.glow) {
    const n = Number.parseInt(s.glow.slice(1), 16);
    style.textShadow = `0 0 10px rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},.55)`;
  }
  return style;
}

/** Editorul stilului de nume (spec §9), cu previzualizare live. */
export function NameStyleEditor({ groupId, name, initial, fallbackColor, labels }: Props) {
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [color, setColor] = useState(initial.color ?? fallbackColor);
  const [useGradient, setUseGradient] = useState((initial.gradient?.length ?? 0) >= 2);
  const [gradient, setGradient] = useState<string[]>(() => {
    const g = initial.gradient ?? [];
    return [g[0] ?? "#F4B740", g[1] ?? "#FFF0B8", g[2] ?? "#E8961C"];
  });
  const [animated, setAnimated] = useState(initial.animated ?? false);
  const [glow, setGlow] = useState(Boolean(initial.glow));
  const [bold, setBold] = useState(initial.bold ?? false);
  const [italic, setItalic] = useState(initial.italic ?? false);
  const [icon, setIcon] = useState(initial.icon ?? "");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  const style = {
    color,
    gradient: useGradient ? gradient : null,
    animated,
    glow: glow ? (useGradient ? gradient[0]! : color) : null,
    bold,
    italic,
  };

  async function save() {
    setPending(true);
    setStatus(null);
    const payload: GcsNameStyle = { color, bold, italic };
    if (useGradient) {
      payload.gradient = gradient;
      payload.animated = animated;
    }
    if (style.glow) payload.glow = style.glow;
    if (icon.trim()) payload.icon = icon.trim();
    const result = await updateGroupStyle(groupId, payload);
    setPending(false);
    if (!result.ok) return setStatus({ ok: false, text: errorMessage(result.error) });
    setStatus({ ok: true, text: labels.saved });
    router.refresh();
  }

  const check = (label: string, value: boolean, set: (v: boolean) => void) => (
    <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 36, fontSize: 14 }}>
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--gcs-accent)" }} />
      {label}
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        aria-label={labels.preview}
        role="img"
        style={{ padding: "18px 16px", borderRadius: 12, background: "var(--gcs-surface2)", border: "1px solid var(--gcs-border)" }}
      >
        <span className="gcs-display" style={previewStyle(style)}>
          {icon.trim() ? `${icon.trim()} ` : ""}
          {name}
        </span>
      </div>
      <label className="gcs-field">
        {labels.color}
        <input type="color" value={color.toLowerCase()} onChange={(e) => setColor(e.target.value.toUpperCase())} style={{ width: 64, height: 40, border: 0, background: "transparent" }} />
      </label>
      {check(labels.useGradient, useGradient, setUseGradient)}
      {useGradient && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {gradient.map((c, i) => (
            <label key={i} className="gcs-field">
              {labels.gradientColor[i]}
              <input
                type="color"
                value={c.toLowerCase()}
                onChange={(e) => setGradient((g) => g.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))}
                style={{ width: 64, height: 40, border: 0, background: "transparent" }}
              />
            </label>
          ))}
          {check(labels.animated, animated, setAnimated)}
        </div>
      )}
      {check(labels.glow, glow, setGlow)}
      {check(labels.bold, bold, setBold)}
      {check(labels.italic, italic, setItalic)}
      <label className="gcs-field">
        {labels.icon}
        <input className="gcs-input" value={icon} maxLength={4} onChange={(e) => setIcon(e.target.value)} style={{ maxWidth: 120 }} />
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <GcsButton variant="primary" onClick={save} disabled={pending}>
          {labels.save}
        </GcsButton>
        {status && (
          <span role={status.ok ? "status" : "alert"} style={{ fontSize: 13, fontWeight: 600, color: status.ok ? "var(--gcs-ok)" : "#FF8A91" }}>
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}
