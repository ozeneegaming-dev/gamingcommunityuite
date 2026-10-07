# Studio VIP (`gcs.vip_studio`)

Pluginul de personalizare VIP al GamingCommunitySuite: membrii VIP își aleg stilul numelui (cu variante de culoare),
rama avatarului, banner-ul, fundalul cardului, arma preferată, fundalul profilului (imagine sau video), citatul, tema și
melodia profilului, cu previzualizare live. Cataloagele se gestionează din ACP → Studio VIP. Cere GCS 0.7.1
(capabilitățile `media` și `appearance`).

- Studioul: `/p/gcs.vip_studio` (în meniul principal al site-ului și în meniul userului). Beneficiile:
  `/p/gcs.vip_studio/benefits`.
- Widget-ul „VIP online”: din „Editează pagina”.
- ACP: prezentarea, stilurile de nume (cu efecte sau scrise în CSS), bannerele (din listă sau în CSS), ramele, armele și
  fundalurile de card (încărcare de pe calculator, una sau mai multe odată), fundalurile de profil (imagine + video
  opțional), temele, melodiile și echipamentele membrilor.
- Setări (ACP → Aplicații și pluginuri → Studio VIP): pagina VIP, eticheta „NOU”, textul propriu pe banner, melodia din
  YouTube sau dintr-un fișier audio propriu.

Desenele (rame, arme, fundaluri) sunt originale, generate la construirea pluginului.

## Modificări

### 1.0.1

- **Rame animate**: ramele APNG, GIF și WebP animate rămân animate (GCS 0.7.1 le recodează în WebP animat, cu duratele
  și buclele lor) în postbit, hover card, profil și studio.
- **Încărcare în bloc** („Încarcă de pe calculator”): rame, arme și fundaluri de card, până la 50 de fișiere odată
  (cel mult ~45 MB pe lot), cu categoria, planurile și setările comune; duplicatele (același fișier) se sar, iar
  pagina de rezultat arată ce s-a adăugat, ce s-a omis și ce s-a respins (cu motivul). Numele vine din numele
  fișierului (ex. `ak47` → „AK47”) și se poate schimba apoi.
- **Arme cu iconițe late** (iconițe de linie, ex. 110×30): acceptate și afișate la proporțiile lor.
- **Stiluri de nume noi**, pe categorii (Neon, Foc, Metal, Glitch, Holografic, Cosmic, Animat, Clasic): flăcări cu jar,
  glitch RGB, mașina de scris, tăietură, oglindă spartă, ploaie digitală, țintă, fulger, aur cu sclipiri, plasmă, aură,
  relief 3D și altele, cele mai multe cu variante de culoare. La actualizare, stilurile vechi pe care adminul nu le-a
  schimbat sunt înlocuite cu cele noi, iar membrii care le aveau trec pe stilul nou cel mai apropiat; cele schimbate
  de admin rămân.
- **Stiluri scrise în CSS**: „Stil nou (CSS)” și „Banner nou (CSS)” în ACP, cu șabloane de pornire, previzualizare pe
  numele adminului și erori pe linii; GCS verifică și închide CSS-ul (fără selectori, fără adrese din afară, animații
  oprite pentru cine preferă mai puțină mișcare).
- **Meniul principal**: „Studio VIP” apare în bara site-ului după instalare (și rămâne în meniul userului).

### 1.0.0

- Prima versiune.
