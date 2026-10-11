# blingmodels

`blingmodels.exe` transformă modelele descărcate de pe Sketchfab în modele pentru **Counter-Strike 1.6** (fișiere `.mdl`, versiunea 10 GoldSrc).

## Formate acceptate

| Format | Ce îți trebuie |
| --- | --- |
| `.glb`, `.gltf` (recomandat de pe Sketchfab) | nimic în plus |
| `.blend`, `.fbx`, `.obj`, `.dae`, `.usdz` | Blender instalat (gratuit, blender.org); îl găsește singur |

Fișierele `.gltf` vin într-o arhivă `.zip`. Dezarhivează tot conținutul ei, apoi trage fișierul `.gltf`.

## Cum se folosește

Trage fișierele peste `blingmodels.exe`. Rezultatul apare în folderul `blingmodels_out`, lângă fișierul tras, împreună cu o imagine `_preview.png` (vedere din față, din lateral și din 3/4).

| Ce vrei | Ce tragi peste exe | Unde copiezi rezultatul |
| --- | --- | --- |
| Obiect sau decor (animat sau nu) | doar modelul | `cstrike\models\` |
| Armă la persoana întâi | modelul + `v_ak47.mdl` original | `cstrike\models\v_ak47.mdl` |
| Arma din mâna altor jucători | modelul + `p_ak47.mdl` original | `cstrike\models\p_ak47.mdl` |
| Arma de pe jos | modelul + `w_ak47.mdl` original, sau doar un model numit `w_ceva.glb` | `cstrike\models\w_ak47.mdl` |
| Jucător | modelul + `gign.mdl` original (și `gignT.mdl`, dacă există) | `cstrike\models\player\gign\gign.mdl` |

Modelele originale sunt în `cstrike\models` (sau în `valve\models`).

Când tragi și un model original, din el se păstrează:

- scheletul;
- toate animațiile (mers, tras, reîncărcare…);
- hitbox-urile;
- punctele de atașare (flacăra țevii);
- evenimentele (sunete, tuburi).

Rezultatul se comportă în joc exact ca originalul, doar că arată ca modelul nou. Pe server nu trebuie schimbat nimic.

> Fă o copie a fișierelor originale înainte să le înlocuiești.

## Opțiuni

Opțiunile se scriu în linia de comandă, înainte sau după fișiere, sau în `blingmodels.ini` lângă exe (`nume=valoare`).

| Opțiune | Ce face |
| --- | --- |
| `-mode auto\|prop\|player\|v\|p\|w` | tipul modelului; `auto` îl deduce din numele modelului original |
| `-rotate "x y z"` | rotește modelul nou, în grade, dacă iese întors (ex. `-rotate "0 0 180"`) |
| `-nofit` | armele nu se mai rotesc automat peste cea veche; se potrivesc doar mărimea și poziția |
| `-keep regex` | la v_: ce să păstreze din original (nume de oase sau texturi); implicit mâinile |
| `-height N` / `-size N` | înălțimea sau lungimea finală, în unități (un jucător are 72) |
| `-scale 39.37` | unități de joc pe metru |
| `-maxtris N` | numărul maxim de triunghiuri; implicit: decor 12000, jucător 6000, v_ 8000, p_/w_ 3000 |
| `-tex 512` | latura maximă a texturilor (maxim 512) |
| `-origin floor\|center\|keep` | unde stă originea la decor |
| `-anims=false` | decorul iese fără animații |
| `-name`, `-out` | numele fișierului rezultat și folderul în care se scrie |
| `-blender cale` | calea spre `blender.exe`, dacă nu e găsit singur |
| `-nopause` | nu mai așteaptă Enter la final |

## Ce face automat

- **Axe și mărime.** Trece din axele glTF (Y în sus) în cele GoldSrc (Z în sus, față spre +X), cu 1 m = 39.37 unități. Modelele exportate greșit în centimetri sunt micșorate automat.
- **Limitele motorului.** Respectă limitele:
  - 2048 de vârfuri pe submodel (modelul e împărțit automat în mai multe părți);
  - 128 de oase;
  - 100 de texturi;
  - texturi de cel mult 512 px, cu laturi putere a lui 2.
- **Texturi.**
  - Paletă de 256 de culori pentru fiecare textură, cu dithering.
  - Transparența (frunze, grilaje) devine textură „masked”.
- **Simplificare.** Reduce numărul de triunghiuri păstrând forma, cusăturile texturilor și granițele dintre oase.
- **Oase și animații.**
  - Fiecare vârf e legat de osul cu greutatea cea mai mare, cum cere GoldSrc.
  - Animațiile glTF devin secvențe.
- **Verificare.** Fiecare `.mdl` scris e recitit și verificat.

## Limite cunoscute

- **Jucător.**
  - Corpul nou se leagă de osul cel mai apropiat din modelul original.
  - Iese cel mai bine când modelul nou stă în aceeași poză ca originalul: în picioare, cu fața înainte, cu brațele depărtate de corp.
- **v_.**
  - Arma nouă se mișcă toată cu osul principal al armei vechi.
  - Încărcătorul sau închizătorul nu se mai mișcă separat.
  - Dacă arma iese întoarsă, folosește `-rotate` sau `-nofit`, apoi verifică imaginea `_preview.png`.
- **Texturi.**
  - GoldSrc are doar texturi cu paletă, fără hărți de normale, metal sau luciu.
  - Se folosește culoarea de bază a materialului.
- **Fișiere comprimate.** Fișierele comprimate cu Draco sau meshopt nu se pot citi direct. Descarcă de pe Sketchfab varianta glTF/GLB obișnuită sau trece fișierul prin Blender.

## Compilare

Se compilează cu Go 1.24 și doar biblioteca standard:

```sh
cd tools/blingmodels
go test ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o blingmodels.exe .
```
