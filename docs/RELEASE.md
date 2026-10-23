# Release și licențe (intern)

Ghid pentru proprietar: cum se construiește pachetul pentru clienți, cum se semnează aplicațiile premium și cum se
emit licențele. Fișierul nu intră în pachetul clientului (din `docs/` se livrează doar `INSTALL.md`).

## Cheile (în `keys/`, în afara repo-ului)

| Fișier | Ce e | Unde se folosește |
|---|---|---|
| `gcs-licenses-ed25519.pem` | cheia **privată** de licențe (`gcs-lic-2026`) | doar la `pnpm license:issue`, pe calculatorul tău |
| `gcs-licenses-ed25519.pub.txt` | cheia publică de licențe | inclusă în fiecare release |
| `gcs-plugins-ed25519.pem` | cheia **privată** a pluginurilor (`gcs-2026`) | doar la `pnpm release:sign` |
| `gcs-plugins-ed25519.pub.txt` | cheia publică a pluginurilor | `GCS_PLUGIN_TRUSTED_KEYS` |

Cheile private nu ajung niciodată în cod, pe server sau în chat. Păstrează o copie de siguranță a folderului `keys/`:
fără cheia privată de licențe nu mai poți emite licențe valabile pentru versiunile deja livrate.

## 1. Pachetul pentru clienți

```bash
pnpm release -- --version 1.0.0 --license-key-file "../keys/gcs-licenses-ed25519.pub.txt"
```

Scrie în `dist/release/<versiune>/` pachetul standard (`gcs-<versiune>.tar.gz` / `.zip`, cu `.sha256`) și, în
`premium/`, pachetele `.gcs` ale aplicațiilor premium livrate ca plugin (nesemnate). Fără cheia publică de licență,
release-ul e refuzat: instalarea clientului ar respinge orice licență.

## 2. Semnarea pachetelor premium

```bash
pnpm release:sign -- --key "../keys/gcs-plugins-ed25519.pem"
```

## 3. Licența unui client

```bash
pnpm license:issue -- --key "../keys/gcs-licenses-ed25519.pem" --licensee "Comunitatea X SRL" \
  --domain forum.x.ro --domain "*.x.ro" --apps servers,chat_pro --expires 2027-10-23 --out licenta-x.txt
```

- `--domain`: domeniul site-ului clientului (cu sau fără `www.`), sau `*.domeniu.ro` pentru subdomenii; repetabil.
- `--apps`: aplicațiile premium incluse: `servers`, `shop`, `vip_studio`, `chat_pro`, `groups_pro` (fără = doar standard).
- `--expires`: `AAAA-LL-ZZ` (valabilă până la sfârșitul zilei, UTC) sau `never`.
- Tokenul (`GCS1.…`) îl trimiți clientului; îl introduce la pasul „Licență” al installer-ului.

Până există platforma-mamă (`GCS_LICENSE_SERVER`), licențele se emit doar așa; o licență nu se poate revoca înainte de
expirare, deci pentru clienți noi e preferabilă o expirare (ex. un an) în loc de `never`.
