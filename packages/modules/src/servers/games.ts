/**
 * Catalogul jocurilor aplicației Servere (specul 2026-10-07-servere §2). Fără dependențe de Node: îl folosesc și
 * paginile client. Un joc nou = o intrare aici (cu un protocol existent sau unul nou în `protocols/`); paginile și baza
 * de date nu se schimbă. Numele jocurilor sunt nume proprii și nu se traduc.
 */

/** Protocoalele de interogare implementate. */
export type GcsGameProtocol = "goldsrc" | "source" | "minecraft" | "bedrock";

export type GcsGameDef = {
  key: string;
  /** Familia, pentru filtrele de pe `/servers` și din widget (ex. ambele ediții Minecraft = `minecraft`). */
  family: string;
  name: string;
  protocol: GcsGameProtocol;
  defaultPort: number;
  /** `steam`: butonul Connect deschide `steam://connect/host:port`; `copy`: doar copierea adresei. */
  connect: "steam" | "copy";
  /** Jocul raportează o hartă (altfel se arată versiunea). */
  hasMap: boolean;
  /** Iconița Font Awesome (după nume). */
  icon: string;
  /** Bannerul implicit (fără imagine încărcată): un degrade în culorile jocului. */
  banner: string;
  /** Apare în selectorul din ACP. */
  enabled: boolean;
};

export type GcsGameFamily = { key: string; label: string; icon: string };

/** Familiile, în ordinea filtrelor. */
export const GCS_GAME_FAMILIES: readonly GcsGameFamily[] = [
  { key: "cs16", label: "CS 1.6", icon: "fa-solid fa-crosshairs" },
  { key: "cs2", label: "CS2 / CS:GO", icon: "fa-solid fa-crosshairs" },
  { key: "minecraft", label: "Minecraft", icon: "fa-solid fa-cube" },
];

export const GCS_GAMES: readonly GcsGameDef[] = [
  {
    key: "cs16",
    family: "cs16",
    name: "Counter-Strike 1.6",
    protocol: "goldsrc",
    defaultPort: 27015,
    connect: "steam",
    hasMap: true,
    icon: "fa-solid fa-crosshairs",
    banner: "radial-gradient(circle at 20% 30%, rgba(244,183,64,.45), transparent 50%), linear-gradient(120deg, #2A1A08, #6B4410)",
    enabled: true,
  },
  {
    key: "cs2",
    family: "cs2",
    name: "Counter-Strike 2 / CS:GO",
    protocol: "source",
    defaultPort: 27015,
    connect: "steam",
    hasMap: true,
    icon: "fa-solid fa-crosshairs",
    banner: "radial-gradient(circle at 80% 20%, rgba(255,159,28,.55), transparent 50%), linear-gradient(120deg, #3A1A0A, #7C2D12)",
    enabled: true,
  },
  {
    key: "minecraft",
    family: "minecraft",
    name: "Minecraft: Java Edition",
    protocol: "minecraft",
    defaultPort: 25565,
    connect: "copy",
    hasMap: false,
    icon: "fa-solid fa-cube",
    banner: "radial-gradient(circle at 30% 30%, rgba(61,220,151,.35), transparent 50%), linear-gradient(120deg, #0D2418, #14532D)",
    enabled: true,
  },
  {
    key: "minecraft_bedrock",
    family: "minecraft",
    name: "Minecraft: Bedrock Edition",
    protocol: "bedrock",
    defaultPort: 19132,
    connect: "copy",
    hasMap: false,
    icon: "fa-solid fa-cube",
    banner: "radial-gradient(circle at 70% 30%, rgba(94,162,255,.35), transparent 50%), linear-gradient(120deg, #0D1B2A, #14532D)",
    enabled: true,
  },
];

/** Definiția unui joc după cheie (și cele dezactivate, ca serverele existente să rămână afișabile). */
export function gameDef(key: string): GcsGameDef | undefined {
  return GCS_GAMES.find((g) => g.key === key);
}

/** Jocurile din selectorul ACP. */
export function enabledGames(): GcsGameDef[] {
  return GCS_GAMES.filter((g) => g.enabled);
}

/** Familia unui filtru (`?game=`), sau `null` pentru o valoare necunoscută. */
export function gameFamily(key: string | null | undefined): GcsGameFamily | null {
  return GCS_GAME_FAMILIES.find((f) => f.key === key) ?? null;
}

/** Adresa de afișat și de copiat: `host:port` (IPv6 între paranteze), fără port la Minecraft pe portul implicit. */
export function serverAddress(game: GcsGameDef | undefined, host: string, port: number): string {
  const h = host.includes(":") ? `[${host}]` : host;
  if (game && game.connect === "copy" && port === game.defaultPort) return h;
  return `${h}:${port}`;
}

/** Linkul Connect (`steam://connect/…`) sau `null` pentru jocurile fără conectare directă. */
export function connectHref(game: GcsGameDef | undefined, host: string, port: number): string | null {
  if (!game || game.connect !== "steam") return null;
  return `steam://connect/${host.includes(":") ? `[${host}]` : host}:${port}`;
}
