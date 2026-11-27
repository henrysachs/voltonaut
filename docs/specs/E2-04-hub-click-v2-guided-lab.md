# Spec E2-04 – Zwift Hub One, Zwift Click v2 und geführtes BLE-Labor

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E1 Diagnosewerkzeug `debug/ble.html`, E2 Controller-Mapping und FTMS-Steuerung
- **Status:** Review
- **Betroffene Module:** `packages/ble` (Controller, FTMS-Verfahren, Labor-Decoder), `apps/web/src/debug/ble`, `apps/web/debug/ble.html`, Verbindungsdialog, E2E-Fakes

## Ziel

Der Zwift Hub One wird als FTMS-Trainer gefunden und lässt sich steuern, auch wenn er auf ein zweites Start-Kommando mit `80 07 04` antwortet. Ein Zwift Click v2 schaltet im Spiel wie ein Play-Griff. Das BLE-Labor zeichnet jedes verbundene Gerät sofort vollständig auf und erklärt pro Gerät, wie ein brauchbarer Mitschnitt entsteht.

## Ausgangsbefund 26.11.2026

Exporte eines Hub One und eines Click v2 (beide Pucks) enthielten fast keine Daten: Das Labor zeichnete nur manuell abonnierte Characteristics auf. Am Click wurde das FTMS-Preset gedrückt. Die Bytes werden nicht als Fixture übernommen; nur die GATT-Struktur und die FTMS-Antworten sind hier dokumentiert (`docs/02-bluetooth.md`).

## Abnahmekriterien

- [x] AK1: Nach dem Verbinden zeichnet das Labor jede Notify-/Indicate-Characteristic auf und liest alle lesbaren Standard-Characteristics einmal, ohne Klick. Dabei gibt es keinen Write außer CCCD. Ausnahmen: Auf einem Trainer bleiben die proprietären Zwift-Services vollständig unberührt (ADR-001). Auf einem Controller werden sie abonniert, aber nicht gelesen. Die Click-v2-Characteristics `…0100`–`…0102` bleiben immer manuell. Fehlgeschlagene automatische Zugriffe stehen als eigenes Ereignis im Log, nicht als Marker.
- [x] AK2: Firmware (`0x2A26`) wird automatisch in die Gerätedaten übernommen.
- [x] AK3: Jedes Gerät hat einen eigenen Log-Tab (WAI-ARIA-Tabs: Pfeiltasten, Home/End, Roving-Tabindex; Fokus bleibt bei Aktualisierungen erhalten) und eine eigene Exportdatei `ble-<nr>-<name>-<zeit>.json`. „Alle exportieren“ lädt eine Datei pro Gerät.
- [x] AK4: Das Labor erkennt Trainer, Zwift Play, Click v2, Pulsgurt und Unbekanntes und zeigt dazu eine Schrittanleitung. Presets, die nicht zum Gerät passen, sind gesperrt und nennen den Grund. Der Zwift-Dienst eines Trainers bleibt gesperrt (ADR-001).
- [x] AK5: Logzeilen sind lesbar (Zeit, Richtung, Name der Characteristic, Hex, Dekodierung). Dekodiert werden Bike Data, HR, CPS, 0x2ACC, FTMS-Status, Control-Point-Antworten, Akku, Device-Info-Texte, Play `0x07`, Click v2 `0x23`, RideOn-Antworten und Click-v2-Sperrmeldungen. Advertising zeigt den Zwift-Gerätetyp.
- [x] AK6: FTMS-Erwerb akzeptiert für Start `0x07` die Antworten `success` und `failed` (am Hub beobachtet bei bereits laufender Maschine; die genaue FTMS-Stelle ist nicht geprüft, UNVERIFIED). Alle anderen Fehler und jedes nicht erfolgreiche neutrale `0x11` sperren weiterhin. Gilt für Fahrt und Labor.
- [x] AK7: Der Trainer-Picker findet den Hub zusätzlich über den Namen „Zwift Hub“.
- [x] AK8: Der Controller-Slot verbindet Play (`00000001-…`, `RideOn`) und Click v2 (`fc82`, `RideOn 02 03`, Antwort mit Gerätekey). Ein Gerät mit FTMS oder CPS wird dort abgelehnt.
- [x] AK9: Click v2: + schaltet hoch, − und B schalten runter. Eine Flanke ergibt genau ein Ereignis, Halten wiederholt nichts. Die Seite wird über die gedrückte Taste bestätigt, eine falsche Seite ist ein behebbarer Fehler. Eine Sperrmeldung erklärt die Zwift-App-Freischaltung.

## Testplan

| AK         | Ebene                       | Datei                                                                                    |
| ---------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| AK1, AK5   | Unit (Profil, Decoder)      | `packages/ble/src/lab.test.ts`                                                           |
| AK1–AK4    | Browser (native GATT-Fakes) | `apps/web/e2e/ble-sniffer-multidevice.spec.ts`, `apps/web/e2e/ble-sniffer.test.ts`       |
| AK1, AK3   | DOM-Composition             | `apps/web/src/debug/ble/main.test.ts`, `dom.test.ts`                                     |
| AK6        | Unit (Verfahren)            | `packages/ble/src/ftms/control.hub.test.ts`, `labControl.test.ts`                        |
| AK7        | Unit (Picker-Optionen)      | `packages/ble/src/ftms/selection.test.ts`                                                |
| AK8, AK9   | Unit/Property               | `packages/ble/src/zwift-play/clickV2.test.ts`, `adapter.clickV2.test.ts`                 |
| Regression | Replay echter Play-Captures | `packages/ble/src/zwift-play/adapter.replay.test.ts`, `parse.test.ts` (unverändert grün) |

`CI=true E2E_PORT=5197 mise run check` ist grün, Coverage-Schwellen gehalten. Ein unabhängiges Agentenreview fand einen ADR-001-Befund (Labor abonnierte den Zwift-Service des Hubs) und drei kleinere (Spec-Zitat, Tab-Barrierefreiheit, Fehler als Marker); alle sind behoben und durch Tests belegt. Engine und Rules sind unverändert, daher kein Mutationslauf.

## Nachweisstand

- **Implementiert:** ja.
- **Softwaregeprüft:** ja, mit Sim-, Replay- und nativen GATT-Fakes.
- **An echter Hardware geprüft:** nein. Hub-Steuerung über Play/Click, Click-v2-Bitbelegung, Handshake-Antwort, Sperrverhalten und Advertising sind **UNVERIFIED**.
- **Bereitgestellt:** nein.

## Nicht-Ziele

Kein proprietäres Hub-Schalten (ADR-001), kein Click-v2-Unlock (Algorithmus nicht öffentlich), keine Writes auf `…0100`–`…0102`, keine Haptik, kein Click v1.

## Offene Fragen / Risiken

- Der linke Click-v2-Puck soll laut BikeControl ohne Zwift-Freischaltung nach etwa einer Minute verstummen; der rechte nicht. Ein Rechts-only-Betrieb (+ hoch, B runter) ist deshalb vollwertig.
- Ob der Hub `0x1826` im Advertising sendet, ist offen; der Namensfilter deckt beides ab.

## Doku-Updates

- [x] `docs/02-bluetooth.md` (Hub One, Click v2, Start-Antwort)
- [x] `docs/local-hardware-lab.md` (Ablauf neues Gerät)
- [x] `docs/open-questions.md` (H3)
