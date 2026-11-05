/**
 * Catalogul jocurilor aplicației Servere (specul 2026-10-07-servere §2). Fără dependențe de Node: îl folosesc și
 * paginile client. Un joc nou = o intrare aici (cu un protocol existent sau unul nou în `protocols/`); paginile și baza
 * de date nu se schimbă. Numele jocurilor sunt nume proprii și nu se traduc.
 */

/** Protocoalele de interogare implementate (`teamspeak`, `discord`, `mumble`: comunicarea, nu jocuri). */
export type GcsGameProtocol = "goldsrc" | "source" | "minecraft" | "bedrock" | "teamspeak" | "discord" | "mumble";

/**
 * Felul intrării: `game` (server de joc, are jucători), `voice` (server de voce, are utilizatori: TeamSpeak, Mumble) sau
 * `community` (un server de Discord, identificat prin ID, are membri online). Doar `game` intră în „Joacă acum” și în
 * numărul de jucători online al site-ului.
 */
export type GcsGameKind = "game" | "voice" | "community";

export type GcsGameDef = {
  key: string;
  /** Familia, pentru filtrele de pe `/servers` și din widget (ex. ambele ediții Minecraft = `minecraft`). */
  family: string;
  name: string;
  protocol: GcsGameProtocol;
  kind: GcsGameKind;
  defaultPort: number;
  /** Portul de interogare implicit, când diferă de portul jocului (ex. ServerQuery-ul TeamSpeak). */
  defaultQueryPort?: number;
  /**
   * `steam`: butonul Connect deschide `steam://connect/host:port`; `copy`: doar copierea adresei; `teamspeak` / `mumble`:
   * linkul clientului de voce; `invite`: invitația raportată de server (Discord).
   */
  connect: "steam" | "copy" | "teamspeak" | "mumble" | "invite";
  /** Jocul raportează o hartă (altfel se arată versiunea). */
  hasMap: boolean;
  /** Iconița Font Awesome (după nume). */
  icon: string;
  /** Bannerul implicit (fără imagine încărcată): un degrade în culorile jocului. */
  banner: string;
  /** Apare în selectorul din ACP (`false` + `soon`: în asistent, ca „În curând”). */
  enabled: boolean;
  soon?: boolean;
};

export type GcsGameFamily = { key: string; label: string; icon: string };

/** Familiile, în ordinea filtrelor. */
export const GCS_GAME_FAMILIES: readonly GcsGameFamily[] = [
  { key: "cs16", label: "CS 1.6", icon: "fa-solid fa-crosshairs" },
  { key: "cs2", label: "CS2 / CS:GO", icon: "fa-solid fa-crosshairs" },
  { key: "minecraft", label: "Minecraft", icon: "fa-solid fa-cube" },
  { key: "rust", label: "Rust", icon: "fa-solid fa-hammer" },
  { key: "gmod", label: "Garry's Mod", icon: "fa-solid fa-wrench" },
  { key: "voice", label: "TeamSpeak / Mumble", icon: "fa-solid fa-microphone" },
  { key: "discord", label: "Discord", icon: "fa-brands fa-discord" },
];

export const GCS_GAMES: readonly GcsGameDef[] = [
  {
    key: "cs16",
    family: "cs16",
    name: "Counter-Strike 1.6",
    protocol: "goldsrc",
    kind: "game",
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
    kind: "game",
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
    kind: "game",
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
    kind: "game",
    defaultPort: 19132,
    connect: "copy",
    hasMap: false,
    icon: "fa-solid fa-cube",
    banner: "radial-gradient(circle at 70% 30%, rgba(94,162,255,.35), transparent 50%), linear-gradient(120deg, #0D1B2A, #14532D)",
    enabled: true,
  },
  {
    key: "rust",
    family: "rust",
    name: "Rust",
    protocol: "source",
    kind: "game",
    defaultPort: 28015,
    connect: "steam",
    hasMap: true,
    icon: "fa-solid fa-hammer",
    banner: "radial-gradient(circle at 25% 30%, rgba(226,96,58,.45), transparent 50%), linear-gradient(120deg, #2A0F08, #5A1F0E)",
    enabled: true,
  },
  {
    key: "gmod",
    family: "gmod",
    name: "Garry's Mod",
    protocol: "source",
    kind: "game",
    defaultPort: 27015,
    connect: "steam",
    hasMap: true,
    icon: "fa-solid fa-wrench",
    banner: "radial-gradient(circle at 75% 30%, rgba(94,162,255,.4), transparent 50%), linear-gradient(120deg, #0B1630, #1D3F7A)",
    enabled: true,
  },
  {
    key: "teamspeak",
    family: "voice",
    name: "TeamSpeak 3",
    protocol: "teamspeak",
    kind: "voice",
    defaultPort: 9987,
    defaultQueryPort: 10011,
    connect: "teamspeak",
    hasMap: false,
    icon: "fa-solid fa-microphone",
    banner: "radial-gradient(circle at 30% 30%, rgba(79,134,198,.45), transparent 50%), linear-gradient(120deg, #0C1626, #1A2D4F)",
    enabled: true,
  },
  {
    key: "mumble",
    family: "voice",
    name: "Mumble",
    protocol: "mumble",
    kind: "voice",
    defaultPort: 64738,
    connect: "mumble",
    hasMap: false,
    icon: "fa-solid fa-headset",
    banner: "radial-gradient(circle at 70% 30%, rgba(160,170,190,.35), transparent 50%), linear-gradient(120deg, #11151C, #2A3140)",
    enabled: true,
  },
  {
    key: "discord",
    family: "discord",
    name: "Discord",
    protocol: "discord",
    kind: "community",
    defaultPort: 443,
    connect: "invite",
    hasMap: false,
    icon: "fa-brands fa-discord",
    banner: "radial-gradient(circle at 30% 30%, rgba(124,131,255,.45), transparent 50%), linear-gradient(120deg, #141634, #3A3FB8)",
    enabled: true,
  },
  {
    key: "fivem",
    family: "fivem",
    name: "FiveM (GTA V)",
    protocol: "source",
    kind: "game",
    defaultPort: 30120,
    connect: "copy",
    hasMap: false,
    icon: "fa-solid fa-car",
    banner: "radial-gradient(circle at 30% 30%, rgba(255,92,138,.4), transparent 50%), linear-gradient(120deg, #26081A, #5A1030)",
    enabled: false,
    soon: true,
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

/** Jocurile din asistentul „Creează categorie de servere”: cele active, apoi cele „În curând”. */
export function wizardGames(): GcsGameDef[] {
  return [...GCS_GAMES.filter((g) => g.enabled), ...GCS_GAMES.filter((g) => !g.enabled && g.soon)];
}

/** Un ID de server Discord (snowflake: 17–20 cifre). */
export const DISCORD_GUILD_RE = /^\d{17,20}$/;

/** O invitație Discord sigură de pus într-un link (raportată de widget): doar `https://discord.gg/<cod>` sau `discord.com/invite`. */
export function safeDiscordInvite(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  const m = /^https:\/\/(?:discord\.gg|discord\.com\/invite)\/([A-Za-z0-9-]{2,40})$/.exec(raw.trim());
  return m ? `https://discord.gg/${m[1]}` : null;
}

/** Familia unui filtru (`?game=`), sau `null` pentru o valoare necunoscută. */
export function gameFamily(key: string | null | undefined): GcsGameFamily | null {
  return GCS_GAME_FAMILIES.find((f) => f.key === key) ?? null;
}

/**
 * Adresa de afișat și de copiat: `host:port` (IPv6 între paranteze), fără port la Minecraft și la serverele de voce pe
 * portul implicit. Discord nu are adresă (ID-ul serverului nu se afișează): șir gol.
 */
export function serverAddress(game: GcsGameDef | undefined, host: string, port: number): string {
  if (game?.connect === "invite") return "";
  const h = host.includes(":") ? `[${host}]` : host;
  if (game && game.connect !== "steam" && port === game.defaultPort) return h;
  return `${h}:${port}`;
}

/** Linkul Connect (`steam://connect/…`) sau `null` pentru jocurile fără conectare directă (și pentru comunicare). */
export function connectHref(game: GcsGameDef | undefined, host: string, port: number): string | null {
  if (!game || game.connect !== "steam") return null;
  return `steam://connect/${host.includes(":") ? `[${host}]` : host}:${port}`;
}

/**
 * Linkul „Intră” al serverelor de comunicare: clientul TeamSpeak (`ts3server://host?port=`), Mumble
 * (`mumble://host:port/`) sau invitația Discord raportată (`invite`, deja verificată); `null` pentru jocuri.
 */
export function joinHref(game: GcsGameDef | undefined, host: string, port: number, invite?: string | null): string | null {
  if (!game) return null;
  const h = host.includes(":") ? `[${host}]` : host;
  if (game.connect === "teamspeak") return `ts3server://${h}?port=${port}`;
  if (game.connect === "mumble") return `mumble://${h}:${port}/`;
  if (game.connect === "invite") return safeDiscordInvite(invite);
  return null;
}
