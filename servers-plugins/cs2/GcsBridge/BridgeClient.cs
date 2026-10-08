// GCS Server Bridge (CS2) — clientul protocolului v1: semnarea cererilor, decalajul ceasului, reîncercările.
// Licența: MIT.

using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Gcs.Bridge;

/// <summary>Răspunsul unei cereri: statusul HTTP și corpul JSON (sau null).</summary>
public sealed record BridgeResponse(int Status, JsonNode? Body, string? Error)
{
    public bool Ok => Status is 200 or 304;
}

/// <summary>
/// Clientul protocolului (specul 2026-10-08-servere-bridge §5–6). Secretul nu pleacă pe rețea: fiecare cerere poartă
/// `hmac-sha256` peste șirul canonic `METODĂ \n CALE \n TIMESTAMP \n NONCE \n hex(SHA-256(corp))`, cu cheia
/// K = hex(SHA-256(secret)). Pluginul ține decalajul față de ceasul GCS (`serverTime`) și retrimite o dată la `clock_skew`.
/// </summary>
public sealed class BridgeClient : IDisposable
{
    public const string BasePath = "/api/servers/bridge/v1";
    public const string PluginId = "gcs-cs2/1.0.0";

    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string _keyId;
    private readonly byte[] _signingKey;

    /// <summary>Ceasul GCS − ceasul local (secunde).</summary>
    public long Offset { get; private set; }

    public bool Configured { get; }

    public BridgeClient(string url, string token)
    {
        _baseUrl = (url ?? "").Trim().TrimEnd('/');
        var parts = (token ?? "").Trim().Split('.');
        var urlOk = Uri.TryCreate(_baseUrl, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp);
        Configured = parts.Length == 3 && parts[0] == "gcs1" && parts[1].Length == 12 && parts[2].Length == 43 && urlOk;
        _keyId = Configured ? parts[1] : "";
        var k = Configured ? Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(parts[2]))).ToLowerInvariant() : "";
        _signingKey = Encoding.ASCII.GetBytes(k);
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        _http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("gcs-cs2", "1.0.0"));
    }

    /// <summary>Timpul în ceasul GCS (secunde Unix).</summary>
    public long Now() => DateTimeOffset.UtcNow.ToUnixTimeSeconds() + Offset;

    private static string Hex(byte[] bytes) => Convert.ToHexString(bytes).ToLowerInvariant();

    private static string Nonce() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(18)).Replace('+', '-').Replace('/', '_').TrimEnd('=');

    /// <summary>
    /// O cerere semnată. `path` = calea de după baza protocolului, cu query-ul exact cum se trimite. La `clock_skew`
    /// decalajul se corectează și cererea se retrimite o dată (nonce nou).
    /// </summary>
    public async Task<BridgeResponse> SendAsync(string method, string path, string? body = null, string? etag = null, TimeSpan? timeout = null, CancellationToken ct = default)
    {
        if (!Configured) return new BridgeResponse(0, null, "not_configured");
        var payload = body ?? "";
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var timestamp = Now().ToString();
            var nonce = Nonce();
            var canonical = string.Join('\n', method.ToUpperInvariant(), path, timestamp, nonce, Hex(SHA256.HashData(Encoding.UTF8.GetBytes(payload))));
            string signature;
            using (var hmac = new HMACSHA256(_signingKey)) signature = Hex(hmac.ComputeHash(Encoding.UTF8.GetBytes(canonical)));

            using var request = new HttpRequestMessage(new HttpMethod(method), _baseUrl + BasePath + path);
            request.Headers.Add("X-GCS-Key", _keyId);
            request.Headers.Add("X-GCS-Timestamp", timestamp);
            request.Headers.Add("X-GCS-Nonce", nonce);
            request.Headers.Add("X-GCS-Signature", "hmac-sha256=" + signature);
            if (etag is not null) request.Headers.TryAddWithoutValidation("If-None-Match", "\"" + etag + "\"");
            if (body is not null) request.Content = new StringContent(payload, Encoding.UTF8, "application/json");

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(timeout ?? TimeSpan.FromSeconds(15));
            HttpResponseMessage response;
            try
            {
                response = await _http.SendAsync(request, cts.Token).ConfigureAwait(false);
            }
            catch (Exception)
            {
                return new BridgeResponse(0, null, "network");
            }
            using (response)
            {
                // Nicio excepție nu iese de aici: un lot de evenimente rămas „în zbor” ar bloca pentru totdeauna coada.
                string text;
                try
                {
                    text = response.StatusCode == HttpStatusCode.NotModified ? "" : await response.Content.ReadAsStringAsync(cts.Token).ConfigureAwait(false);
                }
                catch (Exception)
                {
                    return new BridgeResponse(0, null, "network");
                }
                JsonObject? json = null;
                try
                {
                    if (text.Length > 0) json = JsonNode.Parse(text) as JsonObject;
                }
                catch (JsonException)
                {
                    json = null;
                }
                if (json?["serverTime"] is JsonValue time && time.TryGetValue<long>(out var st)) Offset += st - Now();
                var error = json?["error"] is JsonValue err && err.TryGetValue<string>(out var code) ? code : null;
                if ((int)response.StatusCode == 401 && error == "clock_skew" && attempt == 0) continue;
                return new BridgeResponse((int)response.StatusCode, json, error);
            }
        }
        return new BridgeResponse(0, null, "unreachable");
    }

    public void Dispose() => _http.Dispose();
}
