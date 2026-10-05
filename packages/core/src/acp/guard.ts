/** O sesiune ACP expiră după 12 ore sau la schimbarea IP-ului (spec §6.4). */
export const ACP_REAUTH_HOURS = 12;

export type GcsAcpGateInput = {
  /** Actorul are permisiunea de grup `acp.access`. */
  canAccess: boolean;
  twoFactorEnabled: boolean;
  lastAcpAuthAt: Date | null;
  lastAcpAuthIp: string | null;
};

export type GcsAcpGateResult = "ok" | "need_2fa_setup" | "need_reauth" | "forbidden";

/**
 * Cine poate intra în ACP (spec §6.4): doar cine are `acp.access`, cu 2FA activ și o autentificare
 * în ACP mai nouă de 12 ore, de pe același IP. Funcția e pură; datele le adună apelantul.
 */
export function acpGate(input: GcsAcpGateInput, ip: string, now = new Date()): GcsAcpGateResult {
  if (!input.canAccess) return "forbidden";
  if (!input.twoFactorEnabled) return "need_2fa_setup";
  if (!input.lastAcpAuthAt || input.lastAcpAuthIp !== ip) return "need_reauth";
  const ageMs = now.getTime() - input.lastAcpAuthAt.getTime();
  if (ageMs > ACP_REAUTH_HOURS * 3_600_000 || ageMs < 0) return "need_reauth";
  return "ok";
}
