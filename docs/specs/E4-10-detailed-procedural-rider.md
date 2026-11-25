# Spec E4-10 – Detaillierter, erweiterbarer Fahrer

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E4, Checkbox „Rad + Fahrer (CC0-Basis/Blender), Kurbel synchron zur Kadenz, Beine per IK, Laufräder nach Tempo“ (Teilschritt Fahrer); E7 Garage (Trikot, Helm, Schuhe, Brille als Shop-Slots)
- **Status:** Review
- **Betroffene Module:** `apps/web/src/avatar/` (Fahrer, Posen, Look, Pedalneigung im Rad), `apps/web/src/world/resources.ts` unverändert, Tests, Dokumentation. Keine neue Abhängigkeit, keine Änderung an Katalog, Schemas oder Server.

## Ziel

Der Fahrer ist so detailliert wie das Rad aus [E4-09](E4-09-realistic-procedural-bike.md). Statt Zylindern und Kugeln zeigt er einen geskinnten Körper mit glatten Übergängen, Gesicht, Helm, Handschuhen und Schuhen. Trikotdesigns, Helme, Schuhe und Brillen sind Daten. Eine neue Shop-Option braucht einen Spec-Eintrag und ein Katalog-Item, dessen `assetRef` auf diesen Eintrag zeigt, aber keinen neuen Mesh-Code.

## Abnahmekriterien

- [x] AK1 – Skelett: höchstens 40 Knochen (22), Mixamo-kompatible Namen unter einer `Hips`-Wurzel. Ein Mesh pro Material (≤ 7), alle am selben Skelett. In der Bindepose liegt jeder geskinnte Vertex auf seiner gebauten Position (< 0,01 mm). Gewichte sind normiert, höchstens vier pro Vertex.
- [x] AK2 – Passform auf jedem Rahmen: Über eine volle Kurbelumdrehung sitzen die Cleats auf den Pedalen und die Hände an den Griffgummis (Abweichung < 1 µm vom IK-Ziel). Der Kopf folgt der Kopfpose. Kein geskinnter Vertex ist NaN oder liegt unter 3 cm über der Straße. Die Pedale kippen mit der Fußneigung.
- [x] AK3 – Detail: durchgehende Haut von Schulter bis Handgelenk und von Hüfte bis Knöchel mit Muskelformen (Deltoid, Bizeps, Quadrizeps, Kniescheibe, Wade). Dazu ein Rumpf mit Taschenwölbung und Saum. Der Kopf hat modelliertes Gesicht, Nase, Ohren, Augäpfel mit Iris und Lider. Die Hände tragen Halbfinger-Handschuhe mit vier um den Griffgummi gelegten Fingern und Daumen. Der Helm hat eingelassene Belüftung, Innenschale, Rand, Y-Riemen und Schnalle; Aero-Helme bekommen Heck und Visier. Die Schuhe haben Sohle, Cleat, Fersenkappe und Drehverschlüsse. Die Brille hat Schild- oder Doppelglas, Rahmen und Bügel.
- [x] AK4 – Gemalte Details statt Dreiecke: Trikotdesigns (Band, Streifen, Seitenteile, Punkte, Schärpe), Reißverschluss, Taschennähte, Seitennähte, Saum, Kragen, Blitz-Logo, Bündchen und Beinabschlüsse kommen aus prozeduralen Texturen. Ebenso Gesicht (Brauen, Lippen, Lidstrich, Haare) und Augen, Helmöffnungen und Zierlinien sowie Schuhriemen, Perforation und Schutzrand. Jersey- und Hautfarben färben die Texturen neu, der Helm färbt die Schale. Ein Test prüft die Texel.
- [x] AK5 – Budget: Der Fahrer bleibt mit dem schwersten Kit jedes Slots bei ≤ 20.500 Dreiecken und ≤ 7 Meshes. Fahrer und Rad bleiben für jede Rahmen-/Laufrad-Kombination mit schwerstem Kit bei ≤ 50.000 (`docs/04-world-3d.md` §11, angehoben von 32 k; Henrys Freigabe offen). Gemessen: Fahrer mit Standard-Kit ca. 19,0 k Dreiecke und 6 Meshes, mit schwerstem Kit (Aero-Visier plus Doppelglas) ca. 20,1 k Dreiecke und 7 Meshes.
- [x] AK6 – `jersey.*`, `helmet.*`, `shoes.*` und `glasses.*` werden über `procedural://rider/<slot>/<key>` auf `JERSEY_SPECS`, `HELMET_SPECS`, `SHOE_SPECS` und `GLASSES_SPECS` abgebildet. Unbekannte Refs fallen auf Classic, Standard, Weiß und keine Brille zurück. Ein Kit-Wechsel baut nur die Fahrer-Meshes neu, gibt die alte Geometrie frei und behält das Skelett. Ein Rahmenwechsel baut keine Fahrergeometrie neu, nur die Knochen folgen.

## Testplan (`docs/10-testing.md`)

| AK       | Ebene | Datei                                                                       |
| -------- | ----- | --------------------------------------------------------------------------- |
| AK1, AK2 | Unit  | `apps/web/src/avatar/riderModel.test.ts`, `pose.test.ts`                    |
| AK4      | Unit  | `apps/web/src/avatar/customize.test.ts` (Texel von Trikot, Haut, Helmfarbe) |
| AK5, AK6 | Unit  | `apps/web/src/avatar/riderKit.test.ts`, `customize.test.ts`, `look.test.ts` |
| AK5      | E2E   | bestehende Draw-Call-/Dreiecksbudgets in `e2e/ride-scene.spec.ts` u. a.     |
| AK3, AK4 | Sicht | Renderings aller Ansichten im Browser (Swiftshader), siehe PR               |

## Aufbau

`riderSpecs.ts` (Registry) → `pose.ts` (IK-Gelenke) → `riderRig.ts` (Skelett) → Baugruppen `riderTorso.ts`, `riderLimbs.ts`/`riderArms.ts`/`riderLegs.ts`, `riderShoes.ts`, `riderHead.ts`/`riderFace.ts`/`riderHelmet.ts`/`riderGlasses.ts` → `riderBuild.ts` → `riderBody.ts` (Meshes, Materialien, Texturen) → `rider.ts` (Fahrer auf Rad, Animation). Dazu kommen `riderSurface.ts` (glatte Flächen mit UV und nahtlosen Normalen), `riderWeights.ts` (Hüllen-Skinning), `riderSkin.ts` (Merge zu einem Skinned Mesh pro Material), `riderAtlas.ts` (Texturatlas) sowie `riderPaint.ts`, `riderKitTexture.ts` und `riderGearTexture.ts` (Maler).

## Neue Option hinzufügen

1. In `apps/web/src/avatar/riderSpecs.ts` einen Eintrag ergänzen: `JerseySpec` (Panels: `band`, `strip`, `dots`; Bündchen; Kragen), `HelmetSpec` (Schalenmaße, Heck, Belüftungsspalten, Visier), `ShoeSpec` (Ober- und Detailfarbe, Drehverschlüsse, Riemen) oder `GlassesSpec` (Glasform, Tönung).
2. Im Katalog ein Item mit `assetRef: "procedural://rider/<slot>/<key>"` anlegen.
3. Der Katalog-, Budget- und Look-Test decken die neue Option automatisch ab.

## Nicht-Ziele

- Keine Oberkörperbewegung, kein Wiegetritt und keine Kopfdrehung (henrysachs/voltonaut#69).
- Kein GLB-Fahrer und kein Laden zur Laufzeit (henrysachs/voltonaut#63). Die Knochennamen sind dafür vorbereitet.
- Kein LOD; Bots und Remote-Fahrer nutzen dieses Modell noch nicht.
- Keine neuen Katalog-Items, Preise, Farbslots oder Schema-/Serveränderungen. Körpergröße aus dem Rider-Profil skaliert das Skelett noch nicht.

## Offene Fragen / Risiken

- Budget: Das schwerste Kit (≈ 20,1 k) plus das schwerste Rad (≈ 29,3 k) braucht die Anhebung auf 50 k. Mit 45 k müsste der Fahrer auf ≈ 15,7 k sinken und würde wieder kantiger.
- Aufbauzeit: Fahrergeometrie und Texturen kosten im Render-Worker (Swiftshader) ca. 200 ms, die Skinning-Shader beim ersten Zeichnen ca. 140 ms. Gebaut vor dem ersten Frame verschob das den ersten Frame von ca. 2,7 s (`main`) auf ca. 4,0 s und ließ vier E2E-Tests scheitern. Deshalb zeigt die Fahrtszene zuerst Welt und Rad. Der Fahrer kommt im zweiten Frame dazu (`RiderOnBike` mit `deferBody`). Gemessen: erster Frame wieder ca. 2,7 s, dafür ein einmaliger Ruckler von ca. 340 ms im zweiten Frame; danach 3–5 ms pro Frame. Das ist eine Abmilderung, keine Kostensenkung. Garage-Vorschau und Tests bauen den Fahrer sofort. Auf echter GPU ist das nicht gemessen.
- Draw Calls: 6–7 Fahrer-Meshes statt vorher 19.

## Doku-Updates

- [x] Roadmap-Hinweis · [x] `docs/04-world-3d.md` §11 (Budget) · [x] `docs/05-avatar-customization.md` · [ ] ADR – keine Leitplanke und keine Abhängigkeit geändert

## Nachweisstatus

- **Implementiert:** ja.
- **Am tatsächlichen Artefakt softwaregeprüft:** fmt, Lint inkl. anti-slop, Typecheck, depcruise, guard, 1.517 Unit-Tests mit Coverage (inkl. PWA-Build), 71 E2E im Sim-Modus. Playwright lief hier mit dem vorinstallierten Chromium 1243 statt 1255, weil der Download blockiert war; `mise` war nicht verfügbar, die Schritte liefen einzeln. Dazu Renderings im Browser (Swiftshader).
- **An echter Hardware geprüft:** nicht relevant (reine Darstellung); Bildrate auf echter GPU nicht gemessen.
- **Bereitgestellt:** nein.
