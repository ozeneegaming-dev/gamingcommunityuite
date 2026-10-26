export * from "./phishing";
export * from "./pow";

/**
 * Răspunsul la întrebarea de la înregistrare, comparabil: fără diacritice, litere mici, spațiile strânse și fără
 * punctuația de la capete („  Counter-Strike 2! ” → „counter-strike 2”).
 */
export function normalizeAnswer(answer: string): string {
  return answer
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
}

/** Câte imagini are un HTML randat (limita membrilor noi). */
export function countImages(html: string): number {
  return (html.match(/<img\b/gi) ?? []).length;
}
