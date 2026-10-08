// GCS Server Bridge (CS2) — listele locale: admini, VIP, sancțiuni (păstrate pe disc, merg și fără site).
// Licența: MIT.

using System.Text.Json;
using System.Text.Json.Nodes;

namespace Gcs.Bridge;

public sealed record AdminGrant(long Id, ulong SteamId64, string Flags, uint Immunity, string[] Permissions, long? ExpiresAt, string? Label);

public sealed record VipGrant(ulong SteamId64, string Flags, string[] Permissions, long? ExpiresAt, string Group);

public sealed record Sanction(long Id, string Type, ulong? SteamId64, string? Ip, string Reason, long CreatedAt, long? ExpiresAt, string Admin, string Scope)
{
    /// <summary>Activă la momentul dat (expirarea naturală o aplică pluginul singur, în ceasul GCS).</summary>
    public bool ActiveAt(long now) => ExpiresAt is null || ExpiresAt > now;
}

/// <summary>
/// Listele trase de la site (§6.5–6.7): adminii și VIP-ul (cu ETag), sancțiunile (cursorul reviziei). Pe CS2 toți
/// jucătorii sunt Steam, deci intrările se potrivesc după SteamID64. Fiecare listă se salvează pe disc la schimbare și se
/// încarcă la pornire: site-ul căzut nu oprește adminii și nici bannurile.
/// </summary>
public sealed class LocalLists
{
    private readonly string _dir;
    private readonly object _lock = new();

    public List<AdminGrant> Admins { get; private set; } = new();
    public List<VipGrant> Vip { get; private set; } = new();
    public Dictionary<long, Sanction> Sanctions { get; } = new();
    public string? AdminsEtag { get; private set; }
    public string? VipEtag { get; private set; }
    public long Cursor { get; private set; }

    public LocalLists(string dataDir)
    {
        _dir = dataDir;
        Directory.CreateDirectory(_dir);
    }

    private string PathOf(string name) => Path.Combine(_dir, $"gcs_bridge_{name}.json");

    private static ulong? SteamOf(JsonNode? auth)
    {
        if (auth is not JsonObject o || o["kind"]?.GetValue<string>() != "steam") return null;
        return ulong.TryParse(o["steamId64"]?.GetValue<string>(), out var id) ? id : null;
    }

    private static string[] Strings(JsonNode? node) => node is JsonArray a ? a.Select(x => x?.GetValue<string>() ?? "").Where(x => x.Length > 0).ToArray() : Array.Empty<string>();

    private static long? Time(JsonNode? node) => node is JsonValue v && v.TryGetValue<long>(out var t) ? t : null;

    public void SetAdmins(JsonNode root, bool persist = true)
    {
        var list = new List<AdminGrant>();
        foreach (var item in root["admins"] as JsonArray ?? new JsonArray())
        {
            var steam = SteamOf(item?["auth"]);
            if (item is null || steam is null) continue;
            list.Add(new AdminGrant(item["id"]?.GetValue<long>() ?? 0, steam.Value, item["flags"]?.GetValue<string>() ?? "", (uint)Math.Clamp(item["immunity"]?.GetValue<int>() ?? 0, 0, 100), Strings(item["permissions"]), Time(item["expiresAt"]), item["label"]?.GetValue<string>()));
        }
        lock (_lock)
        {
            Admins = list;
            AdminsEtag = root["etag"]?.GetValue<string>();
        }
        if (persist) File.WriteAllText(PathOf("admins"), root.ToJsonString());
    }

    public void SetVip(JsonNode root, bool persist = true)
    {
        var list = new List<VipGrant>();
        foreach (var item in root["vip"] as JsonArray ?? new JsonArray())
        {
            var steam = SteamOf(item?["auth"]);
            if (item is null || steam is null) continue;
            list.Add(new VipGrant(steam.Value, item["flags"]?.GetValue<string>() ?? "", Strings(item["permissions"]), Time(item["expiresAt"]), item["group"]?.GetValue<string>() ?? ""));
        }
        lock (_lock)
        {
            Vip = list;
            VipEtag = root["etag"]?.GetValue<string>();
        }
        if (persist) File.WriteAllText(PathOf("vip"), root.ToJsonString());
    }

    public static Sanction? ParseSanction(JsonNode? item)
    {
        if (item is null) return null;
        return new Sanction(
            item["id"]?.GetValue<long>() ?? 0,
            item["type"]?.GetValue<string>() ?? "ban",
            SteamOf(item["auth"]),
            item["ip"]?.GetValue<string>(),
            item["reason"]?.GetValue<string>() ?? "",
            item["createdAt"]?.GetValue<long>() ?? 0,
            Time(item["expiresAt"]),
            item["admin"]?.GetValue<string>() ?? "",
            item["scope"]?.GetValue<string>() ?? "server");
    }

    /// <summary>O pagină din `/sanctions` (§6.6): `full` golește lista la prima pagină; `active: false` scoate intrarea.</summary>
    public void ApplySanctionPage(JsonNode root, bool firstPage)
    {
        lock (_lock)
        {
            if (firstPage && root["full"]?.GetValue<bool>() == true) Sanctions.Clear();
            foreach (var item in root["sanctions"] as JsonArray ?? new JsonArray())
            {
                if (item is null) continue;
                var id = item["id"]?.GetValue<long>() ?? 0;
                if (item["active"]?.GetValue<bool>() == true && ParseSanction(item) is { } s) Sanctions[id] = s;
                else Sanctions.Remove(id);
            }
            Cursor = root["cursor"]?.GetValue<long>() ?? Cursor;
        }
    }

    public void SaveSanctions()
    {
        lock (_lock)
        {
            var doc = new JsonObject { ["cursor"] = Cursor, ["sanctions"] = JsonSerializer.SerializeToNode(Sanctions.Values.ToList()) };
            File.WriteAllText(PathOf("sanctions"), doc.ToJsonString());
        }
    }

    /// <summary>O sancțiune dată acum din joc (aplicată imediat; GCS o confirmă la următoarea sincronizare).</summary>
    public void AddLocal(Sanction s)
    {
        lock (_lock) Sanctions[s.Id] = s;
    }

    public void RemoveWhere(Func<Sanction, bool> predicate)
    {
        lock (_lock)
        {
            foreach (var id in Sanctions.Values.Where(predicate).Select(s => s.Id).ToList()) Sanctions.Remove(id);
        }
    }

    public void Load()
    {
        try
        {
            if (File.Exists(PathOf("admins")) && JsonNode.Parse(File.ReadAllText(PathOf("admins"))) is { } a) SetAdmins(a, false);
            if (File.Exists(PathOf("vip")) && JsonNode.Parse(File.ReadAllText(PathOf("vip"))) is { } v) SetVip(v, false);
            if (File.Exists(PathOf("sanctions")) && JsonNode.Parse(File.ReadAllText(PathOf("sanctions"))) is JsonObject s)
            {
                lock (_lock)
                {
                    Cursor = s["cursor"]?.GetValue<long>() ?? 0;
                    foreach (var item in s["sanctions"] as JsonArray ?? new JsonArray())
                    {
                        var entry = item?.Deserialize<Sanction>();
                        if (entry is not null) Sanctions[entry.Id] = entry;
                    }
                }
            }
        }
        catch (Exception)
        {
            // Un fișier stricat contează ca lipsă: listele vin din nou de la site.
        }
    }

    /// <summary>Sancțiunile active ale unui jucător (după SteamID64 sau IP), cea mai lungă pe fiecare tip.</summary>
    public Dictionary<string, Sanction> ActiveFor(ulong steamId64, string? ip, long now)
    {
        lock (_lock)
        {
            return Sanctions.Values
                .Where(s => s.ActiveAt(now) && ((s.SteamId64 is ulong id && id == steamId64) || (ip is not null && s.Ip == ip)))
                .GroupBy(s => s.Type)
                .ToDictionary(g => g.Key, g => g.OrderByDescending(s => s.ExpiresAt ?? long.MaxValue).First());
        }
    }

    /// <summary>Drepturile unui jucător: reuniunea adminilor și a VIP-ului, imunitatea maximă (intrările neexpirate).</summary>
    public (string[] Permissions, uint Immunity, long? AdminId) RightsFor(ulong steamId64, long now)
    {
        lock (_lock)
        {
            var admins = Admins.Where(a => a.SteamId64 == steamId64 && (a.ExpiresAt is null || a.ExpiresAt > now)).ToList();
            var vip = Vip.Where(v => v.SteamId64 == steamId64 && (v.ExpiresAt is null || v.ExpiresAt > now)).ToList();
            var perms = admins.SelectMany(a => a.Permissions).Concat(vip.SelectMany(v => v.Permissions)).Distinct().ToArray();
            var immunity = admins.Count > 0 ? admins.Max(a => a.Immunity) : 0u;
            return (perms, immunity, admins.FirstOrDefault()?.Id);
        }
    }
}
