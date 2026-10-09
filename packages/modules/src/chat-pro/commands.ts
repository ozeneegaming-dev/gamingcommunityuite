import { GcsValidationError, normalizeUsername, type GcsActor } from "@gcs/core";
import { Prisma, type PrismaClient } from "@gcs/db";
import type { GcsChatProCommand } from "./prefs";
import { RPS_CHOICES, type GcsChatProBot, type GcsRpsChoice } from "./types";

/** Rezultatul păstrat în `meta.bot` al mesajului: partea publică și, opțional, datele secrete (ex. alegerea la RPS). */
export type GcsStoredBot = GcsChatProBot & { secret?: Record<string, unknown> };

/** Ce primește o comandă: autorul, argumentele (textul de după nume), ziua de azi și sursa de aleator (testabile). */
export type GcsChatCommandContext = {
  actor: GcsActor;
  args: string;
  db: PrismaClient;
  now: Date;
  /** Ziua de azi (`YYYY-MM-DD`, fusul orar al site-ului). */
  today: string;
  random: () => number;
};

/** O comandă a botului: cheia (setările din ACP, preferințele membrilor), numele tastate și execuția. */
export type GcsChatCommand = {
  key: GcsChatProCommand;
  names: string[];
  /** Textul salvat în mesaj (vizibil și în chat-ul standard) și rezultatul pentru cardul botului. */
  run: (ctx: GcsChatCommandContext) => Promise<{ body: string; bot: GcsStoredBot }>;
};

/** Cât așteaptă o provocare RPS răspunsul adversarului. */
export const RPS_TTL_MS = 10 * 60_000;
const ROLL_MAX = 1_000_000;

/** Numele alegerilor la RPS (română, engleză, emoji), normalizate. */
const RPS_ALIASES: Record<string, GcsRpsChoice> = {
  piatra: "rock",
  rock: "rock",
  "✊": "rock",
  hartie: "paper",
  paper: "paper",
  "✋": "paper",
  foarfeca: "scissors",
  scissors: "scissors",
  "✌": "scissors",
  "✌️": "scissors",
};
export const RPS_EMOJI: Record<GcsRpsChoice, string> = { rock: "✊", paper: "✋", scissors: "✌️" };

export function parseRpsChoice(raw: string): GcsRpsChoice | null {
  return RPS_ALIASES[normalizeUsername(raw)] ?? null;
}

/** Cine câștigă la piatră-hârtie-foarfecă. */
export function rpsWinner(challenger: GcsRpsChoice, opponent: GcsRpsChoice): "challenger" | "opponent" | "draw" {
  if (challenger === opponent) return "draw";
  const beats: Record<GcsRpsChoice, GcsRpsChoice> = { rock: "scissors", paper: "rock", scissors: "paper" };
  return beats[challenger] === opponent ? "challenger" : "opponent";
}

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;

/** `/roll [max]`: un număr între 1 și max (implicit 100). */
const roll: GcsChatCommand = {
  key: "roll",
  names: ["roll", "zar"],
  async run({ args, random }) {
    const arg = args.trim();
    const max = arg === "" ? 100 : Number(arg);
    if (!Number.isInteger(max) || max < 2 || max > ROLL_MAX) throw new GcsValidationError({ body: "command_args" }, { command: "roll" });
    const result = 1 + Math.floor(random() * max);
    return { body: `🎲 ${result} (1-${max})`, bot: { command: "roll", max, result } };
  },
};

/** `/iq`: un IQ „măsurat” la întâmplare (umor), între 50 și 180. */
const iq: GcsChatCommand = {
  key: "iq",
  names: ["iq"],
  async run({ random }) {
    const value = 50 + Math.floor(random() * 131);
    return { body: `🧠 IQ ${value}`, bot: { command: "iq", value } };
  },
};

/** `/zi-de-nastere`: membrii care își arată ziua de naștere pe profil și o au azi (nebanați). */
const birthday: GcsChatCommand = {
  key: "birthday",
  names: ["zi-de-nastere", "zile-de-nastere", "birthday"],
  async run({ db, today }) {
    const [month, day] = [Number(today.slice(5, 7)), Number(today.slice(8, 10))];
    const rows = await db.$queryRaw<{ id: string; name: string; group: string; style: string | null }[]>(Prisma.sql`
      SELECT u.id, u.name, COALESCE(dg.key, g.key) AS "group", ns.key AS style
      FROM users u JOIN groups g ON g.id = u."primaryGroupId" LEFT JOIN groups dg ON dg.id = u."nameGroupId" LEFT JOIN name_styles ns ON ns.id = u."nameStyleId"
      WHERE u."birthdayVisible" AND u.birthday IS NOT NULL
        AND EXTRACT(MONTH FROM u.birthday) = ${month} AND EXTRACT(DAY FROM u.birthday) = ${day}
        AND g.key <> 'banned'
      ORDER BY u.name LIMIT 30`);
    const users = rows.map((r) => ({ id: r.id, name: r.name, nameKey: r.style ?? r.group, age: null }));
    return { body: `🎂 ${users.length > 0 ? users.map((u) => u.name).join(", ") : "—"}`, bot: { command: "birthday", users } };
  },
};

/**
 * `/rps @membru [piatră|hârtie|foarfecă]`: o provocare la piatră-hârtie-foarfecă. Alegerea provocatorului (aleasă la
 * întâmplare dacă lipsește) rămâne secretă până răspunde adversarul (`GcsChatProService.answerRps`), cel mult 10 minute.
 */
const rps: GcsChatCommand = {
  key: "rps",
  names: ["rps", "ppf"],
  async run({ actor, args, db, now, random }) {
    const [rawName, rawChoice] = args.trim().split(/\s+/, 2);
    const name = (rawName ?? "").replace(/^@/, "");
    if (!name) throw new GcsValidationError({ body: "command_args" }, { command: "rps" });
    const opponent = await db.user.findUnique({ where: { nameNormalized: normalizeUsername(name) }, select: { id: true, name: true } });
    if (!opponent) throw new GcsValidationError({ body: "command_user" }, { command: "rps" });
    if (opponent.id === actor.userId) throw new GcsValidationError({ body: "command_self" }, { command: "rps" });
    const choice = rawChoice ? parseRpsChoice(rawChoice) : pick(RPS_CHOICES, random);
    if (!choice) throw new GcsValidationError({ body: "command_args" }, { command: "rps" });
    return {
      body: `✊✋✌️ @${opponent.name}`,
      bot: {
        command: "rps",
        opponent: { id: opponent.id, name: opponent.name },
        state: "open",
        expiresAt: new Date(now.getTime() + RPS_TTL_MS).toISOString(),
        secret: { challenger: choice },
      },
    };
  },
};

/**
 * Registrul comenzilor botului: o comandă nouă = o intrare în plus (`register`), fără alte schimbări în chat. Numele se
 * caută fără diacritice și fără litere mari.
 */
export class GcsChatCommandRegistry {
  private readonly byName = new Map<string, GcsChatCommand>();
  private readonly list: GcsChatCommand[] = [];

  constructor(commands: GcsChatCommand[] = [roll, rps, birthday, iq]) {
    for (const c of commands) this.register(c);
  }

  register(command: GcsChatCommand): void {
    this.list.push(command);
    for (const name of command.names) this.byName.set(normalizeUsername(name), command);
  }

  /** Comanda dintr-un mesaj (`/nume argumente`), sau `null` dacă mesajul nu e o comandă cunoscută. */
  parse(body: string): { command: GcsChatCommand; args: string } | null {
    const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(body.trim());
    if (!m) return null;
    const command = this.byName.get(normalizeUsername(m[1]!));
    return command ? { command, args: m[2] ?? "" } : null;
  }

  all(): GcsChatCommand[] {
    return [...this.list];
  }
}

/** Partea publică a rezultatului (fără secrete); o provocare RPS neterminată la timp apare ca expirată. */
export function publicBot(stored: unknown, now = Date.now()): GcsChatProBot | null {
  if (!stored || typeof stored !== "object") return null;
  const { secret: _secret, ...bot } = stored as GcsStoredBot;
  void _secret;
  if (bot.command === "rps" && bot.state === "open" && Date.parse(bot.expiresAt) < now) return { ...bot, state: "expired" };
  return bot as GcsChatProBot;
}
