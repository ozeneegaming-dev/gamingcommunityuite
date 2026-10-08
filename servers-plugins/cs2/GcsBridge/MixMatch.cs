// GCS Server Bridge (CS2) — meciul mix 5v5 urmărit de GCS: stările, scorul pe echipe, statisticile jucătorilor.
// Licența: MIT.

using System.Text.Json.Nodes;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Modules.Utils;

namespace Gcs.Bridge;

/// <summary>
/// Meciul mix (§6.9): `warmup → live`, `live → halftime`, `halftime → live`, `live → ended`, orice stare deschisă →
/// `aborted`. Echipele A / B rămân aceleași după pauză (doar părțile se schimbă). Fiecare schimbare de stare pleacă ca
/// evenimentul `match` (starea completă), fiecare rundă ca `match_round`. Statisticile din ultima stare sunt totalurile.
/// </summary>
public sealed class MixMatch
{
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
    private readonly Dictionary<int, Line> _lines = new();
    private readonly HashSet<int> _ready = new();

    public bool Open => _status is "warmup" or "live" or "halftime";

    private bool Live => _status == "live";

    private Line? LineOf(CCSPlayerController? p) => p is not null && _lines.TryGetValue(p.Slot, out var l) && l.SteamId == p.SteamID ? l : null;

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
        foreach (var (slot, line) in _lines)
        {
            var p = Utilities.GetPlayerFromSlot(slot);
            var r = p is not null && p.IsValid && p.SteamID == line.SteamId ? reference(p) : new JsonObject { ["auth"] = line.SteamId.ToString(), ["steam"] = true };
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

    /// <summary>O comandă (`start`, `live`, `halftime`, `end`, `abort`); `ok` = tranziția e permisă.</summary>
    public List<(string Type, JsonObject Fields)> Command(string command, List<CCSPlayerController> players, string map, Func<CCSPlayerController, JsonObject> reference, out bool ok)
    {
        ok = true;
        switch (command)
        {
            case "start" when !Open:
                _id = $"m-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}-{Random.Shared.Next(1000, 9999)}";
                _status = "warmup";
                _scoreA = _scoreB = _round = 0;
                _sideA = CsTeam.CounterTerrorist;
                _lines.Clear();
                foreach (var p in players)
                {
                    if (p.Team is not (CsTeam.CounterTerrorist or CsTeam.Terrorist)) continue;
                    _lines[p.Slot] = new Line { SteamId = p.SteamID, Team = p.Team == CsTeam.CounterTerrorist ? 'A' : 'B' };
                }
                break;
            case "live" when _status is "warmup" or "halftime":
                _status = "live";
                break;
            case "halftime" when _status == "live":
                _status = "halftime";
                _sideA = _sideA == CsTeam.CounterTerrorist ? CsTeam.Terrorist : CsTeam.CounterTerrorist;
                foreach (var (slot, line) in _lines)
                {
                    var p = Utilities.GetPlayerFromSlot(slot);
                    if (p is null || !p.IsValid || p.SteamID != line.SteamId) continue;
                    var side = line.Team == 'A' ? _sideA : (_sideA == CsTeam.CounterTerrorist ? CsTeam.Terrorist : CsTeam.CounterTerrorist);
                    p.SwitchTeam(side);
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

    /// <summary>Sfârșitul unei runde: scorul echipelor, `match_round`; în mix-ul automat, pauza și finalul.</summary>
    public List<(string Type, JsonObject Fields)> OnRoundEnd(string winner, bool auto, int maxRounds)
    {
        var events = new List<(string, JsonObject)>();
        if (!Live) return events;
        _round++;
        var side = winner == "CT" ? CsTeam.CounterTerrorist : winner == "T" ? CsTeam.Terrorist : CsTeam.None;
        if (side == CsTeam.None) return events;
        var team = side == _sideA ? "A" : "B";
        if (team == "A") _scoreA++;
        else _scoreB++;
        events.Add(("match_round", new JsonObject { ["matchId"] = _id, ["round"] = _round, ["winner"] = team, ["scoreA"] = _scoreA, ["scoreB"] = _scoreB, ["reason"] = "round_end" }));
        if (!auto) return events;
        var max = Math.Max(2, maxRounds);
        var map = Server.MapName;
        JsonObject Ref(CCSPlayerController p) => new() { ["auth"] = p.SteamID.ToString(), ["steam"] = true, ["name"] = p.PlayerName };
        if (_scoreA > max / 2 || _scoreB > max / 2 || _round >= max) events.AddRange(Command("end", new List<CCSPlayerController>(), map, Ref, out _));
        else if (_round == max / 2)
        {
            events.AddRange(Command("halftime", new List<CCSPlayerController>(), map, Ref, out _));
            events.AddRange(Command("live", new List<CCSPlayerController>(), map, Ref, out _));
        }
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
