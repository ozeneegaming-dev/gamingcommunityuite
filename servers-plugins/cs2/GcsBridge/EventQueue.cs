// GCS Server Bridge (CS2) — coada de evenimente: id-uri unice, loturi, backoff, persistență pe disc.
// Licența: MIT.

using System.Text.Json.Nodes;

namespace Gcs.Bridge;

/// <summary>
/// Evenimentele de trimis (§6.4). Fiecare are un id unic, păstrat la retrimitere, deci GCS îl aplică o singură dată.
/// Un lot iese din coadă doar după confirmare (ok / duplicate / rejected); la eroare de rețea sau 5xx se reîncearcă cu
/// backoff exponențial (5 s, 10 s … max 5 minute); la 4xx (în afară de 409 / 429) lotul se aruncă. La oprire sau la
/// schimbarea hărții coada se salvează pe disc.
/// </summary>
public sealed class EventQueue
{
    public const int MaxQueue = 5000;
    public const int BatchSize = 100;

    private readonly object _lock = new();
    private readonly List<string> _items = new();
    private readonly string _runId = Convert.ToHexString(Guid.NewGuid().ToByteArray())[..8].ToLowerInvariant();
    private long _seq;
    private long _removed;
    private int _backoff;
    private DateTime _nextSendAt = DateTime.MinValue;
    private DateTime _lastSentAt = DateTime.MinValue;

    public bool InFlight { get; private set; }

    public int Count
    {
        get
        {
            lock (_lock) return _items.Count;
        }
    }

    /// <summary>Evenimentele ieșite din coadă de la pornire (confirmate sau aruncate).</summary>
    public long Removed
    {
        get
        {
            lock (_lock) return _removed;
        }
    }

    /// <summary>
    /// Pune un eveniment în coadă, cu id și timpul în ceasul GCS. Întoarce poziția lui de la pornire (1, 2, …; comparabilă
    /// cu <see cref="Removed"/>), sau 0 dacă a fost aruncat.
    /// </summary>
    public long Add(JsonObject ev, long now)
    {
        lock (_lock)
        {
            _seq++;
            ev["id"] = $"{_runId}-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}-{_seq}";
            ev["at"] = now;
            if (_items.Count >= MaxQueue)
            {
                // Coada e plină (site-ul e căzut de mult): se pierde cel mai vechi eveniment; în timpul unui lot trimis
                // (ale cărui poziții trebuie să rămână aceleași), cel nou.
                if (InFlight) return 0;
                _items.RemoveAt(0);
                _removed++;
            }
            _items.Add(ev.ToJsonString());
            return _removed + _items.Count;
        }
    }

    /// <summary>Lotul de trimis acum (dacă e momentul): corpul JSON și câte evenimente conține.</summary>
    public (string Body, int Count)? TakeBatch(int intervalSeconds, bool force = false)
    {
        lock (_lock)
        {
            var now = DateTime.UtcNow;
            if (InFlight || _items.Count == 0 || now < _nextSendAt) return null;
            if (!force && _items.Count < BatchSize && (now - _lastSentAt).TotalSeconds < intervalSeconds) return null;
            var batch = _items.Take(BatchSize).ToList();
            InFlight = true;
            _lastSentAt = now;
            return ("{\"events\":[" + string.Join(',', batch) + "]}", batch.Count);
        }
    }

    /// <summary>Rezultatul lotului: confirmat (iese din coadă), invalid (aruncat) sau eșuat (se reîncearcă).</summary>
    public void Done(int count, BatchOutcome outcome)
    {
        lock (_lock)
        {
            InFlight = false;
            if (outcome == BatchOutcome.Retry)
            {
                _backoff = _backoff == 0 ? 5 : Math.Min(_backoff * 2, 300);
                _nextSendAt = DateTime.UtcNow.AddSeconds(_backoff);
                return;
            }
            var removed = Math.Min(count, _items.Count);
            _items.RemoveRange(0, removed);
            _removed += removed;
            _backoff = 0;
            _nextSendAt = DateTime.MinValue;
        }
    }

    public void Save(string path)
    {
        lock (_lock)
        {
            if (_items.Count == 0)
            {
                if (File.Exists(path)) File.Delete(path);
                return;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllLines(path, _items);
        }
    }

    public void Load(string path)
    {
        if (!File.Exists(path)) return;
        lock (_lock)
        {
            foreach (var line in File.ReadAllLines(path))
            {
                if (line.StartsWith('{') && _items.Count < MaxQueue) _items.Add(line);
            }
        }
        File.Delete(path);
    }
}

public enum BatchOutcome
{
    Confirmed,
    Dropped,
    Retry,
}
