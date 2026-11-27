# 04 – 3D-Welt & Spiel (three.js)

**Ambition:** Voltonaut soll sich wie ein **richtiges Spiel** anfühlen, nicht wie eine Datenvisualisierung: lebendige Welt, Tageszeiten und Wetter, Mitfahrer, Windschatten, Zuschauer am Berg, Effekte, Sound. Die Umsetzung erfolgt etappenweise (MVP zuerst, siehe `07-roadmap.md`), die **Architektur ist aber von Anfang an für den vollen Umfang ausgelegt**.

## 1. Szenenstruktur (ADR-008)

Plain three.js-Szenengraph + eigener, typisierter **System-Scheduler** (kein ECS-Framework):

```ts
interface RenderSystem {
  readonly id: string;
  readonly order: number; // feste Reihenfolge
  init(ctx: SceneContext): void;
  update(frame: FrameInput): void; // liest nur Snapshots
  setQuality(q: QualityLevel): void;
  dispose(): void;
}
interface FrameInput {
  readonly dtS: number;
  readonly alpha: number; // Interpolation zwischen Engine-Ticks
  readonly ride: RideSnapshot;
  readonly riders: readonly RiderView[]; // eigener Fahrer, Bots, Remote
  readonly env: EnvironmentState; // Tageszeit, Wetter (aus world/environment)
}
```

Systeme (Reihenfolge): `environment` (Sonne, Himmel, Wetter) → `terrain` (Chunk-Streaming, LOD) → `scenery` (Instancing) → `riders` (eigener + Bots + Remote, Animation) → `crowd` (Zuschauer) → `pickups` (Volts-Blitze) → `effects` (Partikel, Banner) → `camera` → `audio` → `post` (Post-Processing) → `debug`.
Jedes System besitzt seine three.js-Objekte; keines schreibt in Engine-State. Game-Logik (Pickup gesammelt, Segment) kommt als `RideEvent` aus der Engine und löst nur Effekte aus.

[E4-04](specs/E4-04-render-worker-isolation.md) verschiebt diese bestehenden Systeme und WebGL in einen eigenen Render-Worker. Main überträgt den Canvas einmal und behält DOM, Kameraeingaben und Snapshot-Pull. Die erforderliche `routeId` wird im Worker über die vorhandenen Routendaten aufgelöst. Ein unbestätigter Snapshot plus ein ersetzbarer letzter Wert begrenzen ausschließlich die Darstellungsnachrichten. Engine, BLE und Aufnahmen behalten ihre bisherigen Besitzer. Details und Grenzen stehen in [ADR-019](decisions/ADR-019-render-worker-isolation.md).

[E8-01](specs/E8-01-deterministic-environment.md) berechnet `EnvironmentState` rein aus `(seed, timeS, script)`. `FrameInput` führt ihn als Snapshot in den Scheduler. Das `environment`-System besitzt Himmel, Sonne, Nebel und Regen und läuft vor Terrain und Straße. Niedrige Qualität deaktiviert Regen und Schatten. Die Regentropfen sind begrenzt auf Low 0, Medium 500, High 900 und Ultra 1400. Die tatsächliche Zahl hängt zusätzlich von `rainAmount` ab. Schatten laufen nur bei positiver Sonnenintensität.

Während des Starts bleibt ein zugänglicher Ladestatus sichtbar. Renderdiagnostik stammt nach `renderer.render` aus den echten Three-Zählern und Posen. `after-render-task` bezeichnet die folgende Worker-Task, keine bestätigte sichtbare Präsentation. Fehlende Worker- oder OffscreenCanvas-Unterstützung, Initfehler und Kontextverlust zeigen `3D unavailable`; Fahrt und HUD laufen weiter. Ein Main-WebGL- oder CPU-Bildkopie-Fallback existiert nicht.

## 2. Rendering & Licht

- `WebGLRenderer`, `SRGBColorSpace`, ACES/AgX-Tonemapping, physikalisch korrekte Lichtintensitäten. [E10-10](specs/E10-10-webgpu-evaluation.md) hat WebGPU auf echter Hardware geprüft. Der Fahr-Renderpfad bleibt ohne zweites Backend ([ADR-030](decisions/ADR-030-webgpu-renderer.md)).
- **PBR** (`MeshStandardMaterial`/`MeshPhysicalMaterial` für Lack/Carbon), Environment-Map aus HDRI (Poly Haven) per PMREM, tageszeitabhängig überblendet.
- **Schatten:** Sonnen-`DirectionalLight` mit **Cascaded Shadow Maps** (three `CSM`-Addon) – Nahkaskade scharf für Fahrer/Rad, Fernkaskaden grob; Soft Shadows (PCF) ab High. Kontaktschatten unter Rädern (Blob-Decal) auch auf Low.
- **Post-Processing** (three `EffectComposer`-Addons, keine Zusatzlib): SMAA/FXAA, Bloom (Volts-Blitze, Nachtlichter, Sonne), SSAO/GTAO (High), Tiefenunschärfe in Cinematic-Kamera, Vignette, Farbkorrektur-LUT pro Biom, leichte Motion Blur nur bei Sprint (High), Regentropfen-Overlay.

## 3. Umwelt: Tageszeit & Wetter

- **Day/Night-Zyklus:** Sonnenstand aus Uhrzeit (realer Lokalzeit oder Spielzeit, beschleunigbar), `Sky`-Shader + Sterne/Mond nachts, Laternen und beleuchtete Torbögen (Emissive + Bloom), Scheinwerfer am Rad bei Nacht.
- **Wetter:** `clear | cloudy | fog | rain | storm` mit Übergängen; Regen als GPU-Partikel + nasse Straße (Roughness runter, Pfützen-Reflexe), Nebeldichte, Wolkendecke, Wind sichtbar (Vegetation-Wind-Shader, Fahnen). Wind bleibt visuell. E8-01 sendet keine Wind- oder Widerstandsbefehle an den Trainer.
- `EnvironmentState` enthält `seed`, `timeOfDayS`, `weather`, `sunDirection`, `sunIntensity`, `fogDensity` und `rainAmount`. `environmentAt(seed, timeS, script)` ist rein und deterministisch. Das Wetterskript wählt den größten normalisierten Startzeitpunkt kleiner oder gleich `timeOfDayS`. Bei doppelten Startzeitpunkten gewinnt der spätere Skripteintrag. Wenn kein Eintrag infrage kommt, gilt der erste Eintrag.
- Die URL-Parameter `seed`, `time=HH:MM` und `weather` setzen den Startwert. Standard sind `seed=42`, `time=12:00` und `weather=clear`. Ungültige Werte fallen einzeln auf diese Standardwerte zurück. Die Tageszeit folgt zunächst der Fahrzeit.
- Der erste Wetterschnitt zeigt Regensstreifen und Nebel. Die Startpunkte der Tropfen liegen in einer 24 m hohen Säule um den Fahrer. Nasse Straßen, Wolkenmeshes, Sterne, Mond und Radlicht bleiben offen.

## 4. Strecke, Terrain, Umgebung

- **Route = Daten** (`Route` in `01-architecture.md`): 2D-Centerline (Catmull-Rom) + `ElevationProfile`, Segmente, Pickups, Deko-Zonen.
- **Straße:** extrudiertes Band entlang der 3D-Kurve, Breite 6–8 m, Fahrbahnmarkierung, Randsteine/Leitplanken prozedural, Decals (Kreide-Schriftzüge am KOM, Startlinie).
- **Terrain:** Heightfield-Chunks (256 m, 4 LOD-Stufen, Geomorphing gegen Popping), an der Straße eingeebnet; Splat-Mapping (Gras/Fels/Erde/Schnee nach Höhe/Neigung), KTX2-Texturen.
  - **Stand (ADR-033 Schritt 2, [E10-12](specs/E10-12-world-heightfield.md)):** ein Höhenraster je Welt statt eines Streifens je Strecke. Kacheln zu 256 m, 8 m Punktabstand bis 64 m neben jeder Straße und an der Seemulde, sonst 32 m; feine Ränder liegen auf der groben Nachbarkante. Jede Straße ebnet ihren Korridor ein (flach bis 4 m, Böschung bis 36 m, Deckel bis 17 m), bei überlappenden Korridoren gewinnt die tiefere Straße. Eine Banddecke hält jeden Rasterpunkt 6 cm unter allen Fahrbahnebenen im Umkreis einer Zelldiagonale; im Alpen-Biom trägt zusätzlich die Bankettschürze aus #138 die Fahrbahnkanten. Der exakte Abstandstest (`road-clearance.ts`, `surface-clearance.ts`) belegt für jede Route, dass kein Gelände über der Fahrbahn liegt. Planung ohne `three` (`heightfield.ts`, `road-corridor.ts`, `road-band.ts`, `road-apron.ts`, `terrain-plan.ts`), Darstellung in `terrain.ts` mit 4 × 4 Kacheln je Mesh und Biom-Paletten. LOD, Geomorphing und Splat-Mapping stehen noch aus (#68).
  - **Stand (ADR-033 Schritt 3, [E10-14](specs/E10-14-voltonaut-world.md)):** die erste verbundene Welt `voltonaut` mit Wald, Küste und Nachtstadt als Regionen. Eine Regionskarte (`region-map.ts`) gibt jedem Weltpunkt Regionsgewichte; Geländefarben gehen über 600 m über, Bäume gehören der dominierenden Region. Jede Region wird entlang ihres Heimwegs ausgestattet und nur gezeichnet, solange der Fahrer höchstens 1500 m von ihr entfernt ist (`region-visibility.ts`). Abschnitte außerhalb des gefahrenen Wegs erscheinen als Nebenstraßen. Atmosphäre je Region folgt.
- **Vegetation:** `InstancedMesh`/`BatchedMesh` für Bäume, Büsche, Gras (Gras-Shader mit Wind nur nahe Kamera); Billboard-Impostoren für ferne Bäume; Poisson-Scatter per Seed außerhalb des Straßenkorridors.
- **Roadside life:** Häuser, Zäune, Weidetiere, Fahnen, Banner, Verpflegungsstand, Wasser (See mit Reflexion auf High), Vögel-Schwärme (GPU-Boids, billig).
- **Zuschauer:** an KOM/Sprint/Zielbögen; Low-Poly-Instanzen mit **Vertex-Animation-Textures** (Jubeln, Winken, Fahne schwenken) → hunderte Figuren in wenigen Draw Calls; laufen bei Annäherung mit (simple Agenten-Logik).
- **Biome (Stufenplan):** „Voltonaut Loop" (See, Wald, Hügel – MVP), Küste mit Leuchtturm (`coast-loop`), Alpenpass mit 12-km-Serpentinen-Anstieg und getrennter Abfahrt (`alpine-pass`) und Nachtstadt mit Neon (`night-city`). Die Streckenauswahl im Fahrtmenü zeigt pro Route eine 2D-Vorschau, Länge und Höhenmeter und lädt die gewählte Route über den `route`-URL-Parameter.
- **Themenwelten (#159):** Fantasiewelten sind eigene Welten nach [ADR-033](decisions/ADR-033-connected-worlds.md) §1, keine Regionen der Welt `voltonaut`. Die erste ist die Steinzeit-Welt **Felsental** ([E10-15](specs/E10-15-felsental-world.md)): eine 9 km lange Talrunde mit dem Anstieg „Steinbruch“ (2 km, 4–7 %). Das Biom `stone-age` hat eine ocker-sandsteinfarbene Geländepalette und keinen See. Es zeigt Felsenhäuser mit Eingangstunnel und dunkler Tür im Dorf am Start und im Weiler auf dem Plateau, Palmen und Farne auf den Baumplätzen des Waldplans, Findlinge, Dino-Statuen aus fünf Grundkörpern und vier Vulkane. Ihre Krater und Lavaströme leuchten ohne Lichtquelle und ohne Nebel (`MeshBasicMaterial`). Alles ist geseedet, instanziert und hält mit seinem Radius mindestens 7 m Abstand zur Straßenmitte.
- **GPX-Import** (optional, später): Lat/Lon/Ele → ENU-Projektion → Douglas-Peucker → Höhenglättung (~50 m) → `Route`; Umgebung prozedural.

## 5. Mitfahrer, Bots, Windschatten

- **AI-Bots** (in `packages/engine/bots`, deterministisch): Leistungsprofile (Tempo-Gruppe 2,0/2,5/3,0/3,5 W/kg, „Kletterer", „Sprinter"), reagieren auf Steigung, bilden Gruppen, attackieren am Berg, sprinten auf der Sprint-Wertung. Gleiche Physik wie der Spieler.
- **Seitenversatz / Spuren:** Fahrer haben eine laterale Position (Ausweichen/Überholen automatisch, kein Lenken nötig).
- **Windschatten (Drafting):** Engine berechnet für jeden Fahrer die CdA-Reduktion abhängig von Abstand/Versatz zum Vordermann (ca. −25 bis −35 % direkt dahinter bei < 2 m, linear ausklingend bis ~10 m; ⚠️ Werte nach Literatur kalibrieren). Wirkt auf virtuelles Tempo **und** auf Trainer-Widerstand (reduzierte effektive Kraft).
- **Sichtbarer Effekt:** Windschatten-Indikator im HUD, feine Luftstrom-Partikel/Streaks um den Vordermann, Wind-Sound leiser, Drafting-Linie optional.
- Remote-Fahrer (Gruppenfahrt) gehen als `RiderView` in dieselben Systeme; Drafting hinter Remote-Fahrern lokal berechnet (v2, ⚠️ Netzlatenz).

## 6. Kameras

Verfolger (Standard, Feder-gedämpft), Nah-Verfolger, Seitlich/TV-Kamera (fährt neben der Gruppe), Helikopter (weite Kurven, Landschaft), Ego (Lenker-Sicht), **Cinematic-Modus** (automatischer Schnitt zwischen Shots an Kamera-Spots der Route: Kurvenausgang, Bergkamm, Zieleinfahrt, mit Tiefenunschärfe), Fotomodus (Pause, freie Kamera, Screenshot). Speed-FOV, sanftes Umschalten (Blend 0,5 s), Steuerung über Tastatur und Play-Steuerkreuz.

## 7. Effekte & Spielgefühl

- **Volts-Blitz-Pickups ⚡**: rotierende, leuchtende Blitze über der Straße (Emissive + Bloom + Funken beim Einsammeln, Blitz fliegt in HUD-Zähler). Deterministische Positionen pro Route (`06-gamification.md`).
- **Sprint/KOM:** Banner-Torbögen (grün/gepunktet), Countdown-Flaggen 500/200/100 m, Konfetti/Pyro bei PB, Zuschauerjubel.
- **Ziel/Runde:** Zielbogen mit Partikelregen, Rundenanzeige.
- **Rad/Fahrer:** Staub/Spray auf nasser Straße, Atemwolken bei Kälte (Nacht/Berg), Bremslicht beim Ausrollen.
- **Partikelsystem:** eigenes GPU-instanziertes System (ein Draw Call pro Emitter-Typ), Seed-basiert.
- **Power-ups (sinnvoll, optional, E9, #84):** Zwift-ähnlich, z. B. „Aero-Boost" (CdA −15 % für 15 s), „Leichtgewicht" (−10 % Masse am Berg für 20 s), „Windschatten-Magnet" (stärkerer Draft 20 s). Einsammeln an seltenen Spots; aktivieren per Play-Taste (Power-up-Taste). **Physikrelevant** → Aktivierung wird im Ride-Upload protokolliert und vom Server identisch nachgerechnet; in Bestzeit-Wertungen getrennt markiert. Noch nicht umgesetzt.
- **Spaß-Modus ([E9-01](specs/E9-01-fun-mode-items.md), [ADR-028](decisions/ADR-028-ride-modes-and-fun-items.md)):** eigener Spielmodus mit gelben Item-Boxen über der Fahrbahn (ein instanzierter Draw Call, nur in diesem Modus sichtbar). Anders als die Power-ups oben: keine Belohnungen, keine Aufnahme, spätere Aufnahmen der Sitzung nur lokal (`ride_mode`). Auslösen bisher nur mit `p`.

## 8. Audio & Musik

Web Audio API (keine Zusatzlib): Wind proportional zum Tempo (gedämpft im Windschatten), Freilauf-Klicken beim Rollen, Reifen auf Asphalt/Schotter, Schaltgeräusch (dezent, bestätigt den Gangwechsel), Zuschauer-Jubel räumlich (PannerNode), Blitz-Sammel-Sound, Fanfare bei PB/Level-Up, Wetter-Ambience (Regen, Vögel, Stadt). Musik: eigene/CC0-Loops pro Biom, dynamisch lauter bei Sprints; Lautstärkeregler getrennt für Effekte/Musik; Musik standardmäßig aus (Henry hört evtl. eigene).

## 9. HUD & UI im Spiel

Watt (3-s-Mittel), Kadenz, Puls mit Zonenfarbe, Tempo, Gang (1–24 mit Schaltanimation), Steigung, Distanz/Zeit, Volts-Zähler ⚡, Mini-Höhenprofil mit Position und Segmenten, Mini-Map, Windschatten-Indikator, Segment-Live-Delta, Fahrerliste (Bots/Freunde mit Abstand), Benachrichtigungen (Badge, Level-Up). Skalierbar, kontrastreich, ausblendbar (Cinematic).

### Ingame-Menü

[E4-05](specs/E4-05-ingame-menu.md) ordnet die vorhandene Oberfläche als Spielansicht an. Header, Welt und HUD passen ins Fenster. Profil, lokale Aufnahmen und Konto liegen einmalig in einem nativen Dialog mit benannten Tabs. Kleine Fenster scrollen nur den Menüinhalt. Strava zeigt die noch fehlende Browserintegration, keinen Upload-Erfolg.

**Menü** oder Escape öffnet den Dialog. **Zurück zur Fahrt** oder Escape schließt ihn und stellt den vorherigen Fokus wieder her. Pfeiltasten wechseln zwischen Tabs. Im Menü erreichen Tastendrücke keine globalen Gang- oder Kamerakürzel. Texteingabe und native Zahlenfeldbedienung bleiben erhalten.

Die Fahrt, Geräte und eine laufende Aufnahme bleiben aktiv. Menüschließen speichert oder verwirft keine Aufnahme. Der vorhandene Shortcut **Geräte verbinden** bleibt im Header. **Geräte öffnen** im Menü öffnet denselben Gerätedialog. Erst dessen **Gerät wählen** fordert eine native Geräteauswahl an.

[E4-06](specs/E4-06-integrated-ride-cockpit.md) setzt Henrys Gestaltungsauftrag vom 24.11.2026 um. Die Welt füllt das Fenster. DOM-Instrumente für Leistung und Streckenwerte liegen darüber. Menü, Geräte und Instrumente verwenden dieselbe Gestaltung. Die Aufnahmeaktionen stehen vor aufklappbaren technischen Erklärungen; die Reload-Warnung bleibt sichtbar. Canvas, Worker, Formularbesitzer und Aufnahmeverträge bleiben unverändert. Der Oberflächenumbau ist inzwischen als `c0e300f` bereitgestellt und öffentlich softwaregeprüft; der spätere Betriebsnachtrag in PR #38 präzisiert den gemergten Spec-Stand.

[E4-07](specs/E4-07-accessible-ride-menus.md) ergänzt natives Light-Dismiss für Fahrtmenü und Gerätefenster. Ein Klick oder Tap außerhalb schließt nur das Fenster. Fahrt, Aufnahme und Verbindungen laufen weiter. Die Geräteansicht zeigt verständliche Zustände und Aktionen zuerst; Rohstatus, Zielwerte, ACKs und Einrichtungshinweise liegen in technischen Details. Widerstandssteuerung bleibt eine getrennte, ausdrückliche Handlung. Implementiert, regulär und unabhängig am tatsächlich gebauten Artefakt softwaregeprüft. Noch nicht bereitgestellt.

[E4-11](specs/E4-11-in-ride-menu-redesign.md) vereinheitlicht Fahrtmenü, Gerätedialog und Garage mit eigenen Design-Tokens. Der Spielmodus liegt im Profil-Tab. Kopf, Tabs, scrollender Inhalt und Fußzeile bilden vier Rasterzeilen. Unter 480 px Menübreite brechen die Tabs in zwei Zeilen um. Ein sichtbarer Scroll-Schatten zeigt überlaufenden Inhalt. Menü und Gerätedialog nutzen Glasflächen mit deckendem Fallback. Kurze Ein- und Ausblendungen entfallen bei reduzierter Bewegung. Das HUD bleibt deckend, damit die WebGL-Fläche nicht mit mehreren Blur-Ebenen belastet wird.

## 10. Asset-Pipeline

- **Quellen:** Blender (eigene Modelle), CC0 (Kenney, Quaternius, Poly Haven, ambientCG), CC-BY nur mit Credits; kein NC/ND; Mixamo nur als Rigging-Hilfe (Weitergabe-Bedingungen unklar). Jede Datei in `apps/web/public/assets/LICENSES.md`.
- **Format:** glTF 2.0 Binary (`.glb`); Texturen **KTX2** (Basis Universal: ETC1S für Farbe, UASTC für Normal-Maps), Geometrie **meshopt**-komprimiert (`EXT_meshopt_compression`), optional Quantisierung.
- **Build-Schritt (Ziel):** `mise run assets` → `@gltf-transform/cli`-Pipeline: `dedup → prune → weld → resize (max 2048) → ktx2 (toktx/basisu) → meshopt → validate` von `assets-src/` nach `apps/web/public/assets/`. Ergebnis deterministisch; Größen-Report. Derzeit validiert der Task nur; der Verarbeitungsschritt bleibt offen.
- **Starter-Pack (E4-08):** `assets-src/generate_starter_pack.py` erzeugt mit Blender 5.3.0 die eigenen Modelle `bike.glb`, `pine_tree.glb` und `rock_cluster.glb` sowie Vorschauen und `assets-src/manifest.json`. Der Generator exportiert, reimportiert und prüft Knoten, Materialien, Kindursprünge, Radmaße, Pedale, Cockpitanschluss, Bodenkontakt und Dreiecksbudgets. `mise run assets` parsiert das Manifest streng, erzwingt kanonische Budgets, leitet Dreiecke aus GLB-Daten ab und prüft rekursiv Lizenzen, GLB-Header, Bytegrößen und das 15-MB-Gesamtbudget. Laufzeitintegration, Meshopt und KTX2 sind noch nicht Teil dieses Teilschritts.
- **Laufzeit:** `GLTFLoader` + `KTX2Loader` + `MeshoptDecoder`; Lazy-Loading pro Biom; Ladebildschirm mit Fortschritt.
- **Budget-Check im CI** (Teil von `check`): pro Asset und gesamt (initial ≤ 15 MB, pro Biom ≤ 25 MB), Texturgrößen ≤ 2048, Dreiecke pro Asset-Typ.

## 11. LOD & Performance-Budget

Ziel: **≥ 60 fps @ 1080p auf Henrys Laptop** (Medium oder High), Low-Stufe für iGPUs.

| Posten                                                                                                                                                                                                                                                                                                                                                                                                             | Budget (High)                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Draw Calls                                                                                                                                                                                                                                                                                                                                                                                                         | ≤ 150                                                 |
| Dreiecke sichtbar                                                                                                                                                                                                                                                                                                                                                                                                  | ≤ 500 k (Low ≤ 200 k)                                 |
| Eigener Fahrer + Rad                                                                                                                                                                                                                                                                                                                                                                                               | ≤ 50 k Tris (Rad ≤ 32 k, Fahrer ≤ 20,5 k), ≤ 40 Bones |
| Bot/Remote-Fahrer                                                                                                                                                                                                                                                                                                                                                                                                  | 3 LOD-Stufen (10 k / 3 k / 500 Tris), > 80 m Impostor |
| Zuschauer                                                                                                                                                                                                                                                                                                                                                                                                          | VAT-Instanzen, ≤ 3 Draw Calls gesamt                  |
| GPU-Texturen                                                                                                                                                                                                                                                                                                                                                                                                       | ≤ 64 MB (Low ≤ 32 MB)                                 |
| JS pro Frame                                                                                                                                                                                                                                                                                                                                                                                                       | p95 ≤ 4 ms (Engine-Interpolation + Systeme)           |
| Maßnahmen: `LOD`-Objekte mit Hysterese, Chunk-Geomorphing, Frustum-Culling + grobe Occlusion (Hügel), Instancing/BatchedMesh, Schatten nur nahe Kaskade dynamisch, Qualitätsstufen (Low/Medium/High; Ultra als ungenutzten Experimentwert im Produktionscode, zurückgestellt nach ADR-030), **dynamische Auflösung** (Render-Scale 0,7–1,0) und Auto-Downgrade bei < 50 fps über 5 s. Messung: `10-testing.md` §8. |

Das Budget „Eigener Fahrer + Rad“ wurde am 25.11.2026 zweimal angehoben: auf 32 k für das detaillierte Rad aus [E4-09](specs/E4-09-realistic-procedural-bike.md), freigegeben durch Henry, und auf 50 k für den detaillierten Fahrer aus [E4-10](specs/E4-10-detailed-procedural-rider.md). Henrys Freigabe für die zweite Anhebung steht noch aus. Bots und Remote-Fahrer bekommen dieses Modell erst mit LOD.

Das Höhenraster aus [E10-12](specs/E10-12-world-heightfield.md) zeichnet nur die Meshes (je 4 × 4 Kacheln) im Sichtkegel. Gesamtgröße: Testrunde 184 k Dreiecke in 16 Meshes, Alpenpass 530 k in 44 Meshes plus 28 k Schürze. Gemessen im E2E (headless, SwiftShader), Spitzenwerte je Route gegenüber `main` vor dem Wechsel: Testrunde 112 Draw Calls / 231 k Dreiecke (vorher 108 / 238 k), Küste 76 / 168 k (74 / 184 k), Alpenpass 94 / 382 k (86 / 454 k), Nachtstadt 56 / 127 k (55 / 120 k). Auf echter Hardware offen (#86).

Die Voltonaut-Tour ([E10-14](specs/E10-14-voltonaut-world.md)) bleibt über die ganze Runde bei höchstens 137 Draw Calls und 359 k Dreiecken (E2E-Messfahrt im Sim mit `clock=fast`); Ausstattung fern liegender Regionen kostet keine Draw Calls. Auf echter Hardware offen (#86).

Felsental ([E10-15](specs/E10-15-felsental-world.md)) bündelt Häuser, Statuen und Vulkane je Schicht in einem Mesh für die ganze Runde und Pflanzen in Abschnitten zu 500 m. Mit 250-m-Abschnitten lag die Spitze bei 140 Draw Calls. Gemessen headless mit SwiftShader im Sim-Modus nach dem Rebase auf #174: erster Frame 86 Draw Calls / 185 k Dreiecke, Spitze über die ganze Runde mit `clock=fast` 122 Draw Calls (am Steinbruch) und 280 k Dreiecke. Auf echter Hardware offen (#86).

## 12. Tests

Routen-Daten (Bogenlänge, stetige Steigung, Loop schließt), exakter Abstandstest Gelände unter Fahrbahn für jede Route (E10-12), Bodeninvariante der Ausstattung für jede Welt aus `WORLDS` ([E10-15](specs/E10-15-dressing-ground.md)), deterministische `EnvironmentState`, Bots deterministisch (Golden), visuelle Regression der Kernszenen, Performance-Budget-Szene, Asset-Budget-Check.
