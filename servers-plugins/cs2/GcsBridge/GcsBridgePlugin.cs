// GCS Server Bridge — pluginul CounterStrikeSharp pentru Counter-Strike 2 (GamingCommunitySuite).
//
// Vorbește protocolul v1 al punții (specul 2026-10-08-servere-bridge și 2026-10-08-servere-plugin-v2).
//
// Implicit pluginul DOAR COLECTEAZĂ DATE: heartbeat (harta, jucătorii și permisiunile lor de admin, citite din sistemul
// de admini al serverului), evenimente (conectări, ucideri, runde, focuri, damage, MVP, scorul echipelor), meciurile mix
// urmărite pasiv pe serverele marcate „mix” și legarea identității. Nu schimbă permisiuni, nu dă kick / mute / gag, nu
// rulează comenzi pe server și nu înregistrează comenzi de admin.
//
// Modulele opționale (oprite implicit, pornite din ACP pe fiecare server; `"AllowManage": false` le ține oprite oricum):
// adminii din GCS, bannurile / mute / gag din GCS, VIP-ul din GCS, ready-up-ul mix, comenzile de admin GCS și
// înregistrarea demo-urilor meciurilor mix (`tv_record` / `tv_stoprecord`, cu încărcarea opțională pe site după meci,
// specul 2026-10-08-servere-hltv). Un modul oprit nu își înregistrează comenzile și nu își trage listele de la site.
//
// Fără cheie (pachetul general), pluginul se înrolează singur la site și primește cheia după aprobarea din ACP.
// Evenimentele netrimise se salvează pe disc și se retrimit cu aceleași id-uri.
//
// Licența: MIT (CounterStrikeSharp permite explicit pluginuri MIT). Vezi LICENSE.

using System.Security.Cryptography;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Admin;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Commands.Targeting;
using CounterStrikeSharp.API.Modules.Cvars;
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

    /// <summary>
    /// Cheia API a serverului (`gcs1.&lt;keyId&gt;.&lt;secret&gt;`). Goală = pluginul se înrolează singur, iar adminul îl
    /// aprobă în ACP (cheia primită se salvează în `plugins/GcsBridge/data/gcs_bridge_key.txt`).
    /// </summary>
    [JsonPropertyName("Key")] public string Key { get; set; } = "";

    /// <summary>`false` = pluginul rămâne doar colector, orice module opționale s-ar porni în ACP.</summary>
    [JsonPropertyName("AllowManage")] public bool AllowManage { get; set; } = true;

    /// <summary>Jucătorii necesari pentru ready-up (modulul „Ready-up mix”).</summary>
    [JsonPropertyName("MixPlayers")] public int MixPlayers { get; set; } = 10;

    /// <summary>Rundele unui meci mix când `mp_maxrounds` e 0.</summary>
    [JsonPropertyName("MixMaxRounds")] public int MixMaxRounds { get; set; } = 24;

    /// <summary>Modulul „demos”: demo-ul rămâne pe disc după ce a ajuns pe site (implicit se șterge: l-a creat pluginul).</summary>
    [JsonPropertyName("KeepDemos")] public bool KeepDemos { get; set; } = false;

    [JsonPropertyName("Debug")] public bool Debug { get; set; } = false;
}

public sealed class GcsBridgePlugin : BasePlugin, IPluginConfig<GcsBridgeConfig>
{
    public override string ModuleName => "GCS Server Bridge";
    public override string ModuleVersion => BridgeClient.Version;
    public override string ModuleAuthor => "GamingCommunitySuite";
    public override string ModuleDescription => "Puntea serverului cu GamingCommunitySuite: colectează datele serverului (statistici, meciuri mix, adminii prezenți).";

    /// <summary>Modulele opționale (cheile din `config.features`), oprite implicit.</summary>
    private static readonly string[] Features = { "admins", "sanctions", "vip", "mixReady", "commands", "demos" };

    /// <summary>Permisiunile citite din sistemul de admini al serverului (raportate în heartbeat, doar citite).</summary>
    private static readonly string[] KnownPermissions =
    {
        "@css/root", "@css/generic", "@css/kick", "@css/ban", "@css/unban", "@css/slay", "@css/changemap", "@css/cvar",
        "@css/config", "@css/chat", "@css/vote", "@css/password", "@css/rcon", "@css/reservation", "@gcs/tempban",
    };

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
    private readonly Dictionary<int, string[]> _vipAdded = new();

    // Modulele: cum le-a trimis site-ul (salvate local) și comenzile înregistrate acum.
    private readonly Dictionary<string, bool> _siteFeatures = Features.ToDictionary(f => f, _ => false);
    private bool _commandsRegistered;
    private bool _isMix;
    // Meciul condus din comandă (`css_gcsmatch`): urmărirea pasivă stă deoparte până la harta următoare.
    private bool _mixManual;
    private bool _pendingStart;

    // Demo-urile meciurilor mix (modulul „demos”): înregistrarea în curs și coada de încărcat.
    private DemoUploader _uploader = null!;
    private string? _recordingMatch;
    private string? _recordingName;
    // Oprirea programată (după întârzierea transmisiei): meciul, numele fișierului, dacă meciul s-a încheiat.
    private (string Match, string Name, bool Ended)? _stopping;
    private Timer? _stopTimer;
    private bool _tvWarned;

    // Înrolarea (fără cheie).
    private bool _enrolling;
    private bool _enrollBusy;
    private bool _enrollAnnounced;
    private string _enrollSecret = "";
    private string _enrollRef = "";
    private DateTime _enrollNextAt = DateTime.MinValue;
    private int _enrollBackoff;

    private sealed class WeaponDelta
    {
        public int Shots;
        public int Hits;
        public int Damage;
        public int Headshots;
    }

    private string DataDir => Path.Combine(ModuleDirectory, "data");
    private string KeyPath => Path.Combine(DataDir, "gcs_bridge_key.txt");
    private string EnrollPath => Path.Combine(DataDir, "gcs_bridge_enroll.json");
    private string FeaturesPath => Path.Combine(DataDir, "gcs_bridge_features.json");

    public void OnConfigParsed(GcsBridgeConfig config)
    {
        Config = config;
        Connect();
    }

    /// <summary>
    /// Clientul protocolului: cheia din config, altfel cea primită prin înrolare; fără niciuna, dar cu adresa site-ului,
    /// înrolarea automată.
    /// </summary>
    private void Connect()
    {
        Directory.CreateDirectory(DataDir);
        var key = Config.Key.Trim();
        if (key.Length == 0 && File.Exists(KeyPath)) key = File.ReadAllText(KeyPath).Trim();
        _client?.Dispose();
        _client = new BridgeClient(Config.Url, key);
        _enrolling = !_client.Configured && _client.UrlOk && key.Length == 0;
        if (_client.Insecure) Logger.LogWarning("[GCS] Adresa site-ului e http:// (fără TLS); folosește https://.");
        if (_enrolling) LoadEnroll();
        else if (!_client.Configured) Logger.LogWarning(_client.UrlOk ? "[GCS] Key nu are forma gcs1.<keyId>.<secret>: verifică GcsBridge.json." : "[GCS] Configurare incompletă: setează Url în GcsBridge.json.");
    }

    public override void Load(bool hotReload)
    {
        Directory.CreateDirectory(DataDir);
        _lists = new LocalLists(DataDir);
        _lists.Load();
        _queue.Load(Path.Combine(DataDir, "gcs_bridge_queue.jsonl"));
        LoadFeatures();
        // Încărcarea demo-urilor: niciodată cât timp pe server e un meci mix (încălzire, live, pauză).
        _uploader = new DemoUploader(Path.Combine(DataDir, "gcs_demo_uploads.json")) { Paused = () => _mix.Open, KeepFiles = Config.KeepDemos, Log = message => Logger.LogInformation("{Message}", message) };
        _uploader.Load();

        RegisterListener<Listeners.OnMapStart>(OnMapStart);
        RegisterListener<Listeners.OnMapEnd>(() =>
        {
            // Meciul nu continuă pe harta următoare: unul deschis se anulează (fără ELO).
            if (_mix.Open) QueueAll(_mix.Command("abort", new List<CCSPlayerController>(), Server.MapName, Ref, out _));
            _mixManual = false;
            _pendingStart = false;
            _queue.Save(Path.Combine(DataDir, "gcs_bridge_queue.jsonl"));
            // Timerul heartbeat-ului (STOP_ON_MAPCHANGE) e distrus acum de CounterStrikeSharp: nu se mai oprește a doua oară.
            _heartbeatTimer = null;
        });
        RegisterEventHandler<EventPlayerConnectFull>(OnConnectFull);
        RegisterEventHandler<EventPlayerDisconnect>(OnDisconnect, HookMode.Pre);
        RegisterEventHandler<EventPlayerDeath>(OnDeath);
        RegisterEventHandler<EventPlayerHurt>(OnHurt);
        RegisterEventHandler<EventWeaponFire>(OnWeaponFire);
        RegisterEventHandler<EventRoundMvp>(OnMvp);
        RegisterEventHandler<EventRoundEnd>(OnRoundEnd);
        // Meciurile mix urmărite pasiv: începutul meciului (după warmup / restart), începutul rundei, finalul.
        RegisterEventHandler<EventRoundAnnounceMatchStart>((_, _) => MarkRestart());
        RegisterEventHandler<EventBeginNewMatch>((_, _) => MarkRestart());
        RegisterEventHandler<EventRoundStart>(OnRoundStart);
        RegisterEventHandler<EventCsWinPanelMatch>(OnMatchEnd);
        AddCommandListener("say", OnSay, HookMode.Pre);
        AddCommandListener("say_team", OnSay, HookMode.Pre);

        ApplyFeatures();
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

    // ─── Modulele opționale (specul plugin-v2 §1.2) ──────────────────────────

    /// <summary>Modulul e pornit: pe site și cu acordul local (`AllowManage`).</summary>
    private bool Feat(string name) => Config.AllowManage && _siteFeatures.TryGetValue(name, out var on) && on;

    private bool AnyManage => Feat("admins") || Feat("sanctions") || Feat("vip");

    private void LoadFeatures()
    {
        try
        {
            if (File.Exists(FeaturesPath) && JsonNode.Parse(File.ReadAllText(FeaturesPath)) is JsonObject saved)
            {
                foreach (var f in Features) _siteFeatures[f] = saved[f] is JsonValue v && v.TryGetValue<bool>(out var on) && on;
            }
        }
        catch (Exception)
        {
            // Un fișier stricat contează ca lipsă: modulele vin din nou de la site.
        }
    }

    private void SaveFeatures()
    {
        var doc = new JsonObject();
        foreach (var f in Features) doc[f] = _siteFeatures[f];
        File.WriteAllText(FeaturesPath, doc.ToJsonString());
    }

    /// <summary>Comenzile modulului „commands”: înregistrate doar cât timp e pornit (CounterStrikeSharp le poate scoate).</summary>
    private void ApplyFeatures()
    {
        var commands = Feat("commands");
        if (commands == _commandsRegistered) return;
        _commandsRegistered = commands;
        foreach (var (name, description, handler) in AdminCommands())
        {
            if (commands) AddCommand(name, description, handler);
            else RemoveCommand(name, handler);
        }
    }

    private List<(string Name, string Description, CommandInfo.CommandCallback Handler)> AdminCommands() => new()
    {
        ("css_gcsban", "Ban pe acest server: <țintă> <minute> [motiv]", OnBanCommand),
        ("css_gcsgban", "Ban pe toate serverele: <țintă> <minute> [motiv]", OnBanCommand),
        ("css_gcsmute", "Mute vocal: <țintă> <minute> [motiv]", OnCommCommand),
        ("css_gcsgag", "Gag (chat): <țintă> <minute> [motiv]", OnCommCommand),
        ("css_gcsunmute", "Ridică mute-ul: <țintă> [motiv]", OnUncommCommand),
        ("css_gcsungag", "Ridică gag-ul: <țintă> [motiv]", OnUncommCommand),
        ("css_gcsunban", "Ridică un ban: <SteamID64 | IP> [motiv]", OnUnbanCommand),
        ("css_gcskick", "Kick cu motiv (intră în jurnalul GCS): <țintă> [motiv]", OnKickCommand),
        ("css_gcsmatch", "Meciul mix urmărit de GCS: start | live | halftime | end | abort", OnMatchCommand),
    };

    /// <summary>Modulele s-au schimbat pe site: ce s-a oprit nu mai atinge nimic, ce s-a pornit își trage listele acum.</summary>
    private void FeaturesChanged(Dictionary<string, bool> before)
    {
        ApplyFeatures();
        var players = Utilities.GetPlayers().Where(Tracked).ToList();
        if (before["admins"] && !Feat("admins"))
        {
            // Permisiunile revin la sistemul serverului (configs/admins.json).
            _vipAdded.Clear();
            Server.ExecuteCommand("css_reloadadmins");
        }
        else if (before["vip"] && !Feat("vip") && !Feat("admins"))
        {
            foreach (var p in players)
            {
                if (_vipAdded.Remove(p.Slot, out var added) && added.Length > 0) AdminManager.RemovePlayerPermissions(new SteamID(p.SteamID), added);
            }
        }
        if (before["sanctions"] && !Feat("sanctions"))
        {
            foreach (var p in players) SetComm(p, false, false);
        }
        if ((!before["admins"] && Feat("admins")) || (!before["vip"] && Feat("vip")) || (!before["sanctions"] && Feat("sanctions"))) _ = PullListsAsync(true);
    }

    // ─── Referințele și evenimentele ─────────────────────────────────────────

    /// <summary>Referința jucătorului (§6.3): pe CS2 identitatea e mereu SteamID-ul (GCS decide, pluginul raportează).</summary>
    private static JsonObject Ref(CCSPlayerController p)
    {
        var ip = (p.IpAddress ?? "").Split(':')[0];
        return new JsonObject { ["auth"] = p.SteamID.ToString(), ["steam"] = true, ["name"] = p.PlayerName, ["ip"] = ip };
    }

    /// <summary>
    /// Referința cu permisiunile de admin actuale ale jucătorului, din sistemul serverului (`configs/admins.json`,
    /// grupurile): doar citite, ca site-ul să arate prezența adminilor.
    /// </summary>
    private static JsonObject RefWithRights(CCSPlayerController p)
    {
        var r = Ref(p);
        var steamId = new SteamID(p.SteamID);
        var data = AdminManager.GetPlayerAdminData(steamId);
        if (data is null) return r;
        var permissions = new JsonArray();
        foreach (var perm in KnownPermissions)
        {
            if (AdminManager.PlayerHasPermissions(steamId, perm)) permissions.Add(perm);
        }
        if (permissions.Count > 0) r["permissions"] = permissions;
        var groups = new JsonArray();
        foreach (var g in data.Groups.Take(16)) groups.Add(g);
        if (groups.Count > 0) r["groups"] = groups;
        return r;
    }

    private static JsonObject ConsoleRef() => new() { ["auth"] = "CONSOLE", ["name"] = "Console" };

    /// <summary>Pune evenimentul în coadă; întoarce poziția lui (<see cref="EventQueue.Add"/>).</summary>
    private long Queue(string type, JsonObject fields)
    {
        fields["type"] = type;
        return _queue.Add(fields, Now());
    }

    private void QueueAll(List<(string Type, JsonObject Fields)> events)
    {
        foreach (var (type, fields) in events) Queue(type, fields);
        foreach (var (type, fields) in events)
        {
            if (type == "match" && fields["match"] is JsonObject state) OnMatchState(state);
        }
    }

    // ─── Demo-urile meciurilor mix (modulul „demos”, specul servere-hltv §8) ──

    /// <summary>Numele înregistrării: `gcs-&lt;id meci&gt;` (ca pe site: caracterele din afara `[A-Za-z0-9_-]` devin `_`).</summary>
    private static string DemoName(string matchId) => "gcs-" + new string(matchId.Select(c => char.IsAsciiLetterOrDigit(c) || c is '_' or '-' ? c : '_').ToArray());

    /// <summary>Valoarea numerică a unui cvar, după tipul lui real (citirea cu alt tip ar da gunoi); necunoscut → null.</summary>
    private static double? ConVarNumber(string name)
    {
        var cvar = ConVar.Find(name);
        if (cvar is null) return null;
        try
        {
            return cvar.Type.ToString() switch
            {
                "Bool" => cvar.GetPrimitiveValue<bool>() ? 1 : 0,
                "Float32" => cvar.GetPrimitiveValue<float>(),
                "Float64" => cvar.GetPrimitiveValue<double>(),
                "Int32" => cvar.GetPrimitiveValue<int>(),
                "UInt32" => cvar.GetPrimitiveValue<uint>(),
                "Int16" => cvar.GetPrimitiveValue<short>(),
                "UInt16" => cvar.GetPrimitiveValue<ushort>(),
                _ => null,
            };
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>GOTV pornit pe server (`tv_enable 1`): fără el `tv_record` nu înregistrează nimic.</summary>
    private static bool TvEnabled() => ConVarNumber("tv_enable") is > 0;

    private static int TvDelay() => (int)Math.Clamp(Math.Round(ConVarNumber("tv_delay") ?? 0), 0, 3600);

    /// <summary>
    /// Starea meciului: la `live` pornește înregistrarea (o dată pe meci); la `ended` / `aborted` o oprește după întârzierea
    /// transmisiei + 5 s (GOTV scrie finalul cu întârziere), iar demo-ul unui meci încheiat intră în coada de încărcat.
    /// </summary>
    private void OnMatchState(JsonObject state)
    {
        var id = state["id"]?.GetValue<string>() ?? "";
        var status = state["status"]?.GetValue<string>() ?? "";
        if (status == "live" && _recordingMatch is null && Feat("demos"))
        {
            if (!TvEnabled())
            {
                if (!_tvWarned) Logger.LogWarning("[GCS] Modulul demo-urilor e pornit, dar GOTV e oprit (tv_enable 0): meciul nu se înregistrează.");
                _tvWarned = true;
                return;
            }
            // GOTV înregistrează un singur demo odată: oprirea încă programată a meciului de dinainte se face acum.
            FinishStop();
            _recordingMatch = id;
            _recordingName = DemoName(id);
            Server.ExecuteCommand($"tv_record \"{_recordingName}\"");
            return;
        }
        if ((status == "ended" || status == "aborted") && _recordingMatch == id && _recordingName is { } name)
        {
            _recordingMatch = null;
            _recordingName = null;
            _stopping = (id, name, status == "ended");
            // Meciul încheiat: GOTV scrie finalul cu întârzierea transmisiei, deci oprirea așteaptă tv_delay + 5 s. Cel
            // anulat nu se păstrează: se oprește acum.
            if (status == "ended") _stopTimer = AddTimer(TvDelay() + 5f, FinishStop);
            else FinishStop();
        }
    }

    /// <summary>Oprește înregistrarea programată; demo-ul meciului încheiat intră în coada de încărcat.</summary>
    private void FinishStop()
    {
        if (_stopping is not { } stop) return;
        _stopping = null;
        _stopTimer?.Kill();
        _stopTimer = null;
        Server.ExecuteCommand("tv_stoprecord");
        // Fișierul se închide după oprire; încărcarea (dacă e pornită pe site) pleacă după câteva secunde.
        AddTimer(5f, () =>
        {
            var path = DemoPath(stop.Name);
            if (path is null) return;
            if (stop.Ended) _uploader.Enqueue(stop.Match, path);
            else if (!Config.KeepDemos) TryDelete(path);
        });
    }

    /// <summary>Unde a scris GOTV demo-ul (folderul jocului, `csgo/`).</summary>
    private static string? DemoPath(string name)
    {
        foreach (var dir in new[] { Path.Combine(Server.GameDirectory, "csgo"), Server.GameDirectory })
        {
            var path = Path.Combine(dir, name + ".dem");
            if (File.Exists(path)) return path;
        }
        return null;
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception)
        {
            // Încă deschis: rămâne pe disc.
        }
    }

    private void OnMapStart(string mapName)
    {
        Queue("map", new JsonObject { ["map"] = mapName });
        // Timerul heartbeat-ului se oprește la schimbarea hărții: îl pornim din nou.
        ScheduleHeartbeat(5);
    }

    private HookResult OnConnectFull(EventPlayerConnectFull ev, GameEventInfo info)
    {
        var p = ev.Userid;
        if (!Tracked(p)) return HookResult.Continue;
        _weapons[p!.Slot] = new Dictionary<string, WeaponDelta>();
        _vipAdded.Remove(p.Slot);
        ApplyLocal(p);
        Queue("connect", new JsonObject { ["player"] = RefWithRights(p) });
        // Verificarea proaspătă la site doar pentru modulele de administrare.
        if (AnyManage) _ = CheckAsync(p);
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
        _vipAdded.Remove(p.Slot);
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

    /// <summary>Scorul echipelor (CT / T), din entitățile echipelor.</summary>
    private static (int Ct, int T) TeamScores()
    {
        int ct = 0, t = 0;
        foreach (var team in Utilities.FindAllEntitiesByDesignerName<CCSTeam>("cs_team_manager"))
        {
            if (team.TeamNum == (int)CsTeam.CounterTerrorist) ct = team.Score;
            else if (team.TeamNum == (int)CsTeam.Terrorist) t = team.Score;
        }
        return (ct, t);
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
        // Finalul meciului la majoritate: urmărirea pasivă și ready-up-ul (comanda adminului îl încheie singură).
        QueueAll(_mix.OnRoundEnd(winner, !_mixManual, MaxRounds()));
        return HookResult.Continue;
    }

    // ─── Meciurile mix urmărite pasiv (specul plugin-v2 §3) ──────────────────

    /// <summary>Rundele unui meci: `mp_maxrounds` al serverului, altfel `MixMaxRounds`.</summary>
    private int MaxRounds()
    {
        var rounds = ConVar.Find("mp_maxrounds")?.GetPrimitiveValue<int>() ?? 0;
        return rounds > 0 ? rounds : Math.Max(2, Config.MixMaxRounds);
    }

    /// <summary>Pe un server mix, fără ca meciul să fie condus din comandă în această hartă.</summary>
    private bool PassiveMix => _isMix && !_mixManual;

    private HookResult MarkRestart()
    {
        if (PassiveMix) _pendingStart = true;
        return HookResult.Continue;
    }

    private HookResult OnRoundStart(EventRoundStart ev, GameEventInfo info)
    {
        if (!PassiveMix) return HookResult.Continue;
        var players = Utilities.GetPlayers().Where(Tracked).ToList();
        if (_pendingStart)
        {
            _pendingStart = false;
            if (_mix.Open)
            {
                // Restartul cu 0 runde sau după schimbarea părților: meciul continuă. Unul înainte de runda 3: meci nou.
                if (_mix.Round > 0 && !_mix.Swapped && _mix.Round < 3)
                {
                    QueueAll(_mix.Command("abort", players, Server.MapName, Ref, out _));
                    StartPassive(players);
                }
                return HookResult.Continue;
            }
            StartPassive(players);
            return HookResult.Continue;
        }
        QueueAll(_mix.OnRoundStart(players, Server.MapName, Ref));
        return HookResult.Continue;
    }

    private void StartPassive(List<CCSPlayerController> players)
    {
        var (ct, t) = MixMatch.Sides(players);
        if (ct < MixMatch.MinTeam || t < MixMatch.MinTeam) return;
        QueueAll(_mix.Command("start", players, Server.MapName, Ref, out var ok));
        if (ok) QueueAll(_mix.Command("live", players, Server.MapName, Ref, out _));
    }

    private HookResult OnMatchEnd(EventCsWinPanelMatch ev, GameEventInfo info)
    {
        if (!_mixManual && _mix.Live) QueueAll(_mix.Command("end", new List<CCSPlayerController>(), Server.MapName, Ref, out _));
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
        if (_enrolling)
        {
            EnrollTick();
            return;
        }
        if (_client is not { Configured: true }) return;
        _uploader.Tick(_client);
        var batch = _queue.TakeBatch(_eventsInterval);
        if (batch is { } b) _ = SendEventsAsync(b.Body, b.Count);
        // Doar modulele cu liste (admini, VIP, sancțiuni) trag de la site; colectorul nu trage nimic.
        if (AnyManage && (DateTime.UtcNow - _lastPull).TotalMinutes >= 10) _ = PullListsAsync(true);
    }

    private async Task SendEventsAsync(string body, int count)
    {
        // Lotul se încheie mereu (confirmat, aruncat sau de reîncercat): rămas „în zbor”, ar bloca pentru totdeauna coada.
        var outcome = BatchOutcome.Retry;
        try
        {
            var res = await _client!.SendAsync("POST", "/events", body).ConfigureAwait(false);
            // 200 = toate rezultatele sunt confirmări; 4xx (în afară de 409 / 429 / clock_skew) = lot invalid; restul se reîncearcă.
            outcome = res.Status == 200 ? BatchOutcome.Confirmed : res.Status is >= 400 and < 500 and not 409 and not 429 && res.Error != "clock_skew" ? BatchOutcome.Dropped : BatchOutcome.Retry;
            if (Config.Debug) Logger.LogInformation("[GCS] events {Status} ({Count})", res.Status, count);
        }
        finally
        {
            _queue.Done(count, outcome);
        }
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
                var r = RefWithRights(p);
                r["team"] = p.Team == CsTeam.CounterTerrorist ? "CT" : p.Team == CsTeam.Terrorist ? "T" : "SPEC";
                r["score"] = p.Score;
                players.Add(r);
            }
            var (ct, t) = TeamScores();
            var modules = new JsonArray();
            foreach (var f in Features.Where(Feat)) modules.Add(f);
            var body = new JsonObject
            {
                ["plugin"] = BridgeClient.PluginId,
                ["map"] = Server.MapName,
                ["maxPlayers"] = Server.MaxPlayers,
                ["players"] = players,
                ["modules"] = modules,
                ["scores"] = new JsonObject { ["ct"] = ct, ["t"] = t },
                // Transmisia (GOTV): pentru „Urmărește live” și starea din ACP; doar citită.
                ["tv"] = new JsonObject { ["enabled"] = TvEnabled(), ["delay"] = TvDelay(), ["port"] = (int)Math.Clamp(ConVarNumber("tv_port") ?? 0, 0, 65535), ["recording"] = _recordingMatch is not null },
            };
            if (_mix.Open) body["match"] = _mix.State(Server.MapName, Ref);
            tcs.SetResult(body.ToJsonString());
        });
        var res = await _client.SendAsync("POST", "/heartbeat", await tcs.Task.ConfigureAwait(false)).ConfigureAwait(false);
        if (res.Status != 200 || res.Body is null) return;
        var config = res.Body["config"];
        _heartbeat = Math.Clamp(config?["heartbeat"]?.GetValue<int>() ?? 30, 15, 120);
        _eventsInterval = Math.Clamp(config?["events"]?.GetValue<int>() ?? 10, 5, 60);
        _isMix = config?["isMix"] is JsonValue mix && mix.TryGetValue<bool>(out var isMix) && isMix;
        // Încărcarea demo-urilor (`config.tv`, specul servere-hltv §4.3): doar cu modulul „demos” pornit.
        var tv = config?["tv"];
        _uploader.Enabled = tv?["upload"] is JsonValue up && up.TryGetValue<bool>(out var upload) && upload;
        if (tv?["rate"] is JsonValue rateValue && rateValue.TryGetValue<long>(out var rate) && rate > 0) _uploader.Rate = rate;
        if (config?["features"] is JsonObject features)
        {
            var before = Features.ToDictionary(f => f, Feat);
            var changed = false;
            foreach (var f in Features)
            {
                var on = features[f] is JsonValue v && v.TryGetValue<bool>(out var value) && value;
                if (on == _siteFeatures[f]) continue;
                _siteFeatures[f] = on;
                changed = true;
            }
            if (changed)
            {
                SaveFeatures();
                Server.NextFrame(() => FeaturesChanged(before));
            }
        }
        _uploader.Enabled = _uploader.Enabled && Feat("demos");
        // Doar listele modulelor pornite.
        var versions = res.Body["versions"];
        if ((Feat("admins") && versions?["admins"]?.GetValue<string>() != _lists.AdminsEtag) || (Feat("vip") && versions?["vip"]?.GetValue<string>() != _lists.VipEtag)) await PullListsAsync(false).ConfigureAwait(false);
        _remoteSanctions = versions?["sanctions"]?.GetValue<long>() ?? _remoteSanctions;
        if (Feat("sanctions") && _remoteSanctions != _lists.Cursor) await PullSanctionsAsync().ConfigureAwait(false);
    }

    private async Task PullListsAsync(bool withSanctions)
    {
        _lastPull = DateTime.UtcNow;
        if (Feat("admins"))
        {
            var admins = await _client!.SendAsync("GET", "/admins", etag: _lists.AdminsEtag).ConfigureAwait(false);
            if (admins.Status == 200 && admins.Body is not null) _lists.SetAdmins(admins.Body);
        }
        if (Feat("vip"))
        {
            var vip = await _client!.SendAsync("GET", "/vip", etag: _lists.VipEtag).ConfigureAwait(false);
            if (vip.Status == 200 && vip.Body is not null) _lists.SetVip(vip.Body);
        }
        if (withSanctions && Feat("sanctions")) await PullSanctionsAsync().ConfigureAwait(false);
        Server.NextFrame(() => Utilities.GetPlayers().Where(Tracked).ToList().ForEach(ApplyLocal));
    }

    private async Task PullSanctionsAsync()
    {
        if (_pullingSanctions) return;
        _pullingSanctions = true;
        try
        {
            var first = true;
            long removedAtPull = 0;
            for (var page = 0; page < 1000; page++)
            {
                removedAtPull = _queue.Removed;
                var res = await _client!.SendAsync("GET", $"/sanctions?since={_lists.Cursor}").ConfigureAwait(false);
                if (res.Status != 200 || res.Body is null) return;
                _lists.ApplySanctionPage(res.Body, first);
                first = false;
                if (res.Body["more"]?.GetValue<bool>() != true) break;
            }
            // Bannurile date din joc (id = -poziția evenimentului) au ajuns la GCS dacă evenimentul ieșise din coadă înainte
            // de ultima cerere: lista GCS le conține (sau GCS le-a respins), iar o ridicare pe site trebuie să conteze.
            _lists.RemoveWhere(s => s.Id < 0 && -s.Id <= removedAtPull);
            _lists.SaveSanctions();
            Server.NextFrame(() => Utilities.GetPlayers().Where(Tracked).ToList().ForEach(ApplyLocal));
        }
        finally
        {
            _pullingSanctions = false;
        }
    }

    // ─── Aplicarea pe jucători (doar modulele pornite) ───────────────────────

    /// <summary>
    /// Listele locale, după module: banul → kick; mute → vocea oprită; gag → chat-ul blocat („sanctions”); adminii și VIP-ul
    /// înlocuiesc permisiunile („admins”) sau VIP-ul se adaugă peste cele ale serverului („vip”). Fără module, nimic.
    /// </summary>
    private void ApplyLocal(CCSPlayerController p)
    {
        if (!Tracked(p)) return;
        if (Feat("sanctions"))
        {
            var ip = (p.IpAddress ?? "").Split(':')[0];
            var active = _lists.ActiveFor(p.SteamID, ip, Now());
            if (active.TryGetValue("ban", out var ban))
            {
                Kick(p, ban);
                return;
            }
            SetComm(p, active.ContainsKey("mute"), active.ContainsKey("gag"));
        }
        var steamId = new SteamID(p.SteamID);
        if (Feat("admins"))
        {
            var rights = _lists.RightsFor(p.SteamID, Now());
            AdminManager.ClearPlayerPermissions(steamId);
            if (rights.Permissions.Length > 0) AdminManager.AddPlayerPermissions(steamId, rights.Permissions);
            AdminManager.SetPlayerImmunity(steamId, rights.Immunity);
            return;
        }
        if (!Feat("vip")) return;
        // Doar VIP: permisiunile serverului rămân; se adaugă doar cele lipsă (și se scot doar cele adăugate de GCS).
        if (_vipAdded.Remove(p.Slot, out var previous) && previous.Length > 0) AdminManager.RemovePlayerPermissions(steamId, previous);
        var added = _lists.VipPermissionsFor(p.SteamID, Now()).Where(perm => !AdminManager.PlayerHasPermissions(steamId, perm)).ToArray();
        if (added.Length > 0) AdminManager.AddPlayerPermissions(steamId, added);
        _vipAdded[p.Slot] = added;
    }

    private void SetComm(CCSPlayerController p, bool mute, bool gag)
    {
        var wasMuted = _muted.Contains(p.Slot);
        if (mute) _muted.Add(p.Slot);
        else _muted.Remove(p.Slot);
        if (gag) _gagged.Add(p.Slot);
        else _gagged.Remove(p.Slot);
        // Vocea se schimbă doar când GCS a pus / scoate un mute (nu se atinge un mute dat de alt plugin).
        if (mute) p.VoiceFlags = VoiceFlags.Muted;
        else if (wasMuted) p.VoiceFlags = VoiceFlags.Normal;
    }

    private void Kick(CCSPlayerController p, Sanction ban)
    {
        var left = ban.ExpiresAt is long e ? $"{Math.Max(1, (e - Now()) / 60)} minute rămase" : "permanent";
        Server.ExecuteCommand($"kickid {p.UserId} \"{CommandText($"Banat: {ban.Reason} ({left})")}\"");
    }

    /// <summary>
    /// Un text pus între ghilimele într-o comandă a serverului (motivul vine de pe site sau de la un admin): ghilimelele și
    /// liniile noi l-ar închide și ar permite alte comenzi după el.
    /// </summary>
    private static string CommandText(string text) => text.Replace('"', '\'').Replace('\n', ' ').Replace('\r', ' ');

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
            if (!Feat("sanctions")) return;
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
        if (Feat("sanctions") && _gagged.Contains(player.Slot))
        {
            player.PrintToChat($" {ChatColors.Red}[GCS]{ChatColors.Default} Ai gag: nu poți scrie în chat.");
            return HookResult.Handled;
        }
        if (!Feat("mixReady") || !_isMix) return HookResult.Continue;
        var text = info.GetArg(1).Trim();
        if (text.Equals("!ready", StringComparison.OrdinalIgnoreCase) || text.Equals("/ready", StringComparison.OrdinalIgnoreCase))
        {
            QueueAll(_mix.Ready(player.Slot, true, Utilities.GetPlayers().Where(Tracked).ToList(), Config.MixPlayers, Server.MapName, Ref, out var message));
            Server.PrintToChatAll($" [GCS] {message}");
            return HookResult.Handled;
        }
        if (text.Equals("!unready", StringComparison.OrdinalIgnoreCase) || text.Equals("/unready", StringComparison.OrdinalIgnoreCase))
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

    // ─── Comenzile de admin GCS (modulul „commands”) ─────────────────────────

    /// <summary>Comanda e permisă: modulul pornit și (pentru un jucător) cel puțin una dintre permisiuni.</summary>
    private bool Allowed(CCSPlayerController? admin, CommandInfo command, params string[] permissions)
    {
        if (!Feat("commands")) return false;
        if (admin is null || permissions.Any(perm => AdminManager.PlayerHasPermissions(admin, perm))) return true;
        command.ReplyToCommand("[GCS] Nu ai dreptul la această comandă.");
        return false;
    }

    private long QueueSanction(CCSPlayerController? admin, CCSPlayerController target, string kind, int minutes, string reason, bool global)
    {
        return Queue("sanction", new JsonObject
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

    [CommandHelper(minArgs: 2, usage: "<țintă> <minute> [motiv]")]
    [RequiresPermissionsOr("@css/ban", "@gcs/tempban")]
    public void OnBanCommand(CCSPlayerController? admin, CommandInfo command)
    {
        if (!Allowed(admin, command, "@css/ban", "@gcs/tempban")) return;
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
            var position = QueueSanction(admin, target, "ban", minutes, reason, global);
            // Aplicat imediat local; lista GCS îl înlocuiește la sincronizarea de după trimitere (vezi PullSanctionsAsync).
            var local = new Sanction(_lists.ProvisionalId(position), "ban", target.SteamID, (target.IpAddress ?? "").Split(':')[0], reason, Now(), minutes > 0 ? Now() + minutes * 60L : null, admin?.PlayerName ?? "Console", global ? "global" : "server");
            _lists.AddLocal(local);
            Kick(target, local);
        }
        command.ReplyToCommand(global ? "[GCS] Ban trimis (toate serverele)." : "[GCS] Ban trimis (acest server).");
    }

    [CommandHelper(minArgs: 2, usage: "<țintă> <minute> [motiv]")]
    [RequiresPermissions("@css/chat")]
    public void OnCommCommand(CCSPlayerController? admin, CommandInfo command)
    {
        if (!Allowed(admin, command, "@css/chat")) return;
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

    [CommandHelper(minArgs: 1, usage: "<țintă> [motiv]")]
    [RequiresPermissions("@css/chat")]
    public void OnUncommCommand(CCSPlayerController? admin, CommandInfo command)
    {
        if (!Allowed(admin, command, "@css/chat")) return;
        var mute = command.GetArg(0).Equals("css_gcsunmute", StringComparison.OrdinalIgnoreCase);
        foreach (var target in command.GetArgTargetResult(1).Players.Where(Tracked))
        {
            Queue("unsanction", new JsonObject { ["kind"] = mute ? "mute" : "gag", ["target"] = Ref(target), ["reason"] = command.GetArg(2), ["admin"] = admin is not null && Tracked(admin) ? Ref(admin) : ConsoleRef() });
            SetComm(target, !mute && _muted.Contains(target.Slot), mute && _gagged.Contains(target.Slot));
        }
        command.ReplyToCommand(mute ? "[GCS] Mute ridicat." : "[GCS] Gag ridicat.");
    }

    [CommandHelper(minArgs: 1, usage: "<SteamID64 | IP> [motiv]")]
    [RequiresPermissions("@css/unban")]
    public void OnUnbanCommand(CCSPlayerController? admin, CommandInfo command)
    {
        if (!Allowed(admin, command, "@css/unban")) return;
        var arg = command.GetArg(1).Trim();
        var target = arg.Contains('.') ? new JsonObject { ["ip"] = arg } : new JsonObject { ["auth"] = arg, ["steam"] = true };
        Queue("unsanction", new JsonObject { ["kind"] = "ban", ["target"] = target, ["reason"] = command.GetArg(2), ["admin"] = admin is not null && Tracked(admin) ? Ref(admin) : ConsoleRef() });
        _lists.RemoveWhere(s => s.Type == "ban" && (s.Ip == arg || s.SteamId64?.ToString() == arg));
        command.ReplyToCommand($"[GCS] Unban trimis pentru {arg}.");
    }

    /// <summary>Jurnalul acțiunilor (§4.9) pentru kick-urile date prin plugin.</summary>
    [CommandHelper(minArgs: 1, usage: "<țintă> [motiv]")]
    [RequiresPermissions("@css/kick")]
    public void OnKickCommand(CCSPlayerController? admin, CommandInfo command)
    {
        if (!Allowed(admin, command, "@css/kick")) return;
        var reason = command.GetArg(2);
        foreach (var target in command.GetArgTargetResult(1).Players.Where(Tracked))
        {
            if (admin is not null && !AdminManager.CanPlayerTarget(admin, target)) continue;
            Queue("admin_action", new JsonObject { ["admin"] = admin is not null && Tracked(admin) ? Ref(admin) : ConsoleRef(), ["action"] = "kick", ["target"] = Ref(target), ["reason"] = reason });
            Server.ExecuteCommand($"kickid {target.UserId} \"{CommandText(reason)}\"");
        }
    }

    [CommandHelper(minArgs: 1, usage: "<start|live|halftime|end|abort>")]
    [RequiresPermissions("@css/config")]
    public void OnMatchCommand(CCSPlayerController? admin, CommandInfo command)
    {
        if (!Allowed(admin, command, "@css/config")) return;
        // Meciul condus din comandă: urmărirea pasivă stă deoparte până la harta următoare; doar aici pluginul mută
        // jucătorii la pauză și repornește jocul la `live`.
        _mixManual = true;
        var events = _mix.Command(command.GetArg(1).ToLowerInvariant(), Utilities.GetPlayers().Where(Tracked).ToList(), Server.MapName, Ref, out var ok, move: true);
        QueueAll(events);
        if (ok && command.GetArg(1).Equals("live", StringComparison.OrdinalIgnoreCase)) Server.ExecuteCommand("mp_restartgame 1");
        command.ReplyToCommand(ok ? $"[GCS] Meci: {command.GetArg(1)}." : $"[GCS] Tranziție nepermisă: {command.GetArg(1)}.");
    }

    // ─── Înrolarea automată (specul plugin-v2 §5) ────────────────────────────

    /// <summary>Secretul (generat o singură dată, 32 de octeți aleatori) și referința primită de la site.</summary>
    private void LoadEnroll()
    {
        try
        {
            if (File.Exists(EnrollPath) && JsonNode.Parse(File.ReadAllText(EnrollPath)) is JsonObject saved)
            {
                _enrollSecret = saved["secret"]?.GetValue<string>() ?? "";
                _enrollRef = saved["enrollment"]?.GetValue<string>() ?? "";
                var paused = saved["pausedUntil"]?.GetValue<long>() ?? 0;
                if (paused > 0) _enrollNextAt = DateTimeOffset.FromUnixTimeSeconds(paused).UtcDateTime;
            }
        }
        catch (Exception)
        {
            _enrollSecret = "";
        }
        if (_enrollSecret.Length < 32)
        {
            _enrollSecret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
            _enrollRef = "";
            SaveEnroll(0);
        }
        // Prima cerere după 10 secunde (serverul trebuie să răspundă deja la interogarea site-ului).
        if (_enrollNextAt < DateTime.UtcNow.AddSeconds(10)) _enrollNextAt = DateTime.UtcNow.AddSeconds(10);
    }

    private void SaveEnroll(long pausedUntil)
    {
        var doc = new JsonObject { ["secret"] = _enrollSecret, ["enrollment"] = _enrollRef, ["pausedUntil"] = pausedUntil };
        File.WriteAllText(EnrollPath, doc.ToJsonString());
    }

    private void EnrollTick()
    {
        if (_enrollBusy || DateTime.UtcNow < _enrollNextAt || _client is null) return;
        _enrollBusy = true;
        JsonObject body;
        string path;
        if (_enrollRef.Length == 0)
        {
            path = "/enroll";
            body = new JsonObject
            {
                ["game"] = "cs2",
                ["port"] = ConVar.Find("hostport")?.GetPrimitiveValue<int>() ?? 27015,
                ["hostname"] = ConVar.Find("hostname")?.StringValue ?? "",
                ["map"] = Server.MapName,
                ["maxPlayers"] = Server.MaxPlayers,
                ["players"] = Utilities.GetPlayers().Count(Tracked),
                ["plugin"] = BridgeClient.PluginId,
                ["secret"] = _enrollSecret,
            };
        }
        else
        {
            path = "/enroll/status";
            body = new JsonObject { ["enrollment"] = _enrollRef, ["secret"] = _enrollSecret };
        }
        var client = _client;
        var text = body.ToJsonString();
        _ = Task.Run(async () =>
        {
            var res = await client.PostPlainAsync(path, text).ConfigureAwait(false);
            Server.NextFrame(() => OnEnroll(path, res));
        });
    }

    private void OnEnroll(string path, BridgeResponse res)
    {
        _enrollBusy = false;
        if (!_enrolling) return;
        var now = DateTime.UtcNow;
        if (res.Status == 0 || res.Status >= 500)
        {
            // Rețeaua / 5xx: 60 s, 120 s … max 15 minute.
            _enrollBackoff = _enrollBackoff == 0 ? 60 : Math.Min(_enrollBackoff * 2, 900);
            _enrollNextAt = now.AddSeconds(_enrollBackoff);
            return;
        }
        if (res.Status == 429)
        {
            _enrollNextAt = now.AddSeconds(120);
            return;
        }
        if (res.Status == 404 && path == "/enroll/status")
        {
            // Înrolarea a expirat / a dispărut: se cere din nou, cu același secret.
            _enrollRef = "";
            SaveEnroll(0);
            _enrollNextAt = now.AddSeconds(5);
            return;
        }
        if (res.Status != 200 || res.Body is null)
        {
            Logger.LogWarning("[GCS] Înrolarea refuzată de site ({Status} {Error}). Reîncerc peste o oră.", res.Status, res.Error);
            _enrollNextAt = now.AddHours(1);
            return;
        }
        _enrollBackoff = 0;
        var status = res.Body["status"]?.GetValue<string>() ?? "";
        if (status == "rejected")
        {
            Logger.LogWarning("[GCS] Serverul a fost respins în ACP. Nu mai cer o cheie 24 de ore.");
            _enrollNextAt = now.AddHours(24);
            SaveEnroll(new DateTimeOffset(_enrollNextAt).ToUnixTimeSeconds());
            return;
        }
        if (res.Body["enrollment"] is JsonValue reference && reference.TryGetValue<string>(out var enrollment))
        {
            _enrollRef = enrollment;
            SaveEnroll(0);
        }
        if (res.Body["key"] is JsonValue keyValue && keyValue.TryGetValue<string>(out var key))
        {
            StoreKey(key);
            return;
        }
        if (status == "approved")
        {
            if (res.Body["delivered"]?.GetValue<bool>() == true)
            {
                // Cheia a plecat deja (și a fost folosită), dar nu e aici: o înrolare nouă, de aprobat din nou.
                Logger.LogWarning("[GCS] Cheia acestui server a fost deja livrată, dar nu e salvată aici. Mă înrolez din nou.");
                _enrollSecret = "";
                if (File.Exists(EnrollPath)) File.Delete(EnrollPath);
                LoadEnroll();
                return;
            }
            _enrollNextAt = now.AddSeconds(1);
            return;
        }
        if (!_enrollAnnounced)
        {
            _enrollAnnounced = true;
            Logger.LogInformation("[GCS] Serverul așteaptă aprobarea pe site: ACP → Gaming → Servere → Servere noi detectate.");
        }
        var retry = res.Body["retryAfter"] is JsonValue r && r.TryGetValue<int>(out var seconds) ? seconds : 60;
        _enrollNextAt = now.AddSeconds(Math.Clamp(retry, 30, 600));
    }

    /// <summary>Cheia primită după aprobare: salvată în `data/gcs_bridge_key.txt`, apoi protocolul semnat, imediat.</summary>
    private void StoreKey(string key)
    {
        File.WriteAllText(KeyPath, key.Trim());
        Connect();
        if (_client is not { Configured: true })
        {
            Logger.LogWarning("[GCS] Cheia primită nu e validă.");
            return;
        }
        if (File.Exists(EnrollPath)) File.Delete(EnrollPath);
        Logger.LogInformation("[GCS] Serverul a fost aprobat: cheia e salvată, pluginul e conectat la site.");
        _ = HeartbeatAsync();
    }
}
