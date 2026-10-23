"use client";

import { faQuoteLeft, faXmark } from "@fortawesome/free-solid-svg-icons";
import { GcsButton, GcsIconSvg } from "@gcs/ui";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { QUOTE_EVENT, type GcsQuoteDetail } from "./useEditorLabels";

/**
 * MultiQuote (Forum v2): „+ Citat” pe fiecare postare adaugă citatul într-o listă (în sesiunea browserului, pe topic);
 * bara „Citează N postări” le pune pe toate în caseta de răspuns, în ordinea postărilor.
 */
const EVENT = "gcs:multiquote";
const key = (topicId: number) => `gcs-mq:${topicId}`;

function read(topicId: number): GcsQuoteDetail[] {
  try {
    const raw = window.sessionStorage.getItem(key(topicId));
    return raw ? (JSON.parse(raw) as GcsQuoteDetail[]) : [];
  } catch {
    return [];
  }
}

function write(topicId: number, list: GcsQuoteDetail[]): void {
  try {
    if (list.length === 0) window.sessionStorage.removeItem(key(topicId));
    else window.sessionStorage.setItem(key(topicId), JSON.stringify(list));
  } catch {
    // Fără sessionStorage: lista trăiește doar până la următoarea pagină.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: topicId }));
}

function useQuotes(topicId: number): GcsQuoteDetail[] {
  const [list, setList] = useState<GcsQuoteDetail[]>([]);
  useEffect(() => {
    setList(read(topicId));
    const on = (e: Event) => {
      if ((e as CustomEvent<number>).detail === topicId) setList(read(topicId));
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [topicId]);
  return list;
}

/** Butonul „+ Citat” al unei postări (comută postarea în lista de citate). */
export function GcsMultiQuoteToggle({ topicId, quote }: { topicId: number; quote: () => GcsQuoteDetail }) {
  const t = useTranslations("topic.multiQuote");
  const list = useQuotes(topicId);
  const detail = quote();
  const on = list.some((q) => q.postId === detail.postId);
  return (
    <GcsButton
      variant="ghost"
      size="sm"
      className="gcs-post__action"
      aria-pressed={on}
      icon={<GcsIconSvg icon={faQuoteLeft} />}
      onClick={() => write(topicId, on ? list.filter((q) => q.postId !== detail.postId) : [...list, quote()].sort((a, b) => a.postId - b.postId))}
      data-testid="gcs-multiquote-toggle"
    >
      {on ? t("remove") : t("add")}
    </GcsButton>
  );
}

/** Bara fixă cu citatele adunate: „Citează N postări” (în caseta de răspuns) sau golirea listei. */
export function GcsMultiQuoteBar({ topicId }: { topicId: number }) {
  const t = useTranslations("topic.multiQuote");
  const list = useQuotes(topicId);
  if (list.length === 0) return null;
  return (
    <div className="gcs-multiQuote" role="region" aria-label={t("label")} data-testid="gcs-multiquote-bar">
      <GcsButton
        variant="primary"
        size="sm"
        icon={<GcsIconSvg icon={faQuoteLeft} />}
        onClick={() => {
          for (const q of list) window.dispatchEvent(new CustomEvent(QUOTE_EVENT, { detail: q }));
          write(topicId, []);
        }}
        data-testid="gcs-multiquote-insert"
      >
        {t("insert", { count: list.length })}
      </GcsButton>
      <button type="button" className="gcs-iconBtn" aria-label={t("clear")} onClick={() => write(topicId, [])}>
        <GcsIconSvg icon={faXmark} />
      </button>
    </div>
  );
}
