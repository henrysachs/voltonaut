# Spec E2-05 – Widerstandsanzeige im Fahr-HUD

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E2 (Schalten verändert den Widerstand spürbar), Bedienbarkeit für die Hub-/Click-Probefahrt
- **Status:** Review
- **Betroffene Module:** `apps/web/src/ui`, `apps/web/src/rideDevices.ts`, `apps/web/index.html`, `apps/web/src/styles.css`

## Ziel

Der Fahrer sieht im HUD, ob die Trainersteuerung aus, im Aufbau, aktiv, im Abbau, beendet, verloren oder fehlgeschlagen ist. Bisher stand das nur im Gerätedialog; ein Verlust mitten in der Fahrt blieb unbemerkt.

## Abnahmekriterien

- [x] AK1 – Ohne steuerbaren Trainer ist die Anzeige ausgeblendet.
- [x] AK2 – „Widerstand aktiv“ erscheint erst, wenn die Authority `active` ist (Control, Start und Neutralziel bestätigt).
- [x] AK3 – Ein Grad erscheint nur aus einem bestätigten Ziel (`targetAcknowledged`/`neutralAcknowledged`), nie aus einem nur angeforderten.
- [x] AK4 – Während `stopping` steht „Widerstand wird deaktiviert …“, nie „aus“ (`AGENTS.md` §3.9). Erst nach bestätigtem Stop: „Widerstand aus · Stop bestätigt · neu verbinden“.
- [x] AK5 – Verlorene oder fehlgeschlagene Sitzung bleibt sichtbar, obwohl `available` dann `false` ist.
- [x] AK6 – Nur das Zustandswort steht in der `aria-live`-Region; der Grad steht daneben und wird nicht angesagt. Geschrieben wird nur bei Änderung.

## Testplan (`docs/10-testing.md`)

| AK       | Ebene | Datei                                                                  |
| -------- | ----- | ---------------------------------------------------------------------- |
| AK1–AK6  | Unit  | `apps/web/src/ui/hudTrainerControl.test.ts` (inkl. echter Sim-Trainer) |
| AK2, AK5 | E2E   | `apps/web/e2e/native-control.spec.ts` (native GATT-Fakes)              |
| AK4      | E2E   | `apps/web/e2e/ride-menu-dismissal.spec.ts` (Sim-Trainer, Deaktivieren) |

## Nicht-Ziele

- Keine Änderung an Steuerlogik, BLE oder Engine.
- Kein Aktivieren/Deaktivieren aus dem HUD; das bleibt im Gerätedialog (Nutzerklick).

## Offene Fragen / Risiken

- Nachweisstand: softwaregeprüft mit Sim-Trainer und nativen GATT-Fakes, Hardwareabnahme offen.

## Doku-Updates

- [x] Spec · [ ] Roadmap-Checkbox (keine eigene) · [ ] ADR (nicht nötig)
