# Zwift Hub One und Zwift Click v2, Hardwaremitschnitte vom 27.11.2026

Echte Geräteantworten, aufgezeichnet im geführten BLE-Labor ([E2-04](../../docs/specs/E2-04-hub-click-v2-guided-lab.md)) an der Hardware eines Bekannten. Keine synthetischen Hardware-Fixtures. Beide Originale bleiben unverändert außerhalb des Repositories. Henry hat die Übernahme am 27.11.2026 freigegeben; vorhandene Fixtures bleiben unverändert.

| Gerät | Originaldatei | SHA-256 des Originals |
| --- | --- | --- |
| Zwift Hub One | `ble-1-zwift-hub-2026-11-27T07-44-18.002Z.json` | `d7270d86a72a8dff20250e7ac988c041638960b62038f320cde0b9bbcf2a3418` |
| Zwift Click v2 (rechter Puck) | `ble-2-zwift-click-2026-11-27T07-47-32.089Z.json` | `65c8edd39679c6523401b75f9cc4200492b5ba04307909c966fa074b5fb86bb2` |

## Anonymisierung

Ausschließlich `meta.deviceId` wurde durch `hardware-zwift-hub-one-20261127` beziehungsweise `hardware-zwift-click-v2-right-20261127` ersetzt, ausschließlich `meta.ua` durch `anonymized hardware capture browser`. Alle anderen Werte, insbesondere GATT, Bytes, Zeitstempel, Marker, Gerätename und Firmware, sind identisch. `scripts/import-hub-click-captures.mjs <Originalverzeichnis>` prüft die Original-Hashes und schreibt ohne Überschreiben.

- `zwift-hub-one-hardware-20261127.json`: SHA-256 `2e700d69ffd09fad48763bbd639829f56f0fe6fa0c538aafa9ba0bb1b37aeb50`, 328 Logeinträge.
- `zwift-click-v2-right-hardware-20261127.json`: SHA-256 `f5be26a3822731ba3e213524f6508a6951344ae76c038d6cf3c6938d3071b68b`, 139 Logeinträge, 120 `0x23`-Frames.

## Belegte Fakten

**Hub One**, Firmware 5.2.2, Modell `06`, Hardware `1`, Hersteller „Zwift“:

- `0x2ACC` meldet Maschine `0x00004487` und Ziele `0x0000e00c`. Simulation ist enthalten.
- Alle 97 Indoor-Bike-Data-Frames (Flags `0x0264` und `0x02fe`) werden fehlerfrei gelesen. Die Leistung reicht bis 114 W.
- Erste Freigabe auf der Verbindung: `00` → `80 00 01`, `07` → `80 07 01`, Status `04`, dann `11 … 28 33` und `11 00 00 f4 01 28 33`, jeweils `80 11 01` und Status `12 …`.
- Zweite Freigabe: `07` → **`80 07 04`**, danach bestätigt der Hub beide `0x11` erneut. Damit ist der Befund vom 26.11. reproduziert.
- Der Zwift-Service `00000001-19ca-…` wurde nicht berührt (ADR-001).

**Click v2, rechter Puck**, Firmware 1.2.0, Hardware `B.0`, Akku 80 %:

- Handshake `52 69 64 65 4f 6e 02 03` auf `…03`, Antwort auf `…04` genau dieselben acht Bytes, ohne Gerätekey.
- Markierte Tasten: + = `0x1000`, B = `0x20`, A = `0x10`, Y = `0x40`, Z = `0x80`. Inverse Logik, Ruhezustand `23 08 ff ff ff ff 0f`.
- In rund 90 s Aufnahme kam keine Sperrmeldung.

## Grenzen

Indoor Bike Data liefert Geschwindigkeit, Kadenz und Leistung; die Kadenz steigt im Mitschnitt nach der Leistung von 0 auf bis 28 U/min (Kurbel von Hand gedreht). Die Freigabe-Presets liefen danach im Stand.

Nicht belegt sind spürbarer Widerstand, Widerstand unter Last, die von der App gesendeten neutralen Simulationsbytes (`11 00 00 00 00 00 00`), Reconnect und der gleichzeitige Betrieb von Hub und Click.
