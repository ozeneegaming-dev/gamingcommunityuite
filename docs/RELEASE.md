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

Scrie în `dist/release/<versiune>/` pachetul standard (`gcs-<versiune>.tar.gz` / `.zip`, cu `.sha256`) și, în
`premium/`, pachetele `.gcs` ale aplicațiilor premium livrate ca plugin (nesemnate). Fără cheia publică de licență,
release-ul e refuzat: instalarea clientului ar respinge orice licență.

## 2. Semnarea pachetelor premium

```bash
pnpm release:sign -- --key "../keys/gcs-plugins-ed25519.pem"
```

## 3. Licența unui client

**Din Data Center (varianta obișnuită):** creezi licența în panoul Data Center; **cheia scurtă** (`GCS-XXXX-XXXX-XXXX`)
apare o singură dată, cu buton Copy (în bază stă doar amprenta ei). Pe pagina licenței, secțiunea „GamingCommunitySuite
licence (GCS1)”: aplicațiile premium (ale planului sau alese) și, opțional, domeniile (câte unul pe rând,
`*.domeniu.ro` pentru subdomenii). Clientul primește doar cheia scurtă și o introduce la pasul „Licență” al
installer-ului (sau în ACP → Sistem → Licență); installer-ul o activează la
`https://client.gamingcommunitysuite.com/api/license/activate`, care întoarce tokenul semnat.

- **Domeniul:** dacă nu ai trecut domenii, **prima activare îl fixează** (câte permite planul, implicit unul); domeniile
  trecute de tine sunt o listă fixă. „♻️ Reset domains” eliberează domeniile (clientul și-a mutat forumul): instalarea
  veche intră în perioada de grație la verificarea următoare, iar următoarea activare fixează domeniul nou.
- **Cheia pierdută** (sau o licență veche, a cărei cheie nu o mai știi): „🔑 Generate new key” — cheia veche nu mai
  activează, instalările existente nu sunt atinse.
- **Fără internet / urgențe:** tokenul lung (`GCS1.…`) rămâne pe pagina licenței (Copy / Download) și merge în același
  câmp din installer.
- Activările (reușite sau refuzate) apar în tabelul „Licence key activations”; prea multe încercări greșite de pe
  același IP (10 / 15 minute) sau pe aceeași licență (30 / oră) primesc `rate_limited`.

Site-urile verifică licența zilnic la `https://client.gamingcommunitysuite.com/api/license/verify`: suspendarea sau
revocarea din panou se văd în ACP-ul clientului (avertisment), iar după 30 de zile de grație aplicațiile premium se opresc
(forumul merge mai departe); o prelungire ajunge singură la client (tokenul nou se preia la verificarea următoare).

**Offline, cu cheia ta (urgențe, fără Data Center):**

```bash
pnpm license:issue -- --key "../keys/gcs-licenses-ed25519.pem" --licensee "Comunitatea X SRL" \
  --domain forum.x.ro --domain "*.x.ro" --apps servers,chat_pro --expires 2027-10-23 --out licenta-x.txt
```

- `--domain`: domeniul site-ului clientului (cu sau fără `www.`), sau `*.domeniu.ro` pentru subdomenii; repetabil.
- `--apps`: aplicațiile premium incluse: `servers`, `shop`, `vip_studio`, `chat_pro`, `groups_pro` (fără = doar standard).
- `--expires`: `AAAA-LL-ZZ` (valabilă până la sfârșitul zilei, UTC) sau `never`.
- Tokenul (`GCS1.…`) îl trimiți clientului; îl introduce la pasul „Licență” al installer-ului (în același câmp ca
  cheia scurtă) sau în ACP → Sistem → Licență.

O licență emisă offline nu se poate revoca înainte de expirare (nu are evidență în Data Center), deci e preferabilă o
expirare (ex. un an) în loc de `never`. `GCS_LICENSE_SERVER` (pe site-ul clientului) schimbă adresa verificării online
și a activării cheilor scurte sau le oprește (`off`; rămâne doar tokenul lung).
