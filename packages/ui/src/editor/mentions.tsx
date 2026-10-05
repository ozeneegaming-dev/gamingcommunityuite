"use client";

import type { MentionOptions } from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

export type GcsMentionItem = { id: string; label: string };
type ListProps = { items: GcsMentionItem[]; command: (item: GcsMentionItem) => void; empty: string };
type ListHandle = { onKeyDown: (event: KeyboardEvent) => boolean };

/** Lista de sugestii pentru @mențiuni (navigabilă din tastatură). */
const GcsMentionList = forwardRef<ListHandle, ListProps>(function GcsMentionList({ items, command, empty }, ref) {
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") setActive((i) => (i + 1) % items.length);
      else if (event.key === "ArrowUp") setActive((i) => (i - 1 + items.length) % items.length);
      else if (event.key === "Enter" || event.key === "Tab") command(items[active]!);
      else return false;
      return true;
    },
  }));

  return (
    <ul className="gcs-mentionList" role="listbox">
      {items.length === 0 ? (
        <li className="gcs-mentionList__empty">{empty}</li>
      ) : (
        items.map((item, i) => (
          <li key={item.id} role="option" aria-selected={i === active}>
            <button type="button" className="gcs-mentionList__item" onMouseDown={(e) => (e.preventDefault(), command(item))}>
              @{item.label}
            </button>
          </li>
        ))
      )}
    </ul>
  );
});

/** Configurația sugestiilor: caută userii la `url?q=` (cu o mică întârziere) și afișează lista lângă cursor. */
export function gcsMentionSuggestion(url: string, empty: string): Partial<MentionOptions>["suggestion"] {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    items: ({ query }) =>
      new Promise<GcsMentionItem[]>((resolve) => {
        clearTimeout(timer);
        if (query.length < 2) return resolve([]);
        timer = setTimeout(async () => {
          try {
            const res = await fetch(`${url}?q=${encodeURIComponent(query)}`, { credentials: "same-origin" });
            const data = (await res.json()) as { users?: { id: string; name: string }[] };
            resolve((data.users ?? []).map((u) => ({ id: u.id, label: u.name })));
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
      return {
        onStart: (props) => {
          renderer = new ReactRenderer(GcsMentionList, { props: { items: props.items, command: props.command, empty }, editor: props.editor });
          popup = document.createElement("div");
          popup.className = "gcs-mentionPopup";
          popup.appendChild(renderer.element);
          document.body.appendChild(popup);
          place(props.clientRect?.());
        },
        onUpdate: (props) => {
          renderer?.updateProps({ items: props.items, command: props.command, empty });
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
