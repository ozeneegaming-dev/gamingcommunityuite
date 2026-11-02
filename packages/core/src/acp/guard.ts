/** O sesiune ACP expiră implicit după 12 ore sau la schimbarea IP-ului (spec §6.4). */
export const ACP_REAUTH_HOURS = 12;
/** Fereastra de reautentificare din ACP → Setări → Securitate (minute; implicit cele 12 ore de mai sus). */
export const ACP_SESSION_MINUTES_SETTING = "security.acp_session_minutes";
export const ACP_SESSION_MINUTES_DEFAULT = ACP_REAUTH_HOURS * 60;

export type GcsAcpGateInput = {
  /** Actorul are permisiunea de grup `acp.access`. */
  canAccess: boolean;
  twoFactorEnabled: boolean;
  lastAcpAuthAt: Date | null;
  lastAcpAuthIp: string | null;
  /** Câte minute rămâne valabilă o reautentificare în ACP (implicit 12 ore). */
  reauthMinutes?: number;
};

export type GcsAcpGateResult = "ok" | "need_2fa_setup" | "need_reauth" | "forbidden";

/**
 * Cine poate intra în ACP (spec §6.4): doar cine are `acp.access`, cu 2FA activ și o autentificare
 * în ACP mai nouă decât fereastra setată (implicit 12 ore), de pe același IP. Funcția e pură; datele le adună apelantul.
 */
export function acpGate(input: GcsAcpGateInput, ip: string, now = new Date()): GcsAcpGateResult {
  if (!input.canAccess) return "forbidden";
  if (!input.twoFactorEnabled) return "need_2fa_setup";
  if (!input.lastAcpAuthAt || input.lastAcpAuthIp !== ip) return "need_reauth";
  const minutes = input.reauthMinutes && input.reauthMinutes > 0 ? input.reauthMinutes : ACP_SESSION_MINUTES_DEFAULT;
  const ageMs = now.getTime() - input.lastAcpAuthAt.getTime();
  if (ageMs > minutes * 60_000 || ageMs < 0) return "need_reauth";
  return "ok";
}
