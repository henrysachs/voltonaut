# 04 – 3D-Welt (three.js)

## Szene
- Renderer: `WebGLRenderer` (antialias, `outputColorSpace = SRGBColorSpace`, ACES-Tonemapping). WebGPU später optional.
- Licht: 1 `DirectionalLight` (Sonne) mit Shadow-Map (2048², Kaskade nur um den Fahrer, Kamera folgt), `HemisphereLight` für Umgebung, Fog in Horizontfarbe (versteckt LOD-Grenzen).
- Himmel: `Sky`-Addon oder HDRI (Poly Haven, CC0), niedrige Auflösung.
- Loop: `requestAnimationFrame`, interpoliert Engine-Snapshots (20 Hz) auf Framerate.

## Strecke: Daten zuerst, Mesh daraus
Eine Route ist **reine Daten** (`Route` in `01-architecture.md`): 2D-Centerline (Catmull-Rom-Spline) + `ElevationProfile`. Daraus erzeugt `world/`:
1. **Straße:** extrudiertes Band entlang der 3D-Kurve (`y = elevationAt(d)`), Breite 6 m, UV entlang Distanz (Asphaltstreifen, Mittellinie). Abtastung alle 2 m.
2. **Terrain:** Heightfield-Chunks (z. B. 256 × 256 m, 64² Vertices) aus Noise (Simplex/FBM), **an der Straße eingeebnet** (Distanzfeld zur Centerline → Blend auf Straßenhöhe mit Böschung). Chunks werden um den Fahrer geladen/verworfen.
3. **Szenerie:** Instanced Meshes (Bäume, Felsen, Zäune, Häuser) per Poisson-Disk-Scatter außerhalb eines Korridors um die Straße; deterministisch per Seed pro Route.
4. **Blitz-Pickups ⚡:** Volts-Pickups über der Straße an deterministischen Distanzmarken (`route.seed`), InstancedMesh + Emissive, Details in `06-gamification.md`.
5. **Marker:** Segment-Start/Ziel als Torbögen, Kilometer-Schilder, Banner (Sprint grün, KOM rot-gepunktet).

Position des Fahrers: `distanceM → (x, y, z), heading` über vorberechnete Bogenlängen-Tabelle der Spline (konstante Geschwindigkeit entlang der Kurve, nicht entlang Parameter t).

### Erste Strecke „Voltonaut Loop" (E4)
- Rundkurs ~ 12 km, damit eine Stunde ≈ 2–3 Runden sind.
- Profil: 3 km flach am See → 2 km Anstieg Ø 5 % (KOM) → Hochplateau → 2,5 km Abfahrt → 500 m Sprint-Gerade → Wald zurück. Max. Steigung 8 %.
- Profil als handgesetzte Stützstellen + Spline, nicht als Noise (Fahrgefühl muss designt sein).
- Weitere Biome später: Küste, Alpenpass, Nachtstadt (Emissive + Bloom).

### GPX-Import (E9, optional)
GPX → Lat/Lon/Ele → lokale ENU-Projektion → Douglas-Peucker → Höhe glätten (Savitzky-Golay, Fenster ~50 m) → `Route`. Szenerie prozedural.

## Kamera
- Standard: Verfolgerkamera 5 m hinter, 2 m über dem Fahrer, Federdämpfung (kritisch gedämpft), blickt 10 m voraus entlang der Strecke.
- Weitere: seitlich (cinematic), Helikopter, Ego (Lenker). Taste `C` / Controller-Taste wechselt.
- Leichtes FOV-Weiten bei hohem Tempo (Speed-Gefühl), Kamera-Shake 0.

## Performance-Budget (Ziel: 60 fps @ 1080p, Mittelklasse-Laptop iGPU)
| Posten | Budget |
|---|---|
| Draw Calls | < 150 |
| Dreiecke sichtbar | < 500 k |
| Fahrer + Rad | ≤ 25 k Tris, 1 Skinned Mesh, ≤ 2 Materialien (Rad + Fahrer), ≤ 40 Bones |
| Texturen gesamt | < 64 MB GPU; KTX2/Basis komprimiert |
| Initialer Download | < 15 MB (GLB Draco/meshopt-komprimiert) |
| JS-Frame-Zeit | < 4 ms (Engine + Avatar + Scatter-Update) |
Maßnahmen: InstancedMesh für Vegetation, Chunk-LOD, Schatten nur Nahbereich, `renderer.info` im Debug-HUD, Qualitätsstufen (Low/Med/High) in Einstellungen. Wenn < 50 fps über 5 s → automatisch eine Stufe runter.

## Asset-Quellen & Lizenzen
Regel: nur Lizenzen, die öffentliches GitHub-Repo + Weitergabe erlauben. Jede Datei in `public/assets/LICENSES.md`.

| Quelle | Inhalt | Lizenz | Hinweis |
|---|---|---|---|
| Kenney (kenney.nl) | Low-Poly-Natur, Straßenteile, Props | CC0 | ideal für Stil-Konsistenz |
| Quaternius (quaternius.com) | Low-Poly-Natur, Charaktere (geriggt) | CC0 | Charaktere als Basis für Fahrer möglich |
| Poly Haven | HDRIs, PBR-Texturen, Modelle | CC0 | Himmel, Asphalt, Gras |
| ambientCG | PBR-Texturen | CC0 | |
| Sketchfab | Fahrräder, Fahrer | **gemischt** (CC-BY, CC-BY-NC, …) | nur CC0/CC-BY; CC-BY → Namensnennung in Credits; **kein NC/ND** |
| Mixamo (Adobe) | Rigging, Animationen | Adobe-Nutzungsbedingungen, lizenzfrei in Projekten | ⚠️ Roh-Weitergabe der Mixamo-Dateien in einem öffentlichen Repo ist rechtlich unklar; außerdem **keine** brauchbare Tret-Animation. → nur als Rigging-Hilfe, Ergebnis eigenes Modell. |
| Eigenbau (Blender) | Rad, Fahrer | eigen (MIT/CC0) | langfristig das Ziel für den Look |

Empfehlung: Stil **stylized low-poly** statt Fotorealismus – passt zu CC0-Quellen, Performance und Customizing (Farben statt Texturen).

## Tests
- Routen-Daten: Bogenlänge = `lengthM` ± 0,5 %, `gradeAt` stetig, Loop schließt (Start = Ende, Höhe gleich).
- Visueller Smoke-Test (Playwright, Sim): Screenshot nach 10 s, Pixel nicht einfarbig, keine WebGL-Errors in Konsole.
