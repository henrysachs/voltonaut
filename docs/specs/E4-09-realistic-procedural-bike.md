# Spec E4-09 – Realistisches, erweiterbares Rennrad

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E4, Checkbox „Rad + Fahrer (CC0-Basis/Blender), Kurbel synchron zur Kadenz, Beine per IK, Laufräder nach Tempo“ (Teilschritt Rad + Bein-IK); E7 Garage (Rahmen/Laufräder als Shop-Slots)
- **Tracking:** henrysachs/voltonaut#102
- **Status:** Review
- **Betroffene Module:** `apps/web/src/avatar/` (Rad, Posen, Look), Tests, Dokumentation. Keine neue Abhängigkeit, keine Änderung an Katalog, Schemas oder Server.

## Ziel

Spiel und Garage zeigen statt des Zylinder-Rads ein realistisches Rennrad mit echter Rahmengeometrie, Antrieb, Bremsen und Cockpit. Rahmen- und Laufradvarianten sind Daten: Eine neue Shop-Option besteht aus einem Registry-Eintrag und einem Katalog-Item, dessen `assetRef` auf diesen Eintrag zeigt. Neuer Mesh-Code ist dafür nicht nötig.

## Abnahmekriterien

- [x] AK1 – Die Geometrie folgt einer Hersteller-Geometrietabelle (Stack, Reach, Lenk- und Sitzwinkel, Kettenstrebe, Tretlagerabsenkung, Gabelvorlauf, Steuerrohr). Beide Reifen stehen auf y = 0. Der Radstand liegt zwischen 0,96 und 1,05 m. Die Pedale haben über eine volle Umdrehung mehr als 7 cm Bodenfreiheit.
- [x] AK2 – Das Modell enthält profilierte, sich verjüngende Rohre (rund bzw. Kamm-Tail), Gabel mit Vorbiegung, Steuersatz, Vorbau, Rennlenker mit Drop, Griffgummis und Hebeln, Sattel mit Streben, Stütze, Felgen mit Profil, Reifen, Messerspeichen (2-fach gekreuzt), Naben, Steckachsen, Bremsscheiben und -sättel, 50/34-Kettenblätter, 11-fach-Kassette, Kette, Schaltwerk, Umwerfer, Klickpedale sowie Flasche und Halter.
- [x] AK3 – Knotenvertrag wie in E4-08: `bike` → `frame`, `wheel_front`, `wheel_rear`, `crank` → `pedal_r`/`pedal_l`. Laufräder drehen um ihre Achse, die Kurbel um das Tretlager, und die Pedale bleiben waagerecht.
- [x] AK4 – Jede Kombination aus Rahmen- und Laufrad-Spec bleibt bei ≤ 32.000 Dreiecken und ≤ 26 Meshes. Fahrer und Rad zusammen bleiben im Budget von `docs/04-world-3d.md` §11 (≤ 32 k; vorher 25 k, angehoben am 25.11.2026 durch Henry für das detaillierte Rad). Statische Teile werden pro Material zusammengeführt, ein Material kostet also einen Draw Call je bewegtem Teil. Die Spielszene im Sim-Modus bleibt unter dem Szenenbudget (gemessen: 127 Calls, ca. 203 k Dreiecke; vorher 128 Calls, ca. 160 k).
- [x] AK5 – `frame.*`/`wheels.*`-Items werden über ihre `assetRef` (`procedural://bike/<slot>/<key>`) auf `FRAME_SPECS`/`WHEEL_SPECS` abgebildet. Unbekannte oder nicht-prozedurale Refs fallen auf Race/Alu zurück. Ein Variantenwechsel baut nur die Rad-Meshes neu, gibt die alte Geometrie frei und behält Kurbel- und Radwinkel.
- [x] AK6 – Der Fahrer passt auf jeden Rahmen: Hüfte über dem Sattel, Hände an den Griffgummis mit leicht gebeugtem Ellbogen, Füße auf den Pedalen. Die Beine werden per Zwei-Knochen-IK gestellt (konstante Ober- und Unterschenkellängen, Knie vor der Hüfte, Restbeugung am unteren Totpunkt).

## Testplan (`docs/10-testing.md`)

| AK      | Ebene | Datei                                                                                      |
| ------- | ----- | ------------------------------------------------------------------------------------------ |
| AK1     | Unit  | `apps/web/src/avatar/bikeGeometry.test.ts`                                                 |
| AK2–AK5 | Unit  | `apps/web/src/avatar/bikeModel.test.ts`, `look.test.ts`                                    |
| AK6     | Unit  | `apps/web/src/avatar/pose.test.ts` (Beine und Arme je Rahmen), `customize.test.ts`         |
| AK4     | E2E   | bestehende Draw-Call-/Dreiecksbudgets in `e2e/ride-scene.spec.ts`, `e2e/game-menu.spec.ts` |

## Neue Option hinzufügen

1. In `apps/web/src/avatar/bikeSpecs.ts` einen `FrameSpec` (Geometrietabelle, Rohrquerschnitte, Reifenbreite, Flankenfarbe, Lenkerbreite, Dekorfarbe) oder `WheelSpec` (Felgenhöhe/-breite, Speichenzahl, Scheibe hinten, Finish) in `FRAME_SPECS`/`WHEEL_SPECS` eintragen.
2. Im Katalog (`packages/rules/src/avatarCatalogData.ts`) ein Item mit `assetRef: "procedural://bike/frame/<key>"` bzw. `…/wheels/<key>` anlegen. Mehrere Items dürfen dieselbe Spec nutzen.
3. Der Budget- und der Katalogtest decken die neue Kombination automatisch ab.

## Nicht-Ziele

- Kein neuer Fahrerkörper, kein Skinning (henrysachs/voltonaut#63) und keine Arm- oder Oberkörperanimation über die Lenkerhaltung hinaus (henrysachs/voltonaut#69).
- Keine neuen Katalog-Items oder Preise (das bestehende Saison-Item `wheels.season-01` bekommt nur seine Laufrad-Spec), keine Änderung an `AvatarConfig`, Schemas oder Server.
- Keine Texturen, kein Meshopt/KTX2, keine neue Abhängigkeit. Das Blender-`bike.glb` aus E4-08 bleibt unverändert und ungenutzt.

## Offene Fragen / Risiken

- Keine Umgebungs-Map: Die erste Fassung erzeugte eine prozedurale Map, deren PMREM-Umwandlung auf Software-GPUs den Seitenstart um ca. 0,8 s verlängerte. Dadurch lief `pwa.build.test.ts` in CI ins 5-s-Timeout (lokal ca. 3,5 s auf `main` gegenüber ca. 4,3 s mit der Map). Lack und Metall bekommen ihre Glanzlichter jetzt nur aus Sonne und Himmelslicht. Spiegelungen kommen mit der allgemeinen HDRI-Arbeit (henrysachs/voltonaut#66).
- Bots und Remote-Fahrer brauchen später ein LOD, weil jedes Rad ca. 29 k Dreiecke hat.
- Weitere Farbslots (Dekor, Lenkerband, Sattel) bräuchten ein erweitertes `AvatarConfig.bike` und damit eine Schema- und Serveränderung. Das ist hier bewusst nicht umgesetzt.

## Doku-Updates

- [x] Roadmap-Hinweis · [x] `docs/05-avatar-customization.md` · [ ] ADR – keine Leitplanke und keine Abhängigkeit geändert

## Nachweisstatus

- **Implementiert:** ja.
- **Am tatsächlichen Artefakt softwaregeprüft:** Unit-Tests, Lint, Typecheck und `mise run check` (siehe PR). Dazu Renderings aller Varianten im Browser (Swiftshader) und Screenshots im Sim-Modus.
- **An echter Hardware geprüft:** nicht relevant (reine Darstellung); Bildrate auf echter GPU nicht gemessen.
- **Bereitgestellt:** nein.
