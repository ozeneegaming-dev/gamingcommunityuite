# gcs.hello — pluginul de exemplu

Arată tot ce poate face un plugin GamingCommunitySuite:

| Ce | Unde |
| --- | --- |
| widget (`greeting`) | Editează pagina → Widget-uri disponibile → Hello |
| pagină pe site | `/p/gcs.hello` (permisiunea `view`) |
| pagină în ACP | ACP → Sistem → Hello |
| rută API | `GET /api/plugins/gcs.hello/stats` |
| setări cu tab-uri | ACP → Sistem → Aplicații și pluginuri → Hello |
| permisiune de grup | ACP → Grupuri → „Poate vedea pagina pluginului Hello” |
| tabel propriu | `plugin_gcs__hello.greetings_log` (migrația `001_init.sql`) |
| listener | `post.created` → un rând în tabel |
| punct de extensie | `postbit.after_fields` |
| job periodic | `cleanup`, zilnic |
| meniul userului | „Hello” |
| CSS propriu | `assets/hello.css` (închis automat în containerul pluginului) |

Build: `pnpm --filter @gcs/plugin-sdk build:example` → `examples/hello/dist/gcs.hello-1.0.0.zip`.
Pachetul e nesemnat: îl poate instala doar Root Admin, cu codul 2FA și cheia `gcs.hello` tastată.
