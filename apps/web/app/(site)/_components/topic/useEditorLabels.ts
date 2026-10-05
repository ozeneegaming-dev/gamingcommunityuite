"use client";

import type { GcsEditorLabels } from "@gcs/ui/editor";
import { useTranslations } from "next-intl";

const KEYS = [
  "toolbar",
  "bold",
  "italic",
  "underline",
  "quote",
  "code",
  "spoiler",
  "mention",
  "image",
  "video",
  "videoUrl",
  "insert",
  "cancel",
  "invalidVideo",
  "placeholder",
  "uploading",
  "uploadFailed",
  "noMentions",
] as const satisfies readonly (keyof GcsEditorLabels)[];

/** Textele editorului, traduse (`topic.editor.*`). */
export function useEditorLabels(): GcsEditorLabels {
  const t = useTranslations("topic.editor");
  return Object.fromEntries(KEYS.map((k) => [k, t(k)])) as GcsEditorLabels;
}

/** Evenimentul prin care butonul „Citează” al unei postări trimite citatul către caseta de răspuns. */
export const QUOTE_EVENT = "gcs:quote";
export type GcsQuoteDetail = { postId: number; authorId: string | null; authorName: string; text: string };
