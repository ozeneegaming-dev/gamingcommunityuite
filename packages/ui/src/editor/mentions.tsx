"use client";

import type { MentionNodeAttrs, MentionOptions } from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import { GcsMentionList, mentionItems, type GcsMentionAttrs, type GcsMentionItem, type GcsMentionLabels, type GcsMentionListHandle } from "./mentionList";

export { GcsMentionList, mentionItems, type GcsMentionAttrs, type GcsMentionIcon, type GcsMentionItem, type GcsMentionLabels, type GcsMentionListHandle } from "./mentionList";

type ListHandle = GcsMentionListHandle;
type ListProps = { items: GcsMentionItem[]; command: (attrs: GcsMentionAttrs) => void; labels: GcsMentionLabels };
type ApiResponse = Parameters<typeof mentionItems>[0];

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
