import { GcsSqlKv, PLUGIN_JOB, writeWorkerHeartbeat } from "@gcs/core";
import type { GcsServices } from "./services";
import { BOT_SCHEDULED_JOB, BOT_WELCOME_JOB } from "./bot/settings";

/** Jobul care dovedește că worker-ul procesează coada (nu doar că procesul trăiește). */
export const HEARTBEAT_JOB = "system.heartbeat";
/** Curățenia ediției Lite: cheile expirate din `gcs_kv` și jurnalul live mai vechi de 5 minute. */
export const LITE_SWEEP_JOB = "system.lite_sweep";
/** Verificarea zilnică a licenței la platforma-mamă (Data Center). */
export const LICENSE_CHECK_JOB = "license.check";
/** Anti-spam: recalcularea pragurilor de avertisment după expirări (la 10 minute). */
export const WARNINGS_EXPIRY_JOB = "warnings.expiry";
/** Jobul care scoate grupurile secundare temporare expirate (Membri v2). */
export const SECONDARY_EXPIRY_JOB = "groups.secondary_expiry";

/**
 * Joburile aplicației. Se înregistrează în orice proces (în `web` doar ca nume cunoscute),
 * dar rulează doar în `gcs-worker` (`services.jobs.start()`).
 */
export function registerAppJobs(s: GcsServices): void {
  s.jobs.register({ name: HEARTBEAT_JOB, everyMs: 60_000, handler: () => writeWorkerHeartbeat(s.kv) });
  if (s.edition === "lite") {
    s.jobs.register({
      name: LITE_SWEEP_JOB,
      everyMs: 5 * 60_000,
      handler: async () => {
        if (s.kv instanceof GcsSqlKv) await s.kv.sweep();
        await s.realtime.log.prune();
      },
    });
  }
  s.achievements.registerJobs(s.jobs);
  s.achievementRules.registerJobs(s.jobs, (userId) => s.achievements.evaluate(userId));
  s.vip.registerJobs(s.jobs);
  // Membri v2: grupurile secundare temporare ajunse la expirare se scot (membrul e anunțat), la minut.
  // Anti-spam: avertismentele expirate ridică pragurile care nu mai sunt atinse (postări moderate, restricție, ban de prag).
  s.jobs.register({ name: WARNINGS_EXPIRY_JOB, everyMs: 10 * 60_000, handler: async () => void (await s.warnings.expireSweep()) });
  s.jobs.register({ name: SECONDARY_EXPIRY_JOB, everyMs: 60_000, handler: async () => void (await s.groups.expireSecondary()) });
  s.notificationProducers.registerJobs(s.jobs);
  s.chat.registerJobs(s.jobs);
  // Moderarea chat-ului: expirarea accesului de moderator, a mute-urilor și a sancțiunilor (la minut).
  s.chatModeration.registerJobs(s.jobs);
  // Chat Pro: câștigătorul perioadei încheiate a clasamentului (și badge-ul lui), o dată pe oră.
  s.jobs.register({
    name: "chat_pro.finalize",
    everyMs: 3600_000,
    handler: async () => {
      if (await s.chatPro.active()) await s.chatPro.ranking.finalize();
    },
  });
  // Botul comunității: bun venitul (după înregistrare) și postările programate scadente.
  s.jobs.register({ name: BOT_WELCOME_JOB, handler: async (data) => void (typeof data.userId === "string" ? await s.communityBot.welcome(data.userId) : false) });
  s.jobs.register({ name: BOT_SCHEDULED_JOB, everyMs: 60_000, handler: async () => void (await s.communityBot.publishScheduled()) });
  s.jobs.register({ name: "translate.cleanup", everyMs: 24 * 3600_000, handler: async () => void (await s.translation.cleanup()) });
  // Licența: verificarea zilnică la platforma-mamă (doar licențele emise de Data Center). Când aplicațiile premium se
  // opresc sau repornesc, meniul și paginile se recalculează.
  s.jobs.register({
    name: LICENSE_CHECK_JOB,
    pattern: "37 3 * * *",
    handler: async () => {
      const before = await s.licenseOnline.premiumBlocked();
      await s.licenseOnline.run();
      if ((await s.licenseOnline.premiumBlocked()) !== before) await s.cache.invalidateTags(["apps", "nav", "layout", "stats"]);
    },
  });
  // Timpul online: totalurile zilei copiate din Redis în baza de date (5 min).
  s.onlineTime.registerJobs(s.jobs);
  // Joburile pluginurilor (etapa 6): un singur job generic, rulat de gazda pluginurilor din worker.
  s.jobs.register({ name: PLUGIN_JOB, handler: (data) => s.plugins.runJob(data) });
  s.importer.registerJobs(s.jobs);
  // Aplicația Servere: runda de interogare (10 s) și agregarea orară a istoricului.
  s.serverPoller.registerJobs(s.jobs);
  // Puntea cu serverele de joc: curățenia (5 min), locurile pe server, legăturile Steam și imaginile hărților (10 min).
  s.bridge.registerJobs(s.jobs);
  // Aplicația Clanuri: clasamentul (orar), expirările și arhivarea clanurilor inactive (zilnic).
  s.clans.registerJobs(s.jobs);
  // Ștergerea și unirea conturilor: rularea operațiilor și cererile ajunse la termen (5 min).
  s.memberRemoval.registerJobs(s.jobs);
  // Profil gaming v2: datele Steam / FACEIT ale membrilor cu Steam legat (la cerere și o rundă orară).
  s.externalProfiles.registerJobs(s.jobs);
  // Forum v2: arhivarea automată (orar) și închiderea topicurilor vechi (la 6 ore).
  s.archive.registerJobs(s.jobs);
}
