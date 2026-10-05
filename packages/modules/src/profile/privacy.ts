/** Confidențialitatea unui membru (specul etapei 3, §6), salvată în `users.privacy`. */
export type GcsProfileVisibility = "PUBLIC" | "MEMBERS" | "FOLLOWED";
export type GcsContactPolicy = "MEMBERS" | "FOLLOWED" | "NOBODY";
export type GcsPrivacy = { profile: GcsProfileVisibility; messages: GcsContactPolicy; wall: GcsContactPolicy; showOnline: boolean };

export const DEFAULT_PRIVACY: GcsPrivacy = { profile: "PUBLIC", messages: "MEMBERS", wall: "MEMBERS", showOnline: true };

const PROFILE_VALUES: GcsProfileVisibility[] = ["PUBLIC", "MEMBERS", "FOLLOWED"];
const CONTACT_VALUES: GcsContactPolicy[] = ["MEMBERS", "FOLLOWED", "NOBODY"];

/** Valorile salvate, completate cu cele implicite; orice valoare necunoscută revine la implicit. */
export function normalizePrivacy(raw: unknown): GcsPrivacy {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    profile: PROFILE_VALUES.includes(r.profile as GcsProfileVisibility) ? (r.profile as GcsProfileVisibility) : DEFAULT_PRIVACY.profile,
    messages: CONTACT_VALUES.includes(r.messages as GcsContactPolicy) ? (r.messages as GcsContactPolicy) : DEFAULT_PRIVACY.messages,
    wall: CONTACT_VALUES.includes(r.wall as GcsContactPolicy) ? (r.wall as GcsContactPolicy) : DEFAULT_PRIVACY.wall,
    showOnline: typeof r.showOnline === "boolean" ? r.showOnline : DEFAULT_PRIVACY.showOnline,
  };
}

/** `true` dacă valoarea e o confidențialitate completă și validă (pentru input-ul din formular). */
export function isValidPrivacy(raw: unknown): raw is GcsPrivacy {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    PROFILE_VALUES.includes(r.profile as GcsProfileVisibility) &&
    CONTACT_VALUES.includes(r.messages as GcsContactPolicy) &&
    CONTACT_VALUES.includes(r.wall as GcsContactPolicy) &&
    typeof r.showOnline === "boolean"
  );
}
