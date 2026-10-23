"use client";

import { GcsEditor, type GcsEditorBlock } from "@gcs/ui/editor";
import type { JSONContent } from "@tiptap/core";
import { useState } from "react";
import { useBlockLabels, useEditorLabels } from "../../../../../(site)/_components/topic/useEditorLabels";

/**
 * Editorul complet al postărilor (cu blocurile permise staff-ului) într-un formular ACP: documentul ajunge într-un câmp
 * ascuns, ca JSON (`""` = gol). Folosit de pagina unui nod „Pagină / Anunț” și de regulile forumului (Forum v2).
 */
export function GcsAcpDocInput({ name, initial, blocks, id, labelledBy }: { name: string; initial: JSONContent | null; blocks: GcsEditorBlock[]; id: string; labelledBy?: string }) {
  const labels = useEditorLabels();
  const blockLabels = useBlockLabels();
  const [value, setValue] = useState(() => (initial ? JSON.stringify(initial) : ""));
  return (
    <div className="gcs-richInput" data-testid={`gcs-acp-doc-${name}`}>
      <GcsEditor
        id={id}
        labels={labels}
        forumId={0}
        initialContent={initial}
        blocks={blocks}
        blockLabels={blockLabels}
        {...(labelledBy ? { labelledBy } : {})}
        onChange={(doc, empty) => setValue(empty ? "" : JSON.stringify(doc))}
      />
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
