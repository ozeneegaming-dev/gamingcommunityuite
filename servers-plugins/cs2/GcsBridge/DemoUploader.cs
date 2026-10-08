// GCS Server Bridge (CS2) — încărcarea demo-urilor meciurilor mix pe site (specul 2026-10-08-servere-hltv §4.3).
// Licența: MIT.

using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Gcs.Bridge;

/// <summary>
/// Coada demo-urilor de încărcat: după finalul unui meci mix, fișierul înregistrat de modulul „demos” urcă pe site în
/// bucăți semnate (`POST /demos/upload`, apoi `POST /demos/chunk?upload=…&amp;offset=…`), cu ritmul primit de la site,
/// reluabil (starea se păstrează pe disc), și se oprește cât timp pe server e un meci (`Paused`). Fără dependențe de
/// CounterStrikeSharp: aceeași clasă rulează și în verificarea încrucișată cu codul site-ului.
/// </summary>
public sealed class DemoUploader
{
    /// <summary>Un demo din coadă.</summary>
    public sealed class Item
    {
        public string Match { get; set; } = "";
        public string Path { get; set; } = "";
        public string Name { get; set; } = "";
        public long Size { get; set; }
        public string? Sha256 { get; set; }
        public long? Upload { get; set; }
        public long Received { get; set; }
        public long NextAt { get; set; }
        public int Backoff { get; set; }
    }

    private const int MaxItems = 20;
    private readonly object _lock = new();
    private readonly List<Item> _items = new();
    private readonly string _statePath;
    private bool _busy;

    /// <summary>Încărcarea e pornită pe site (`config.tv.upload`, cu modulul „demos”).</summary>
    public bool Enabled { get; set; }

    /// <summary>Ritmul (octeți / s) recomandat de site.</summary>
    public long Rate { get; set; } = 1024 * 1024;

    /// <summary>Fișierul local rămâne după încărcarea confirmată (implicit se șterge: l-a creat modulul).</summary>
    public bool KeepFiles { get; set; }

    /// <summary>Pe server e un meci în desfășurare: nicio bucată nu pleacă acum.</summary>
    public Func<bool> Paused { get; set; } = () => false;

    public Action<string> Log { get; set; } = _ => { };

    /// <summary>Ceasul (secunde Unix), înlocuibil în teste.</summary>
    public Func<long> Clock { get; set; } = () => DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    public DemoUploader(string statePath)
    {
        _statePath = statePath;
    }

    public int Count
    {
        get
        {
            lock (_lock) return _items.Count;
        }
    }

    public bool Busy
    {
        get
        {
            lock (_lock) return _busy;
        }
    }

    public void Load()
    {
        try
        {
            if (!File.Exists(_statePath) || JsonNode.Parse(File.ReadAllText(_statePath)) is not JsonArray list) return;
            lock (_lock)
            {
                foreach (var node in list)
                {
                    if (node is not JsonObject o || o["match"]?.GetValue<string>() is not { } match || o["path"]?.GetValue<string>() is not { } path) continue;
                    _items.Add(new Item
                    {
                        Match = match,
                        Path = path,
                        Name = o["name"]?.GetValue<string>() ?? System.IO.Path.GetFileName(path),
                        Size = o["size"]?.GetValue<long>() ?? 0,
                        Sha256 = o["sha256"]?.GetValue<string>(),
                    });
                }
            }
        }
        catch (Exception)
        {
            // Un fișier stricat contează ca o coadă goală.
        }
    }

    private void Save()
    {
        var list = new JsonArray();
        lock (_lock)
        {
            foreach (var i in _items) list.Add(new JsonObject { ["match"] = i.Match, ["path"] = i.Path, ["name"] = i.Name, ["size"] = i.Size, ["sha256"] = i.Sha256 });
        }
        try
        {
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(_statePath)!);
            File.WriteAllText(_statePath, list.ToJsonString());
        }
        catch (Exception)
        {
            // Discul plin / fără drepturi: coada rămâne în memorie.
        }
    }

    /// <summary>Un demo nou de încărcat (meciul încheiat, fișierul închis).</summary>
    public void Enqueue(string match, string path)
    {
        lock (_lock)
        {
            if (_items.Any(i => i.Match == match) || _items.Count >= MaxItems) return;
            _items.Add(new Item { Match = match, Path = path, Name = System.IO.Path.GetFileName(path), NextAt = Clock() });
        }
        Save();
    }

    /// <summary>Pasul periodic (o dată pe secundă): pornește încărcarea primului demo scadent, dacă nu e una în curs.</summary>
    public Task? Tick(BridgeClient client)
    {
        Item? item;
        lock (_lock)
        {
            if (_busy || !Enabled || !client.Configured || _items.Count == 0) return null;
            item = _items.FirstOrDefault(i => i.NextAt <= Clock());
            if (item is null) return null;
            _busy = true;
        }
        if (Paused())
        {
            lock (_lock) _busy = false;
            return null;
        }
        return Task.Run(async () =>
        {
            try
            {
                await RunAsync(client, item).ConfigureAwait(false);
            }
            catch (Exception e)
            {
                Log($"[GCS] Încărcarea demo-ului {item.Name} a eșuat: {e.GetType().Name}");
                Retry(item);
            }
            finally
            {
                lock (_lock) _busy = false;
            }
        });
    }

    private void Drop(Item item, bool deleteFile)
    {
        lock (_lock) _items.Remove(item);
        Save();
        if (deleteFile && !KeepFiles)
        {
            try
            {
                File.Delete(item.Path);
            }
            catch (Exception)
            {
                // Fișierul e încă folosit: rămâne pe disc.
            }
        }
    }

    private void Retry(Item item, int? seconds = null)
    {
        item.Backoff = seconds is null ? (item.Backoff == 0 ? 5 : Math.Min(item.Backoff * 2, 300)) : item.Backoff;
        item.NextAt = Clock() + (seconds ?? item.Backoff);
    }

    private static string Hex(byte[] bytes) => Convert.ToHexString(bytes).ToLowerInvariant();

    /// <summary>O rundă pentru un demo: start / reluare, bucățile de la `received`, cu ritmul și pauza în timpul meciurilor.</summary>
    private async Task RunAsync(BridgeClient client, Item item)
    {
        if (!File.Exists(item.Path))
        {
            Log($"[GCS] Demo-ul {item.Name} nu mai există pe disc; îl scot din coadă.");
            Drop(item, false);
            return;
        }
        if (item.Sha256 is null || item.Size == 0)
        {
            await using var stream = File.OpenRead(item.Path);
            item.Size = stream.Length;
            item.Sha256 = Hex(await SHA256.HashDataAsync(stream).ConfigureAwait(false));
            Save();
        }
        var start = await client.SendAsync("POST", "/demos/upload", new JsonObject { ["match"] = item.Match, ["file"] = item.Name, ["size"] = item.Size, ["sha256"] = item.Sha256 }.ToJsonString()).ConfigureAwait(false);
        if (start.Status == 200 && start.Body is not null)
        {
            if (start.Body["done"]?.GetValue<bool>() == true)
            {
                Log($"[GCS] Demo-ul {item.Name} e pe site.");
                Drop(item, true);
                return;
            }
            if (start.Body["processing"]?.GetValue<bool>() == true)
            {
                Retry(item, 20);
                return;
            }
            item.Upload = start.Body["upload"]?.GetValue<long>();
            var chunkSize = start.Body["chunkSize"]?.GetValue<int>() ?? 0;
            item.Received = start.Body["received"]?.GetValue<long>() ?? 0;
            if (item.Upload is null || chunkSize <= 0)
            {
                Retry(item);
                return;
            }
            await SendChunksAsync(client, item, chunkSize).ConfigureAwait(false);
            return;
        }
        switch (start.Status)
        {
            case 409 when start.Error == "match_open":
                // Evenimentul de final n-a ajuns încă la site: mai târziu.
                Retry(item, 60);
                return;
            case 403 or 404 or 410 or 413 or 507:
                Log($"[GCS] Site-ul nu primește demo-ul {item.Name} ({start.Status} {start.Error}); îl scot din coadă.");
                Drop(item, start.Status == 410);
                return;
            default:
                Retry(item);
                return;
        }
    }

    private async Task SendChunksAsync(BridgeClient client, Item item, int chunkSize)
    {
        await using var file = new FileStream(item.Path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        var buffer = new byte[chunkSize];
        while (item.Received < item.Size)
        {
            // Niciodată în timpul unui meci pe acest server: se reia după el, de la `received`.
            if (Paused())
            {
                Retry(item, 30);
                return;
            }
            var length = (int)Math.Min(chunkSize, item.Size - item.Received);
            file.Seek(item.Received, SeekOrigin.Begin);
            var read = 0;
            while (read < length)
            {
                var n = await file.ReadAsync(buffer.AsMemory(read, length - read)).ConfigureAwait(false);
                if (n == 0) break;
                read += n;
            }
            if (read != length)
            {
                // Fișierul s-a schimbat pe disc: altă încărcare, de la capăt.
                item.Sha256 = null;
                item.Size = 0;
                Retry(item);
                return;
            }
            var sentAt = DateTime.UtcNow;
            var res = await client.SendBytesAsync($"/demos/chunk?upload={item.Upload}&offset={item.Received}", buffer.AsSpan(0, length).ToArray(), TimeSpan.FromSeconds(60)).ConfigureAwait(false);
            if (res.Status == 409 && res.Body?["received"] is JsonValue r && r.TryGetValue<long>(out var received))
            {
                item.Received = received;
                continue;
            }
            if (res.Status != 200 || res.Body is null)
            {
                if (res.Status is 404 or 400) item.Upload = null;
                Retry(item);
                return;
            }
            item.Received = res.Body["received"]?.GetValue<long>() ?? item.Received;
            item.Backoff = 0;
            if (res.Body["complete"]?.GetValue<bool>() == true)
            {
                // Site-ul verifică fișierul: întrebăm din nou până la `done`.
                Retry(item, 15);
                return;
            }
            // Ritmul: o bucată de `length` octeți la `Rate` octeți / s.
            var wait = TimeSpan.FromSeconds((double)length / Math.Max(64 * 1024, Rate)) - (DateTime.UtcNow - sentAt);
            if (wait > TimeSpan.Zero) await Task.Delay(wait).ConfigureAwait(false);
        }
        Retry(item, 15);
    }
}
