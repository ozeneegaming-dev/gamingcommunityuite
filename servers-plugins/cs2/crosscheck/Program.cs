// Verificarea încrucișată a încărcării demo-urilor: clientul real al pluginului CS2 contra site-ului real, prin HTTP.
//   dotnet run --project servers-plugins/cs2/crosscheck -- <url site> <cheia gcs1...> <id meci> <fișier .dem>
// Scrie pe stdout câte un JSON pe linie (pașii), iar codul de ieșire e 0 doar dacă demo-ul a ajuns pe site. Licența: MIT.

using System.Text.Json.Nodes;
using Gcs.Bridge;

if (args.Length < 4)
{
    Console.Error.WriteLine("Folosire: <url> <cheie> <id meci> <fișier .dem>");
    return 2;
}
var (url, key, match, file) = (args[0], args[1], args[2], args[3]);
void Step(JsonObject o) => Console.WriteLine(o.ToJsonString());

using var client = new BridgeClient(url, key);
if (!client.Configured)
{
    Step(new JsonObject { ["step"] = "config", ["ok"] = false });
    return 1;
}

// Heartbeat-ul semnat: site-ul pornește încărcarea doar cu modulul „demos” și sursa „plugin”.
var hb = await client.SendAsync("POST", "/heartbeat", new JsonObject
{
    ["plugin"] = BridgeClient.PluginId,
    ["map"] = "de_mirage",
    ["maxPlayers"] = 12,
    ["players"] = new JsonArray(),
    ["modules"] = new JsonArray("demos"),
    ["tv"] = new JsonObject { ["enabled"] = true, ["delay"] = 105, ["port"] = 27020, ["recording"] = false },
}.ToJsonString());
var tv = hb.Body?["config"]?["tv"];
Step(new JsonObject { ["step"] = "heartbeat", ["status"] = hb.Status, ["demos"] = hb.Body?["config"]?["features"]?["demos"]?.GetValue<bool>(), ["upload"] = tv?["upload"]?.GetValue<bool>(), ["chunkSize"] = tv?["chunkSize"]?.GetValue<int>() });

// Încărcarea: întreruptă o dată după prima bucată (ca un meci pornit pe server), apoi reluată de unde a rămas.
var pausedCalls = 0;
var virtualNow = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
var state = Path.Combine(Path.GetTempPath(), $"gcs-crosscheck-{Environment.ProcessId}.json");
var uploader = new DemoUploader(state)
{
    Enabled = tv?["upload"]?.GetValue<bool>() == true,
    Rate = 8 * 1024 * 1024,
    Paused = () => Interlocked.Increment(ref pausedCalls) == 3,
    Log = message => Console.Error.WriteLine(message),
    Clock = () => virtualNow,
};
uploader.Enqueue(match, file);
var deadline = DateTime.UtcNow.AddSeconds(150);
var rounds = 0;
while (uploader.Count > 0 && DateTime.UtcNow < deadline)
{
    var task = uploader.Tick(client);
    if (task is not null)
    {
        await task;
        rounds++;
    }
    else
    {
        // Ceasul virtual sare peste pauzele dintre reîncercări (15 / 20 / 30 s): testul nu așteaptă de-adevăratelea.
        virtualNow += 5;
        await Task.Delay(150);
    }
}
Step(new JsonObject { ["step"] = "done", ["remaining"] = uploader.Count, ["rounds"] = rounds, ["fileExists"] = File.Exists(file), ["pausedCalls"] = pausedCalls });
File.Delete(state);
return uploader.Count == 0 ? 0 : 1;
