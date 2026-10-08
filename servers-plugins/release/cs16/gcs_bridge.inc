// GCS Server Bridge — interfața pentru alte pluginuri (ex. un plugin de mix existent care conduce meciurile).
// Licența: GPL-3.0-or-later (vezi gcs_bridge.sma).

#if defined _gcs_bridge_included
  #endinput
#endif
#define _gcs_bridge_included

#pragma reqlib gcs_bridge
#if !defined AMXMODX_NOAUTOLOAD
  #pragma loadlib gcs_bridge
#endif

/**
 * Conduce meciul mix urmărit de GCS (aceleași tranziții ca `gcs_match`). GCS doar urmărește meciul: restartul jocului
 * și mutarea jucătorilor la pauză le face pluginul care cheamă nativa. După primul apel, detectarea pasivă a meciurilor
 * stă deoparte până la harta următoare.
 *   "start"    — meci nou (warmup), echipa A = CT, echipa B = T;
 *   "live"     — meciul începe (sau reîncepe după pauză);
 *   "halftime" — pauza: echipele A / B rămân aceleași, doar părțile se schimbă;
 *   "end"      — meciul s-a încheiat (câștigătorul din scor);
 *   "abort"    — meciul e anulat (nu schimbă ELO-ul).
 *
 * @return  true dacă tranziția e permisă din starea curentă.
 */
native bool:gcs_mix_command(const command[]);

/** Starea meciului curent: 0 niciunul, 1 warmup, 2 live, 3 halftime. Scorul echipelor A / B prin referință. */
native gcs_mix_state(&scoreA = 0, &scoreB = 0);

/** Pune în coada punții un eveniment propriu (obiect JSON serializat, fără `id` / `at`, care se adaugă automat). */
native bool:gcs_queue_event(const json[]);

/**
 * Apelat la fiecare schimbare a stării meciului (`status`: warmup, live, halftime, ended, aborted).
 */
forward gcs_on_match_state(const matchId[], const status[], scoreA, scoreB);

/** Apelat după ce un jucător și-a legat identitatea de un cont GCS (`/gcs COD`). */
forward gcs_on_player_linked(id, const user[]);
