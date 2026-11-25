# Spec E2-03 – Freigegebene FTMS-Rollenschaltung

- **Roadmap-Bezug:** E2, Control Point und spürbare virtuelle Schaltung; E3, Engine → Trainer.
- **Status:** Implementiert und unabhängig softwaregeprüft. Hardwareabnahme offen; Bereitstellung bleibt ein getrennter Betriebsschritt.
- **Betroffene Module:** `packages/ble/src/ftms`, `apps/web/src/{rideDevices,main,ui/connect}`, native Browser-E2E.

## Ziel

Die belegten Play-Flanken ändern über die vorhandene Worker-Engine den realen FTMS-Simulationswiderstand. Verbinden bleibt lesend. Erst „Rollenschaltung aktivieren“ im Geräte-Menü fordert Rechte an.

## Form und Ownership vor Implementierung

Verglichene Formen:

1. **Control-Session im TrainerAdapter (gewählt):** Adapter besitzt GATT-Generation, Featureprüfung, Messwerte, Autorität, ein ausstehendes Verfahren und genau einen neuesten Zielwert. Aufrufer übergeben ausschließlich vorhandene `TrainerCommand.simulation`-Werte; keine Physik im BLE/UI.
2. **Generischer Command-Broker:** zusätzliche Lebenszyklen, Routing und Kenntnis des aktiven Geräts im Aufrufer. Kein zweiter schreibender Gerätetyp vorhanden; daher verworfen.

```ts
type TrainerAuthority =
  | { kind: "inactive"; reason: string }
  | { kind: "acquiring"; step: "control" | "start" | "neutral" | "stopping" }
  | { kind: "active" }
  | { kind: "lost"; reason: string }
  | { kind: "failed"; reason: string; reconnectRequired: boolean };

interface TrainerControl {
  enable(clockScale?: number): Promise<void>;
  disable(): Promise<void>;
  submit(command: Extract<TrainerCommand, { type: "simulation" }>): void;
  view(): TrainerControlView;
  subscribe(listener: () => void): () => void;
}
```

Gerätefähigkeit vor Worker-Erzeugung zurückgeben; UI-Mount und Sim-Connect erst nach Bus-Listenern. Vorhandenes Worker-`onCommands` erhält den konkreten Geräteempfänger. Kein neuer Broker, globaler Callback oder Engine-Eingriff.

Die Engine unterdrückt unveränderte Kommandos. Seit [E0-11](E0-11-trainer-control-timing.md) hält der Trainer-Adapter selbst das letzte Engine-Simulationsziel. Aufrufer reichen jedes Engine-Update mit Pause-Zustand weiter. Frische eigene Gerätekadenz >0 und ein nicht pausiertes Engine-Update innerhalb von 1,5 s bestätigen dessen weitere Gültigkeit; die Auto-Pause verwirft es bis zum Resume-Kommando. Wiederholte identische Ziele erzeugen keine weiteren Writes. Diese Projektion berechnet keine Physik.

## Abnahmekriterien

- [x] AK1 – FTMS-Feature Bit 13, CP write+indicate, explizite Freigabe und Echtzeit erforderlich. CPS/fehlende Features bleiben passiv.
- [x] AK2 – Indications vor Writes; genau ein Verfahren; Pending vor Write; exakte dreibyte `0x80/opcode/result`-Korrelation, synchrones ACK möglich; `00 → 07 → 11 neutral` erst nach jeweiligem ACK und abgeschlossenem Write.
- [x] AK3 – Nur vorhandene Engine-Simulation; finite Werte; konservative Grade-Grenzen −5…10 %, Wind/Crr/Cw gemäß Standard. Maximal vier Sim-Writes pro realer Sekunde; neuestes Ziel statt unbegrenzter Queue. Kein zusätzlicher pauschaler 250-ms-Aufschub für bereits fällige Kommandos.
- [x] AK4 – Keine automatischen Ziele bei Kadenz null/veralteten Daten. Reconnect, Auswahl, Abbruch, Permission Lost, fehlerhaftes ACK und Timeout verwerfen alte Ziele. Timeout/unklare Writes sperren bis frischer GATT-Verbindung; kein blindes Wiederholen desselben Opcodes.
- [x] AK5 – Deaktivieren beendet automatische Ziele, sendet nur bei bestätigtem Besitz eine begrenzte Neutralisierung und Stop; ACK und Zielanzeige bleiben getrennt. Unbestätigter Zustand heißt unbekannt, nie „physisch gestoppt“.
- [x] AK6 – Native-GATT-E2E: Trainer + beide Play-Griffe, null Trainerwrites vor Freigabe, vollständige Kontrollsequenz, rechts höherer/linker niedrigerer dekodierter Grade, Halten ohne weiteren Gangwechsel, HUD und sichtbare 3D-Szene.
- [x] AK7 – Sim, bestehende native Read-only-Tests und vollständiges Gate unverändert grün; Build grün. Keine Hardware-/Latenz-/Gefühlsbehauptungen aus Fakes.

## Testplan

| AK  | Ebene                                             | Datei                                                    |
| --- | ------------------------------------------------- | -------------------------------------------------------- |
| 1–5 | Unit/Integration                                  | `packages/ble/src/ftms/control*.test.ts`                 |
| 6   | Browser mit nativem GATT-Fake, echter Engine/Play | `apps/web/e2e/native-control*.spec.ts`                   |
| 7   | Bestehende Tests + Gate                           | `E2E_PORT=5234 CI=true mise run check`, `mise run build` |

Das unabhängige Safety-Review fand einen Statusrückschritt nach einem bestätigten ACK mit unmittelbar folgendem Rechteverlust. Die Korrektur beendet die alte Control-Session einschließlich ihrer wartenden Fortsetzungen. Die beiden unveränderten roten Gegenproben und 18 permanente Regressionen bestehen. Das frische unabhängige Nachreview bestätigt zusätzlich Timer-/Subscription-Abbau, die aufgelöste Disable-Wartephase und ausdrücklich erneute Freigabe nach frischem Attach.

Das kombinierte Gesamtgate mit dem gemergten Render-Worker besteht mit 686 Unit-Tests und 36 Browserfällen. Auch der Build besteht. Der unabhängige Produktionsbuild zeigt null Writes vor Freigabe, sechs bestätigte Writes und rechts/links veränderte tatsächliche Worker-Kommandos. Kein Hardwareattest wird daraus abgeleitet.

## Grenzen / Risiken

- Kein ERG, Reset `0x01`, Haptik oder proprietäres Trainerprotokoll.
- `mT=83 kg` bleibt Engine-Annahme, nicht Hardwarebefund. Profil-Kettenblatt/Cog müssen dem Rad entsprechen. Kalibrierung, Trainer-Firmware, physisches Gefühl und Latenzziel <300 ms bleiben Hardware-Abnahme.
- Konservative Transportbegrenzung 10 % ist nicht die bestätigte Trainergrenze. Bergab ist Gangmonotonie nicht garantiert (bestehendes Modell).
- Seite schließen/Verbindung verlieren garantiert keine Neutralisierung. Bei unklarem Widerstand sicher anhalten, andere Centrals trennen, neu verbinden und ausdrücklich freigeben.
- Elternsession besitzt Integration, unabhängiges Review, kombiniertes Gate und Rollout. Keine Git-Schreiboperationen oder echte Funkzugriffe in dieser Aufgabe.

## Doku-Updates

- [x] E2-Teilschritt in Roadmap · [x] Bluetooth-/Lifecycle-Befund · [x] Hardware-Abnahme weiterhin offen dokumentiert

Implementiert und an nativen Browser-Fakes sowie Sim softwaregeprüft. Unabhängiges Runtime-Review und frisches Safety-Nachreview bestanden. An echter Hardware getestet: **nein**. Der jeweils bereitgestellte Commit wird getrennt mit URL und Betriebsart genannt.
