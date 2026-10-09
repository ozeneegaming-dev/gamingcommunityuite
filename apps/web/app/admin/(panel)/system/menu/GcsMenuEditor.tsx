"use client";

import { faArrowDown, faArrowUp, faFloppyDisk, faPlus, faTrash } from "@fortawesome/free-solid-svg-icons";
import type { GcsNavItemEdit, GcsNavItemInput, GcsNavLabel } from "@gcs/core";
import { GcsButton, GcsIconPicker, GcsIconSvg } from "@gcs/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useErrorMessage } from "@/lib/use-error-message";
import { saveMenu } from "../../appearance/actions";

type Item = {
  uid: string;
  /** Eticheta tradusă automat (cheia unui modul); textele scrise de admin au prioritate. */
  labelKey: string | null;
  texts: Record<string, string>;
  /** Descrierea din mega meniu, pe limbi (goală = cea implicită a itemilor automați). */
  descTexts: Record<string, string>;
  /** Insigna fixă din mega meniu („NOU”). */
  badge: string;
  icon: string | null;
  href: string;
  appKey: string | null;
  groups: number[];
  newTab: boolean;
  enabled: boolean;
  children: Item[];
};

export type GcsMenuEditorLabels = {
  add: string;
  addChild: string;
  label: string;
  autoLabel: string;
  href: string;
  icon: string;
  iconSearch: string;
  iconNone: string;
  iconNoResults: string;
  groups: string;
  groupsHint: string;
  newTab: string;
  enabled: string;
  up: string;
  down: string;
  remove: string;
  save: string;
  saved: string;
  newItem: string;
  mega: string;
  description: string;
  descriptionHint: string;
  badge: string;
  badgeHint: string;
};

let counter = 0;
const uid = () => `m${++counter}`;

function fromEdit(it: GcsNavItemEdit): Item {
  const label = it.label as Record<string, string>;
  const key = "key" in label ? label.key : null;
  return {
    uid: uid(),
    labelKey: key ?? null,
    texts: key ? {} : { ...label },
    descTexts: { ...((it.description ?? {}) as Record<string, string>) },
    badge: it.badge ?? "",
    icon: it.icon ?? null,
    href: it.href ?? "",
    appKey: it.appKey ?? null,
    groups: it.groups ?? [],
    newTab: it.newTab ?? false,
    enabled: it.enabled ?? true,
    children: it.children.map(fromEdit),
  };
}

function toInput(it: Item): GcsNavItemInput {
  const texts = Object.fromEntries(Object.entries(it.texts).filter(([, v]) => v.trim()));
  const label: GcsNavLabel = Object.keys(texts).length > 0 || !it.labelKey ? texts : { key: it.labelKey };
  const description = Object.fromEntries(Object.entries(it.descTexts).filter(([, v]) => v.trim()));
  return {
    label,
    description: Object.keys(description).length > 0 ? description : null,
    badge: it.badge.trim() || null,
    icon: it.icon,
    href: it.href.trim() || null,
    appKey: it.appKey,
    groups: it.groups,
    newTab: it.newTab,
    enabled: it.enabled,
    children: it.children.map(toInput),
  };
}

/**
 * Managerul meniului (specul etapei 5, ACP → Sistem → Manager meniu): itemii pe două niveluri, cu eticheta pe limbi
 * (sau cea automată a modulului), linkul, iconița, vizibilitatea pe grupuri, deschiderea în tab nou și ordinea.
 */
export function GcsMenuEditor({
  initial,
  locales,
  autoLabels,
  groups,
  labels,
}: {
  initial: GcsNavItemEdit[];
  locales: { code: string; label: string }[];
  autoLabels: Record<string, string>;
  groups: { id: number; name: string }[];
  labels: GcsMenuEditorLabels;
}) {
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [items, setItems] = useState<Item[]>(() => initial.map(fromEdit));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const blank = (): Item => ({ uid: uid(), labelKey: null, texts: { [locales[0]?.code ?? "ro"]: labels.newItem }, descTexts: {}, badge: "", icon: null, href: "/", appKey: null, groups: [], newTab: false, enabled: true, children: [] });

  /** Aplică `fn` pe lista care conține itemul `id` (rădăcina sau copiii unui item). */
  const update = (fn: (list: Item[], index: number) => Item[], id: string) =>
    setItems((root) => {
      const walk = (list: Item[]): Item[] => {
        const i = list.findIndex((x) => x.uid === id);
        if (i >= 0) return fn(list, i);
        return list.map((x) => ({ ...x, children: walk(x.children) }));
      };
      return walk(root);
    });
  const patch = (id: string, p: Partial<Item>) => update((list, i) => list.map((x, j) => (j === i ? { ...x, ...p } : x)), id);
  const move = (id: string, d: -1 | 1) =>
    update((list, i) => {
      const j = i + d;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    }, id);
  const remove = (id: string) => update((list, i) => list.filter((_, j) => j !== i), id);

  const save = () =>
    start(async () => {
      const res = await saveMenu(items.map(toInput));
      setStatus(res.ok ? { ok: true, text: labels.saved } : { ok: false, text: errorMessage(res.error) });
      if (res.ok) router.refresh();
    });

  const row = (it: Item, depth: number) => (
    <li key={it.uid} className="gcs-menuEditor__item" data-testid="gcs-menu-item">
      <div className="gcs-menuEditor__fields">
        <fieldset className="gcs-menuEditor__labels">
          <legend>{labels.label}</legend>
          {it.labelKey && <p className="gcs-muted" style={{ margin: 0, fontSize: 12 }}>{labels.autoLabel.replace("{label}", autoLabels[it.labelKey] ?? it.labelKey)}</p>}
          {locales.map((l) => (
            <label key={l.code} className="gcs-field">
              <span className="gcs-muted">{l.label}</span>
              <input className="gcs-input" value={it.texts[l.code] ?? ""} maxLength={40} onChange={(e) => patch(it.uid, { texts: { ...it.texts, [l.code]: e.target.value } })} />
            </label>
          ))}
        </fieldset>
        <div className="gcs-menuEditor__col">
          <label className="gcs-field">
            {labels.href}
            <input className="gcs-input" value={it.href} maxLength={500} onChange={(e) => patch(it.uid, { href: e.target.value })} />
          </label>
          <div className="gcs-field" role="group" aria-label={labels.icon}>
            <span>{labels.icon}</span>
            <GcsIconPicker name={`icon-${it.uid}`} value={it.icon} searchUrl="/api/icons/search" labels={{ search: labels.iconSearch, none: labels.iconNone, noResults: labels.iconNoResults }} onChange={(v) => patch(it.uid, { icon: v })} />
          </div>
          <label className="gcs-checkRow">
            <input type="checkbox" checked={it.newTab} onChange={(e) => patch(it.uid, { newTab: e.target.checked })} />
            {labels.newTab}
          </label>
          <label className="gcs-checkRow">
            <input type="checkbox" checked={it.enabled} onChange={(e) => patch(it.uid, { enabled: e.target.checked })} />
            {labels.enabled}
          </label>
        </div>
        {/* Mega meniul (designul Nova): o descriere de un rând sub titlu și o insignă fixă. */}
        <fieldset className="gcs-menuEditor__labels gcs-menuEditor__mega">
          <legend>{labels.mega}</legend>
          <p className="gcs-muted" style={{ margin: 0, fontSize: 12 }}>{labels.descriptionHint}</p>
          {locales.map((l) => (
            <label key={l.code} className="gcs-field">
              <span className="gcs-muted">
                {labels.description} ({l.label})
              </span>
              <input
                className="gcs-input"
                value={it.descTexts[l.code] ?? ""}
                maxLength={100}
                onChange={(e) => patch(it.uid, { descTexts: { ...it.descTexts, [l.code]: e.target.value } })}
                data-testid={`gcs-menu-desc-${l.code}`}
              />
            </label>
          ))}
          <label className="gcs-field">
            <span>{labels.badge}</span>
            <input className="gcs-input" value={it.badge} maxLength={12} placeholder={labels.badgeHint} onChange={(e) => patch(it.uid, { badge: e.target.value })} data-testid="gcs-menu-badge" />
          </label>
        </fieldset>
        <fieldset className="gcs-menuEditor__groups">
          <legend>{labels.groups}</legend>
          <p className="gcs-muted" style={{ margin: 0, fontSize: 12 }}>{labels.groupsHint}</p>
          {groups.map((g) => (
            <label key={g.id} className="gcs-check">
              <input
                type="checkbox"
                checked={it.groups.includes(g.id)}
                onChange={(e) => patch(it.uid, { groups: e.target.checked ? [...it.groups, g.id] : it.groups.filter((x) => x !== g.id) })}
              />
              {g.name}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="gcs-menuEditor__tools">
        <GcsButton variant="ghost" size="sm" onClick={() => move(it.uid, -1)} icon={<GcsIconSvg icon={faArrowUp} />}>
          {labels.up}
        </GcsButton>
        <GcsButton variant="ghost" size="sm" onClick={() => move(it.uid, 1)} icon={<GcsIconSvg icon={faArrowDown} />}>
          {labels.down}
        </GcsButton>
        {depth === 0 && (
          <GcsButton variant="ghost" size="sm" onClick={() => patch(it.uid, { children: [...it.children, blank()] })} icon={<GcsIconSvg icon={faPlus} />}>
            {labels.addChild}
          </GcsButton>
        )}
        <GcsButton variant="ghost" size="sm" onClick={() => remove(it.uid)} icon={<GcsIconSvg icon={faTrash} />}>
          {labels.remove}
        </GcsButton>
      </div>
      {it.children.length > 0 && <ul className="gcs-menuEditor__list gcs-menuEditor__list--children">{it.children.map((c) => row(c, depth + 1))}</ul>}
    </li>
  );

  return (
    <div className="gcs-menuEditor" data-testid="gcs-menu-editor">
      <ul className="gcs-menuEditor__list">{items.map((it) => row(it, 0))}</ul>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <GcsButton variant="ghost" onClick={() => setItems((list) => [...list, blank()])} icon={<GcsIconSvg icon={faPlus} />}>
          {labels.add}
        </GcsButton>
        <GcsButton variant="primary" onClick={save} disabled={pending} data-testid="gcs-menu-save" icon={<GcsIconSvg icon={faFloppyDisk} />}>
          {labels.save}
        </GcsButton>
        {status && (
          <span role={status.ok ? "status" : "alert"} className={status.ok ? "gcs-muted" : "gcs-field__error"}>
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}
