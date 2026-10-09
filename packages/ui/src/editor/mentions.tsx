"use client";

import type { MentionNodeAttrs, MentionOptions } from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import { forwardRef, useEffect, useImperativeHandle, useState, type CSSProperties } from "react";
import { GcsAvatar } from "../components/GcsAvatar";
import { GcsClanTag, type GcsClanTagData } from "../components/GcsClanTag";

/** Datele SVG ale unei iconițe Font Awesome (rezolvată pe server), ca lista să n-aibă nevoie de registrul de iconițe. */
export type GcsMentionIcon = { width: number; height: number; path: string };

/** O sugestie: un membru (avatar, nume stilizat, online, tagul clanului) sau un grup (iconița și culoarea grupului). */
export type GcsMentionItem =
  | { kind: "user"; id: string; label: string; image: string | null; nameKey: string | null; online: boolean; clan: GcsClanTagData | null }
  | { kind: "group"; id: string; label: string; color: string | null; icon: GcsMentionIcon | null };

/** Ce intră în nodul `mention` (Tiptap ignoră restul): id-ul, eticheta și tipul. */
export type GcsMentionAttrs = { id: string; label: string; kind: "user" | "group" };

export type GcsMentionLabels = { empty: string; group: string; online: string };

type ListProps = { items: GcsMentionItem[]; command: (attrs: GcsMentionAttrs) => void; labels: GcsMentionLabels };
type ListHandle = { onKeyDown: (event: KeyboardEvent) => boolean };

/** Răspunsul `/api/forums/mentions?groups=1` (membrii au și câmpuri pe care lista nu le folosește). */
type ApiResponse = {
  users?: { id: string; name: string; image?: string | null; nameKey?: string | null; online?: boolean; clan?: GcsClanTagData | null }[];
  groups?: { id: number; name: string; color?: string | null; icon?: GcsMentionIcon | null }[];
};

const LABEL_MAX = 40;
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** Răspunsul serverului → sugestiile listei: grupurile primele, apoi membrii. */
export function mentionItems(data: ApiResponse): GcsMentionItem[] {
  const groups: GcsMentionItem[] = (data.groups ?? []).map((g) => ({
    kind: "group",
    id: String(g.id),
    label: g.name.slice(0, LABEL_MAX),
    color: g.color && HEX.test(g.color) ? g.color : null,
    icon: g.icon ?? null,
  }));
  const users: GcsMentionItem[] = (data.users ?? []).map((u) => ({
    kind: "user",
    id: u.id,
    label: u.name,
    image: u.image ?? null,
    nameKey: u.nameKey ?? null,
    online: u.online === true,
    clan: u.clan ?? null,
  }));
  return [...groups, ...users];
}

const attrsOf = (item: GcsMentionItem): GcsMentionAttrs => ({ id: item.id, label: item.label, kind: item.kind });

function GroupIcon({ icon }: { icon: GcsMentionIcon | null }) {
  // Fără iconiță aleasă: un simbol generic de grup (trei siluete), desenat din CSS.
  if (!icon) return <span className="gcs-mentionList__groupIcon gcs-mentionList__groupIcon--default" aria-hidden="true" />;
  return (
    <span className="gcs-mentionList__groupIcon" aria-hidden="true">
      <svg viewBox={`0 0 ${icon.width} ${icon.height}`} focusable="false">
        <path fill="currentColor" d={icon.path} />
      </svg>
    </span>
  );
}

/** Lista de sugestii pentru @mențiuni (navigabilă din tastatură: săgeți, Enter / Tab, Escape). */
export const GcsMentionList = forwardRef<ListHandle, ListProps>(function GcsMentionList({ items, command, labels }, ref) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") setActive((i) => (i + 1) % items.length);
      else if (event.key === "ArrowUp") setActive((i) => (i - 1 + items.length) % items.length);
      else if (event.key === "Enter" || event.key === "Tab") command(attrsOf(items[active]!));
      else return false;
      return true;
    },
  }));

  return (
    <ul className="gcs-mentionList" role="listbox">
      {items.length === 0 ? (
        <li className="gcs-mentionList__empty">{labels.empty}</li>
      ) : (
        items.map((item, i) => (
          <li key={`${item.kind}:${item.id}`} role="option" aria-selected={i === active} data-kind={item.kind}>
            <button
              type="button"
              className="gcs-mentionList__item"
              onMouseDown={(e) => (e.preventDefault(), command(attrsOf(item)))}
              onMouseEnter={() => setActive(i)}
            >
              {item.kind === "group" ? (
                <>
                  <span className="gcs-mentionList__group" style={item.color ? ({ "--gcs-gm-color": item.color } as CSSProperties) : undefined}>
                    <GroupIcon icon={item.icon} />
                    <span className="gcs-mentionList__name">@{item.label}</span>
                  </span>
                  <span className="gcs-mentionList__hint">{labels.group}</span>
                </>
              ) : (
                <>
                  <span className="gcs-mentionList__avatar">
                    <GcsAvatar name={item.label} size="s" {...(item.image ? { src: item.image } : {})} />
                    {item.online && <span className="gcs-mentionList__online" role="img" aria-label={labels.online} title={labels.online} />}
                  </span>
                  <span className={`gcs-mentionList__name${item.nameKey ? ` gcs-name--${item.nameKey}` : ""}`}>@{item.label}</span>
                  {item.clan && <GcsClanTag clan={item.clan} size="sm" plain className="gcs-mentionList__clan" />}
                </>
              )}
            </button>
          </li>
        ))
      )}
    </ul>
  );
});

/**
 * Configurația sugestiilor: caută la `url?q=…&groups=1` (cu o mică întârziere) membrii și grupurile pe care autorul
 * le poate menționa, și afișează lista lângă cursor. Serverul verifică din nou, la salvare, fiecare mențiune de grup.
 */
export function gcsMentionSuggestion(url: string, labels: GcsMentionLabels): Partial<MentionOptions>["suggestion"] {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    items: ({ query }) =>
      new Promise<GcsMentionItem[]>((resolve) => {
        clearTimeout(timer);
        if (query.length < 1) return resolve([]);
        timer = setTimeout(async () => {
          try {
            const res = await fetch(`${url}?q=${encodeURIComponent(query)}&groups=1`, { credentials: "same-origin" });
            resolve(mentionItems((await res.json()) as ApiResponse));
          } catch {
            resolve([]);
          }
        }, 200);
      }),
    render: () => {
      let renderer: ReactRenderer<ListHandle, ListProps> | undefined;
      let popup: HTMLDivElement | undefined;
      const place = (rect: DOMRect | null | undefined) => {
        if (!popup || !rect) return;
        popup.style.left = `${rect.left + window.scrollX}px`;
        popup.style.top = `${rect.bottom + window.scrollY + 4}px`;
      };
      // Sugestia dă `command(props)`; lista trimite doar atributele nodului (cu `kind`, adăugat de `GcsMention`).
      const commandOf = (command: (props: MentionNodeAttrs) => void) => (attrs: GcsMentionAttrs) => command(attrs);
      return {
        onStart: (props) => {
          renderer = new ReactRenderer(GcsMentionList, { props: { items: props.items as GcsMentionItem[], command: commandOf(props.command), labels }, editor: props.editor });
          popup = document.createElement("div");
          popup.className = "gcs-mentionPopup";
          popup.appendChild(renderer.element);
          document.body.appendChild(popup);
          place(props.clientRect?.());
        },
        onUpdate: (props) => {
          renderer?.updateProps({ items: props.items as GcsMentionItem[], command: commandOf(props.command), labels });
          place(props.clientRect?.());
        },
        onKeyDown: (props) => {
          if (props.event.key === "Escape") {
            popup?.remove();
            return true;
          }
          return renderer?.ref?.onKeyDown(props.event) ?? false;
        },
        onExit: () => {
          popup?.remove();
          renderer?.destroy();
        },
      };
    },
  };
}
