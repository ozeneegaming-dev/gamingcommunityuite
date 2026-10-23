// Editorul de postări (`@gcs/ui/editor`), separat de restul design system-ului ca Tiptap să nu intre în paginile fără editor.
export { GcsEditor, type GcsEditorHandle, type GcsEditorLabels, type GcsEditorProps, type GcsEditorTool, type GcsQuoteInput } from "./GcsEditor";
export { gcsEditorExtensions, GCS_EDITOR_MARKS, GCS_EDITOR_NODES, isEmbedUrl, isImageUrl, type GcsEditorAllow } from "./extensions";
export { GCS_BLOCK_FIELDS, GCS_EDITOR_BLOCK_NODES, gcsBlockExtensions, type GcsBlockLabels, type GcsEditorBlock } from "./blocks";
export { loadDraft, clearDraft } from "./draft";
export { GcsMentionList, mentionItems, type GcsMentionAttrs, type GcsMentionIcon, type GcsMentionItem, type GcsMentionLabels } from "./mentions";
