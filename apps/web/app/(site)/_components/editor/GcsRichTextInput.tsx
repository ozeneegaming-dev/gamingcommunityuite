"use client";

import { plainTextToDoc } from "@gcs/core/rich-fields";
import { GcsEditor, type GcsEditorAllow, type GcsEditorTool } from "@gcs/ui/editor";
import type { JSONContent } from "@tiptap/core";
import { useEffect, useRef, useState } from "react";
import { useEditorLabels } from "../topic/useEditorLabels";

/** HTML scris de mână (valorile vechi ale anunțului): editorul îl parsează după schemă (ce nu e permis dispare). */
const LOOKS_LIKE_HTML = /<[a-z][\s\S]*>/i;

/** Conținutul inițial al editorului: documentul, HTML-ul vechi sau textul vechi (un paragraf pe rând). */
export function editorContent(value: unknown): JSONContent | string | null {
  if (typeof value === "string") return LOOKS_LIKE_HTML.test(value) ? value : (plainTextToDoc(value) as JSONContent | null);
  if (typeof value === "object" && value !== null && (value as { type?: unknown }).type === "doc") return value as JSONContent;
  return null;
}

type Props = {
  /** Numele câmpului ascuns din formular (formularele trimise ca `FormData`): JSON-ul documentului sau `""` pentru gol. */
  name?: string;
  /** Valoarea salvată: documentul, un text vechi sau gol. */
  initial: unknown;
  allow: GcsEditorAllow;
  maxLength: number;
  /** Valoarea nouă la fiecare modificare: documentul sau `""` (editor gol). */
  onValue?: (value: JSONContent | "") => void;
  tools?: readonly GcsEditorTool[];
  imageUrl?: boolean;
  compact?: boolean;
  labelledBy?: string;
  id?: string;
};

/**
 * Editorul compact pentru un câmp formatat (regulile chat-ului, anunțul, câmpurile de profil „Text lung”): într-un
 * formular `FormData`, documentul ajunge într-un câmp ascuns, ca JSON; altfel, prin `onValue`. Neatins, câmpul trimite
 * valoarea salvată neschimbată (un text vechi rămâne text); golit, trimite `""`. Serverul validează documentul
 * (validatorul conținutului + profilul câmpului).
 */
export function GcsRichTextInput({ name, initial, allow, maxLength, onValue, tools, imageUrl, compact, labelledBy, id }: Props) {
  const labels = useEditorLabels();
  const [content] = useState(() => editorContent(initial));
  const [value, setValue] = useState(() => JSON.stringify(initial ?? ""));
  // Editorul își păstrează callback-urile de la creare: apelul trece prin ref, ca să ajungă la cel mai nou `onValue`.
  const onValueRef = useRef(onValue);
  useEffect(() => {
    onValueRef.current = onValue;
  });
  return (
    <div className="gcs-richInput">
      <GcsEditor
        labels={labels}
        forumId={0}
        initialContent={content}
        allow={allow}
        maxLength={maxLength}
        {...(tools ? { tools } : {})}
        {...(imageUrl ? { imageUrl } : {})}
        {...(compact ? { compact } : {})}
        {...(labelledBy ? { labelledBy } : {})}
        {...(id ? { id } : {})}
        // @mențiunile (aceleași sugestii ca în postări), doar unde câmpul le permite (`mention` în `allow`).
        {...(allow.nodes.includes("mention") ? { mentionUrl: "/api/forums/mentions" } : {})}
        onChange={(doc, empty) => {
          setValue(empty ? '""' : JSON.stringify(doc));
          onValueRef.current?.(empty ? "" : doc);
        }}
      />
      {name && <input type="hidden" name={name} value={value} />}
    </div>
  );
}
