"use client";

import type { GcsBlockLabels, GcsEditorLabels } from "@gcs/ui/editor";
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
  "imageUrl",
  "invalidImage",
  "video",
  "videoUrl",
  "insert",
  "cancel",
  "invalidVideo",
  "placeholder",
  "uploading",
  "uploadFailed",
  "noMentions",
  "mentionGroup",
  "mentionOnline",
] as const satisfies readonly (keyof GcsEditorLabels)[];

// Toate textele editorului trebuie traduse: o cheie lipsă din listă ar da `undefined` (ex. eticheta unui câmp).
type Missing = Exclude<keyof GcsEditorLabels, (typeof KEYS)[number] | "characters" | "charactersMax">;
const ALL_KEYS: [Missing] extends [never] ? true : Missing = true;
void ALL_KEYS;

/** Textele editorului, traduse (`topic.editor.*`). */
export function useEditorLabels(): GcsEditorLabels {
  const t = useTranslations("topic.editor");
  // `characters` / `charactersMax` au parametri ({count}, {max}): îl luăm brut, editorul îi înlocuiește.
  return { ...Object.fromEntries(KEYS.map((k) => [k, t(k)])), characters: t.raw("characters") as string, charactersMax: t.raw("charactersMax") as string } as GcsEditorLabels;
}

/** Forum v2: textele blocurilor editorului (`topic.editor.blocks.*`, aplatizate: `type.section`, `field.title`…). */
export function useBlockLabels(): GcsBlockLabels {
  const t = useTranslations("topic.editor");
  const raw = t.raw("blocks") as Record<string, unknown>;
  const out: GcsBlockLabels = {};
  const walk = (node: unknown, prefix: string) => {
    if (typeof node === "string") out[prefix] = node;
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) walk(v, prefix ? `${prefix}.${k}` : k);
  };
  walk(raw, "");
  return out;
}

/** Evenimentul prin care butonul „Citează” al unei postări trimite citatul către caseta de răspuns. */
export const QUOTE_EVENT = "gcs:quote";
export type GcsQuoteDetail = { postId: number; authorId: string | null; authorName: string; text: string };
