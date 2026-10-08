// GCS Server Bridge (CS2) — meciul mix 5v5 urmărit de GCS: stările, scorul pe echipe, statisticile jucătorilor.
// Licența: MIT.

using System.Text.Json.Nodes;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Utils;

namespace Gcs.Bridge;

/// <summary>
/// Meciul mix (§6.9 partea A, §3 plugin-v2): `warmup → live`, `live → halftime`, `halftime → live`, `live → ended`,
/// orice stare deschisă → `aborted`. Echipele A / B rămân aceleași după pauză (doar părțile se schimbă). Fiecare schimbare
/// de stare pleacă ca evenimentul `match` (starea completă), fiecare rundă ca `match_round`. Statisticile din ultima
/// stare sunt totalurile. Meciul se urmărește pasiv (jocul face restartul și schimbarea părților); doar comanda
/// `css_gcsmatch halftime` mută jucătorii.
/// </summary>
public sealed class MixMatch
{
    /// <summary>Cel puțin atâția jucători în fiecare echipă pentru un meci detectat pasiv.</summary>
    public const int MinTeam = 2;

    private sealed class Line
    {
        public required ulong SteamId;
        public required char Team;
        public int Kills;
        public int Deaths;
        public int Assists;
        public int Headshots;
        public int Damage;
        public int Mvps;
    }

    private string _status = "";
    private string _id = "";
    private int _scoreA;
    private int _scoreB;
    private int _round;
    private CsTeam _sideA = CsTeam.CounterTerrorist;
    /// <summary>Jucătorii meciului după SteamID (cei ieșiți rămân, cu cifrele lor).</summary>
    private readonly Dictionary<ulong, Line> _lines = new();
    private readonly HashSet<int> _ready = new();

    public bool Open => _status is "warmup" or "live" or "halftime";

    public bool Live => _status == "live";

    /// <summary>Rundele jucate în meciul curent.</summary>
    public int Round => _round;

    /// <summary>Părțile s-au schimbat deja (pauza a trecut).</summary>
    public bool Swapped { get; private set; }

    private Line? LineOf(CCSPlayerController? p) => p is not null && _lines.TryGetValue(p.SteamID, out var l) ? l : null;

    public void OnDeath(CCSPlayerController? killer, CCSPlayerController victim, CCSPlayerController? assister, bool headshot, bool suicide)
    {
        if (!Live) return;
        if (LineOf(victim) is { } v) v.Deaths++;
        if (!suicide && LineOf(killer) is { } k)
        {
            k.Kills++;
            if (headshot) k.Headshots++;
        }
        if (LineOf(assister) is { } a) a.Assists++;
    }

    public void OnDamage(CCSPlayerController attacker, int damage)
    {
        if (Live && LineOf(attacker) is { } l) l.Damage += damage;
    }

    public void OnMvp(CCSPlayerController p)
    {
        if (Live && LineOf(p) is { } l) l.Mvps++;
    }

    public void Leave(int slot) => _ready.Remove(slot);

    /// <summary>Starea completă (§6.9), cu referințele jucătorilor online.</summary>
    public JsonObject State(string map, Func<CCSPlayerController, JsonObject> reference)
    {
        var players = new JsonArray();
        var online = Utilities.GetPlayers().Where(p => p is { IsValid: true, IsBot: false }).ToDictionary(p => p.SteamID, p => p);
        foreach (var line in _lines.Values)
        {
            var r = online.TryGetValue(line.SteamId, out var p) ? reference(p) : new JsonObject { ["auth"] = line.SteamId.ToString(), ["steam"] = true };
            players.Add(new JsonObject
            {
                ["player"] = r,
                ["team"] = line.Team.ToString(),
                ["kills"] = line.Kills,
                ["deaths"] = line.Deaths,
                ["assists"] = line.Assists,
                ["headshots"] = line.Headshots,
                ["damage"] = line.Damage,
                ["mvps"] = line.Mvps,
            });
        }
        return new JsonObject
        {
            ["id"] = _id,
            ["status"] = _status,
            ["map"] = map,
            ["round"] = _round,
            ["teams"] = new JsonObject { ["A"] = new JsonObject { ["name"] = "Echipa A" }, ["B"] = new JsonObject { ["name"] = "Echipa B" } },
            ["score"] = new JsonObject { ["A"] = _scoreA, ["B"] = _scoreB },
            ["players"] = players,
        };
    }

    private (string, JsonObject) StateEvent(string map, Func<CCSPlayerController, JsonObject> reference) => ("match", new JsonObject { ["match"] = State(map, reference) });

    /// <summary>
    /// O comandă (`start`, `live`, `halftime`, `end`, `abort`); `ok` = tranziția e permisă. `move` = la `halftime`
    /// pluginul mută jucătorii pe partea cealaltă (doar comanda adminului; jocul o face singur cu `mp_halftime`).
    /// </summary>
    public List<(string Type, JsonObject Fields)> Command(string command, List<CCSPlayerController> players, string map, Func<CCSPlayerController, JsonObject> reference, out bool ok, bool move = false)
    {
        ok = true;
        switch (command)
        {
            case "start" when !Open:
                _id = $"m-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}-{Random.Shared.Next(1000, 9999)}";
                _status = "warmup";
                _scoreA = _scoreB = _round = 0;
                _sideA = CsTeam.CounterTerrorist;
                Swapped = false;
                _lines.Clear();
                foreach (var p in players)
                {
                    if (p.Team is not (CsTeam.CounterTerrorist or CsTeam.Terrorist)) continue;
                    _lines[p.SteamID] = new Line { SteamId = p.SteamID, Team = p.Team == CsTeam.CounterTerrorist ? 'A' : 'B' };
                }
                break;
            case "live" when _status is "warmup" or "halftime":
                _status = "live";
                break;
            case "halftime" when _status == "live":
                _status = "halftime";
                _sideA = Other(_sideA);
                Swapped = true;
                if (!move) break;
                foreach (var p in players)
                {
                    if (LineOf(p) is { } line) p.SwitchTeam(line.Team == 'A' ? _sideA : Other(_sideA));
                }
                break;
            case "end" when _status == "live":
                _status = "ended";
                break;
            case "abort" when Open:
                _status = "aborted";
                break;
            default:
                ok = false;
                return new List<(string, JsonObject)>();
        }
        return new List<(string, JsonObject)> { StateEvent(map, reference) };
    }

    private static CsTeam Other(CsTeam side) => side == CsTeam.CounterTerrorist ? CsTeam.Terrorist : CsTeam.CounterTerrorist;

    /// <summary>Câte jucători sunt pe fiecare parte (CT, T).</summary>
    public static (int Ct, int T) Sides(IEnumerable<CCSPlayerController> players)
    {
        var list = players.ToList();
        return (list.Count(p => p.Team == CsTeam.CounterTerrorist), list.Count(p => p.Team == CsTeam.Terrorist));
    }

    /// <summary>
    /// Începutul rundei într-un meci live: dacă majoritatea jucătorilor din A sunt pe partea cealaltă, e pauza (`halftime`
    /// apoi `live`); jucătorii veniți târziu intră în echipa părții lor.
    /// </summary>
    public List<(string Type, JsonObject Fields)> OnRoundStart(List<CCSPlayerController> players, string map, Func<CCSPlayerController, JsonObject> reference)
    {
        var events = new List<(string, JsonObject)>();
        if (!Live) return events;
        int on = 0, off = 0;
        foreach (var p in players)
        {
            if (LineOf(p) is not { Team: 'A' }) continue;
            if (p.Team == _sideA) on++;
            else if (p.Team is CsTeam.CounterTerrorist or CsTeam.Terrorist) off++;
        }
        if (off > on)
        {
            events.AddRange(Command("halftime", players, map, reference, out _));
            events.AddRange(Command("live", players, map, reference, out _));
        }
        foreach (var p in players)
        {
            if (p.Team is not (CsTeam.CounterTerrorist or CsTeam.Terrorist) || LineOf(p) is not null) continue;
            _lines[p.SteamID] = new Line { SteamId = p.SteamID, Team = p.Team == _sideA ? 'A' : 'B' };
        }
        return events;
    }

    /// <summary>
    /// Sfârșitul unei runde: scorul echipelor (numărat de plugin, restarturile jocului nu îl strică), `match_round`; cu
    /// `autoEnd`, finalul la majoritate (sau egal la ultima rundă).
    /// </summary>
    public List<(string Type, JsonObject Fields)> OnRoundEnd(string winner, bool autoEnd, int maxRounds)
    {
        var events = new List<(string, JsonObject)>();
        if (!Live) return events;
        _round++;
        var side = winner == "CT" ? CsTeam.CounterTerrorist : winner == "T" ? CsTeam.Terrorist : CsTeam.None;
        if (side != CsTeam.None)
        {
            var team = side == _sideA ? "A" : "B";
            if (team == "A") _scoreA++;
            else _scoreB++;
            events.Add(("match_round", new JsonObject { ["matchId"] = _id, ["round"] = _round, ["winner"] = team, ["scoreA"] = _scoreA, ["scoreB"] = _scoreB, ["reason"] = "round_end" }));
        }
        if (!autoEnd) return events;
        var max = Math.Max(2, maxRounds);
        JsonObject Ref(CCSPlayerController p) => new() { ["auth"] = p.SteamID.ToString(), ["steam"] = true, ["name"] = p.PlayerName };
        if (_scoreA > max / 2 || _scoreB > max / 2 || _round >= max) events.AddRange(Command("end", new List<CCSPlayerController>(), Server.MapName, Ref, out _));
        return events;
    }

    /// <summary>Ready-up-ul simplu (`!ready`): când sunt gata toți jucătorii ceruți, meciul pornește (warmup → live).</summary>
    public List<(string Type, JsonObject Fields)> Ready(int slot, bool ready, List<CCSPlayerController> players, int needed, string map, Func<CCSPlayerController, JsonObject> reference, out string message)
    {
        var events = new List<(string, JsonObject)>();
        if (Live || _status == "halftime")
        {
            message = "Meciul e deja în desfășurare.";
            return events;
        }
        if (ready) _ready.Add(slot);
        else _ready.Remove(slot);
        var need = Math.Max(2, needed);
        message = $"Gata: {_ready.Count} / {need}.";
        if (_ready.Count < need) return events;
        _ready.Clear();
        if (_status != "warmup") events.AddRange(Command("start", players, map, reference, out _));
        events.AddRange(Command("live", players, map, reference, out _));
        Server.ExecuteCommand("mp_restartgame 3");
        message = "Meciul începe!";
        return events;
    }
}
