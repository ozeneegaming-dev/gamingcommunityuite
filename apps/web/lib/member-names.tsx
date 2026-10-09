import "server-only";
import { decorateMemberNamesHtml, memberUserIdsInHtml } from "@gcs/core";
import { memberNameKeys } from "@gcs/modules";
import { cache } from "react";
import { pluginHost, safeModeActive } from "./plugins";
import { services } from "./services";

/**
 * Numele membrilor peste tot (specul 2026-10-10-nume-mentiuni-grupuri-peste-tot), partea de server: membrii ale căror
 * efecte se desenează pe litere (lista dată componentei `GcsMemberName` prin `GcsNameFxProvider`), cheile stilurilor
 * pentru datele care au doar id și nume, și HTML-ul salvat sau al pluginurilor adus la markup-ul comun.
 */

/** Membrii cu efecte pe litere (Studio VIP), o dată pe request; gol în modul sigur al pluginurilor. */
export const nameLetterUsers = cache(async (): Promise<string[]> => {
  try {
    await pluginHost();
    if (await safeModeActive()) return [];
    return await services().appearance.letterUsers();
  } catch {
    return [];
  }
});

/** Cheile stilurilor numelor pentru niște membri (o interogare pe request pentru același set). */
export const nameKeysFor = cache(async (ids: string): Promise<Map<string, string>> => memberNameKeys(services().db, ids.split(",").filter(Boolean)));

/** Cheia stilului unui membru (din datele care au doar id și nume). */
export async function nameKeysOf(ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((id): id is string => typeof id === "string" && id !== ""))].sort();
  return list.length === 0 ? new Map() : nameKeysFor(list.join(","));
}

/**
 * HTML-ul cu nume de membri (mențiunile din conținutul salvat, pluginurile, șabloanele): fiecare `a.gcs-userLink` /
 * `.gcs-mention` cu `data-user-id` primește markup-ul comun: clasa stilului (grupul afișat de acum, deci și conținutul
 * vechi e la zi), `data-text` și literele separate pentru efectele pe litere.
 */
export async function namesHtml(html: string): Promise<string>;
export async function namesHtml(html: string[]): Promise<string[]>;
export async function namesHtml(html: string | string[]): Promise<string | string[]> {
  const list = Array.isArray(html) ? html : [html];
  const ids = list.flatMap((h) => memberUserIdsInHtml(h));
  if (ids.length === 0) return html;
  const [keys, letters] = await Promise.all([nameKeysOf(ids), nameLetterUsers()]);
  const set = new Set(letters);
  const out = list.map((h) => decorateMemberNamesHtml(h, { keys, letters: set }));
  return Array.isArray(html) ? out : out[0]!;
}

/** Foaia cu clasele de previzualizare ale efectelor (paginile pluginurilor, pagina VIP), cu versiunea aspectului. */
export async function GcsNamePreviewsCss() {
  const version = await services()
    .appearance.version()
    .catch(() => 0);
  return <link rel="stylesheet" href={`/gcs-names.css?previews=1&v=${version}`} precedence="gcs-names" />;
}
