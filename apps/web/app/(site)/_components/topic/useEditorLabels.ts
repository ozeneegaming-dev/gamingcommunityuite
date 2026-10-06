"use client";

import type { GcsEditorLabels } from "@gcs/ui/editor";
import { useTranslations } from "next-intl";

const KEYS = [
  "toolbar",
  "bold",
  "italic",
  "underline",
  "strike",
  "superscript",
  "subscript",
  "alignLeft",
  "alignCenter",
  "alignRight",
  "alignJustify",
  "fontSize",
  "sizeDefault",
  "color",
  "colorCustom",
  "highlight",
  "removeColor",
  "clearFormatting",
  "bulletList",
  "orderedList",
  "horizontalRule",
  "link",
  "linkUrl",
  "removeLink",
  "emoji",
  "emojiSmileys",
  "emojiPeople",
  "emojiGaming",
  "emojiSymbols",
  "fullscreen",
  "exitFullscreen",
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
  // `characters` / `charactersMax` au parametri ({count}, {max}): îl luăm brut, editorul îi înlocuiește.
  return { ...Object.fromEntries(KEYS.map((k) => [k, t(k)])), characters: t.raw("characters") as string, charactersMax: t.raw("charactersMax") as string } as GcsEditorLabels;
}

/** Evenimentul prin care butonul „Citează” al unei postări trimite citatul către caseta de răspuns. */
export const QUOTE_EVENT = "gcs:quote";
export type GcsQuoteDetail = { postId: number; authorId: string | null; authorName: string; text: string };
