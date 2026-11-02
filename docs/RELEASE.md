# Release și licențe (intern)

Ghid pentru proprietar: cum se construiește pachetul pentru clienți, cum se semnează aplicațiile premium și cum se
emit licențele. Fișierul nu intră în pachetul clientului (din `docs/` se livrează doar `INSTALL.md`).

## Cheile (în `keys/`, în afara repo-ului)

| Fișier | Ce e | Unde se folosește |
|---|---|---|
| `gcs-licenses-ed25519.pem` | cheia **privată** de licențe (`gcs-lic-2026`) | doar la `pnpm license:issue`, pe calculatorul tău |
| `gcs-licenses-ed25519.pub.txt` | cheia publică de licențe | inclusă în fiecare release |
| `gcs-licenses-dc-ed25519.pub.txt` | cheia publică a licențelor emise de Data Center (`gcs-lic-dc-2026`; cea privată stă doar pe VPS, în `/etc/gcs-datacenter/keys/`) | inclusă în fiecare release |
| `gcs-plugins-ed25519.pem` | cheia **privată** a pluginurilor (`gcs-2026`) | doar la `pnpm release:sign` |
| `gcs-plugins-ed25519.pub.txt` | cheia publică a pluginurilor | `--plugin-key-file` (inclusă în pachet: pluginurile semnate sunt „Certificat GCS” la client) |

Cheile private nu ajung niciodată în cod, pe server sau în chat. Păstrează o copie de siguranță a folderului `keys/`:
fără cheia privată de licențe nu mai poți emite licențe valabile pentru versiunile deja livrate.

## 1. Pachetul pentru clienți

```bash
pnpm release -- --version 1.0.0 --license-key-file "../keys/gcs-licenses-ed25519.pub.txt" --license-key-file "../keys/gcs-licenses-dc-ed25519.pub.txt" --plugin-key-file "../keys/gcs-plugins-ed25519.pub.txt"
```

Ediția Lite (găzduire partajată, pachetul gata construit `gcs-lite-<versiune>.zip`): aceleași chei, plus `--edition lite`:

```bash
pnpm release -- --edition lite --version 1.0.0 --license-key-file "../keys/gcs-licenses-ed25519.pub.txt" --license-key-file "../keys/gcs-licenses-dc-ed25519.pub.txt" --plugin-key-file "../keys/gcs-plugins-ed25519.pub.txt"
```

Pachetul Lite are la rădăcină doar `app.js`, `cron.mjs`, `docs/`, `EULA.md`, `LICENSE`, `VERSION`,
`THIRD-PARTY-NOTICES.md` și `CHECKSUMS.sha256`; motorul compilat (fără sursele TypeScript) și dependențele lui stau în
`server/`. La prima pornire, `app.js` creează lângă ele `config/`, `uploads/`, `applications/` și `plugins/` și mută
singur o instalare cu structura veche (`INSTALL-LITE.md` › Actualizarea). Release-ul se oprește dacă în pachet rămân
surse `.ts` / `.tsx` sau un `node_modules` în rădăcină.

Scrie în `dist/release/<versiune>/` pachetul standard (`gcs-<versiune>.tar.gz` / `.zip`, cu `.sha256`) și, în
`premium/`, pachetele `.gcs` ale aplicațiilor premium livrate ca plugin (nesemnate). Fără cheia publică de licență,
release-ul e refuzat: instalarea clientului ar respinge orice licență.

## 2. Semnarea pachetelor premium

```bash
pnpm release:sign -- --key "../keys/gcs-plugins-ed25519.pem"
```

## 3. Licența unui client

**Din Data Center (varianta obișnuită):** panoul Data Center → licența clientului → secțiunea „GamingCommunitySuite licence
(GCS1)”: domeniile (câte unul pe rând, `*.domeniu.ro` pentru subdomenii), aplicațiile premium (ale planului sau alese),
apoi „Issue GCS licence token”. Tokenul (`GCS1.…`) îl trimiți clientului. Site-urile verifică licența zilnic la
`https://client.gamingcommunitysuite.com/api/license/verify`: suspendarea sau revocarea din panou se văd în ACP-ul
clientului (avertisment), iar după 30 de zile de grație aplicațiile premium se opresc (forumul merge mai departe); o
prelungire ajunge singură la client (tokenul nou se preia la verificarea următoare).

**Offline, cu cheia ta (urgențe, fără Data Center):**

```bash
pnpm license:issue -- --key "../keys/gcs-licenses-ed25519.pem" --licensee "Comunitatea X SRL" \
  --domain forum.x.ro --domain "*.x.ro" --apps servers,chat_pro --expires 2027-10-23 --out licenta-x.txt
```

- `--domain`: domeniul site-ului clientului (cu sau fără `www.`), sau `*.domeniu.ro` pentru subdomenii; repetabil.
- `--apps`: aplicațiile premium incluse: `servers`, `shop`, `vip_studio`, `chat_pro`, `groups_pro` (fără = doar standard).
- `--expires`: `AAAA-LL-ZZ` (valabilă până la sfârșitul zilei, UTC) sau `never`.
- Tokenul (`GCS1.…`) îl trimiți clientului; îl introduce la pasul „Licență” al installer-ului.

O licență emisă offline nu se poate revoca înainte de expirare (nu are evidență în Data Center), deci e preferabilă o
expirare (ex. un an) în loc de `never`. `GCS_LICENSE_SERVER` (pe site-ul clientului) schimbă adresa verificării online
sau o oprește (`off`).
