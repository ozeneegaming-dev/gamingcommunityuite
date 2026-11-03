import { docImages, docSnippet, type GcsDocImage } from "../content-text";
import type { GcsLastPost, GcsUserRef } from "./queries";

/**
 * Cardurile de forum (vederea în grilă, macheta „Carduri de forum”): zona de imagine de sus a cardului. Ordinea:
 * imaginea forumului din ACP, apoi previzualizarea automată din ultima postare (prima ei poză sau, fără poze, titlul,
 * primele rânduri și autorul peste culoarea forumului), apoi gradientul cu iconița mare (forum fără postări).
 */

/** Modurile din ACP › Forumuri › Editează › Imaginea de previzualizare. */
export const GCS_FORUM_PREVIEW_MODES = ["auto", "image", "color"] as const;
export type GcsForumPreviewMode = (typeof GCS_FORUM_PREVIEW_MODES)[number];
export const isForumPreviewMode = (v: unknown): v is GcsForumPreviewMode => typeof v === "string" && (GCS_FORUM_PREVIEW_MODES as readonly string[]).includes(v);

/** Setarea forumului: modul, imaginea încărcată (id-ul fișierului decorativ) și punctul de focalizare (procente). */
export type GcsForumPreview = { mode: GcsForumPreviewMode; imageId: string | null; focusX: number; focusY: number };
export const DEFAULT_FORUM_PREVIEW: GcsForumPreview = { mode: "auto", imageId: null, focusX: 50, focusY: 50 };

/** Ținta fișierului decorativ al imaginii de previzualizare (`storeDecorImage`), verificată la salvare. */
export const forumPreviewTarget = (forumId: number) => `forum:${forumId}:preview`;

/** Ce ține cache-ul despre ultima postare a unui forum: pozele eligibile (în ordine) și începutul textului. */
export type GcsPostPreview = { images: GcsDocImage[]; text: string };
export const EMPTY_POST_PREVIEW: GcsPostPreview = { images: [], text: "" };

/** Zona de imagine a unui card, gata de randat. `position`: `object-position` (focalizarea din ACP), altfel `null`. */
export type GcsForumCardMedia =
  | { kind: "image"; source: "acp" | "post"; src: string; position: string | null }
  | { kind: "generated"; title: string; text: string; user: GcsUserRef | null }
  | { kind: "empty" };

/** Spoilerele nu se dezvăluie pe card (nici citatele și blocurile ascunse, ca peste tot). */
const CARD_SKIPPED: ReadonlySet<string> = new Set(["quote", "gcsHidden", "spoiler"]);
/** Destul text pentru două rânduri ale cardului (restul îl taie CSS-ul). */
const CARD_TEXT = 220;

/** Previzualizarea unei postări (documentul editorului): pozele (fără emoticoane și iconițe) și începutul textului. */
export function postPreview(json: unknown): GcsPostPreview {
  return { images: docImages(json, { max: 3, skip: CARD_SKIPPED }), text: docSnippet(json, CARD_TEXT, CARD_SKIPPED) };
}

/** Setarea citită din bază (sau dintr-un arbore cache-uit), validată: o valoare stricată = cea implicită. */
export function forumPreviewOf(row: { previewMode?: unknown; previewImageId?: unknown; previewFocusX?: unknown; previewFocusY?: unknown }): GcsForumPreview {
  const pct = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100 ? v : 50);
  return {
    mode: isForumPreviewMode(row.previewMode) ? row.previewMode : "auto",
    imageId: typeof row.previewImageId === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(row.previewImageId) ? row.previewImageId : null,
    focusX: pct(row.previewFocusX),
    focusY: pct(row.previewFocusY),
  };
}

/** Are nevoie cardul de conținutul ultimei postări? (nu, cu imaginea din ACP sau „Doar culoarea forumului”). */
export function needsPostPreview(preview: GcsForumPreview, last: GcsLastPost | null): boolean {
  return last !== null && preview.mode !== "color" && preview.imageId === null;
}

/**
 * Starea zonei de imagine. `post`: previzualizarea ultimei postări (din cache), `canDownload`: vizitatorul poate deschide
 * atașamentele forumului ultimei postări (`forums.download`); altfel atașamentele se sar și rămân doar pozele externe.
 */
export function cardMedia(input: { preview: GcsForumPreview; last: GcsLastPost | null; post: GcsPostPreview | null; canDownload: boolean }): GcsForumCardMedia {
  const { preview, last, post, canDownload } = input;
  if (preview.mode === "color") return { kind: "empty" };
  if (preview.imageId !== null) return { kind: "image", source: "acp", src: `/files/${preview.imageId}`, position: `${preview.focusX}% ${preview.focusY}%` };
  if (!last) return { kind: "empty" };
  const image = post?.images.find((img) => !img.file || canDownload);
  if (image) return { kind: "image", source: "post", src: image.src, position: null };
  return { kind: "generated", title: last.topicTitle, text: post?.text ?? "", user: last.user };
}
