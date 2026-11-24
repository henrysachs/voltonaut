# Spec E4-08 – Original Blender Starter Assets

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E4, Checkbox „Rad + Fahrer (CC0-Basis/Blender)“ und Asset-Pipeline; dieser Teilschritt liefert nur das Rad, keine Fahreranimation.
- **Status:** Implementiert und softwaregeprüft. Unabhängiges Review, vollständiges Gate und Build sind grün; Merge und CI stehen noch aus.
- **Betroffene Module:** `assets-src/`, `apps/web/public/assets/`, `scripts/assets.mjs`, `scripts/assets.ts`, `scripts/assets.test.mjs`/`.ts`, Dokumentation. Keine Laufzeitmodule.

## Ziel

Ein eigener Low-Poly-Roadbike für die spätere Garage sowie eine Kiefer und ein Felscluster für die spätere Welt entstehen vollständig in Blender. Ein deterministischer Headless-Generator erzeugt GLBs, Vorschauen und einen maschinenlesbaren Manifest-Nachweis; externe Assets sind nicht beteiligt.

## Abnahmekriterien (aus der Roadmap übernommen und präzisiert)

- [x] AK1 – `blender -b --python assets-src/generate_starter_pack.py` erzeugt ohne externe Daten `bike.glb`, `pine_tree.glb`, `rock_cluster.glb`, drei PNG-Vorschauen und `assets-src/manifest.json`.
- [x] AK2 – Die Dateien bleiben innerhalb der kanonischen Dreiecksbudgets: Bike ≤ 25.000, Kiefer ≤ 2.000, Felscluster ≤ 1.000. Manifest und Status nennen die tatsächlich reimportierten Zahlen, keine FPS-Zusage.
- [x] AK3 – Jede GLB wird nach dem Export neu importiert. Knoten- und Materiallisten müssen exakt übereinstimmen. Zusätzlich werden Kindursprünge, Radfläche/-radius, Pedalopposition und Pedalachsen, Cockpitanschluss sowie Bodenkontakt des Felsclusters geprüft.
- [x] AK4 – `mise run assets` parsiert alle Manifestfelder streng, erzwingt die kanonischen Budgets, leitet Dreiecke aus den GLB-Accessor-Daten ab und prüft rekursiv Lizenzeinträge, GLB-Header, Manifestvollständigkeit, reale Bytegrößen und das initiale 15-MB-Gesamtbudget.
- [x] AK5 – `apps/web/public/assets/LICENSES.md` kennzeichnet alle drei Modelle als originale Voltonaut-Arbeit unter CC0-1.0. `docs/04-world-3d.md` und die Roadmap trennen die gelieferten Assets von weiterhin offener Laufzeitintegration.

## Testplan (`docs/10-testing.md`)

| AK  | Ebene           | Datei / Fixture                       | Nachweis                                                                   |
| --- | --------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| AK1 | Asset-Generator | `assets-src/generate_starter_pack.py` | Blender 5.3.0; zwei Läufe mit identischen SHA-256 für alle sieben Ausgaben |
| AK2 | Asset-Budget    | `assets-src/manifest.json`            | Reimport-Zählung: Bike 5.168, Kiefer 394, Felscluster 240 Dreiecke         |
| AK3 | Contract        | Blender-Reimport im Generator         | Exakte Listen, Kindursprünge, Radmaß, Pedale, Cockpit und Bodenkontakt     |
| AK4 | Script          | `scripts/assets.test.mjs`             | `mise run assets`; neun positive/negative Validatortests                   |
| AK5 | Doku/Lizenz     | `apps/web/public/assets/LICENSES.md`  | Drei vollständige Tabellenzeilen; `git diff --check`                       |

## Artefakte

| Asset       | GLB                                       | Dreiecke | Materialien | Knoten |   Bytes |
| ----------- | ----------------------------------------- | -------: | ----------: | -----: | ------: |
| Roadbike    | `apps/web/public/assets/bike.glb`         |    5.168 |           7 |    112 | 280.556 |
| Kiefer      | `apps/web/public/assets/pine_tree.glb`    |      394 |           4 |     17 |  35.268 |
| Felscluster | `apps/web/public/assets/rock_cluster.glb` |      240 |           4 |      7 |  31.756 |

Vorschauen: `assets-src/previews/bike.png`, `assets-src/previews/pine_tree.png`, `assets-src/previews/rock_cluster.png` (jeweils 960 × 720, Cycles CPU, fester Seed).

Reimport-Nachweis: Die Stem-Vertices liegen bei World-Y `0.836501..0.933499`; ihre Mittelachse verbindet Headtube `[0.31, 0.85, 0]` mit Anker `[0.42, 0.92, 0]`. Beide Abstände zum Stem betragen `0.016000` m (Stemradius). Das Felscluster hat nach Reimport `min World-Y = -0.000000` m.

## Laufzeit-Integrationsvertrag

Alle GLBs sind glTF 2.0 mit Metermaß, +X vorwärts, +Y oben und +Z rechts. Die Wurzel sitzt im Bodenkoordinatenursprung; Modelle enthalten keine Texturen, Skelette oder Animationen.

**Garage / `bike.glb`:**

- `bike` ist die Wurzel. `frame` und `fork` sind direkte Kinder.
- `anchor_wheel_front` bei `[0,57, 0,35, 0]` und `anchor_wheel_rear` bei `[-0,55, 0,35, 0]` enthalten jeweils `wheel_front` bzw. `wheel_rear` mit Ursprung in der Achse. Radradius: 0,35 m; Drehachse: lokale +Z.
- `anchor_crank` bei `[-0,08, 0,28, 0]` enthält `crank`. `pedal_l` und `pedal_r` sind Kinder von `crank`, stehen um 180° versetzt und haben ihre Drehpunkte an der Pedalspindel. Die Pedalachsen reichen jeweils bis zur Kurbelachse bei `y = ±0.075`.
- `anchor_saddle` bei `[-0,255, 0,91, 0]` enthält `saddle`; `anchor_handlebar` bei `[0,42, 0,92, 0]` enthält `handlebar`. Die Cockpit-Geometrie ist relativ zu diesem Anker autorisiert; der Stem verbindet Headtube und Anker.
- Zum Laufradtausch wird das Default-`wheel_*`-Kind durch ein Ersatzrad mit Achsenursprung und lokaler XY-Radebene ersetzt. Der Anker selbst bleibt unverändert.
- Prozedurale Animation dreht `wheel_*` um lokales Z mit `-distanceM / 0.35`, `crank` mit `-φ` sowie `pedal_l`/`pedal_r` mit `+φ`, damit die Pedale waagerecht bleiben. `φ += 2π · cadenceRpm / 60 · dtS`.
- Farben laufen über die benannten Materialien `frame_paint` und `accent_yellow`; kein zweites Farbmodell oder Maskentexturformat wird mit diesem Teilschritt eingeführt.

**Welt:**

- `pine_tree` und `rock_cluster` haben ihren Ursprung auf dem Boden. Die Kiefer ist 3,62 m hoch; das Felscluster ist als kompakte, seedbar platzierbare Einheit gedacht. Seine tiefsten ausgewerteten Vertices erreichen nach Reimport World-Y `0` ohne Bodenluft.
- Instanziierung, Streuung, Kollision, LOD und Biomzuordnung bleiben Aufgaben der Weltintegration. Die Dateien werden durch diesen Teilschritt nicht automatisch in die Szene geladen.

## Nicht-Ziele

- Keine Laufzeitintegration, kein Loader, keine Fahreranimation, kein IK, keine Kameraführung.
- Keine neuen Abhängigkeiten, kein Meshopt-/KTX2-Ausbau, keine externen Downloads.
- Keine FPS-, Draw-Call- oder Produktionsbehauptung; keine Bereitstellung.

## Offene Fragen / Risiken

- Die Vorschauen sind mit Blender 5.3.0 und Cycles CPU erzeugt. Bitgleiche Vorschauen auf anderen Blender-/Betriebssystemversionen sind nicht zugesagt.
- Die späteren Welt- und Garageagenten müssen Ladezeit, Draw Calls und Instanziierung erst am tatsächlichen Runtime-Artefakt messen.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Roadmap-Hinweis · [x] `docs/04-world-3d.md` · [x] Lizenzregister · [ ] ADR – keine Entscheidung, Leitplanke oder Abhängigkeit geändert.

## Nachweisstatus

- **Implementiert:** ja.
- **Am tatsächlichen Artefakt softwaregeprüft:** ja, durch Export, Blender-Reimport und Asset-Validator. Zwei Generatorläufe sind hashgleich. `mise run assets` und neun Validator-Tests sind grün. Das vollständige Gate besteht mit 1.108 Tests und 62 E2Es, der Build ist grün und das unabhängige Review ist APPROVE.
- **An echter Hardware geprüft:** nein; für diesen statischen Asset-Teilschritt nicht relevant.
- **Bereitgestellt:** nein.
