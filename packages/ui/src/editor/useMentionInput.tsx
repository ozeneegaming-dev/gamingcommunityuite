"use client";

import { mentionIndex, mentionQueryAt, type GcsMentionHint } from "@gcs/core/text-mentions";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { GcsMentionList, mentionItems, type GcsMentionAttrs, type GcsMentionItem, type GcsMentionLabels, type GcsMentionListHandle } from "./mentionList";

export type GcsMentionInputOptions = {
  /** Textul câmpului și funcția care îl schimbă (câmpul rămâne controlat de componenta lui). */
  value: string;
  onValue: (next: string) => void;
  labels: GcsMentionLabels;
  /** Adresa sugestiilor (aceeași ca în editorul postărilor). */
  url?: string;
  /** Fără sugestii (ex. vizitatorii sau un câmp dezactivat). */
  enabled?: boolean;
  /** Unde apare lista: deasupra câmpului (chat-ul, câmpul jos în pagină) sau dedesubt. */
  placement?: "above" | "below";
  maxLength?: number;
};

type State = { start: number; end: number; query: string; items: GcsMentionItem[] };

/**
 * Sugestiile de @mențiuni pentru câmpurile simple (`<input>`, `<textarea>`): aceeași listă ca în editorul postărilor
 * (membri cu avatar și nume stilizat, grupurile pe care autorul le poate menționa), din tastatură (↑ ↓, Enter / Tab,
 * Escape) sau cu click. Alegerea scrie `@Nume ` în text și ține minte id-ul: `hints()` dă serverului sugestiile alese
 * care sunt încă în text, iar serverul hotărăște mențiunile (după id). Folosire: `ref` pe câmp, `onText(value, caret)`
 * la fiecare schimbare, `onKeyDown` înaintea tastelor proprii ale câmpului și `popup` lângă câmp (într-un container
 * `gcs-mentionAnchor`).
 */
export function useMentionInput<T extends HTMLInputElement | HTMLTextAreaElement>(opts: GcsMentionInputOptions) {
  const { value, onValue, labels, url = "/api/forums/mentions", enabled = true, placement = "below", maxLength } = opts;
  const ref = useRef<T>(null);
  const list = useRef<GcsMentionListHandle>(null);
  const [state, setState] = useState<State | null>(null);
  const picked = useRef(new Map<string, GcsMentionAttrs>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cache = useRef(new Map<string, GcsMentionItem[]>());
  const seq = useRef(0);
  const id = useId();

  useEffect(() => () => clearTimeout(timer.current), []);

  const onText = useCallback(
    (text: string, caret: number) => {
      const q = enabled ? mentionQueryAt(text, caret) : null;
      clearTimeout(timer.current);
      if (!q || q.query.length < 1) {
        setState(null);
        return;
      }
      const known = cache.current.get(q.query.toLowerCase());
      setState((prev) => ({ start: q.start, end: caret, query: q.query, items: known ?? prev?.items ?? [] }));
      if (known) return;
      const mine = ++seq.current;
      timer.current = setTimeout(async () => {
        try {
          const res = await fetch(`${url}?q=${encodeURIComponent(q.query)}&groups=1`, { credentials: "same-origin" });
          const items = mentionItems((await res.json()) as Parameters<typeof mentionItems>[0]);
          cache.current.set(q.query.toLowerCase(), items);
          if (mine === seq.current) setState((prev) => (prev && prev.query === q.query ? { ...prev, items } : prev));
        } catch {
          if (mine === seq.current) setState(null);
        }
      }, 180);
    },
    [enabled, url],
  );

  const choose = useCallback(
    (attrs: GcsMentionAttrs) => {
      if (!state) return;
      const insert = `@${attrs.label} `;
      let next = value.slice(0, state.start) + insert + value.slice(state.end);
      if (maxLength && next.length > maxLength) next = next.slice(0, maxLength);
      picked.current.set(`${attrs.kind}:${attrs.id}`, attrs);
      onValue(next);
      setState(null);
      const pos = Math.min(state.start + insert.length, next.length);
      requestAnimationFrame(() => {
        ref.current?.focus();
        ref.current?.setSelectionRange(pos, pos);
      });
    },
    [state, value, onValue, maxLength],
  );

  /** Tastele listei; `true` = tasta a fost folosită de listă (câmpul n-o mai tratează, ex. Enter nu trimite). */
  const onKeyDown = useCallback(
    (e: KeyboardEvent<T>): boolean => {
      if (!state || state.items.length === 0) return false;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setState(null);
        return true;
      }
      if (list.current?.onKeyDown(e.nativeEvent)) {
        e.preventDefault();
        return true;
      }
      return false;
    },
    [state],
  );

  /** Sugestiile alese care sunt încă în text (`@Nume` întreg), cu eticheta (ex. nodurile `mention` ale unui document). */
  const picks = useCallback((): GcsMentionAttrs[] => [...picked.current.values()].filter((a) => mentionIndex(value, a.label) !== -1), [value]);

  /** Sugestiile alese care sunt încă în text, pentru server (doar tipul și id-ul). */
  const hints = useCallback((): GcsMentionHint[] => picks().map((a) => ({ kind: a.kind, id: a.id })), [picks]);

  /** După trimitere: lista aleasă se golește. */
  const reset = useCallback(() => {
    picked.current.clear();
    setState(null);
  }, []);

  const open = state !== null && state.items.length > 0;
  const popup: ReactNode = open ? (
    <div id={id} className={`gcs-mentionPopup gcs-mentionPopup--inline gcs-mentionPopup--${placement}`} data-testid="gcs-mention-popup">
      <GcsMentionList ref={list} items={state.items} command={choose} labels={labels} />
    </div>
  ) : null;

  return {
    ref,
    popup,
    open,
    onText,
    onKeyDown,
    onBlur: () => setState(null),
    hints,
    picks,
    reset,
    /** Atributele ARIA ale câmpului cât lista e deschisă. */
    aria: open ? { "aria-controls": id, "aria-expanded": true, "aria-autocomplete": "list" as const } : {},
  };
}
