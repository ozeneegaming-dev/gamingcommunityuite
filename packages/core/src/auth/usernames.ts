const USERNAME_CHARS = /^[\p{L}\p{N}_.-]+$/u;
const MIN_LENGTH = 3;
const MAX_LENGTH = 24;

/**
 * Forma canonică a unui nume, folosită pentru unicitate (`users.nameNormalized`):
 * NFKC, fără diacritice (ș/ş → s, ț/ţ → t, ă/â → a, î → i…), lowercase, fără spații la capete.
 * Astfel „Ștefan” și „ştefan” sunt același nume (Review Focus #1).
 */
export function normalizeUsername(name: string): string {
  return name
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .normalize("NFC")
    .toLowerCase()
    .trim();
}

/** Emailurile sunt case-insensitive: se salvează și se caută lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Cheia erorii (de tradus în UI), sau `null` dacă numele e valid. */
export function validateUsername(name: string): string | null {
  const trimmed = name.trim();
  const length = [...trimmed].length;
  if (length < MIN_LENGTH) return "username_too_short";
  if (length > MAX_LENGTH) return "username_too_long";
  if (!USERNAME_CHARS.test(trimmed)) return "username_invalid_chars";
  return null;
}
