// GCS Server Bridge — pluginul CounterStrikeSharp pentru Counter-Strike 2 (GamingCommunitySuite).
//
// Vorbește protocolul v1 al punții (specul 2026-10-08-servere-bridge): heartbeat, evenimente (conectări, ucideri,
// runde, focuri, damage, MVP, acțiuni de admin, sancțiuni, meciuri mix), listele trase de la site (admini, sancțiuni,
// VIP), verificarea la conectare și legarea identității. Listele se păstrează local: site-ul căzut nu oprește adminii și
// nici bannurile. Evenimentele netrimise se salvează pe disc și se retrimit cu aceleași id-uri.
//
// Licența: MIT (CounterStrikeSharp permite explicit pluginuri MIT). Vezi LICENSE.

using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Admin;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Commands.Targeting;
using CounterStrikeSharp.API.Modules.Entities;
using CounterStrikeSharp.API.Modules.Timers;
using CounterStrikeSharp.API.Modules.Utils;
using Microsoft.Extensions.Logging;
using Timer = CounterStrikeSharp.API.Modules.Timers.Timer;

namespace Gcs.Bridge;

/// <summary>Configul (addons/counterstrikesharp/configs/plugins/GcsBridge/GcsBridge.json).</summary>
public sealed class GcsBridgeConfig : BasePluginConfig
{
    /// <summary>Adresa site-ului (ex. https://comunitate.exemplu.ro), fără calea protocolului.</summary>
    [JsonPropertyName("Url")] public string Url { get; set; } = "";

    /// <summary>Cheia API a serverului (`gcs1.&lt;keyId&gt;.&lt;secret&gt;`), din ACP → Servere → Plugin și chei API.</summary>
    [JsonPropertyName("Key")] public string Key { get; set; } = "";

    /// <summary>Ready-up-ul simplu al meciurilor mix (!ready / !unready).</summary>
    [JsonPropertyName("MixReady")] public bool MixReady { get; set; } = false;

    [JsonPropertyName("MixPlayers")] public int MixPlayers { get; set; } = 10;

    [JsonPropertyName("MixMaxRounds")] public int MixMaxRounds { get; set; } = 24;

    [JsonPropertyName("Debug")] public bool Debug { get; set; } = false;
}

public sealed class GcsBridgePlugin : BasePlugin, IPluginConfig<GcsBridgeConfig>
{
    public override string ModuleName => "GCS Server Bridge";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor => "GamingCommunitySuite";
    public override string ModuleDescription => "Puntea serverului cu GamingCommunitySuite: admini, bannuri, statistici, meciuri mix.";

    public GcsBridgeConfig Config { get; set; } = new();

    private BridgeClient? _client;
    private readonly EventQueue _queue = new();
    private LocalLists _lists = null!;
    private readonly MixMatch _mix = new();
    private int _heartbeat = 30;
    private int _eventsInterval = 10;
    private long _remoteSanctions = -1;
    private bool _pullingSanctions;
    private DateTime _lastPull = DateTime.MinValue;
    private Timer? _heartbeatTimer;
    private readonly HashSet<int> _gagged = new();
    private readonly HashSet<int> _muted = new();
    private readonly Dictionary<int, Dictionary<string, WeaponDelta>> _weapons = new();

    private sealed class WeaponDelta
    {
        public int Shots;
        public int Hits;
        public int Damage;
        public int Headshots;
    }

    public void OnConfigParsed(GcsBridgeConfig config)
    {
        Config = config;
        _client?.Dispose();
        _client = new BridgeClient(config.Url, config.Key);
        if (!_client.Configured) Logger.LogWarning("[GCS] Configurare incompletă: setează Url și Key în GcsBridge.json.");
    }

    private string DataDir => Path.Combine(ModuleDirectory, "data");

    public override void Load(bool hotReload)
    {
        _lists = new LocalLists(DataDir);
        _lists.Load();
        _queue.Load(Path.Combine(DataDir, "gcs_bridge_queue.jsonl"));

        RegisterListener<Listeners.OnMapStart>(_ => OnMapStart());
        RegisterListener<Listeners.OnMapEnd>(() => _queue.Save(Path.Combine(DataDir, "gcs_bridge_queue.jsonl")));
        RegisterEventHandler<EventPlayerConnectFull>(OnConnectFull);
        RegisterEventHandler<EventPlayerDisconnect>(OnDisconnect, HookMode.Pre);
        RegisterEventHandler<EventPlayerDeath>(OnDeath);
        RegisterEventHandler<EventPlayerHurt>(OnHurt);
        RegisterEventHandler<EventWeaponFire>(OnWeaponFire);
        RegisterEventHandler<EventRoundMvp>(OnMvp);
        RegisterEventHandler<EventRoundEnd>(OnRoundEnd);
        AddCommandListener("say", OnSay, HookMode.Pre);
        AddCommandListener("say_team", OnSay, HookMode.Pre);

        AddTimer(1.0f, Tick, TimerFlags.REPEAT);
        ScheduleHeartbeat(5);
        if (hotReload) Server.NextFrame(() => Utilities.GetPlayers().Where(Tracked).ToList().ForEach(ApplyLocal));
    }

    public override void Unload(bool hotReload)
    {
        _queue.Save(Path.Combine(DataDir, "gcs_bridge_queue.jsonl"));
        _client?.Dispose();
    }

    private static bool Tracked(CCSPlayerController? p) => p is { IsValid: true, IsBot: false, IsHLTV: false } && p.SteamID != 0;

    private long Now() => _client?.Now() ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    // ─── Referințele și evenimentele ─────────────────────────────────────────

    /// <summary>Referința jucătorului (§6.3): pe CS2 identitatea e mereu SteamID-ul (GCS decide, pluginul raportează).</summary>
    private static JsonObject Ref(CCSPlayerController p)
    {
        var ip = (p.IpAddress ?? "").Split(':')[0];
        return new JsonObject { ["auth"] = p.SteamID.ToString(), ["steam"] = true, ["name"] = p.PlayerName, ["ip"] = ip };
    }

    private static JsonObject ConsoleRef() => new() { ["auth"] = "CONSOLE", ["name"] = "Console" };

    private void Queue(string type, JsonObject fields)
    {
        fields["type"] = type;
        _queue.Add(fields, Now());
    }

    private void OnMapStart()
    {
        Queue("map", new JsonObject { ["map"] = Server.MapName });
        // Timerul heartbeat-ului se oprește la schimbarea hărții: îl pornim din nou.
        ScheduleHeartbeat(5);
    }

    private HookResult OnConnectFull(EventPlayerConnectFull ev, GameEventInfo info)
    {
        var p = ev.Userid;
        if (!Tracked(p)) return HookResult.Continue;
        _weapons[p!.Slot] = new Dictionary<string, WeaponDelta>();
        ApplyLocal(p);
        Queue("connect", new JsonObject { ["player"] = Ref(p) });
        _ = CheckAsync(p);
        return HookResult.Continue;
    }

    private HookResult OnDisconnect(EventPlayerDisconnect ev, GameEventInfo info)
    {
        var p = ev.Userid;
        if (!Tracked(p)) return HookResult.Continue;
        FlushWeapons(p!);
        Queue("disconnect", new JsonObject { ["player"] = Ref(p!) });
        _gagged.Remove(p!.Slot);
        _muted.Remove(p.Slot);
        _weapons.Remove(p.Slot);
        _mix.Leave(p.Slot);
        return HookResult.Continue;
    }

    private HookResult OnDeath(EventPlayerDeath ev, GameEventInfo info)
    {
        var victim = ev.Userid;
        if (!Tracked(victim)) return HookResult.Continue;
        var killer = ev.Attacker;
        var suicide = killer is null || !killer.IsValid || killer.Slot == victim!.Slot;
        var fields = new JsonObject { ["victim"] = Ref(victim!), ["weapon"] = ev.Weapon, ["headshot"] = ev.Headshot, ["map"] = Server.MapName };
        if (!suicide)
        {
            var k = Ref(killer!);
            if (killer!.IsBot) k["bot"] = true;
            fields["killer"] = k;
            if (killer.TeamNum == victim!.TeamNum) fields["teamkill"] = true;
        }
        if (ev.Assister is { IsValid: true } a && Tracked(a)) fields["assister"] = Ref(a);
        Queue("kill", fields);
        _mix.OnDeath(killer, victim!, ev.Assister, ev.Headshot, suicide);
        return HookResult.Continue;
    }

    private WeaponDelta Delta(CCSPlayerController p, string weapon)
    {
        if (!_weapons.TryGetValue(p.Slot, out var map)) _weapons[p.Slot] = map = new Dictionary<string, WeaponDelta>();
        if (!map.TryGetValue(weapon, out var d)) map[weapon] = d = new WeaponDelta();
        return d;
    }

    private HookResult OnWeaponFire(EventWeaponFire ev, GameEventInfo info)
    {
        if (Tracked(ev.Userid) && !ev.Weapon.Contains("knife") && !ev.Weapon.Contains("grenade")) Delta(ev.Userid!, ev.Weapon).Shots++;
        return HookResult.Continue;
    }

    private HookResult OnHurt(EventPlayerHurt ev, GameEventInfo info)
    {
        var attacker = ev.Attacker;
        if (!Tracked(attacker) || ev.Userid is null || attacker!.Slot == ev.Userid.Slot) return HookResult.Continue;
        var d = Delta(attacker, ev.Weapon);
        d.Hits++;
        d.Damage += ev.DmgHealth;
        if (ev.Hitgroup == 1) d.Headshots++;
        _mix.OnDamage(attacker, ev.DmgHealth);
        return HookResult.Continue;
    }

    private HookResult OnMvp(EventRoundMvp ev, GameEventInfo info)
    {
        if (Tracked(ev.Userid)) _mix.OnMvp(ev.Userid!);
        return HookResult.Continue;
    }

    private void FlushWeapons(CCSPlayerController p)
    {
        if (!_weapons.TryGetValue(p.Slot, out var map)) return;
        foreach (var (weapon, d) in map)
        {
            if (d.Shots == 0 && d.Hits == 0 && d.Damage == 0) continue;
            Queue("weapon_stats", new JsonObject { ["player"] = Ref(p), ["weapon"] = weapon, ["shots"] = d.Shots, ["hits"] = d.Hits, ["damage"] = d.Damage, ["headshots"] = d.Headshots });
        }
        map.Clear();
    }

    private HookResult OnRoundEnd(EventRoundEnd ev, GameEventInfo info)
    {
        // Winner: 2 = T, 3 = CT; altceva = egal.
        var winner = ev.Winner == 3 ? "CT" : ev.Winner == 2 ? "T" : "draw";
        var players = new JsonArray();
        foreach (var p in Utilities.GetPlayers().Where(Tracked))
        {
            if (p.Team is not (CsTeam.CounterTerrorist or CsTeam.Terrorist)) continue;
            players.Add(new JsonObject { ["player"] = Ref(p), ["team"] = p.Team == CsTeam.CounterTerrorist ? "CT" : "T" });
            FlushWeapons(p);
        }
        Queue("round_end", new JsonObject { ["winner"] = winner, ["players"] = players, ["map"] = Server.MapName });
        foreach (var (type, fields) in _mix.OnRoundEnd(winner, Config.MixReady, Config.MixMaxRounds)) Queue(type, fields);
        return HookResult.Continue;
    }

    // ─── Ritmul: heartbeat, evenimente, liste ────────────────────────────────

    private void ScheduleHeartbeat(float seconds)
    {
        _heartbeatTimer?.Kill();
        _heartbeatTimer = AddTimer(seconds, () =>
        {
            _ = HeartbeatAsync();
            ScheduleHeartbeat(_heartbeat);
        }, TimerFlags.STOP_ON_MAPCHANGE);
    }

    private void Tick()
    {
        if (_client is not { Configured: true }) return;
        var batch = _queue.TakeBatch(_eventsInterval);
        if (batch is { } b) _ = SendEventsAsync(b.Body, b.Count);
        if ((DateTime.UtcNow - _lastPull).TotalMinutes >= 10) _ = PullListsAsync(true);
    }

    private async Task SendEventsAsync(string body, int count)
    {
        var res = await _client!.SendAsync("POST", "/events", body).ConfigureAwait(false);
        // 200 = toate rezultatele sunt confirmări; 4xx (în afară de 409 / 429 / clock_skew) = lot invalid; restul se reîncearcă.
        var outcome = res.Status == 200 ? BatchOutcome.Confirmed : res.Status is >= 400 and < 500 and not 409 and not 429 && res.Error != "clock_skew" ? BatchOutcome.Dropped : BatchOutcome.Retry;
        if (Config.Debug) Logger.LogInformation("[GCS] events {Status} ({Count})", res.Status, count);
        _queue.Done(count, outcome);
    }

    private async Task HeartbeatAsync()
    {
        if (_client is not { Configured: true }) return;
        var tcs = new TaskCompletionSource<string>();
        Server.NextFrame(() =>
        {
            var players = new JsonArray();
            foreach (var p in Utilities.GetPlayers().Where(Tracked))
            {
                var r = Ref(p);
                r["team"] = p.Team == CsTeam.CounterTerrorist ? "CT" : p.Team == CsTeam.Terrorist ? "T" : "SPEC";
                r["score"] = p.Score;
                players.Add(r);
            }
            var body = new JsonObject { ["plugin"] = BridgeClient.PluginId, ["map"] = Server.MapName, ["maxPlayers"] = Server.MaxPlayers, ["players"] = players };
            if (_mix.Open) body["match"] = _mix.State(Server.MapName, Ref);
            tcs.SetResult(body.ToJsonString());
        });
        var res = await _client.SendAsync("POST", "/heartbeat", await tcs.Task.ConfigureAwait(false)).ConfigureAwait(false);
        if (res.Status != 200 || res.Body is null) return;
        _heartbeat = Math.Clamp(res.Body["config"]?["heartbeat"]?.GetValue<int>() ?? 30, 15, 120);
        _eventsInterval = Math.Clamp(res.Body["config"]?["events"]?.GetValue<int>() ?? 10, 5, 60);
        var versions = res.Body["versions"];
        if (versions?["admins"]?.GetValue<string>() != _lists.AdminsEtag || versions?["vip"]?.GetValue<string>() != _lists.VipEtag) await PullListsAsync(false).ConfigureAwait(false);
        _remoteSanctions = versions?["sanctions"]?.GetValue<long>() ?? _remoteSanctions;
        if (_remoteSanctions != _lists.Cursor) await PullSanctionsAsync().ConfigureAwait(false);
    }

    private async Task PullListsAsync(bool withSanctions)
    {
        _lastPull = DateTime.UtcNow;
        var admins = await _client!.SendAsync("GET", "/admins", etag: _lists.AdminsEtag).ConfigureAwait(false);
        if (admins.Status == 200 && admins.Body is not null) _lists.SetAdmins(admins.Body);
        var vip = await _client.SendAsync("GET", "/vip", etag: _lists.VipEtag).ConfigureAwait(false);
        if (vip.Status == 200 && vip.Body is not null) _lists.SetVip(vip.Body);
        if (withSanctions) await PullSanctionsAsync().ConfigureAwait(false);
        Server.NextFrame(() => Utilities.GetPlayers().Where(Tracked).ToList().ForEach(ApplyLocal));
    }

    private async Task PullSanctionsAsync()
    {
        if (_pullingSanctions) return;
        _pullingSanctions = true;
        try
        {
            var first = true;
            for (var page = 0; page < 1000; page++)
            {
                var res = await _client!.SendAsync("GET", $"/sanctions?since={_lists.Cursor}").ConfigureAwait(false);
                if (res.Status != 200 || res.Body is null) return;
                _lists.ApplySanctionPage(res.Body, first);
                first = false;
                if (res.Body["more"]?.GetValue<bool>() != true) break;
            }
            _lists.SaveSanctions();
            Server.NextFrame(() => Utilities.GetPlayers().Where(Tracked).ToList().ForEach(ApplyLocal));
        }
        finally
        {
            _pullingSanctions = false;
        }
    }

    // ─── Aplicarea pe jucători ───────────────────────────────────────────────

    /// <summary>Listele locale: banul → kick; mute → vocea oprită; gag → chat-ul blocat; drepturile de admin și VIP.</summary>
    private void ApplyLocal(CCSPlayerController p)
    {
        if (!Tracked(p)) return;
        var ip = (p.IpAddress ?? "").Split(':')[0];
        var active = _lists.ActiveFor(p.SteamID, ip, Now());
        if (active.TryGetValue("ban", out var ban))
        {
            Kick(p, ban);
            return;
        }
        SetComm(p, active.ContainsKey("mute"), active.ContainsKey("gag"));
        var steamId = new SteamID(p.SteamID);
        var rights = _lists.RightsFor(p.SteamID, Now());
        AdminManager.ClearPlayerPermissions(steamId);
        if (rights.Permissions.Length > 0) AdminManager.AddPlayerPermissions(steamId, rights.Permissions);
        AdminManager.SetPlayerImmunity(steamId, rights.Immunity);
    }

    private void SetComm(CCSPlayerController p, bool mute, bool gag)
    {
        if (mute) _muted.Add(p.Slot);
        else _muted.Remove(p.Slot);
        if (gag) _gagged.Add(p.Slot);
        else _gagged.Remove(p.Slot);
        p.VoiceFlags = mute ? VoiceFlags.Muted : VoiceFlags.Normal;
    }

    private void Kick(CCSPlayerController p, Sanction ban)
    {
        var left = ban.ExpiresAt is long e ? $"{Math.Max(1, (e - Now()) / 60)} minute rămase" : "permanent";
        var reason = $"Banat: {ban.Reason} ({left})".Replace("\"", "'");
        Server.ExecuteCommand($"kickid {p.UserId} \"{reason}\"");
    }

    /// <summary>`/check` la conectare (3 secunde); fără răspuns, rămân listele locale.</summary>
    private async Task CheckAsync(CCSPlayerController p)
    {
        var slot = p.Slot;
        var steamId = p.SteamID;
        var body = new JsonObject { ["player"] = Ref(p) }.ToJsonString();
        var res = await _client!.SendAsync("POST", "/check", body, timeout: TimeSpan.FromSeconds(3)).ConfigureAwait(false);
        if (res.Status != 200 || res.Body is null) return;
        Server.NextFrame(() =>
        {
            var player = Utilities.GetPlayerFromSlot(slot);
            if (player is null || !player.IsValid || player.SteamID != steamId) return;
            if (LocalLists.ParseSanction(res.Body["ban"]) is { Id: > 0 } ban)
            {
                _lists.AddLocal(ban);
                Kick(player, ban);
                return;
            }
            SetComm(player, res.Body["mute"] is JsonObject || _muted.Contains(slot), res.Body["gag"] is JsonObject || _gagged.Contains(slot));
        });
    }

    // ─── Chat: legarea identității, gag, ready-up ───────────────────────────

    private HookResult OnSay(CCSPlayerController? player, CommandInfo info)
    {
        if (player is null || !Tracked(player)) return HookResult.Continue;
        if (_gagged.Contains(player.Slot))
        {
            player.PrintToChat($" {ChatColors.Red}[GCS]{ChatColors.Default} Ai gag: nu poți scrie în chat.");
            return HookResult.Handled;
        }
        var text = info.GetArg(1).Trim();
        if (Config.MixReady && (text.Equals("!ready", StringComparison.OrdinalIgnoreCase) || text.Equals("/ready", StringComparison.OrdinalIgnoreCase)))
        {
            foreach (var (type, fields) in _mix.Ready(player.Slot, true, Utilities.GetPlayers().Where(Tracked).ToList(), Config.MixPlayers, Server.MapName, Ref, out var message)) Queue(type, fields);
            Server.PrintToChatAll($" [GCS] {message}");
            return HookResult.Handled;
        }
        if (Config.MixReady && (text.Equals("!unready", StringComparison.OrdinalIgnoreCase) || text.Equals("/unready", StringComparison.OrdinalIgnoreCase)))
        {
            _mix.Ready(player.Slot, false, Utilities.GetPlayers().Where(Tracked).ToList(), Config.MixPlayers, Server.MapName, Ref, out var message);
            Server.PrintToChatAll($" [GCS] {message}");
            return HookResult.Handled;
        }
        return HookResult.Continue;
    }

    /// <summary>`!gcs COD` / `/gcs COD` (§3.3). Pe CS2 identitatea e Steam: contul se leagă de pe site (Conectează Steam).</summary>
    [ConsoleCommand("css_gcs", "Leagă identitatea de contul de pe site")]
    [CommandHelper(minArgs: 1, usage: "<COD>", whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void OnLinkCommand(CCSPlayerController? player, CommandInfo command)
    {
        if (player is null || !Tracked(player) || _client is not { Configured: true }) return;
        var slot = player.Slot;
        var body = new JsonObject { ["player"] = Ref(player), ["code"] = command.GetArg(1) }.ToJsonString();
        player.PrintToChat(" [GCS] Se verifică codul…");
        _ = Task.Run(async () =>
        {
            var res = await _client.SendAsync("POST", "/link", body).ConfigureAwait(false);
            var message = res.Status == 200
                ? $"Identitatea ta e legată de contul {res.Body?["user"]?.GetValue<string>()}."
                : res.Error switch
                {
                    "steam_use_site" => "Contul Steam se leagă de pe site (Setări → Cont → Conectează Steam).",
                    "expired_code" => "Codul a expirat. Cere unul nou pe site.",
                    "used_code" => "Codul a fost deja folosit.",
                    "already_linked" => "Identitatea ta e deja legată de alt cont.",
                    "rate_limited" => "Prea multe încercări. Așteaptă un minut.",
                    _ => "Cod invalid.",
                };
            Server.NextFrame(() => Utilities.GetPlayerFromSlot(slot)?.PrintToChat($" [GCS] {message}"));
        });
    }

    // ─── Sancțiunile din joc ────────────────────────────────────────────────

    private void QueueSanction(CCSPlayerController? admin, CCSPlayerController target, string kind, int minutes, string reason, bool global)
    {
        Queue("sanction", new JsonObject
        {
            ["kind"] = kind,
            ["target"] = Ref(target),
            ["minutes"] = minutes,
            ["reason"] = reason,
            ["scope"] = global ? "global" : "server",
            ["admin"] = admin is not null && Tracked(admin) ? Ref(admin) : ConsoleRef(),
        });
    }

    private static (int Minutes, string Reason) Duration(CommandInfo command)
    {
        var minutes = int.TryParse(command.GetArg(2), out var m) ? Math.Max(0, m) : 0;
        var reason = string.Join(' ', Enumerable.Range(3, Math.Max(0, command.ArgCount - 3)).Select(command.GetArg)).Trim();
        return (minutes, reason.Length > 0 ? reason : "-");
    }

    [ConsoleCommand("css_gcsban", "Ban pe acest server: <țintă> <minute> [motiv]")]
    [ConsoleCommand("css_gcsgban", "Ban pe toate serverele: <țintă> <minute> [motiv]")]
    [CommandHelper(minArgs: 2, usage: "<țintă> <minute> [motiv]")]
    [RequiresPermissionsOr("@css/ban", "@gcs/tempban")]
    public void OnBanCommand(CCSPlayerController? admin, CommandInfo command)
    {
        var (minutes, reason) = Duration(command);
        // `@gcs/tempban` (flag-ul v) dă doar bannuri temporare.
        if (admin is not null && minutes == 0 && !AdminManager.PlayerHasPermissions(admin, "@css/ban"))
        {
            command.ReplyToCommand("[GCS] Doar bannuri temporare cu drepturile tale.");
            return;
        }
        var global = command.GetArg(0).Equals("css_gcsgban", StringComparison.OrdinalIgnoreCase);
        foreach (var target in command.GetArgTargetResult(1).Players.Where(Tracked))
        {
            if (admin is not null && !AdminManager.CanPlayerTarget(admin, target)) continue;
            QueueSanction(admin, target, "ban", minutes, reason, global);
            var local = new Sanction(-Random.Shared.NextInt64(1, long.MaxValue), "ban", target.SteamID, (target.IpAddress ?? "").Split(':')[0], reason, Now(), minutes > 0 ? Now() + minutes * 60L : null, admin?.PlayerName ?? "Console", global ? "global" : "server");
            _lists.AddLocal(local);
            Kick(target, local);
        }
        command.ReplyToCommand(global ? "[GCS] Ban trimis (toate serverele)." : "[GCS] Ban trimis (acest server).");
    }

    [ConsoleCommand("css_gcsmute", "Mute vocal: <țintă> <minute> [motiv]")]
    [ConsoleCommand("css_gcsgag", "Gag (chat): <țintă> <minute> [motiv]")]
    [CommandHelper(minArgs: 2, usage: "<țintă> <minute> [motiv]")]
    [RequiresPermissions("@css/chat")]
    public void OnCommCommand(CCSPlayerController? admin, CommandInfo command)
    {
        var (minutes, reason) = Duration(command);
        var mute = command.GetArg(0).Equals("css_gcsmute", StringComparison.OrdinalIgnoreCase);
        foreach (var target in command.GetArgTargetResult(1).Players.Where(Tracked))
        {
            if (admin is not null && !AdminManager.CanPlayerTarget(admin, target)) continue;
            QueueSanction(admin, target, mute ? "mute" : "gag", minutes, reason, false);
            SetComm(target, mute || _muted.Contains(target.Slot), !mute || _gagged.Contains(target.Slot));
        }
        command.ReplyToCommand(mute ? "[GCS] Mute aplicat." : "[GCS] Gag aplicat.");
    }

    [ConsoleCommand("css_gcsunmute", "Ridică mute-ul: <țintă> [motiv]")]
    [ConsoleCommand("css_gcsungag", "Ridică gag-ul: <țintă> [motiv]")]
    [CommandHelper(minArgs: 1, usage: "<țintă> [motiv]")]
    [RequiresPermissions("@css/chat")]
    public void OnUncommCommand(CCSPlayerController? admin, CommandInfo command)
    {
        var mute = command.GetArg(0).Equals("css_gcsunmute", StringComparison.OrdinalIgnoreCase);
        foreach (var target in command.GetArgTargetResult(1).Players.Where(Tracked))
        {
            Queue("unsanction", new JsonObject { ["kind"] = mute ? "mute" : "gag", ["target"] = Ref(target), ["reason"] = command.GetArg(2), ["admin"] = admin is not null && Tracked(admin) ? Ref(admin) : ConsoleRef() });
            SetComm(target, !mute && _muted.Contains(target.Slot), mute && _gagged.Contains(target.Slot));
        }
        command.ReplyToCommand(mute ? "[GCS] Mute ridicat." : "[GCS] Gag ridicat.");
    }

    [ConsoleCommand("css_gcsunban", "Ridică un ban: <SteamID64 | IP> [motiv]")]
    [CommandHelper(minArgs: 1, usage: "<SteamID64 | IP> [motiv]")]
    [RequiresPermissions("@css/unban")]
    public void OnUnbanCommand(CCSPlayerController? admin, CommandInfo command)
    {
        var arg = command.GetArg(1).Trim();
        var target = arg.Contains('.') ? new JsonObject { ["ip"] = arg } : new JsonObject { ["auth"] = arg, ["steam"] = true };
        Queue("unsanction", new JsonObject { ["kind"] = "ban", ["target"] = target, ["reason"] = command.GetArg(2), ["admin"] = admin is not null && Tracked(admin) ? Ref(admin) : ConsoleRef() });
        _lists.RemoveWhere(s => s.Type == "ban" && (s.Ip == arg || s.SteamId64?.ToString() == arg));
        command.ReplyToCommand($"[GCS] Unban trimis pentru {arg}.");
    }

    /// <summary>Jurnalul acțiunilor (§4.9) pentru kick-urile date prin plugin.</summary>
    [ConsoleCommand("css_gcskick", "Kick cu motiv (intră în jurnalul GCS): <țintă> [motiv]")]
    [CommandHelper(minArgs: 1, usage: "<țintă> [motiv]")]
    [RequiresPermissions("@css/kick")]
    public void OnKickCommand(CCSPlayerController? admin, CommandInfo command)
    {
        var reason = command.GetArg(2);
        foreach (var target in command.GetArgTargetResult(1).Players.Where(Tracked))
        {
            if (admin is not null && !AdminManager.CanPlayerTarget(admin, target)) continue;
            Queue("admin_action", new JsonObject { ["admin"] = admin is not null && Tracked(admin) ? Ref(admin) : ConsoleRef(), ["action"] = "kick", ["target"] = Ref(target), ["reason"] = reason });
            Server.ExecuteCommand($"kickid {target.UserId} \"{reason.Replace("\"", "'")}\"");
        }
    }

    // ─── Meciul mix ─────────────────────────────────────────────────────────

    [ConsoleCommand("css_gcsmatch", "Meciul mix urmărit de GCS: start | live | halftime | end | abort")]
    [CommandHelper(minArgs: 1, usage: "<start|live|halftime|end|abort>")]
    [RequiresPermissions("@css/config")]
    public void OnMatchCommand(CCSPlayerController? admin, CommandInfo command)
    {
        var events = _mix.Command(command.GetArg(1).ToLowerInvariant(), Utilities.GetPlayers().Where(Tracked).ToList(), Server.MapName, Ref, out var ok);
        foreach (var (type, fields) in events) Queue(type, fields);
        if (ok && command.GetArg(1).Equals("live", StringComparison.OrdinalIgnoreCase)) Server.ExecuteCommand("mp_restartgame 1");
        command.ReplyToCommand(ok ? $"[GCS] Meci: {command.GetArg(1)}." : $"[GCS] Tranziție nepermisă: {command.GetArg(1)}.");
    }
}
