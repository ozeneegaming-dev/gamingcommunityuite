/*
 * GCS Server Bridge — pluginul AMX Mod X pentru Counter-Strike 1.6 (GamingCommunitySuite).
 *
 * Vorbește protocolul v1 al punții (specul 2026-10-08-servere-bridge și 2026-10-08-servere-plugin-v2).
 *
 * Implicit pluginul DOAR COLECTEAZĂ DATE: heartbeat (harta, jucătorii și flag-urile lor de admin, citite din sistemul
 * de admini al serverului), evenimente (conectări, ucideri, runde, focuri, scorul echipelor), meciurile mix detectate
 * pasiv pe serverele marcate „mix” și legarea identității cu `/gcs COD`. Nu scrie flag-uri, nu dă kick / mute / gag, nu
 * rulează comenzi pe server și nu înregistrează comenzi de admin.
 *
 * Modulele opționale (oprite implicit, pornite din ACP pe fiecare server; `gcs_allow_manage 0` le ține oprite oricum):
 * adminii din GCS, bannurile / mute / gag din GCS, VIP-ul din GCS, ready-up-ul mix și comenzile de admin GCS. Un modul
 * oprit nu își înregistrează comenzile și nu își trage listele de la site.
 *
 * HLTV-ul e un proxy separat: pluginul doar raportează câte proxy-uri HLTV sunt conectate (heartbeat `tv.hltv`);
 * demo-urile și „Urmărește live” se configurează pe site (specul 2026-10-08-servere-hltv).
 *
 * Fără cheie (pachetul general), pluginul se înrolează singur la site și primește cheia după aprobarea din ACP.
 * Evenimentele netrimise se salvează pe disc și se retrimit cu aceleași id-uri.
 *
 * Cerințe: AMX Mod X 1.9 / 1.10 (nativele json_* și hash_string cu SHA-256), modulul AmxxEasyHttp (HTTPS asincron).
 * Opțional: ReAPI + Reunion (deosebesc clienții Steam de cei non-Steam).
 *
 * Copyright (C) GamingCommunitySuite
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
 * License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
 * version. This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the
 * implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
 * details: <https://www.gnu.org/licenses/>.
 *
 * As a special exception, the AMX Mod X developers grant permission to link this plugin with AMX Mod X (see the
 * AMX Mod X license); this plugin is licensed GPL-3.0-or-later.
 */

#include <amxmodx>
#include <amxmisc>
#include <cstrike>
#include <engine>
#include <fakemeta>
#include <hamsandwich>
#include <json>
#include <easy_http>
#tryinclude <reapi>

#pragma semicolon 1
#pragma dynamic 262144

#define PLUGIN      "GCS Server Bridge"
#define VERSION     "1.2.0"
#define AUTHOR      "GamingCommunitySuite"
#define PLUGIN_ID   "gcs-amxx/1.2.0"
#define BASE_PATH   "/api/servers/bridge/v1"

// Corpul unei cereri: nativele AMX Mod X (hash_string) și AmxxEasyHttp (set_body) citesc cel mult 16383 de caractere
// dintr-un șir Pawn, deci un lot rămâne sub această limită (și semnătura acoperă exact ce se trimite).
#define BODY         16000
#define ITEM         4096
#define MAX_QUEUE    2000
#define BATCH        100
#define ROUND_CHUNK  8
#define SANCTION_PAGE 100
#define AUTH_LEN     40
#define NAME_LEN     64
// Meciul mix detectat pasiv: cel puțin atâția jucători în fiecare echipă.
#define MIX_MIN_TEAM 2

// Tipurile cererilor (datele utilizatorului din AmxxEasyHttp).
enum
{
	REQ_HEARTBEAT = 1,
	REQ_EVENTS,
	REQ_ADMINS,
	REQ_VIP,
	REQ_SANCTIONS,
	REQ_CHECK,
	REQ_LINK,
	REQ_ENROLL,
	REQ_ENROLL_STATUS
};

// Modulele opționale (specul plugin-v2 §1.2), oprite implicit: pluginul doar colectează date.
enum
{
	FEAT_ADMINS = 0,
	FEAT_SANCTIONS,
	FEAT_VIP,
	FEAT_MIXREADY,
	FEAT_COMMANDS,
	FEAT_COUNT
};

// Cheile modulelor în `config.features` (site) și în `modules` (heartbeat).
new const g_featKeys[][] = { "admins", "sanctions", "vip", "mixReady", "commands" };

// Identitatea locală a unui jucător (ca în GCS: Steam, non-Steam, nume).
enum
{
	KIND_NONE = 0,
	KIND_STEAM,
	KIND_NONSTEAM,
	KIND_NAME
};

enum
{
	SAN_BAN = 0,
	SAN_MUTE,
	SAN_GAG
};

enum _:AdminEntry
{
	AE_Id,
	AE_Kind,
	AE_Auth[AUTH_LEN],
	AE_Salt[33],
	AE_Verifier[65],
	AE_Flags,
	AE_Immunity,
	AE_Expires
};

enum _:VipEntry
{
	VE_Kind,
	VE_Auth[AUTH_LEN],
	VE_Flags,
	VE_Expires
};

enum _:SanctionEntry
{
	SE_Id,
	SE_Type,
	SE_Kind,
	SE_Auth[AUTH_LEN],
	SE_Ip[46],
	SE_Name[NAME_LEN],
	SE_Reason[200],
	SE_Expires,
	SE_Admin[33]
};

enum
{
	MIX_NONE = 0,
	MIX_WARMUP,
	MIX_LIVE,
	MIX_HALFTIME,
	MIX_ENDED
};

// ─── Configurarea ────────────────────────────────────────────────────────────

new g_cvarUrl, g_cvarKey, g_cvarPwField, g_cvarNameProtect, g_cvarAliases, g_cvarMixPlayers, g_cvarMixRounds, g_cvarDebug, g_cvarAllowManage;
new g_url[192], g_keyId[13], g_signKey[65];
new bool:g_configured;
new g_offset;                 // ceasul GCS − ceasul local (secunde)
new g_heartbeat = 30, g_eventsInterval = 10;
new g_identityMode[8] = "mixed";
new bool:g_nameIds;
new bool:g_isMix;

// ─── Modulele opționale ─────────────────────────────────────────────────────

new bool:g_siteFeat[FEAT_COUNT];     // cum le-a trimis site-ul (salvate local, pentru pornirea următoare)
new bool:g_registered[FEAT_COUNT];   // comenzile înregistrate în harta curentă

// ─── Înrolarea (fără cheie) ─────────────────────────────────────────────────

new g_enrollSecret[65], g_enrollRef[32];
new bool:g_enrolling, bool:g_enrollBusy, bool:g_enrollAnnounced;
new g_enrollNextAt, g_enrollBackoff;

// ─── Starea ──────────────────────────────────────────────────────────────────

new Array:g_queue, Array:g_admins, Array:g_vip, Array:g_sanctions;
new g_queueHead;              // evenimentele dinaintea lui sunt confirmate (scoase fără mutarea întregii cozi)
new g_runId[9], g_seq;
new bool:g_inflight, g_batchCount, g_backoff, g_nextSendAt, g_lastEventsAt;
new g_etagAdmins[33], g_etagVip[33], g_cursor, g_remoteSanctions, g_lastPull;
new bool:g_pullingSanctions, bool:g_sanctionsFull;
new g_removedTotal, g_removedAtPull;  // evenimentele ieșite din coadă (de la pornire); câte erau la ultima cerere de sancțiuni
new g_dataDir[128];

// ─── Jucătorii ──────────────────────────────────────────────────────────────

new g_auth[33][AUTH_LEN], g_steam[33], g_kind[33], g_userid[33], g_vipAdded[33];
new bool:g_muted[33], bool:g_gagged[33], g_adminId[33], bool:g_linkedChecked[33];
new g_shots[33][CSW_P90 + 1], g_hits[33][CSW_P90 + 1], g_damage[33][CSW_P90 + 1], g_hs[33][CSW_P90 + 1];
new g_clipBefore[33];
new g_matchKills[33], g_matchDeaths[33], g_matchHs[33], g_matchDamage[33];
new g_matchTeam[33];          // 'A' / 'B' / 0

// ─── Meciul mix ──────────────────────────────────────────────────────────────

new g_mixState, g_mixId[40], g_scoreA, g_scoreB, g_mixRound, g_sideA = 2;  // CS_TEAM_CT = 2
new bool:g_ready[33];
// Meciul condus de GCS (ready-up / gcs_match: restart, schimbarea părților) sau de alt plugin (nativele): detectarea
// pasivă stă deoparte până la harta următoare.
new bool:g_mixDriven, bool:g_mixManual, bool:g_pendingStart, bool:g_mixSwapped;
new g_teamCT, g_teamT;
new g_fwdMatchState, g_fwdLinked;

public plugin_init()
{
	register_plugin(PLUGIN, VERSION, AUTHOR);

	g_cvarUrl = register_cvar("gcs_url", "");
	g_cvarKey = register_cvar("gcs_key", "", FCVAR_PROTECTED);
	g_cvarPwField = register_cvar("gcs_password_field", "_pw");
	g_cvarNameProtect = register_cvar("gcs_name_protect", "1");
	g_cvarAliases = register_cvar("gcs_amx_aliases", "1");
	g_cvarMixPlayers = register_cvar("gcs_mix_players", "10");
	g_cvarMixRounds = register_cvar("gcs_mix_maxrounds", "30");
	g_cvarDebug = register_cvar("gcs_debug", "0");
	g_cvarAllowManage = register_cvar("gcs_allow_manage", "1");

	g_queue = ArrayCreate(ITEM);
	g_admins = ArrayCreate(AdminEntry);
	g_vip = ArrayCreate(VipEntry);
	g_sanctions = ArrayCreate(SanctionEntry);

	register_event("DeathMsg", "ev_death", "a");
	register_event("Damage", "ev_damage", "b", "2!0", "3=0", "4!0");
	register_event("SendAudio", "ev_win_t", "a", "2&%!MRAD_terwin");
	register_event("SendAudio", "ev_win_ct", "a", "2&%!MRAD_ctwin");
	register_event("SendAudio", "ev_win_draw", "a", "2&%!MRAD_rounddraw");
	// Scorul echipelor și meciurile mix detectate pasiv (restartul jocului, începutul rundei).
	register_event("TeamScore", "ev_team_score", "a");
	register_event("TextMsg", "ev_game_restart", "a", "2&#Game_C", "2&#Game_w");
	register_event("HLTV", "ev_new_round", "a", "1=0", "2=0");

	// Focurile: înainte și după atacul principal al fiecărei arme de foc (încărcătorul scade = foc tras).
	new name[32];
	for (new w = CSW_P228; w <= CSW_P90; w++)
	{
		if (w == CSW_KNIFE || w == CSW_HEGRENADE || w == CSW_FLASHBANG || w == CSW_SMOKEGRENADE || w == CSW_C4 || w == 2) continue;
		if (!get_weaponname(w, name, charsmax(name))) continue;
		RegisterHam(Ham_Weapon_PrimaryAttack, name, "ham_attack_pre", 0);
		RegisterHam(Ham_Weapon_PrimaryAttack, name, "ham_attack_post", 1);
	}

	// `say /gcs COD` (legarea contului) rămâne în modul colector; restul comenzilor sunt ale modulului „commands”
	// (`register_feature`), înregistrate doar când e pornit.
	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");

	g_fwdMatchState = CreateMultiForward("gcs_on_match_state", ET_IGNORE, FP_STRING, FP_STRING, FP_CELL, FP_CELL);
	g_fwdLinked = CreateMultiForward("gcs_on_player_linked", ET_IGNORE, FP_CELL, FP_STRING);

	formatex(g_runId, charsmax(g_runId), "%x", (get_systime() ^ random(0x7FFFFFFF)) & 0x7FFFFFFF);
}

public plugin_natives()
{
	register_library("gcs_bridge");
	register_native("gcs_mix_command", "native_mix_command");
	register_native("gcs_mix_state", "native_mix_state");
	register_native("gcs_queue_event", "native_queue_event");
	set_module_filter("module_filter");
	set_native_filter("native_filter");
}

/**
 * ReAPI e opțional: `reapi.inc` cere biblioteca `reapi` (`#pragma reqlib`); fără filtrul acesta, pluginul compilat cu
 * ReAPI nu s-ar încărca pe serverele fără el.
 */
public module_filter(const library[], LibType:type)
{
	return equal(library, "reapi") ? PLUGIN_HANDLED : PLUGIN_CONTINUE;
}

/** Fără ReAPI, nativele lui lipsesc și pluginul merge mai departe (nu le apelează: vezi `steam_state`). */
public native_filter(const name[], index, trap)
{
	return trap ? PLUGIN_CONTINUE : PLUGIN_HANDLED;
}

public plugin_cfg()
{
	get_localinfo("amxx_datadir", g_dataDir, charsmax(g_dataDir));
	new cfg[128];
	get_localinfo("amxx_configsdir", cfg, charsmax(cfg));
	server_cmd("exec %s/gcs_bridge.cfg", cfg);
	server_exec();
	// Cheia primită prin înrolare (gcs_bridge_key.cfg), doar dacă gcs_bridge.cfg nu are una.
	new key[8], path[192];
	get_pcvar_string(g_cvarKey, key, charsmax(key));
	formatex(path, charsmax(path), "%s/gcs_bridge_key.cfg", cfg);
	if (!key[0] && file_exists(path))
	{
		server_cmd("exec %s", path);
		server_exec();
	}
	load_features();
	read_config();
	if (g_enrolling) load_enroll();
	apply_features();
	load_queue();
	load_lists();
	set_task(1.0, "task_tick", _, _, _, "b");
	set_task(5.0, "task_heartbeat");
}

public plugin_end()
{
	// Meciul nu continuă pe harta următoare: unul deschis se anulează (fără ELO).
	if (g_mixState == MIX_WARMUP || g_mixState == MIX_LIVE || g_mixState == MIX_HALFTIME) mix_command("abort", false);
	save_queue();
}

stock read_config()
{
	new token[160];
	get_pcvar_string(g_cvarUrl, g_url, charsmax(g_url));
	trim(g_url);
	new len = strlen(g_url);
	while (len > 0 && g_url[len - 1] == '/') g_url[--len] = EOS;
	get_pcvar_string(g_cvarKey, token, charsmax(token));
	trim(token);

	// Cheia: gcs1.<keyId>.<secret>; K = hex(SHA-256(secret)), secretul nu pleacă nicăieri.
	new prefix[8], rest[150], secret[64];
	strtok2(token, prefix, charsmax(prefix), rest, charsmax(rest), '.');
	strtok2(rest, g_keyId, charsmax(g_keyId), secret, charsmax(secret), '.');
	g_configured = equal(prefix, "gcs1") && strlen(g_keyId) == 12 && strlen(secret) == 43 && g_url[0] != EOS;
	g_enrolling = false;
	if (g_configured) hash_string(secret, Hash_Sha256, g_signKey, charsmax(g_signKey));
	else if (g_url[0] && !token[0])
	{
		// Pachetul general: adresa fără cheie → înrolarea automată (aprobarea în ACP).
		g_enrolling = true;
		g_enrollNextAt = get_systime() + 10;
	}
	else if (g_url[0]) log_amx("[GCS] gcs_key nu are forma gcs1.<keyId>.<secret>: verifică gcs_bridge.cfg.");
	else log_amx("[GCS] Configurare incompletă: setează gcs_url în gcs_bridge.cfg.");
	if (equali(g_url, "http://", 7)) log_amx("[GCS] Atenție: adresa site-ului e http:// (fără TLS); folosește https://.");
}

// ─── Cererile semnate ───────────────────────────────────────────────────────

stock make_nonce(out[], len)
{
	static const chars[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (new i = 0; i < len; i++) out[i] = chars[random(sizeof(chars) - 1)];
	out[len] = EOS;
}

/** Echipa CS ca text de protocol: CT, T sau SPEC. */
stock team_code(const team[], out[], len)
{
	if (equal(team, "CT")) copy(out, len, "CT");
	else if (equal(team, "TERRORIST")) copy(out, len, "T");
	else copy(out, len, "SPEC");
}

/** Felul unei sancțiuni ca text de protocol. */
stock sanction_kind(kind, out[], len)
{
	if (kind == SAN_MUTE) copy(out, len, "mute");
	else if (kind == SAN_GAG) copy(out, len, "gag");
	else copy(out, len, "ban");
}

/** Ceasul GCS (secunde). */
stock gcs_now()
{
	return get_systime() + g_offset;
}

/**
 * O cerere semnată (§5.2) cu `sha256-env` = SHA-256(K \n canonic \n K), canonic = METODĂ \n CALE \n TIMESTAMP \n
 * NONCE \n hex(SHA-256(corp)). `kind` și `extra` ajung înapoi în răspuns.
 */
stock bridge_request(const method[], const path[], const body[], kind, extra = 0)
{
	if (!g_configured) return 0;
	// Peste limită, hash_string și set_body ar tăia corpul (semnătura n-ar mai corespunde): cererea nu pleacă.
	if (strlen(body) >= BODY)
	{
		log_amx("[GCS] Cererea %s %s e prea mare (%d caractere).", method, path, strlen(body));
		return 0;
	}
	new url[320], ts[16], nonce[25], bodyHash[65], signature[65], header[90];
	static canonical[512], envelope[700];
	formatex(url, charsmax(url), "%s%s%s", g_url, BASE_PATH, path);
	num_to_str(gcs_now(), ts, charsmax(ts));
	make_nonce(nonce, 24);
	hash_string(body, Hash_Sha256, bodyHash, charsmax(bodyHash));
	formatex(canonical, charsmax(canonical), "%s^n%s^n%s^n%s^n%s", method, path, ts, nonce, bodyHash);
	formatex(envelope, charsmax(envelope), "%s^n%s^n%s", g_signKey, canonical, g_signKey);
	hash_string(envelope, Hash_Sha256, signature, charsmax(signature));
	formatex(header, charsmax(header), "sha256-env=%s", signature);

	new EzHttpOptions:options = ezhttp_create_options();
	ezhttp_option_set_header(options, "X-GCS-Key", g_keyId);
	ezhttp_option_set_header(options, "X-GCS-Timestamp", ts);
	ezhttp_option_set_header(options, "X-GCS-Nonce", nonce);
	ezhttp_option_set_header(options, "X-GCS-Signature", header);
	ezhttp_option_set_header(options, "User-Agent", PLUGIN_ID);
	if (kind == REQ_ADMINS && g_etagAdmins[0]) ezhttp_option_set_header(options, "If-None-Match", g_etagAdmins);
	if (kind == REQ_VIP && g_etagVip[0]) ezhttp_option_set_header(options, "If-None-Match", g_etagVip);
	ezhttp_option_set_timeout(options, kind == REQ_CHECK ? 3000 : 15000);
	new data[3];
	data[0] = kind;
	data[1] = extra;
	data[2] = (kind == REQ_CHECK || kind == REQ_LINK) ? g_userid[extra] : 0;
	ezhttp_option_set_user_data(options, data, sizeof(data));
	if (body[0])
	{
		ezhttp_option_set_header(options, "Content-Type", "application/json");
		ezhttp_option_set_body(options, body);
	}
	if (get_pcvar_num(g_cvarDebug)) log_amx("[GCS] %s %s (%d octeți)", method, path, strlen(body));
	if (equal(method, "POST")) ezhttp_post(url, "on_response", options);
	else ezhttp_get(url, "on_response", options);
	return 1;
}

public on_response(EzHttpRequest:request)
{
	new data[3];
	ezhttp_get_user_data(request, data);
	new kind = data[0], extra = data[1];

	if (ezhttp_get_error_code(request) != EZH_OK)
	{
		if (kind == REQ_ENROLL || kind == REQ_ENROLL_STATUS) on_enroll(kind, 0, Invalid_JSON, "network");
		else on_failure(kind, 0);
		return;
	}
	new code = ezhttp_get_http_code(request);
	// Răspunsul trece printr-un fișier: json_parse dintr-un șir citește cel mult 16383 de caractere, iar listele
	// (admini, VIP, sancțiuni) pot fi mai mari. Din fișier nu există limita.
	new path[192], JSON:root = Invalid_JSON;
	formatex(path, charsmax(path), "%s/gcs_bridge_response.json", g_dataDir);
	if (code != 304 && ezhttp_save_data_to_file(request, path) > 0)
	{
		root = json_parse(path, true);
		delete_file(path);
		if (root != Invalid_JSON && !json_is_object(root))
		{
			json_free(root);
			root = Invalid_JSON;
		}
	}
	if (root != Invalid_JSON && json_object_has_value(root, "serverTime", JSONNumber))
	{
		g_offset += json_object_get_number(root, "serverTime") - gcs_now();
	}
	new error[32];
	if (root != Invalid_JSON && json_object_has_value(root, "error", JSONString)) json_object_get_string(root, "error", error, charsmax(error));

	if (kind == REQ_ENROLL || kind == REQ_ENROLL_STATUS)
	{
		on_enroll(kind, code, root, error);
		if (root != Invalid_JSON) json_free(root);
		return;
	}

	if (code == 200 || code == 304)
	{
		switch (kind)
		{
			case REQ_HEARTBEAT: on_heartbeat(root);
			case REQ_EVENTS: on_events_done(extra);
			case REQ_ADMINS: if (code == 200) on_admins(root);
			case REQ_VIP: if (code == 200) on_vip(root);
			case REQ_SANCTIONS: on_sanctions(root);
			case REQ_CHECK: if (data[2] == g_userid[extra] && is_user_connected(extra)) on_check(extra, root);
			case REQ_LINK: if (data[2] == g_userid[extra] && is_user_connected(extra)) on_link(extra, root, code);
		}
	}
	else if (kind == REQ_LINK && data[2] == g_userid[extra] && is_user_connected(extra))
	{
		on_link(extra, root, code);
	}
	else
	{
		// 401 clock_skew (decalajul e corectat acum), 409 replay și 429 se reîncearcă; restul 4xx = lot invalid.
		new bool:retry = code >= 500 || code == 429 || code == 409 || (code == 401 && equal(error, "clock_skew"));
		if (code == 401 && !equal(error, "clock_skew")) log_amx("[GCS] Cheie respinsă (%s): verifică gcs_key.", error);
		on_failure(kind, retry ? 0 : 1);
	}
	if (root != Invalid_JSON) json_free(root);
}

/** `drop` = cererea a fost invalidă (4xx): lotul de evenimente se aruncă, nu se reîncearcă. */
stock on_failure(kind, drop)
{
	if (kind == REQ_EVENTS)
	{
		if (drop) remove_front(g_batchCount);
		else
		{
			// Backoff exponențial: 5 s, 10 s, 20 s … max 5 minute.
			g_backoff = g_backoff ? min(g_backoff * 2, 300) : 5;
			g_nextSendAt = get_systime() + g_backoff;
		}
		g_inflight = false;
	}
	else if (kind == REQ_SANCTIONS)
	{
		g_pullingSanctions = false;
	}
}

/** Evenimentele din coadă (neconfirmate). */
stock queue_size()
{
	return ArraySize(g_queue) - g_queueHead;
}

/**
 * Scoate primele `count` evenimente. Doar începutul cozii se mută (ștergerea fiecărui element ar muta toată coada, de
 * zeci de MB după o pană a site-ului); memoria se compactează rar.
 */
stock remove_front(count)
{
	new total = ArraySize(g_queue);
	new removed = min(max(count, 0), total - g_queueHead);
	g_removedTotal += removed;
	g_queueHead += removed;
	if (g_queueHead >= total)
	{
		ArrayClear(g_queue);
		g_queueHead = 0;
	}
	else if (g_queueHead >= 500)
	{
		new Array:rest = ArrayCreate(ITEM);
		static item[ITEM];
		for (new i = g_queueHead; i < total; i++)
		{
			ArrayGetString(g_queue, i, item, charsmax(item));
			ArrayPushString(rest, item);
		}
		ArrayDestroy(g_queue);
		g_queue = rest;
		g_queueHead = 0;
	}
}

// ─── Ritmul: heartbeat, evenimente, liste ───────────────────────────────────

public task_tick()
{
	new now = get_systime();
	if (g_enrolling)
	{
		enroll_tick(now);
		return;
	}
	if (!g_configured) return;
	if (!g_inflight && queue_size() > 0 && now >= g_nextSendAt && (queue_size() >= BATCH || now - g_lastEventsAt >= g_eventsInterval)) send_events();
	// Modulele cu liste (admini, VIP, sancțiuni): o tragere completă o dată la 10 minute (și la versiuni noi, din
	// heartbeat). Colectorul nu trage nimic.
	if (now - g_lastPull >= 600 && (feat(FEAT_ADMINS) || feat(FEAT_VIP) || feat(FEAT_SANCTIONS))) pull_lists(true);
}

public task_heartbeat()
{
	if (g_configured) send_heartbeat();
	set_task(float(g_heartbeat), "task_heartbeat");
}

stock send_events()
{
	static body[BODY], item[ITEM];
	new len = copy(body, charsmax(body), "{^"events^":[");
	new count = 0, total = ArraySize(g_queue);
	for (new i = g_queueHead; i < total && count < BATCH; i++)
	{
		ArrayGetString(g_queue, i, item, charsmax(item));
		if (len + strlen(item) + 4 >= charsmax(body)) break;
		if (count) body[len++] = ',';
		len += copy(body[len], charsmax(body) - len, item);
		count++;
	}
	copy(body[len], charsmax(body) - len, "]}");
	g_inflight = true;
	g_batchCount = count;
	g_lastEventsAt = get_systime();
	if (!bridge_request("POST", "/events", body, REQ_EVENTS, count)) g_inflight = false;
}

stock on_events_done(count)
{
	// Toate rezultatele (ok, duplicate, rejected) sunt confirmări: lotul iese din coadă.
	remove_front(count);
	g_inflight = false;
	g_backoff = 0;
	g_nextSendAt = 0;
}

stock send_heartbeat()
{
	new JSON:root = json_init_object();
	new map[64];
	get_mapname(map, charsmax(map));
	json_object_set_string(root, "plugin", PLUGIN_ID);
	json_object_set_string(root, "map", map);
	json_object_set_number(root, "maxPlayers", get_maxplayers());
	new JSON:players = json_init_array();
	new team[16];
	new hltv = 0;
	for (new id = 1; id <= MaxClients; id++)
	{
		if (is_user_connected(id) && is_user_hltv(id)) hltv++;
		if (!is_user_connected(id) || is_user_bot(id) || is_user_hltv(id)) continue;
		new JSON:ref = player_ref(id);
		get_user_team(id, team, charsmax(team));
		new code[8];
		team_code(team, code, charsmax(code));
		json_object_set_string(ref, "team", code);
		json_object_set_number(ref, "score", get_user_frags(id));
		json_object_set_number(ref, "time", get_user_time(id, 1));
		set_admin_flags(ref, id);
		json_array_append_value(players, ref);
		json_free(ref);
	}
	json_object_set_value(root, "players", players);
	json_free(players);
	// Modulele active pe server și scorul echipelor (afișate în ACP).
	new JSON:modules = json_init_array();
	for (new f = 0; f < FEAT_COUNT; f++) if (feat(f)) json_array_append_string(modules, g_featKeys[f]);
	json_object_set_value(root, "modules", modules);
	json_free(modules);
	json_object_set_number(root, "scores.ct", g_teamCT, true);
	json_object_set_number(root, "scores.t", g_teamT, true);
	// Proxy-urile HLTV conectate (specul servere-hltv §8): starea transmisiei în ACP; doar citită.
	json_object_set_number(root, "tv.hltv", hltv, true);
	if (g_mixState == MIX_WARMUP || g_mixState == MIX_LIVE || g_mixState == MIX_HALFTIME)
	{
		new JSON:match = match_state();
		json_object_set_value(root, "match", match);
		json_free(match);
	}
	static body[BODY];
	// Un JSON tăiat ar fi invalid: peste limită, heartbeat-ul nu pleacă (32 de jucători încap cu mult).
	new bool:fits = json_serial_size(root) < charsmax(body);
	if (fits) json_serial_to_string(root, body, charsmax(body));
	json_free(root);
	if (fits) bridge_request("POST", "/heartbeat", body, REQ_HEARTBEAT);
	else log_amx("[GCS] Heartbeat-ul depășește %d caractere: nu se trimite.", charsmax(body));
}

stock on_heartbeat(JSON:root)
{
	if (root == Invalid_JSON) return;
	new JSON:config = json_object_get_value(root, "config");
	if (config != Invalid_JSON)
	{
		g_heartbeat = clamp(json_object_get_number(config, "heartbeat"), 15, 120);
		g_eventsInterval = clamp(json_object_get_number(config, "events"), 5, 60);
		json_object_get_string(config, "identityMode", g_identityMode, charsmax(g_identityMode));
		g_nameIds = json_object_get_bool(config, "nameIds");
		g_isMix = json_object_get_bool(config, "isMix");
		new JSON:features = json_object_get_value(config, "features");
		if (features != Invalid_JSON)
		{
			new bool:before[FEAT_COUNT], bool:changed = false;
			for (new f = 0; f < FEAT_COUNT; f++)
			{
				before[f] = feat(f);
				new bool:value = json_object_get_bool(features, g_featKeys[f]);
				if (value != g_siteFeat[f])
				{
					g_siteFeat[f] = value;
					changed = true;
				}
			}
			json_free(features);
			if (changed)
			{
				save_features();
				features_changed(before);
			}
		}
		json_free(config);
	}
	new JSON:versions = json_object_get_value(root, "versions");
	if (versions != Invalid_JSON)
	{
		// Doar listele modulelor pornite.
		new etag[33];
		json_object_get_string(versions, "admins", etag, charsmax(etag));
		if (feat(FEAT_ADMINS) && !equal(etag, g_etagAdmins)) bridge_request("GET", "/admins", "", REQ_ADMINS);
		json_object_get_string(versions, "vip", etag, charsmax(etag));
		if (feat(FEAT_VIP) && !equal(etag, g_etagVip)) bridge_request("GET", "/vip", "", REQ_VIP);
		g_remoteSanctions = json_object_get_number(versions, "sanctions");
		if (feat(FEAT_SANCTIONS) && g_remoteSanctions != g_cursor) pull_sanctions();
		json_free(versions);
	}
}

stock pull_lists(bool:all)
{
	g_lastPull = get_systime();
	if (feat(FEAT_ADMINS)) bridge_request("GET", "/admins", "", REQ_ADMINS);
	if (feat(FEAT_VIP)) bridge_request("GET", "/vip", "", REQ_VIP);
	if (all && feat(FEAT_SANCTIONS)) pull_sanctions();
}

// ─── Modulele opționale (specul plugin-v2 §1.2) ─────────────────────────────

/** Modulul e pornit: pe site și cu acordul local (`gcs_allow_manage`). */
stock bool:feat(f)
{
	return g_siteFeat[f] && get_pcvar_num(g_cvarAllowManage) != 0;
}

stock features_path(path[], len)
{
	formatex(path, len, "%s/gcs_bridge_features.json", g_dataDir);
}

/** Modulele primite ultima dată de la site: pornirea următoare înregistrează direct ce e pornit. */
stock load_features()
{
	new path[192];
	features_path(path, charsmax(path));
	new JSON:root = file_exists(path) ? json_parse(path, true) : Invalid_JSON;
	if (root == Invalid_JSON) return;
	for (new f = 0; f < FEAT_COUNT; f++) g_siteFeat[f] = json_object_get_bool(root, g_featKeys[f]);
	json_free(root);
}

stock save_features()
{
	new JSON:root = json_init_object();
	for (new f = 0; f < FEAT_COUNT; f++) json_object_set_bool(root, g_featKeys[f], g_siteFeat[f]);
	new path[192];
	features_path(path, charsmax(path));
	json_serial_to_file(root, path);
	json_free(root);
}

stock apply_features()
{
	for (new f = 0; f < FEAT_COUNT; f++) register_feature(f);
}

/**
 * Comenzile unui modul pornit (o dată pe hartă). Doar modulul „commands” are comenzi proprii; celelalte lucrează prin
 * hook-urile comune (conectarea, chat-ul), care verifică modulul la fiecare apel. Un modul oprit în timpul hărții devine
 * inert imediat (comenzile lui nu mai fac nimic) și dispare la harta următoare.
 */
stock register_feature(f)
{
	if (g_registered[f] || !feat(f)) return;
	g_registered[f] = true;
	if (f != FEAT_COMMANDS) return;
	register_concmd("gcs_ban", "cmd_ban", ADMIN_BAN | ADMIN_BAN_TEMP, "<nume|#userid|authid> <minute> [motiv] — ban pe acest server");
	register_concmd("gcs_gban", "cmd_ban", ADMIN_BAN | ADMIN_BAN_TEMP, "<nume|#userid|authid> <minute> [motiv] — ban pe toate serverele");
	register_concmd("gcs_unban", "cmd_unban", ADMIN_BAN, "<authid|ip> [motiv]");
	register_concmd("gcs_mute", "cmd_comm", ADMIN_CHAT, "<nume|#userid> <minute> [motiv] — mute vocal");
	register_concmd("gcs_gag", "cmd_comm", ADMIN_CHAT, "<nume|#userid> <minute> [motiv] — gag (chat)");
	register_concmd("gcs_unmute", "cmd_uncomm", ADMIN_CHAT, "<nume|#userid> [motiv]");
	register_concmd("gcs_ungag", "cmd_uncomm", ADMIN_CHAT, "<nume|#userid> [motiv]");
	register_concmd("gcs_match", "cmd_match", ADMIN_CFG, "<start|live|halftime|end|abort> — meciul mix urmărit de GCS");
	register_concmd("gcs_sync", "cmd_sync", ADMIN_RCON, "— trage acum listele de la site");
	// Aliasurile clasice (cu `gcs_amx_aliases 1`); jurnalul acțiunilor pentru comenzile adminilor din AMX Mod X.
	register_concmd("amx_ban", "cmd_amx_ban", ADMIN_BAN | ADMIN_BAN_TEMP, "<nume|#userid|authid> <minute> [motiv]");
	register_concmd("amx_unban", "cmd_amx_unban", ADMIN_BAN, "<authid|ip>");
	register_concmd("amx_kick", "log_kick", ADMIN_KICK);
	register_concmd("amx_slay", "log_slay", ADMIN_SLAY);
	register_concmd("amx_slap", "log_slap", ADMIN_SLAY);
	register_concmd("amx_map", "log_map", ADMIN_MAP);
}

/** Modulele s-au schimbat pe site: ce s-a oprit nu mai atinge nimic, ce s-a pornit își trage listele acum. */
stock features_changed(const bool:before[])
{
	apply_features();
	if (before[FEAT_ADMINS] && !feat(FEAT_ADMINS))
	{
		// Adminii revin la sistemul serverului (users.ini): AMX Mod X îi reîncarcă pentru toți jucătorii.
		for (new id = 1; id <= MaxClients; id++)
		{
			g_adminId[id] = 0;
			g_vipAdded[id] = 0;
		}
		server_cmd("amx_reloadadmins");
	}
	else if (before[FEAT_VIP] && !feat(FEAT_VIP) && !feat(FEAT_ADMINS))
	{
		// Doar flag-urile adăugate de GCS dispar.
		for (new id = 1; id <= MaxClients; id++)
		{
			if (is_user_connected(id) && g_vipAdded[id]) remove_user_flags(id, g_vipAdded[id]);
			g_vipAdded[id] = 0;
		}
	}
	if (before[FEAT_SANCTIONS] && !feat(FEAT_SANCTIONS))
	{
		for (new id = 1; id <= MaxClients; id++) if (is_user_connected(id) && (g_muted[id] || g_gagged[id])) set_comm(id, false, false);
	}
	new bool:pull = false;
	for (new f = FEAT_ADMINS; f <= FEAT_VIP; f++) if (!before[f] && feat(f)) pull = true;
	if (pull)
	{
		g_etagAdmins[0] = EOS;
		g_etagVip[0] = EOS;
		pull_lists(true);
	}
}

/** Flag-urile de admin actuale ale jucătorului, din sistemul serverului (doar citite; fără `z`). */
stock set_admin_flags(JSON:ref, id)
{
	new letters[32];
	get_flags(get_user_flags(id) & ~ADMIN_USER, letters, charsmax(letters));
	if (letters[0]) json_object_set_string(ref, "flags", letters);
}

stock pull_sanctions()
{
	if (g_pullingSanctions) return;
	g_pullingSanctions = true;
	new path[96];
	formatex(path, charsmax(path), "/sanctions?since=%d&limit=%d", g_cursor, SANCTION_PAGE);
	g_removedAtPull = g_removedTotal;
	if (!bridge_request("GET", path, "", REQ_SANCTIONS)) g_pullingSanctions = false;
}

public cmd_sync(id, level, cid)
{
	if (!feat(FEAT_COMMANDS)) return PLUGIN_CONTINUE;
	if (!cmd_access(id, level, cid, 1)) return PLUGIN_HANDLED;
	g_etagAdmins[0] = EOS;
	g_etagVip[0] = EOS;
	pull_lists(true);
	console_print(id, "[GCS] Sincronizarea a pornit.");
	return PLUGIN_HANDLED;
}

// ─── Identitatea ────────────────────────────────────────────────────────────

/** Steam confirmat de ReAPI / Reunion: 1, non-Steam: 0, necunoscut: -1. */
stock steam_state(id)
{
#if defined _reapi_included
	if (LibraryExists("reapi", LibType_Library) && has_reunion()) return REU_GetAuthtype(id) == CA_TYPE_STEAM ? 1 : 0;
#endif
	#pragma unused id
	return -1;
}

/** Contul `Y:Z` dintr-un `STEAM_X:Y:Z` / `VALVE_X:Y:Z` (universul se ignoră). */
stock auth_account(const auth[], out[], len)
{
	new colon = contain(auth, ":");
	if (colon < 0 || (!equal(auth, "STEAM_", 6) && !equal(auth, "VALVE_", 6)))
	{
		out[0] = EOS;
		return 0;
	}
	copy(out, len, auth[colon + 1]);
	return 1;
}

stock bool:is_valid_auth(const auth[])
{
	if (!equal(auth, "STEAM_", 6) && !equal(auth, "VALVE_", 6)) return false;
	if (contain(auth, "_ID_") != -1 || equal(auth, "STEAM_666:88:666")) return false;
	return true;
}

/** Identitatea locală (aceleași reguli ca GCS, §3.2), pentru listele locale. */
stock local_kind(id)
{
	if (!is_valid_auth(g_auth[id])) return g_nameIds ? KIND_NAME : KIND_NONE;
	if (equal(g_auth[id], "VALVE_", 6)) return KIND_NONSTEAM;
	if (g_steam[id] == 1 || (g_steam[id] == -1 && equal(g_identityMode, "steam"))) return KIND_STEAM;
	return KIND_NONSTEAM;
}

/** Numele normalizat ca în GCS: fără coduri ^N, spații comprimate, litere mici (ASCII), max 32. */
stock normalize_name(const name[], out[], len)
{
	new j = 0, bool:space = false;
	for (new i = 0; name[i] != EOS && j < len; i++)
	{
		new c = name[i];
		if (c == '^^' && name[i + 1] >= '0' && name[i + 1] <= '9')
		{
			i++;
			continue;
		}
		if (c < 32) continue;
		if (c == ' ')
		{
			space = true;
			continue;
		}
		if (space && j > 0 && j < len) out[j++] = ' ';
		space = false;
		out[j++] = (c >= 'A' && c <= 'Z') ? c + 32 : c;
	}
	out[min(j, len)] = EOS;
	if (strlen(out) > 32) out[32] = EOS;
}

/** Referința jucătorului (§6.3): GCS decide identitatea, pluginul doar raportează. */
stock JSON:player_ref(id)
{
	new JSON:ref = json_init_object();
	new name[NAME_LEN], ip[46];
	get_user_name(id, name, charsmax(name));
	get_user_ip(id, ip, charsmax(ip), 1);
	json_object_set_string(ref, "auth", g_auth[id]);
	if (g_steam[id] >= 0) json_object_set_bool(ref, "steam", g_steam[id] == 1);
	json_object_set_string(ref, "name", name);
	json_object_set_string(ref, "ip", ip);
	return ref;
}

/** Referința consolei serverului (acțiunile fără admin în joc). */
stock JSON:console_ref()
{
	new JSON:ref = json_init_object();
	json_object_set_string(ref, "auth", "CONSOLE");
	json_object_set_string(ref, "name", "Console");
	return ref;
}

// ─── Coada de evenimente ────────────────────────────────────────────────────

/**
 * Pune un eveniment în coadă: id unic (același la retrimitere) și timpul în ceasul GCS. Întoarce poziția lui de la
 * pornire (1, 2, …; vezi `g_removedTotal`), sau 0 dacă evenimentul a fost aruncat.
 */
stock queue_event(JSON:event)
{
	new eventId[40];
	g_seq++;
	formatex(eventId, charsmax(eventId), "%s-%d-%d", g_runId, get_systime(), g_seq);
	json_object_set_string(event, "id", eventId);
	json_object_set_number(event, "at", gcs_now());
	static item[ITEM];
	// Un eveniment tăiat ar strica tot lotul (JSON invalid): peste limită se aruncă și se notează.
	if (json_serial_size(event) >= charsmax(item))
	{
		log_amx("[GCS] Eveniment prea mare (peste %d caractere), aruncat.", charsmax(item));
		json_free(event);
		return 0;
	}
	json_serial_to_string(event, item, charsmax(item));
	json_free(event);
	if (queue_size() >= MAX_QUEUE)
	{
		// Coada e plină (site-ul e căzut de mult): se pierde cel mai vechi eveniment; în timpul unui lot trimis (ale
		// cărui poziții trebuie să rămână aceleași), cel nou.
		if (g_inflight) return 0;
		remove_front(1);
	}
	ArrayPushString(g_queue, item);
	return g_removedTotal + queue_size();
}

stock JSON:new_event(const type[])
{
	new JSON:event = json_init_object();
	json_object_set_string(event, "type", type);
	return event;
}

stock set_ref(JSON:event, const key[], id)
{
	new JSON:ref = id > 0 ? player_ref(id) : console_ref();
	json_object_set_value(event, key, ref);
	json_free(ref);
}

stock queue_path(path[], len)
{
	formatex(path, len, "%s/gcs_bridge_queue.txt", g_dataDir);
}

/** La oprire / schimbarea hărții, evenimentele netrimise se salvează (aceleași id-uri la retrimitere). */
stock save_queue()
{
	new path[192];
	queue_path(path, charsmax(path));
	if (file_exists(path)) delete_file(path);
	new total = ArraySize(g_queue);
	if (total <= g_queueHead) return;
	new file = fopen(path, "wt");
	if (!file) return;
	static item[ITEM];
	for (new i = g_queueHead; i < total; i++)
	{
		ArrayGetString(g_queue, i, item, charsmax(item));
		fprintf(file, "%s^n", item);
	}
	fclose(file);
}

stock load_queue()
{
	new path[192];
	queue_path(path, charsmax(path));
	new file = fopen(path, "rt");
	if (!file) return;
	static line[ITEM];
	while (!feof(file))
	{
		fgets(file, line, charsmax(line));
		trim(line);
		if (line[0] == '{' && queue_size() < MAX_QUEUE) ArrayPushString(g_queue, line);
	}
	fclose(file);
	delete_file(path);
}

public native_queue_event(plugin, params)
{
	static json[ITEM];
	get_string(1, json, charsmax(json));
	new JSON:event = json_parse(json);
	if (event == Invalid_JSON || !json_object_has_value(event, "type", JSONString))
	{
		if (event != Invalid_JSON) json_free(event);
		return false;
	}
	queue_event(event);
	return true;
}

// ─── Listele locale (admini, VIP, sancțiuni) ────────────────────────────────

stock list_path(const name[], path[], len)
{
	formatex(path, len, "%s/gcs_bridge_%s.json", g_dataDir, name);
}

/** `auth` dintr-o intrare: tipul (steam / nonsteam) și ID-ul de comparat (Steam2 pentru Steam). */
stock read_auth(JSON:item, &kind, auth[], len)
{
	new JSON:a = json_object_get_value(item, "auth");
	kind = KIND_NONE;
	auth[0] = EOS;
	if (a == Invalid_JSON) return;
	if (json_get_type(a) == JSONObject)
	{
		new k[12];
		json_object_get_string(a, "kind", k, charsmax(k));
		if (equal(k, "steam"))
		{
			kind = KIND_STEAM;
			json_object_get_string(a, "steam2", auth, len);
		}
		else if (equal(k, "nonsteam"))
		{
			kind = KIND_NONSTEAM;
			json_object_get_string(a, "id", auth, len);
		}
		else if (equal(k, "name"))
		{
			kind = KIND_NAME;
			json_object_get_string(a, "name", auth, len);
		}
	}
	json_free(a);
}

stock json_time(JSON:item, const key[])
{
	return json_object_has_value(item, key, JSONNumber) ? json_object_get_number(item, key) : 0;
}

stock on_admins(JSON:root)
{
	if (root == Invalid_JSON) return;
	json_object_get_string(root, "etag", g_etagAdmins, charsmax(g_etagAdmins));
	new JSON:list = json_object_get_value(root, "admins");
	if (list == Invalid_JSON) return;
	load_admins(list);
	new path[192];
	list_path("admins", path, charsmax(path));
	json_serial_to_file(list, path);
	json_free(list);
	if (feat(FEAT_ADMINS) || feat(FEAT_VIP)) for (new id = 1; id <= MaxClients; id++) if (is_user_connected(id)) apply_rights(id);
}

stock load_admins(JSON:list)
{
	ArrayClear(g_admins);
	new entry[AdminEntry], flags[32];
	for (new i = 0, n = json_array_get_count(list); i < n; i++)
	{
		new JSON:item = json_array_get_value(list, i);
		entry[AE_Id] = json_object_get_number(item, "id");
		read_auth(item, entry[AE_Kind], entry[AE_Auth], AUTH_LEN - 1);
		entry[AE_Salt][0] = EOS;
		entry[AE_Verifier][0] = EOS;
		if (entry[AE_Kind] == KIND_NAME)
		{
			json_object_get_string(item, "auth.salt", entry[AE_Salt], 32, true);
			json_object_get_string(item, "auth.verifier", entry[AE_Verifier], 64, true);
		}
		json_object_get_string(item, "flags", flags, charsmax(flags));
		entry[AE_Flags] = read_flags(flags);
		entry[AE_Immunity] = json_object_get_number(item, "immunity");
		entry[AE_Expires] = json_time(item, "expiresAt");
		json_free(item);
		if (entry[AE_Kind] != KIND_NONE) ArrayPushArray(g_admins, entry);
	}
}

stock on_vip(JSON:root)
{
	if (root == Invalid_JSON) return;
	json_object_get_string(root, "etag", g_etagVip, charsmax(g_etagVip));
	new JSON:list = json_object_get_value(root, "vip");
	if (list == Invalid_JSON) return;
	load_vip(list);
	new path[192];
	list_path("vip", path, charsmax(path));
	json_serial_to_file(list, path);
	json_free(list);
	if (feat(FEAT_ADMINS) || feat(FEAT_VIP)) for (new id = 1; id <= MaxClients; id++) if (is_user_connected(id)) apply_rights(id);
}

stock load_vip(JSON:list)
{
	ArrayClear(g_vip);
	new entry[VipEntry], flags[32];
	for (new i = 0, n = json_array_get_count(list); i < n; i++)
	{
		new JSON:item = json_array_get_value(list, i);
		read_auth(item, entry[VE_Kind], entry[VE_Auth], AUTH_LEN - 1);
		json_object_get_string(item, "flags", flags, charsmax(flags));
		entry[VE_Flags] = read_flags(flags);
		entry[VE_Expires] = json_time(item, "expiresAt");
		json_free(item);
		if (entry[VE_Kind] == KIND_STEAM || entry[VE_Kind] == KIND_NONSTEAM) ArrayPushArray(g_vip, entry);
	}
}

stock sanction_type(const type[])
{
	return equal(type, "mute") ? SAN_MUTE : equal(type, "gag") ? SAN_GAG : SAN_BAN;
}

/** O sancțiune din JSON (lista sincronizată sau răspunsul `/check`). */
stock parse_sanction(JSON:item, entry[SanctionEntry])
{
	new type[8];
	entry[SE_Id] = json_object_get_number(item, "id");
	json_object_get_string(item, "type", type, charsmax(type));
	entry[SE_Type] = sanction_type(type);
	read_auth(item, entry[SE_Kind], entry[SE_Auth], AUTH_LEN - 1);
	entry[SE_Ip][0] = EOS;
	entry[SE_Name][0] = EOS;
	if (json_object_has_value(item, "ip", JSONString)) json_object_get_string(item, "ip", entry[SE_Ip], 45);
	if (json_object_has_value(item, "name", JSONString)) json_object_get_string(item, "name", entry[SE_Name], NAME_LEN - 1);
	json_object_get_string(item, "reason", entry[SE_Reason], 199);
	json_object_get_string(item, "admin", entry[SE_Admin], 32);
	entry[SE_Expires] = json_time(item, "expiresAt");
}

stock find_sanction(sanctionId)
{
	new entry[SanctionEntry];
	for (new i = 0, n = ArraySize(g_sanctions); i < n; i++)
	{
		ArrayGetArray(g_sanctions, i, entry);
		if (entry[SE_Id] == sanctionId) return i;
	}
	return -1;
}

stock on_sanctions(JSON:root)
{
	g_pullingSanctions = false;
	if (root == Invalid_JSON) return;
	new bool:full = json_object_get_bool(root, "full");
	new entry[SanctionEntry];
	// Prima pagină a unei sincronizări complete înlocuiește lista locală; bannurile date acum din joc (id negativ, încă
	// netrimise) rămân.
	if (full && !g_sanctionsFull)
	{
		for (new i = ArraySize(g_sanctions) - 1; i >= 0; i--)
		{
			ArrayGetArray(g_sanctions, i, entry);
			if (entry[SE_Id] >= 0) ArrayDeleteItem(g_sanctions, i);
		}
	}
	g_sanctionsFull = full;
	new JSON:list = json_object_get_value(root, "sanctions");
	if (list != Invalid_JSON)
	{
		for (new i = 0, n = json_array_get_count(list); i < n; i++)
		{
			new JSON:item = json_array_get_value(list, i);
			new sanctionId = json_object_get_number(item, "id");
			new index = find_sanction(sanctionId);
			if (json_object_get_bool(item, "active"))
			{
				parse_sanction(item, entry);
				if (index >= 0) ArraySetArray(g_sanctions, index, entry);
				else ArrayPushArray(g_sanctions, entry);
			}
			else if (index >= 0) ArrayDeleteItem(g_sanctions, index);
			json_free(item);
		}
		json_free(list);
	}
	g_cursor = json_object_get_number(root, "cursor");
	if (json_object_get_bool(root, "more"))
	{
		pull_sanctions();
		return;
	}
	g_sanctionsFull = false;
	// Bannurile date din joc se aplică imediat, cu id-ul -poziția evenimentului în coadă. Dacă evenimentul ieșise din
	// coadă înainte de cererea acestei pagini, lista GCS îl conține (sau GCS l-a respins): intrarea locală dispare, ca o
	// ridicare a banului pe site să conteze.
	for (new i = ArraySize(g_sanctions) - 1; i >= 0; i--)
	{
		ArrayGetArray(g_sanctions, i, entry);
		if (entry[SE_Id] < 0 && -entry[SE_Id] <= g_removedAtPull) ArrayDeleteItem(g_sanctions, i);
	}
	save_sanctions();
	if (feat(FEAT_SANCTIONS)) for (new id = 1; id <= MaxClients; id++) if (is_user_connected(id)) apply_sanctions(id);
}

stock save_sanctions()
{
	new JSON:root = json_init_object(), JSON:list = json_init_array();
	new entry[SanctionEntry];
	for (new i = 0, n = ArraySize(g_sanctions); i < n; i++)
	{
		ArrayGetArray(g_sanctions, i, entry);
		new JSON:item = json_init_object();
		json_object_set_number(item, "id", entry[SE_Id]);
		json_object_set_number(item, "t", entry[SE_Type]);
		json_object_set_number(item, "k", entry[SE_Kind]);
		json_object_set_string(item, "auth", entry[SE_Auth]);
		json_object_set_string(item, "ip", entry[SE_Ip]);
		json_object_set_string(item, "name", entry[SE_Name]);
		json_object_set_string(item, "reason", entry[SE_Reason]);
		json_object_set_string(item, "admin", entry[SE_Admin]);
		json_object_set_number(item, "expires", entry[SE_Expires]);
		json_array_append_value(list, item);
		json_free(item);
	}
	json_object_set_number(root, "cursor", g_cursor);
	json_object_set_value(root, "sanctions", list);
	json_free(list);
	new path[192];
	list_path("sanctions", path, charsmax(path));
	json_serial_to_file(root, path);
	json_free(root);
}

/** Listele salvate la ultima sincronizare: adminii și bannurile merg și cu site-ul căzut. */
stock load_lists()
{
	new path[192];
	list_path("admins", path, charsmax(path));
	new JSON:list = file_exists(path) ? json_parse(path, true) : Invalid_JSON;
	if (list != Invalid_JSON)
	{
		load_admins(list);
		json_free(list);
	}
	list_path("vip", path, charsmax(path));
	list = file_exists(path) ? json_parse(path, true) : Invalid_JSON;
	if (list != Invalid_JSON)
	{
		load_vip(list);
		json_free(list);
	}
	list_path("sanctions", path, charsmax(path));
	new JSON:root = file_exists(path) ? json_parse(path, true) : Invalid_JSON;
	if (root == Invalid_JSON) return;
	g_cursor = json_object_get_number(root, "cursor");
	list = json_object_get_value(root, "sanctions");
	new entry[SanctionEntry];
	for (new i = 0, n = list != Invalid_JSON ? json_array_get_count(list) : 0; i < n; i++)
	{
		new JSON:item = json_array_get_value(list, i);
		entry[SE_Id] = json_object_get_number(item, "id");
		entry[SE_Type] = json_object_get_number(item, "t");
		entry[SE_Kind] = json_object_get_number(item, "k");
		json_object_get_string(item, "auth", entry[SE_Auth], AUTH_LEN - 1);
		json_object_get_string(item, "ip", entry[SE_Ip], 45);
		json_object_get_string(item, "name", entry[SE_Name], NAME_LEN - 1);
		json_object_get_string(item, "reason", entry[SE_Reason], 199);
		json_object_get_string(item, "admin", entry[SE_Admin], 32);
		entry[SE_Expires] = json_object_get_number(item, "expires");
		ArrayPushArray(g_sanctions, entry);
		json_free(item);
	}
	if (list != Invalid_JSON) json_free(list);
	json_free(root);
}

// ─── Aplicarea pe jucători ──────────────────────────────────────────────────

/** Intrarea (Steam / non-Steam) se potrivește cu jucătorul: contul `Y:Z`, universul ignorat; prefixul VALVE contează. */
stock bool:auth_matches(id, kind, const auth[])
{
	if (kind == KIND_NONE || kind == KIND_NAME || kind != g_kind[id]) return false;
	new a[AUTH_LEN], b[AUTH_LEN];
	if (!auth_account(auth, a, charsmax(a)) || !auth_account(g_auth[id], b, charsmax(b))) return false;
	if (kind == KIND_NONSTEAM && (equal(auth, "VALVE_", 6) != equal(g_auth[id], "VALVE_", 6))) return false;
	return bool:equal(a, b);
}

stock bool:expired(expires)
{
	return expires > 0 && expires <= gcs_now();
}

/**
 * Drepturile din liste. Cu modulul „admins”: adminii (identitate) și VIP-ul înlocuiesc drepturile jucătorului; fără nimic,
 * utilizator simplu (`z`). Doar cu „vip”: flag-urile VIP se adaugă peste drepturile serverului, iar la schimbare se scot
 * doar cele adăugate de GCS. Fără niciunul, nimic nu se atinge.
 */
stock apply_rights(id)
{
	if (is_user_bot(id) || is_user_hltv(id)) return;
	new bool:admins = feat(FEAT_ADMINS), bool:vipOn = feat(FEAT_VIP);
	if (!admins && !vipOn) return;
	new flags = 0, vipFlags = 0, entry[AdminEntry], vip[VipEntry];
	g_adminId[id] = g_adminId[id] < 0 ? g_adminId[id] : 0;
	for (new i = 0, n = admins ? ArraySize(g_admins) : 0; i < n; i++)
	{
		ArrayGetArray(g_admins, i, entry);
		if (expired(entry[AE_Expires]) || entry[AE_Kind] == KIND_NAME) continue;
		if (auth_matches(id, entry[AE_Kind], entry[AE_Auth]))
		{
			flags |= entry[AE_Flags];
			if (!g_adminId[id]) g_adminId[id] = entry[AE_Id];
		}
	}
	// Adminul pe nume (logat cu parola): `g_adminId` negativ păstrează id-ul intrării.
	if (admins && g_adminId[id] < 0)
	{
		for (new i = 0, n = ArraySize(g_admins); i < n; i++)
		{
			ArrayGetArray(g_admins, i, entry);
			if (entry[AE_Id] == -g_adminId[id] && !expired(entry[AE_Expires])) flags |= entry[AE_Flags];
		}
	}
	for (new i = 0, n = vipOn ? ArraySize(g_vip) : 0; i < n; i++)
	{
		ArrayGetArray(g_vip, i, vip);
		if (!expired(vip[VE_Expires]) && auth_matches(id, vip[VE_Kind], vip[VE_Auth])) vipFlags |= vip[VE_Flags];
	}
	if (admins)
	{
		remove_user_flags(id);
		set_user_flags(id, (flags | vipFlags) ? (flags | vipFlags) : ADMIN_USER);
		g_vipAdded[id] = 0;
		return;
	}
	// Doar VIP: drepturile serverului rămân; se adaugă doar flag-urile lipsă (și se scot doar cele adăugate de GCS).
	if (g_vipAdded[id]) remove_user_flags(id, g_vipAdded[id]);
	g_vipAdded[id] = vipFlags & ~get_user_flags(id);
	if (g_vipAdded[id]) set_user_flags(id, g_vipAdded[id]);
}

/**
 * Adminii pe nume + parolă (§7.3): parola din setinfo (`gcs_password_field`), SHA-256(salt:parolă) comparat cu
 * verificatorul. Cu `gcs_name_protect 1`, cine folosește numele unui admin fără parola corectă e dat afară.
 */
stock check_name_admin(id)
{
	new name[NAME_LEN], normalized[NAME_LEN], field[32], password[64], buffer[160], digest[65];
	get_user_name(id, name, charsmax(name));
	normalize_name(name, normalized, charsmax(normalized));
	get_pcvar_string(g_cvarPwField, field, charsmax(field));
	get_user_info(id, field, password, charsmax(password));
	new entry[AdminEntry];
	for (new i = 0, n = ArraySize(g_admins); i < n; i++)
	{
		ArrayGetArray(g_admins, i, entry);
		if (entry[AE_Kind] != KIND_NAME || expired(entry[AE_Expires]) || !equal(entry[AE_Auth], normalized)) continue;
		formatex(buffer, charsmax(buffer), "%s:%s", entry[AE_Salt], password);
		hash_string(buffer, Hash_Sha256, digest, charsmax(digest));
		if (password[0] && equali(digest, entry[AE_Verifier]))
		{
			if (g_adminId[id] != -entry[AE_Id])
			{
				g_adminId[id] = -entry[AE_Id];
				new JSON:event = new_event("admin_login");
				set_ref(event, "player", id);
				json_object_set_number(event, "adminId", entry[AE_Id]);
				queue_event(event);
			}
			return;
		}
		if (get_pcvar_num(g_cvarNameProtect))
		{
			server_cmd("kick #%d ^"Nume rezervat (parola lipsește sau e greșită)^"", get_user_userid(id));
		}
		return;
	}
	if (g_adminId[id] < 0) g_adminId[id] = 0;
}

/** Sancțiunile locale ale jucătorului: ban → kick; mute → vocea oprită; gag → chat-ul blocat. */
stock apply_sanctions(id)
{
	if (!is_user_connected(id) || is_user_bot(id)) return;
	new ip[46], name[NAME_LEN], normalized[NAME_LEN], entry[SanctionEntry];
	get_user_ip(id, ip, charsmax(ip), 1);
	get_user_name(id, name, charsmax(name));
	normalize_name(name, normalized, charsmax(normalized));
	new bool:mute = false, bool:gag = false;
	for (new i = 0, n = ArraySize(g_sanctions); i < n; i++)
	{
		ArrayGetArray(g_sanctions, i, entry);
		if (expired(entry[SE_Expires])) continue;
		new bool:hit = auth_matches(id, entry[SE_Kind], entry[SE_Auth]) || (entry[SE_Ip][0] && equal(entry[SE_Ip], ip));
		// Banul pe nume (fără identitate) se aplică doar jucătorilor care nu sunt Steam.
		if (!hit && entry[SE_Kind] == KIND_NONE && entry[SE_Name][0] && g_kind[id] != KIND_STEAM && equal(entry[SE_Name], normalized)) hit = true;
		if (!hit) continue;
		switch (entry[SE_Type])
		{
			case SAN_BAN:
			{
				kick_banned(id, entry[SE_Reason], entry[SE_Expires]);
				return;
			}
			case SAN_MUTE: mute = true;
			case SAN_GAG: gag = true;
		}
	}
	set_comm(id, mute, gag);
}

stock set_comm(id, bool:mute, bool:gag)
{
	g_muted[id] = mute;
	g_gagged[id] = gag;
	set_speak(id, mute ? SPEAK_MUTED : SPEAK_NORMAL);
}

stock kick_banned(id, const reason[], expires)
{
	new left[48], text[200];
	if (expires > 0) formatex(left, charsmax(left), "%d minute rămase", max(1, (expires - gcs_now()) / 60));
	else copy(left, charsmax(left), "permanent");
	// Motivul (de pe site sau de la un admin) ajunge într-o comandă a serverului: ghilimelele și liniile noi ar închide-o
	// și ar permite alte comenzi după ea.
	copy(text, charsmax(text), reason);
	replace_string(text, charsmax(text), "^"", "'");
	replace_string(text, charsmax(text), "^n", " ");
	replace_string(text, charsmax(text), "^r", " ");
	server_cmd("kick #%d ^"Banat: %s (%s)^"", get_user_userid(id), text, left);
}

// ─── Conectări ──────────────────────────────────────────────────────────────

public client_authorized(id, const authid[])
{
	copy(g_auth[id], AUTH_LEN - 1, authid);
}

public client_putinserver(id)
{
	g_userid[id] = get_user_userid(id);
	g_adminId[id] = 0;
	g_muted[id] = false;
	g_gagged[id] = false;
	g_ready[id] = false;
	g_linkedChecked[id] = false;
	reset_weapon_stats(id);
	if (is_user_bot(id) || is_user_hltv(id)) return;
	if (!g_auth[id][0]) get_user_authid(id, g_auth[id], AUTH_LEN - 1);
	g_steam[id] = steam_state(id);
	g_kind[id] = local_kind(id);
	g_vipAdded[id] = 0;

	// Modulele de administrare (oprite implicit): mai întâi listele locale (merg și fără site), apoi verificarea
	// proaspătă (`/check`, 3 secunde).
	if (feat(FEAT_SANCTIONS)) apply_sanctions(id);
	if (!is_user_connected(id)) return;
	if (feat(FEAT_ADMINS)) check_name_admin(id);
	apply_rights(id);

	new JSON:event = new_event("connect");
	new JSON:ref = player_ref(id);
	set_admin_flags(ref, id);
	json_object_set_value(event, "player", ref);
	json_free(ref);
	queue_event(event);

	if (!feat(FEAT_SANCTIONS) && !feat(FEAT_ADMINS) && !feat(FEAT_VIP)) return;
	new JSON:body = json_init_object();
	set_ref(body, "player", id);
	static text[ITEM];
	json_serial_to_string(body, text, charsmax(text));
	json_free(body);
	bridge_request("POST", "/check", text, REQ_CHECK, id);
}

public client_infochanged(id)
{
	// Numele schimbat: adminii pe nume + parolă și flag-urile VIP (sistemul serverului le poate reseta).
	if ((feat(FEAT_ADMINS) || feat(FEAT_VIP)) && is_user_connected(id) && !is_user_bot(id)) set_task(0.1, "task_recheck_name", id);
}

public task_recheck_name(id)
{
	if (!is_user_connected(id)) return;
	if (feat(FEAT_ADMINS)) check_name_admin(id);
	apply_rights(id);
}

public client_disconnected(id)
{
	if (g_userid[id] && !is_user_bot(id) && !is_user_hltv(id) && g_auth[id][0])
	{
		flush_weapon_stats(id);
		new JSON:event = new_event("disconnect");
		// Referința se construiește din datele salvate (jucătorul pleacă).
		new JSON:ref = json_init_object();
		new name[NAME_LEN], ip[46];
		get_user_name(id, name, charsmax(name));
		get_user_ip(id, ip, charsmax(ip), 1);
		json_object_set_string(ref, "auth", g_auth[id]);
		if (g_steam[id] >= 0) json_object_set_bool(ref, "steam", g_steam[id] == 1);
		json_object_set_string(ref, "name", name);
		json_object_set_string(ref, "ip", ip);
		json_object_set_value(event, "player", ref);
		json_free(ref);
		json_object_set_number(event, "playtime", get_user_time(id, 1));
		queue_event(event);
	}
	g_auth[id][0] = EOS;
	g_userid[id] = 0;
	g_adminId[id] = 0;
	g_vipAdded[id] = 0;
	g_ready[id] = false;
	// Slotul poate fi luat de alt jucător: echipa și cifrele din meci nu se moștenesc.
	g_matchTeam[id] = 0;
	g_matchKills[id] = 0;
	g_matchDeaths[id] = 0;
	g_matchHs[id] = 0;
	g_matchDamage[id] = 0;
}

stock on_check(id, JSON:root)
{
	if (root == Invalid_JSON || !feat(FEAT_SANCTIONS)) return;
	new entry[SanctionEntry];
	new JSON:ban = json_object_get_value(root, "ban");
	if (ban != Invalid_JSON && json_get_type(ban) == JSONObject)
	{
		parse_sanction(ban, entry);
		if (find_sanction(entry[SE_Id]) < 0) ArrayPushArray(g_sanctions, entry);
		kick_banned(id, entry[SE_Reason], entry[SE_Expires]);
	}
	if (ban != Invalid_JSON) json_free(ban);
	if (!is_user_connected(id)) return;
	new JSON:mute = json_object_get_value(root, "mute"), JSON:gag = json_object_get_value(root, "gag");
	new bool:muted = mute != Invalid_JSON && json_get_type(mute) == JSONObject;
	new bool:gagged = gag != Invalid_JSON && json_get_type(gag) == JSONObject;
	if (mute != Invalid_JSON) json_free(mute);
	if (gag != Invalid_JSON) json_free(gag);
	set_comm(id, muted || g_muted[id], gagged || g_gagged[id]);
}

// ─── Statisticile ───────────────────────────────────────────────────────────

stock reset_weapon_stats(id)
{
	for (new w = 0; w <= CSW_P90; w++)
	{
		g_shots[id][w] = 0;
		g_hits[id][w] = 0;
		g_damage[id][w] = 0;
		g_hs[id][w] = 0;
	}
}

/** Deltele de precizie și damage acumulate (evenimentul `weapon_stats`, pe armă). */
stock flush_weapon_stats(id)
{
	new name[32];
	for (new w = 1; w <= CSW_P90; w++)
	{
		if (!g_shots[id][w] && !g_hits[id][w] && !g_damage[id][w]) continue;
		get_weaponname(w, name, charsmax(name));
		new JSON:event = new_event("weapon_stats");
		set_ref(event, "player", id);
		json_object_set_string(event, "weapon", name);
		json_object_set_number(event, "shots", g_shots[id][w]);
		json_object_set_number(event, "hits", g_hits[id][w]);
		json_object_set_number(event, "damage", g_damage[id][w]);
		json_object_set_number(event, "headshots", g_hs[id][w]);
		queue_event(event);
	}
	reset_weapon_stats(id);
}

public ham_attack_pre(weapon)
{
	new owner = pev(weapon, pev_owner);
	if (owner >= 1 && owner <= MaxClients) g_clipBefore[owner] = cs_get_weapon_ammo(weapon);
}

public ham_attack_post(weapon)
{
	new owner = pev(weapon, pev_owner);
	if (owner < 1 || owner > MaxClients) return;
	if (cs_get_weapon_ammo(weapon) < g_clipBefore[owner])
	{
		new w = cs_get_weapon_id(weapon);
		if (w > 0 && w <= CSW_P90) g_shots[owner][w]++;
	}
}

public ev_damage(victim)
{
	new weapon, hitzone;
	new attacker = get_user_attacker(victim, weapon, hitzone);
	if (attacker < 1 || attacker > MaxClients || attacker == victim || weapon < 1 || weapon > CSW_P90) return;
	new damage = read_data(2);
	g_hits[attacker][weapon]++;
	g_damage[attacker][weapon] += damage;
	if (hitzone == HIT_HEAD) g_hs[attacker][weapon]++;
	if (g_mixState == MIX_LIVE) g_matchDamage[attacker] += damage;
}

public ev_death()
{
	new killer = read_data(1), victim = read_data(2), headshot = read_data(3);
	new weapon[32];
	read_data(4, weapon, charsmax(weapon));
	// Boții nu sunt urmăriți ca victime; ucis de un bot = ucigaș neurmărit (nu sinucidere).
	if (victim < 1 || victim > MaxClients || is_user_bot(victim) || is_user_hltv(victim)) return;
	new JSON:event = new_event("kill");
	new map[64];
	get_mapname(map, charsmax(map));
	set_ref(event, "victim", victim);
	new bool:suicide = killer < 1 || killer > MaxClients || killer == victim;
	if (!suicide)
	{
		set_ref(event, "killer", killer);
		if (is_user_bot(killer)) json_object_set_bool(event, "killer.bot", true, true);
		else if (get_user_team(killer) == get_user_team(victim)) json_object_set_bool(event, "teamkill", true);
	}
	json_object_set_string(event, "weapon", weapon);
	json_object_set_bool(event, "headshot", headshot != 0);
	json_object_set_string(event, "map", map);
	queue_event(event);

	if (g_mixState == MIX_LIVE)
	{
		g_matchDeaths[victim]++;
		if (!suicide)
		{
			g_matchKills[killer]++;
			if (headshot) g_matchHs[killer]++;
		}
	}
}

public ev_win_t()
{
	round_end("T");
}

public ev_win_ct()
{
	round_end("CT");
}

public ev_win_draw()
{
	round_end("draw");
}

/**
 * Sfârșitul rundei: rundele jucate / câștigate, focurile și, în meciul mix, scorul și istoricul rundelor. Jucătorii
 * pleacă în loturi de câte ROUND_CHUNK (un eveniment `round_end` pe lot, ca să încapă în ITEM); GCS numără rundele pe
 * jucător, deci împărțirea nu schimbă nimic.
 */
stock round_end(const winner[])
{
	new JSON:event = Invalid_JSON, JSON:players = Invalid_JSON, team[16], map[64], count = 0;
	get_mapname(map, charsmax(map));
	for (new id = 1; id <= MaxClients; id++)
	{
		if (!is_user_connected(id) || is_user_bot(id) || is_user_hltv(id)) continue;
		get_user_team(id, team, charsmax(team));
		if (!equal(team, "CT") && !equal(team, "TERRORIST")) continue;
		if (event == Invalid_JSON)
		{
			event = new_event("round_end");
			json_object_set_string(event, "winner", winner);
			json_object_set_string(event, "map", map);
			players = json_init_array();
			count = 0;
		}
		new JSON:item = json_init_object();
		set_ref(item, "player", id);
		new code[8];
		team_code(team, code, charsmax(code));
		json_object_set_string(item, "team", code);
		json_array_append_value(players, item);
		json_free(item);
		flush_weapon_stats(id);
		if (++count >= ROUND_CHUNK)
		{
			queue_round_end(event, players);
			event = Invalid_JSON;
		}
	}
	if (event != Invalid_JSON) queue_round_end(event, players);
	if (g_mixState == MIX_LIVE) mix_round_end(winner);
}

stock queue_round_end(JSON:event, JSON:players)
{
	json_object_set_value(event, "players", players);
	json_free(players);
	queue_event(event);
}

// ─── Comenzile jucătorilor (chat) ───────────────────────────────────────────

public cmd_say(id)
{
	if (g_gagged[id] && feat(FEAT_SANCTIONS)) return PLUGIN_HANDLED;
	new text[128], command[16], code[32];
	read_args(text, charsmax(text));
	remove_quotes(text);
	trim(text);
	parse(text, command, charsmax(command), code, charsmax(code));
	if (equali(command, "/gcs") || equali(command, "!gcs"))
	{
		link_player(id, code);
		return PLUGIN_HANDLED;
	}
	if (feat(FEAT_MIXREADY) && g_isMix)
	{
		if (equali(command, "/ready") || equali(command, "!ready"))
		{
			set_ready(id, true);
			return PLUGIN_HANDLED;
		}
		if (equali(command, "/unready") || equali(command, "!unready"))
		{
			set_ready(id, false);
			return PLUGIN_HANDLED;
		}
	}
	return PLUGIN_CONTINUE;
}

/** `/gcs COD`: legarea identității non-Steam de contul de pe site (§3.3). */
stock link_player(id, const code[])
{
	if (!code[0])
	{
		client_print(id, print_chat, "[GCS] Scrie /gcs COD (codul îl primești pe site: Setări → Cont).");
		return;
	}
	new JSON:body = json_init_object();
	set_ref(body, "player", id);
	json_object_set_string(body, "code", code);
	static text[ITEM];
	json_serial_to_string(body, text, charsmax(text));
	json_free(body);
	bridge_request("POST", "/link", text, REQ_LINK, id);
	client_print(id, print_chat, "[GCS] Se verifică codul…");
}

stock on_link(id, JSON:root, code)
{
	new error[32], user[64];
	if (code == 200 && root != Invalid_JSON)
	{
		json_object_get_string(root, "user", user, charsmax(user));
		client_print(id, print_chat, "[GCS] Identitatea ta e legată de contul %s.", user);
		new ret;
		ExecuteForward(g_fwdLinked, ret, id, user);
		return;
	}
	if (root != Invalid_JSON) json_object_get_string(root, "error", error, charsmax(error));
	if (equal(error, "steam_use_site")) client_print(id, print_chat, "[GCS] Contul Steam se leagă de pe site (Conectează Steam).");
	else if (equal(error, "expired_code")) client_print(id, print_chat, "[GCS] Codul a expirat. Cere unul nou pe site.");
	else if (equal(error, "used_code")) client_print(id, print_chat, "[GCS] Codul a fost deja folosit.");
	else if (equal(error, "already_linked")) client_print(id, print_chat, "[GCS] Identitatea ta e deja legată de alt cont.");
	else if (equal(error, "no_identity")) client_print(id, print_chat, "[GCS] Identitatea ta nu poate fi legată (ID invalid).");
	else if (equal(error, "rate_limited")) client_print(id, print_chat, "[GCS] Prea multe încercări. Așteaptă un minut.");
	else client_print(id, print_chat, "[GCS] Cod invalid.");
}

// ─── Sancțiunile din joc ────────────────────────────────────────────────────

/** Ținta unei comenzi: un jucător online (nume, #userid) sau, pentru ban / unban, un ID scris. */
stock find_target(id, const arg[])
{
	new target = cmd_target(id, arg, CMDTARGET_OBEY_IMMUNITY | CMDTARGET_ALLOW_SELF);
	return target;
}

stock queue_sanction(admin, target, const auth[], kind, minutes, const reason[], bool:global)
{
	new JSON:event = new_event("sanction");
	new text[8];
	sanction_kind(kind, text, charsmax(text));
	json_object_set_string(event, "kind", text);
	if (target > 0) set_ref(event, "target", target);
	else
	{
		new JSON:ref = json_init_object();
		if (contain(auth, ".") != -1 || contain(auth, ":") == -1) json_object_set_string(ref, "ip", auth);
		else json_object_set_string(ref, "auth", auth);
		json_object_set_value(event, "target", ref);
		json_free(ref);
	}
	json_object_set_number(event, "minutes", minutes);
	json_object_set_string(event, "reason", reason);
	if (global) json_object_set_string(event, "scope", "global");
	else json_object_set_string(event, "scope", "server");
	set_ref(event, "admin", admin);
	return queue_event(event);
}

public cmd_ban(id, level, cid)
{
	if (!feat(FEAT_COMMANDS)) return PLUGIN_CONTINUE;
	if (!cmd_access(id, level, cid, 3)) return PLUGIN_HANDLED;
	new arg[AUTH_LEN], length[12], reason[200], command[16];
	read_argv(0, command, charsmax(command));
	read_argv(1, arg, charsmax(arg));
	read_argv(2, length, charsmax(length));
	read_args(reason, charsmax(reason));
	// Motivul = restul argumentelor după țintă și durată.
	new skip[AUTH_LEN + 16];
	formatex(skip, charsmax(skip), "%s %s", arg, length);
	replace(reason, charsmax(reason), skip, "");
	remove_quotes(reason);
	trim(reason);
	if (!reason[0]) copy(reason, charsmax(reason), "-");
	new minutes = max(0, str_to_num(length));
	// Flag-ul `d` dă orice ban; `v` (ADMIN_BAN_TEMP) doar bannuri temporare.
	if (id > 0 && !(get_user_flags(id) & ADMIN_BAN) && minutes == 0)
	{
		console_print(id, "[GCS] Doar banuri temporare cu drepturile tale.");
		return PLUGIN_HANDLED;
	}
	// Un authid al unui jucător online îl țintește pe el (cu imunitatea lui); altfel banul e pe ID-ul / IP-ul scris.
	new bool:byAuth = contain(arg, "STEAM_") == 0 || contain(arg, "VALVE_") == 0;
	new bool:online = byAuth && find_player("c", arg) != 0;
	new target = (byAuth && !online) ? 0 : find_target(id, arg);
	if (!target && (!byAuth || online) && contain(arg, ".") == -1) return PLUGIN_HANDLED;
	new bool:global = bool:equal(command, "gcs_gban");
	new position = queue_sanction(id, target, arg, SAN_BAN, minutes, reason, global);
	// Aplicat imediat local (id = -poziția evenimentului); lista GCS îl înlocuiește la sincronizarea de după trimitere.
	new entry[SanctionEntry];
	entry[SE_Id] = -max(position, 1);
	entry[SE_Type] = SAN_BAN;
	entry[SE_Kind] = target ? g_kind[target] : (contain(arg, ".") != -1 ? KIND_NONE : KIND_NONSTEAM);
	if (target) copy(entry[SE_Auth], AUTH_LEN - 1, g_auth[target]);
	else if (contain(arg, ".") == -1) copy(entry[SE_Auth], AUTH_LEN - 1, arg);
	entry[SE_Ip][0] = EOS;
	if (target) get_user_ip(target, entry[SE_Ip], 45, 1);
	else if (contain(arg, ".") != -1) copy(entry[SE_Ip], 45, arg);
	entry[SE_Name][0] = EOS;
	copy(entry[SE_Reason], 199, reason);
	entry[SE_Expires] = minutes > 0 ? gcs_now() + minutes * 60 : 0;
	ArrayPushArray(g_sanctions, entry);
	if (target) kick_banned(target, reason, entry[SE_Expires]);
	if (global) console_print(id, "[GCS] Ban trimis (toate serverele).");
	else console_print(id, "[GCS] Ban trimis (acest server).");
	return PLUGIN_HANDLED;
}

public cmd_unban(id, level, cid)
{
	if (!feat(FEAT_COMMANDS)) return PLUGIN_CONTINUE;
	if (!cmd_access(id, level, cid, 2)) return PLUGIN_HANDLED;
	new arg[AUTH_LEN], reason[200];
	read_argv(1, arg, charsmax(arg));
	read_argv(2, reason, charsmax(reason));
	new JSON:event = new_event("unsanction");
	json_object_set_string(event, "kind", "ban");
	new JSON:ref = json_init_object();
	if (contain(arg, ".") != -1) json_object_set_string(ref, "ip", arg);
	else json_object_set_string(ref, "auth", arg);
	json_object_set_value(event, "target", ref);
	json_free(ref);
	json_object_set_string(event, "reason", reason);
	set_ref(event, "admin", id);
	queue_event(event);
	// Scoate și local banul (identitatea sau IP-ul).
	new entry[SanctionEntry];
	for (new i = ArraySize(g_sanctions) - 1; i >= 0; i--)
	{
		ArrayGetArray(g_sanctions, i, entry);
		if (entry[SE_Type] == SAN_BAN && (equal(entry[SE_Auth], arg) || equal(entry[SE_Ip], arg))) ArrayDeleteItem(g_sanctions, i);
	}
	console_print(id, "[GCS] Unban trimis pentru %s.", arg);
	return PLUGIN_HANDLED;
}

public cmd_comm(id, level, cid)
{
	if (!feat(FEAT_COMMANDS)) return PLUGIN_CONTINUE;
	if (!cmd_access(id, level, cid, 3)) return PLUGIN_HANDLED;
	new command[16], arg[64], length[12], reason[200];
	read_argv(0, command, charsmax(command));
	read_argv(1, arg, charsmax(arg));
	read_argv(2, length, charsmax(length));
	read_argv(3, reason, charsmax(reason));
	new target = find_target(id, arg);
	if (!target) return PLUGIN_HANDLED;
	new kind = equal(command, "gcs_mute") ? SAN_MUTE : SAN_GAG;
	if (!reason[0]) copy(reason, charsmax(reason), "-");
	queue_sanction(id, target, "", kind, max(0, str_to_num(length)), reason, false);
	set_comm(target, kind == SAN_MUTE ? true : g_muted[target], kind == SAN_GAG ? true : g_gagged[target]);
	if (kind == SAN_MUTE) console_print(id, "[GCS] Mute aplicat.");
	else console_print(id, "[GCS] Gag aplicat.");
	return PLUGIN_HANDLED;
}

public cmd_uncomm(id, level, cid)
{
	if (!feat(FEAT_COMMANDS)) return PLUGIN_CONTINUE;
	if (!cmd_access(id, level, cid, 2)) return PLUGIN_HANDLED;
	new command[16], arg[64], reason[200];
	read_argv(0, command, charsmax(command));
	read_argv(1, arg, charsmax(arg));
	read_argv(2, reason, charsmax(reason));
	new target = find_target(id, arg);
	if (!target) return PLUGIN_HANDLED;
	new bool:mute = bool:equal(command, "gcs_unmute");
	new JSON:event = new_event("unsanction");
	new text[8];
	sanction_kind(mute ? SAN_MUTE : SAN_GAG, text, charsmax(text));
	json_object_set_string(event, "kind", text);
	set_ref(event, "target", target);
	json_object_set_string(event, "reason", reason);
	set_ref(event, "admin", id);
	queue_event(event);
	set_comm(target, mute ? false : g_muted[target], mute ? g_gagged[target] : false);
	if (mute) console_print(id, "[GCS] Mute ridicat.");
	else console_print(id, "[GCS] Gag ridicat.");
	return PLUGIN_HANDLED;
}

/** `amx_ban` / `amx_unban` merg prin GCS doar cu `gcs_amx_aliases 1` (altfel le tratează alt plugin). */
public cmd_amx_ban(id, level, cid)
{
	if (!feat(FEAT_COMMANDS) || !get_pcvar_num(g_cvarAliases)) return PLUGIN_CONTINUE;
	return cmd_ban(id, level, cid);
}

public cmd_amx_unban(id, level, cid)
{
	if (!feat(FEAT_COMMANDS) || !get_pcvar_num(g_cvarAliases)) return PLUGIN_CONTINUE;
	return cmd_unban(id, level, cid);
}

/** Jurnalul acțiunilor (§4.9) pentru comenzile adminilor din AMX Mod X; comanda merge mai departe neschimbată. */
stock log_action(id, const action[], target, const reason[])
{
	new JSON:event = new_event("admin_action");
	set_ref(event, "admin", id);
	json_object_set_string(event, "action", action);
	if (target > 0) set_ref(event, "target", target);
	json_object_set_string(event, "reason", reason);
	queue_event(event);
}

stock log_target_command(id, level, const action[])
{
	if (!feat(FEAT_COMMANDS) || (!(get_user_flags(id) & level) && id > 0)) return PLUGIN_CONTINUE;
	new arg[64], reason[200];
	read_argv(1, arg, charsmax(arg));
	read_argv(2, reason, charsmax(reason));
	new target = cmd_target(id, arg, CMDTARGET_ALLOW_SELF);
	if (target) log_action(id, action, target, reason);
	return PLUGIN_CONTINUE;
}

public log_kick(id, level, cid)
{
	return log_target_command(id, level, "kick");
}

public log_slay(id, level, cid)
{
	return log_target_command(id, level, "slay");
}

public log_slap(id, level, cid)
{
	return log_target_command(id, level, "slap");
}

public log_map(id, level, cid)
{
	if (!feat(FEAT_COMMANDS) || (id > 0 && !(get_user_flags(id) & level))) return PLUGIN_CONTINUE;
	new map[64];
	read_argv(1, map, charsmax(map));
	new JSON:event = new_event("admin_action");
	set_ref(event, "admin", id);
	json_object_set_string(event, "action", "map");
	new JSON:details = json_init_object();
	json_object_set_string(details, "map", map);
	json_object_set_value(event, "details", details);
	json_free(details);
	queue_event(event);
	// Evenimentele se salvează înainte de schimbarea hărții (plugin_end).
	return PLUGIN_CONTINUE;
}

// ─── Meciul mix (5v5) ───────────────────────────────────────────────────────

stock JSON:match_state()
{
	new JSON:match = json_init_object();
	new status[12];
	switch (g_mixState)
	{
		case MIX_WARMUP: copy(status, charsmax(status), "warmup");
		case MIX_LIVE: copy(status, charsmax(status), "live");
		case MIX_HALFTIME: copy(status, charsmax(status), "halftime");
		default: copy(status, charsmax(status), "ended");
	}
	new map[64];
	get_mapname(map, charsmax(map));
	json_object_set_string(match, "id", g_mixId);
	json_object_set_string(match, "status", status);
	json_object_set_string(match, "map", map);
	json_object_set_number(match, "round", g_mixRound);
	json_object_set_string(match, "teams.A.name", "Echipa A", true);
	json_object_set_string(match, "teams.B.name", "Echipa B", true);
	json_object_set_number(match, "score.A", g_scoreA, true);
	json_object_set_number(match, "score.B", g_scoreB, true);
	new JSON:players = json_init_array();
	for (new id = 1; id <= MaxClients; id++)
	{
		if (!is_user_connected(id) || is_user_bot(id) || !g_matchTeam[id]) continue;
		new JSON:item = json_init_object();
		set_ref(item, "player", id);
		json_object_set_string(item, "team", g_matchTeam[id] == 'A' ? "A" : "B");
		json_object_set_number(item, "kills", g_matchKills[id]);
		json_object_set_number(item, "deaths", g_matchDeaths[id]);
		json_object_set_number(item, "assists", 0);
		json_object_set_number(item, "headshots", g_matchHs[id]);
		json_object_set_number(item, "damage", g_matchDamage[id]);
		json_object_set_number(item, "mvps", 0);
		json_array_append_value(players, item);
		json_free(item);
	}
	json_object_set_value(match, "players", players);
	json_free(players);
	return match;
}

stock queue_match(const status[])
{
	new JSON:event = new_event("match");
	new JSON:match = match_state();
	json_object_set_string(match, "status", status);
	json_object_set_value(event, "match", match);
	json_free(match);
	queue_event(event);
	new ret;
	ExecuteForward(g_fwdMatchState, ret, g_mixId, status, g_scoreA, g_scoreB);
	// Starea meciului ajunge imediat pe site.
	g_lastEventsAt = 0;
}

/**
 * Tranzițiile (§6.9): start → warmup, warmup / halftime → live, live → halftime / ended, orice deschis → aborted.
 * `manage` = GCS conduce meciul (ready-up, `gcs_match`): restartul și schimbarea părților le face pluginul. Altfel
 * (alt plugin prin native, detectarea pasivă) pluginul doar urmărește meciul și nu schimbă nimic pe server.
 */
stock bool:mix_command(const command[], bool:manage)
{
	if (equal(command, "start"))
	{
		if (g_mixState == MIX_WARMUP || g_mixState == MIX_LIVE || g_mixState == MIX_HALFTIME) return false;
		formatex(g_mixId, charsmax(g_mixId), "m-%d-%s", get_systime(), g_runId);
		g_scoreA = 0;
		g_scoreB = 0;
		g_mixRound = 0;
		g_sideA = 2;
		for (new id = 1; id <= MaxClients; id++)
		{
			g_matchKills[id] = 0;
			g_matchDeaths[id] = 0;
			g_matchHs[id] = 0;
			g_matchDamage[id] = 0;
			g_matchTeam[id] = 0;
			if (!is_user_connected(id) || is_user_bot(id)) continue;
			new team = get_user_team(id);
			if (team == 2) g_matchTeam[id] = 'A';
			else if (team == 1) g_matchTeam[id] = 'B';
		}
		g_mixState = MIX_WARMUP;
		g_mixDriven = manage;
		g_mixSwapped = false;
		queue_match("warmup");
		return true;
	}
	if (equal(command, "live"))
	{
		if (g_mixState != MIX_WARMUP && g_mixState != MIX_HALFTIME) return false;
		g_mixState = MIX_LIVE;
		if (manage) server_cmd("sv_restart 1");
		queue_match("live");
		return true;
	}
	if (equal(command, "halftime"))
	{
		if (g_mixState != MIX_LIVE) return false;
		g_mixState = MIX_HALFTIME;
		// Echipele A / B rămân aceleași, doar părțile se schimbă (mutarea jucătorilor doar când GCS conduce meciul).
		g_sideA = g_sideA == 2 ? 1 : 2;
		g_mixSwapped = true;
		for (new id = 1; manage && id <= MaxClients; id++)
		{
			if (!is_user_connected(id) || !g_matchTeam[id]) continue;
			new side = g_matchTeam[id] == 'A' ? g_sideA : (g_sideA == 2 ? 1 : 2);
			cs_set_user_team(id, side == 2 ? CS_TEAM_CT : CS_TEAM_T);
		}
		queue_match("halftime");
		return true;
	}
	if (equal(command, "end"))
	{
		if (g_mixState != MIX_LIVE) return false;
		g_mixState = MIX_ENDED;
		queue_match("ended");
		return true;
	}
	if (equal(command, "abort"))
	{
		if (g_mixState != MIX_WARMUP && g_mixState != MIX_LIVE && g_mixState != MIX_HALFTIME) return false;
		g_mixState = MIX_ENDED;
		queue_match("aborted");
		return true;
	}
	return false;
}

stock mix_round_end(const winner[])
{
	g_mixRound++;
	new side = equal(winner, "CT") ? 2 : equal(winner, "T") ? 1 : 0;
	new team[2] = "-";
	if (side == g_sideA)
	{
		g_scoreA++;
		team[0] = 'A';
	}
	else if (side)
	{
		g_scoreB++;
		team[0] = 'B';
	}
	if (team[0] != '-')
	{
		new JSON:event = new_event("match_round");
		json_object_set_string(event, "matchId", g_mixId);
		json_object_set_number(event, "round", g_mixRound);
		json_object_set_string(event, "winner", team);
		json_object_set_number(event, "scoreA", g_scoreA);
		json_object_set_number(event, "scoreB", g_scoreB);
		json_object_set_string(event, "reason", "round_end");
		queue_event(event);
	}
	new maxRounds = mix_max_rounds();
	if (g_mixDriven && feat(FEAT_MIXREADY))
	{
		// Mix-ul condus de GCS (ready-up): pauza la jumătate, finalul la majoritate (sau egal la ultima rundă).
		if (g_scoreA > maxRounds / 2 || g_scoreB > maxRounds / 2 || g_mixRound >= maxRounds) mix_command("end", true);
		else if (g_mixRound == maxRounds / 2)
		{
			mix_command("halftime", true);
			set_task(10.0, "task_mix_live");
		}
		return;
	}
	// Detectarea pasivă: doar finalul (pauza se vede din schimbarea părților, la începutul rundei).
	if (passive_mix() && (g_scoreA > maxRounds / 2 || g_scoreB > maxRounds / 2 || g_mixRound >= maxRounds)) mix_command("end", false);
}

/** Rundele unui meci: `mp_maxrounds` al serverului, altfel `gcs_mix_maxrounds` (implicit 30). */
stock mix_max_rounds()
{
	new rounds = get_cvar_num("mp_maxrounds");
	return rounds > 0 ? rounds : max(2, get_pcvar_num(g_cvarMixRounds));
}

public task_mix_live()
{
	mix_command("live", true);
}

// ─── Meciurile mix detectate pasiv (specul plugin-v2 §3) ────────────────────

/** Pe un server mix, fără ready-up GCS și fără alt plugin care conduce meciul în această hartă. */
stock bool:passive_mix()
{
	return g_isMix && !feat(FEAT_MIXREADY) && !g_mixManual;
}

public ev_team_score()
{
	new team[16];
	read_data(1, team, charsmax(team));
	if (equal(team, "CT")) g_teamCT = read_data(2);
	else if (equal(team, "TERRORIST")) g_teamT = read_data(2);
}

/** `#Game_Commencing` / `#Game_will_restart_in`: jocul repornește; decizia se ia la începutul rundei următoare. */
public ev_game_restart()
{
	if (passive_mix()) g_pendingStart = true;
}

public ev_new_round()
{
	if (!passive_mix()) return;
	if (g_pendingStart)
	{
		g_pendingStart = false;
		if (g_mixState == MIX_WARMUP || g_mixState == MIX_LIVE || g_mixState == MIX_HALFTIME)
		{
			// Restartul cu 0 runde (LO3) sau după schimbarea părților (LO3-ul reprizei a doua): meciul continuă. Unul
			// înainte de runda 3: meciul a fost repornit, deci altul nou. Mai târziu se ignoră.
			if (g_mixRound > 0 && !g_mixSwapped && g_mixRound < 3)
			{
				mix_command("abort", false);
				passive_start();
			}
			return;
		}
		passive_start();
		return;
	}
	if (g_mixState == MIX_LIVE) passive_sides();
}

/** Meci nou: cel puțin MIX_MIN_TEAM jucători în fiecare echipă; echipa A = CT. */
stock passive_start()
{
	new ct = 0, t = 0;
	for (new id = 1; id <= MaxClients; id++)
	{
		if (!is_user_connected(id) || is_user_bot(id) || is_user_hltv(id)) continue;
		new team = get_user_team(id);
		if (team == 2) ct++;
		else if (team == 1) t++;
	}
	if (ct < MIX_MIN_TEAM || t < MIX_MIN_TEAM) return;
	if (mix_command("start", false)) mix_command("live", false);
}

/**
 * Începutul rundei în meci: dacă majoritatea jucătorilor din A sunt pe partea cealaltă, e pauza (A / B rămân aceleași,
 * părțile se schimbă). Jucătorii veniți târziu intră în echipa părții lor.
 */
stock passive_sides()
{
	new onA = 0, offA = 0;
	for (new id = 1; id <= MaxClients; id++)
	{
		if (!is_user_connected(id) || is_user_bot(id) || is_user_hltv(id) || g_matchTeam[id] != 'A') continue;
		new team = get_user_team(id);
		if (team == g_sideA) onA++;
		else if (team == 1 || team == 2) offA++;
	}
	if (offA > onA)
	{
		mix_command("halftime", false);
		mix_command("live", false);
	}
	for (new id = 1; id <= MaxClients; id++)
	{
		if (!is_user_connected(id) || is_user_bot(id) || is_user_hltv(id) || g_matchTeam[id]) continue;
		new team = get_user_team(id);
		if (team == 1 || team == 2) g_matchTeam[id] = team == g_sideA ? 'A' : 'B';
	}
}

stock set_ready(id, bool:ready)
{
	if (g_mixState == MIX_LIVE || g_mixState == MIX_HALFTIME) return;
	g_ready[id] = ready;
	new count = 0;
	for (new i = 1; i <= MaxClients; i++) if (is_user_connected(i) && g_ready[i]) count++;
	new need = max(2, get_pcvar_num(g_cvarMixPlayers));
	client_print(0, print_chat, "[GCS] Gata: %d / %d.", count, need);
	if (count >= need)
	{
		for (new i = 1; i <= MaxClients; i++) g_ready[i] = false;
		if (g_mixState != MIX_WARMUP) mix_command("start", true);
		set_task(5.0, "task_mix_live");
		client_print(0, print_chat, "[GCS] Meciul începe în 5 secunde.");
	}
}

public cmd_match(id, level, cid)
{
	if (!feat(FEAT_COMMANDS)) return PLUGIN_CONTINUE;
	if (!cmd_access(id, level, cid, 2)) return PLUGIN_HANDLED;
	new command[16];
	read_argv(1, command, charsmax(command));
	// Meciul condus din comandă: detectarea pasivă stă deoparte până la harta următoare.
	g_mixManual = true;
	if (mix_command(command, true)) console_print(id, "[GCS] Meci: %s.", command);
	else console_print(id, "[GCS] Tranziție nepermisă: %s.", command);
	return PLUGIN_HANDLED;
}

public native_mix_command(plugin, params)
{
	new command[16];
	get_string(1, command, charsmax(command));
	// Alt plugin conduce meciul (și face el restartul / mutările): GCS doar îl urmărește.
	g_mixManual = true;
	return mix_command(command, false);
}

// ─── Înrolarea automată (specul plugin-v2 §5) ───────────────────────────────

stock enroll_path(path[], len)
{
	formatex(path, len, "%s/gcs_bridge_enroll.json", g_dataDir);
}

/** Secretul înrolării (generat o singură dată, păstrat local) și referința primită de la site. */
stock load_enroll()
{
	new path[192];
	enroll_path(path, charsmax(path));
	new JSON:root = file_exists(path) ? json_parse(path, true) : Invalid_JSON;
	if (root != Invalid_JSON)
	{
		json_object_get_string(root, "secret", g_enrollSecret, charsmax(g_enrollSecret));
		json_object_get_string(root, "enrollment", g_enrollRef, charsmax(g_enrollRef));
		// Respins: pauza continuă și după o repornire.
		g_enrollNextAt = max(g_enrollNextAt, json_object_get_number(root, "pausedUntil"));
		json_free(root);
	}
	if (strlen(g_enrollSecret) != 64)
	{
		make_secret(g_enrollSecret, charsmax(g_enrollSecret));
		g_enrollRef[0] = EOS;
		save_enroll(0);
	}
}

stock save_enroll(pausedUntil)
{
	new JSON:root = json_init_object();
	json_object_set_string(root, "secret", g_enrollSecret);
	json_object_set_string(root, "enrollment", g_enrollRef);
	json_object_set_number(root, "pausedUntil", pausedUntil);
	new path[192];
	enroll_path(path, charsmax(path));
	json_serial_to_file(root, path);
	json_free(root);
}

/**
 * Secretul (64 de caractere hex): AMX Mod X nu are un generator criptografic, deci se amestecă într-un SHA-256 tot ce
 * nu se poate ghici ușor din afară: timpul, ceasul în milisecunde (citit de mai multe ori), timpul motorului,
 * generatorul AMX Mod X, harta, numele serverului; apoi încă o rundă cu alte valori. Site-ul păstrează doar hash-ul lui,
 * iar cheia se livrează doar cu secretul și referința aleatorie dată de site.
 */
stock make_secret(out[], len)
{
	static pool[640];
	new host[64], map[32], first[65];
	get_cvar_string("hostname", host, charsmax(host));
	get_mapname(map, charsmax(map));
	formatex(pool, charsmax(pool), "%d|%d|%f|%d|%d|%d|%d|%d|%d|%d|%d|%s|%s|%d|%d", get_systime(), tickcount(), get_gametime(), random(0x7FFFFFFF), random(0x7FFFFFFF), random(0x7FFFFFFF), random(0x7FFFFFFF), random(0x7FFFFFFF), random(0x7FFFFFFF), random(0x7FFFFFFF), random(0x7FFFFFFF), host, map, get_playersnum(), tickcount());
	hash_string(pool, Hash_Sha256, first, charsmax(first));
	formatex(pool, charsmax(pool), "%s|%d|%d|%d|%d|%f|%d", first, random(0x7FFFFFFF), random(0x7FFFFFFF), tickcount(), get_systime(), get_gametime(), random(0x7FFFFFFF));
	hash_string(pool, Hash_Sha256, out, len);
}

/** O cerere a înrolării: fără semnătură (pluginul nu are încă o cheie), doar JSON. */
stock enroll_request(const path[], const body[], kind)
{
	new url[320];
	formatex(url, charsmax(url), "%s%s%s", g_url, BASE_PATH, path);
	new EzHttpOptions:options = ezhttp_create_options();
	ezhttp_option_set_header(options, "User-Agent", PLUGIN_ID);
	ezhttp_option_set_header(options, "Content-Type", "application/json");
	ezhttp_option_set_timeout(options, 15000);
	new data[3];
	data[0] = kind;
	ezhttp_option_set_user_data(options, data, sizeof(data));
	ezhttp_option_set_body(options, body);
	if (get_pcvar_num(g_cvarDebug)) log_amx("[GCS] POST %s", path);
	ezhttp_post(url, "on_response", options);
}

stock enroll_tick(now)
{
	if (g_enrollBusy || now < g_enrollNextAt) return;
	g_enrollBusy = true;
	static body[1024];
	new JSON:root = json_init_object();
	if (!g_enrollRef[0])
	{
		new host[128], map[64];
		get_cvar_string("hostname", host, charsmax(host));
		get_mapname(map, charsmax(map));
		json_object_set_string(root, "game", "cs16");
		json_object_set_number(root, "port", get_cvar_num("port"));
		json_object_set_string(root, "hostname", host);
		json_object_set_string(root, "map", map);
		json_object_set_number(root, "maxPlayers", get_maxplayers());
		json_object_set_number(root, "players", get_playersnum());
		json_object_set_string(root, "plugin", PLUGIN_ID);
		json_object_set_string(root, "secret", g_enrollSecret);
		json_serial_to_string(root, body, charsmax(body));
		json_free(root);
		enroll_request("/enroll", body, REQ_ENROLL);
		return;
	}
	json_object_set_string(root, "enrollment", g_enrollRef);
	json_object_set_string(root, "secret", g_enrollSecret);
	json_serial_to_string(root, body, charsmax(body));
	json_free(root);
	enroll_request("/enroll/status", body, REQ_ENROLL_STATUS);
}

/** Rețeaua / 5xx: 60 s, 120 s … max 15 minute. */
stock enroll_backoff()
{
	g_enrollBackoff = g_enrollBackoff ? min(g_enrollBackoff * 2, 900) : 60;
	g_enrollNextAt = get_systime() + g_enrollBackoff;
}

stock on_enroll(kind, code, JSON:root, const error[])
{
	g_enrollBusy = false;
	new now = get_systime();
	if (code == 0 || code >= 500)
	{
		enroll_backoff();
		return;
	}
	if (code == 429)
	{
		g_enrollNextAt = now + 120;
		return;
	}
	if (code == 404 && kind == REQ_ENROLL_STATUS)
	{
		// Înrolarea a expirat / a dispărut: se cere din nou, cu același secret.
		g_enrollRef[0] = EOS;
		save_enroll(0);
		g_enrollNextAt = now + 5;
		return;
	}
	if (code != 200 || root == Invalid_JSON)
	{
		log_amx("[GCS] Înrolarea refuzată de site (%d %s). Reîncerc peste o oră.", code, error);
		g_enrollNextAt = now + 3600;
		return;
	}
	g_enrollBackoff = 0;
	new status[16];
	json_object_get_string(root, "status", status, charsmax(status));
	if (equal(status, "rejected"))
	{
		log_amx("[GCS] Serverul a fost respins în ACP. Nu mai cer o cheie 24 de ore.");
		g_enrollNextAt = now + 86400;
		save_enroll(g_enrollNextAt);
		return;
	}
	if (json_object_has_value(root, "enrollment", JSONString))
	{
		json_object_get_string(root, "enrollment", g_enrollRef, charsmax(g_enrollRef));
		save_enroll(0);
	}
	if (json_object_has_value(root, "key", JSONString))
	{
		new key[160];
		json_object_get_string(root, "key", key, charsmax(key));
		store_key(key);
		return;
	}
	if (equal(status, "approved"))
	{
		if (json_object_get_bool(root, "delivered"))
		{
			// Cheia a plecat deja (și a fost folosită), dar nu e aici: o înrolare nouă, de aprobat din nou.
			log_amx("[GCS] Cheia acestui server a fost deja livrată, dar nu e salvată aici. Mă înrolez din nou.");
			make_secret(g_enrollSecret, charsmax(g_enrollSecret));
			g_enrollRef[0] = EOS;
			save_enroll(0);
			g_enrollNextAt = now + 60;
			return;
		}
		g_enrollNextAt = now + 1;
		return;
	}
	if (!g_enrollAnnounced)
	{
		g_enrollAnnounced = true;
		log_amx("[GCS] Serverul așteaptă aprobarea pe site: ACP → Gaming → Servere → Servere noi detectate.");
	}
	new retry = json_object_has_value(root, "retryAfter", JSONNumber) ? json_object_get_number(root, "retryAfter") : 60;
	g_enrollNextAt = now + clamp(retry, 30, 600);
}

/**
 * Cheia primită după aprobare: salvată în `configs/gcs_bridge_key.cfg` (citit la pornire doar dacă `gcs_key` din
 * gcs_bridge.cfg e gol), apoi pluginul continuă imediat cu protocolul semnat.
 */
stock store_key(const key[])
{
	new cfg[128], path[192];
	get_localinfo("amxx_configsdir", cfg, charsmax(cfg));
	formatex(path, charsmax(path), "%s/gcs_bridge_key.cfg", cfg);
	new file = fopen(path, "wt");
	if (file)
	{
		fprintf(file, "// GCS Server Bridge: cheia acestui server, primită de la site după aprobare. Nu o publica.^ngcs_key ^"%s^"^n", key);
		fclose(file);
	}
	else log_amx("[GCS] Nu pot salva cheia în %s (drepturile folderului).", path);
	set_pcvar_string(g_cvarKey, key);
	read_config();
	if (!g_configured)
	{
		log_amx("[GCS] Cheia primită nu e validă.");
		return;
	}
	enroll_path(path, charsmax(path));
	if (file_exists(path)) delete_file(path);
	log_amx("[GCS] Serverul a fost aprobat: cheia e salvată, pluginul e conectat la site.");
	send_heartbeat();
}

public native_mix_state(plugin, params)
{
	set_param_byref(1, g_scoreA);
	set_param_byref(2, g_scoreB);
	return g_mixState == MIX_ENDED ? MIX_NONE : g_mixState;
}
