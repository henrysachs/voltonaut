# 05 – Avatar & Customizing

## Ziel
Ein sichtbarer Fahrer auf einem Rad, der **im Takt der echten Kadenz** tritt, sich mit Tempo/Steigung natürlich verhält (Wiegetritt am Berg, Ducken bergab) und dessen Teile austauschbar sind.

## Modellaufbau
- **Rad** (`bike.glb`): separate Nodes `frame`, `fork`, `wheel_front`, `wheel_rear`, `crank` (Pivot im Tretlager), `pedal_l`, `pedal_r`, `handlebar`, `saddle`. Rahmen und Laufräder sind **Slots**: andere GLBs werden an Anker-Nodes (`anchor_wheel_front`, …) gehängt.
- **Fahrer** (`rider.glb`): ein Skinned Mesh, humanoides Skelett (Mixamo-kompatible Bone-Namen erleichtern Tools), Teile als getrennte Meshes am selben Skelett: `body`(Haut), `jersey`, `bibs`, `helmet`, `shoes`, `glasses`. Austausch = Mesh im Slot ersetzen, Skelett bleibt.
- Farben über Material-Parameter (Masken-Textur: R/G/B-Kanäle = Primär/Sekundär/Akzent), nicht über neue Texturen → Trikot-Designs = Maske + 2–3 Farben.

## Animation (prozedural, nicht Keyframe)
1. **Kurbelwinkel** `φ` integriert aus Kadenz: `φ += 2π · cadenceRpm/60 · dt` (geglättet, damit Kadenzsprünge nicht ruckeln). Kurbel-Node dreht sich mit `φ`.
2. **Beine per Two-Bone-IK** (Hüfte→Knie→Fuß): Fußziel = Pedalposition; Knie-Pole nach vorne. Fußgelenk leichter Winkel abhängig von `φ` (Ankling).
3. **Hände** per IK an Lenker (Oberlenker/Unterlenker je nach Tempo/Pose).
4. **Oberkörper:** Basis-Pose; leichte Hüft-/Schulter-Wippe mit `sin(φ)` proportional zu Leistung; Wiegetritt-Pose bei `gradePct > 6` und `powerW > 1.3 × FTP-Schätzung` (Blend 0,5 s).
5. **Laufräder** drehen mit virtuellem Tempo, nicht mit Kadenz. Rollen ohne Treten → Beine stehen still (Freilauf), Pedale bei 3/9 Uhr.
6. Kopf schaut leicht in Kurvenrichtung; Rad neigt sich minimal in Kurven (`bank ≈ atan(v²/(r·g))`, geclampt 8°).

Vorteil prozedural: exakte Kadenz-Synchronisierung, keine Mixamo-Abhängigkeit, funktioniert mit jedem Rahmen (Sattelhöhe/Reach als Parameter).

## Customizing
```ts
interface ItemDef {
  id: string;                    // 'jersey.voltonaut-classic'
  slot: 'jersey' | 'helmet' | 'shoes' | 'glasses' | 'frame' | 'wheels' | 'skin';
  name: string; asset: string;   // GLB-Pfad oder Masken-Textur
  colorable: number;             // Anzahl frei wählbarer Farben (0–3)
  unlock: UnlockRule;            // siehe 06-gamification.md
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  stats?: { massKg?: number; cdaDelta?: number };   // optional, Gameplay-Effekt (Entscheidung offen)
}
```
- Item-Katalog als JSON (`avatar/catalog/*.json`), validiert per Schema in Tests.
- `AvatarConfig` (01-architecture) referenziert nur IDs + Farben; ungültige/nicht besessene IDs → Fallback auf Default. Besitz prüft der Server (`inventory/`), der Client nur gegen den Cache.
- Körpergröße aus dem Rider-Profil (`heightCm`) skaliert das Skelett; Sattelhöhe/Reach folgen daraus.
- Garage-Screen (ui/garage): Drehbarer 3D-Showroom (OrbitControls), Slot-Tabs, gesperrte Items ausgegraut mit Freischaltbedingung. Änderung → Intent `avatar.setConfig` → avatar übernimmt, `sync/` speichert per `PUT /v1/me/avatar`. Shop-Tab: Preise in Volts ⚡, Kauf → `POST /v1/shop/purchase`.
- Hautton: 6–8 Presets + freier Farbwähler.

## Start-Katalog (E7)
| Slot | Anzahl | Default |
|---|---|---|
| Trikot | 6 Designs × Farben | „Voltonaut Classic" |
| Helm | 3 | Standard |
| Schuhe | 2 | weiß |
| Rahmen | 3 (Race, Aero, Gravel) | Race |
| Laufräder | 4 (Alu, Carbon flach, Carbon tief, Disc) | Alu |
| Brille | 2 + keine | keine |

## Offene Designfrage
Sollen Rahmen/Laufräder **Spielwerte** haben (Gewicht/CdA wie bei Zwift)? Vorschlag: v1 rein kosmetisch, Werte im Datenmodell vorgesehen, später per Einstellung aktivierbar. → `open-questions.md`.
