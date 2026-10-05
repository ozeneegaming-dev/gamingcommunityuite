// Editorul de postări (`@gcs/ui/editor`), separat de restul design system-ului ca Tiptap să nu intre în paginile fără editor.
export { GcsEditor, type GcsEditorHandle, type GcsEditorLabels, type GcsEditorProps, type GcsQuoteInput } from "./GcsEditor";
export { gcsEditorExtensions, GCS_EDITOR_MARKS, GCS_EDITOR_NODES, isEmbedUrl } from "./extensions";
