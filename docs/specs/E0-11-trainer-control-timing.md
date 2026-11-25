# Spec E0-11 – Trainer-Adapter besitzt das Steuerungs-Timing

- **Roadmap-Bezug:** E0, Architekturpflege; E2 [E2-03](E2-03-ftms-virtual-shifting.md) „Rollenschaltung“, E3 Engine → Trainer.
- **Status:** Implementiert und softwaregeprüft, Hardwareabnahme offen. Nicht bereitgestellt.
- **Betroffene Module:** `packages/ble/src/{ftms,sim}`, `apps/web/src/{rideDevices,ui/connect}`.

## Ziel

Aufrufer der Trainersteuerung tragen keine Timing-Pflichten mehr. Der Trainer-Adapter (echt und Sim) liest die Kadenz aus seinen eigenen geparsten Messdaten. Er legt die Echtzeitbedingung (`clockScale`) bei der Erzeugung fest und entscheidet selbst, ob ein Engine-Ziel noch gilt. Aufrufer reichen nur Engine-Kommandos weiter, die UI sieht nur Ansicht, Aktivieren und Deaktivieren.

## Befund vor der Änderung (im Code geprüft)

1. `observeCadence` musste von außen gefüttert werden, sonst ging nichts raus. Doppelt in `ftms/adapter.ts` und `sim/fakeTrainer.ts`.
2. `commandSink` in `rideDevices.ts` reichte das unveränderte Ziel bei jeder Worker-Nachricht (20 Hz) erneut ein, damit es innerhalb von `FRESH_S = 1,5 s` gültig blieb. `FtmsControlSession.submit` hat dafür einen Zweig für identische Ziele.
3. `clockScale` lief über `main.ts` → `rideDevices` → `ConnectSlot.trainer` → `renderTrainerControl` → `enable(clockScale)`.
4. „Fährt“ wurde zweimal entschieden: Snapshot-Kadenz und `paused` im Web, frische Gerätekadenz in der Session.
5. Das 4-Hz-Limit steht in der Engine (`COMMAND_INTERVAL_TICKS = 5`) und in der Session (`SIM_INTERVAL_S = 0,25`).
6. `FtmsControlConnection` (`attach`, `detach`, `observeCadence`) war über `@voltonaut/ble` öffentlich.

## Form

```ts
interface TrainerControlPanel {
  enable(): Promise<void>;
  disable(): Promise<void>;
  view(): TrainerControlView;
  subscribe(listener: () => void): () => void;
}

interface TrainerControl extends TrainerControlPanel {
  forward(commands: readonly TrainerCommand[]): void;
}
```

- `ControlOptions.clockScale`, `TrainerAdapterOptions.clockScale` und `FakeTrainerOptions.clockScale` sind Pflichtfelder. `enable()` hat keinen Parameter mehr.
- Neues internes Modul `ftms/controlConnection.ts` mit `FtmsControlConnection` (`attach`, `detach`, `publishData`, `dispose`). Es ist nicht aus dem Paketindex exportiert. `ftms/control.ts` exportiert nur noch die Vertragstypen.
- `publishData` ist der einzige Weg für geparste Trainer-Samples: Kadenz an die Session, gehaltenes Ziel bestätigen, dann auf den Bus. FTMS- und Sim-Adapter nutzen ihn beide.
- `forward` merkt sich das letzte Simulationsziel und die Zeit des Batches. Auch leere Batches beweisen eine laufende Engine. Das gehaltene Ziel wird nur angeboten, solange die Engine innerhalb von `FRESH_S` geliefert hat.
- `rideDevices.ts` verliert `commandSink` und `onSnapshot`. `ConnectSlot.trainer` ist ein `TrainerControlPanel`. `main.ts` bleibt unverändert.

### Bewusst beibehalten

- **Zwei Raten-Limits.** Das Engine-Limit läuft in Fahrtzeit-Ticks, ist deterministisch und wird vom Server nachgerechnet. Es begrenzt keinen BLE-Verkehr bei beschleunigter oder stockender Uhr. `SIM_INTERVAL_S` ist das Wanduhr-Limit des Transports. Beide bleiben; der Grund steht an `SIM_INTERVAL_S`.
- **Gleiches-Ziel-Zweig in `FtmsControlSession.submit`.** Der Adapter bietet das gehaltene Ziel weiterhin bei jedem Sample erneut an. `FtmsControlSession` und `ControlProcedure` bleiben unverändert (Sicherheitskern).
- **„Fährt“ hat eine Quelle:** frische Gerätekadenz > 0 in der Session. Die Engine-Pause braucht keine zweite Prüfung: Sie setzt Kadenz 0 voraus, und die Engine schickt beim Wiederanfahren ein sofortiges Kommando.

### Entscheidung zur erneuten Freigabe

Nach Disconnect, Timeout, Rechteverlust oder Deaktivieren bleibt die Autorität verloren. Das gehaltene Engine-Ziel wird nie ohne neue Freigabe gesendet. Nach ausdrücklichem `enable()` laufen erneut `00 → 07 → 11 neutral`. Danach sendet der Adapter das aktuelle Engine-Ziel, sofern die Engine innerhalb von 1,5 s geliefert hat und frische Kadenz > 0 vorliegt. Das entspricht dem bisherigen Verhalten von `commandSink`. Es ist kein Wiederholen eines unbestätigten Kommandos, denn ein unbestätigtes Verfahren sperrt weiterhin bis zur frischen GATT-Verbindung.

## Abnahmekriterien

- [x] AK1 – Über `createTrainerAdapter`: Bike Data mit Kadenz, ein `forward` → genau ein `0x11`-Write mit dem Ziel, erst nach ausdrücklicher Freigabe. Weitere Samples und leere Batches erzeugen keine Wiederholung.
- [x] AK2 – Kadenz älter als 1,5 s oder Kadenz 0 → kein Write. Die Kadenz kommt ausschließlich aus den eigenen Indoor Bike Data.
- [x] AK3 – Wiederanfahren sendet das gehaltene Ziel; nach einer Engine-Pause > 1,5 s ohne Batch nicht.
- [x] AK4 – Disconnect/Reconnect: Autorität `inactive`, Ziel und ACK leer, kein Write des gecachten Ziels trotz Samples und Batches. Erst nach erneutem `enable()` folgen `00, 07, 11 neutral, 11 Ziel`.
- [x] AK5 – Timeout eines Ziel-Writes sperrt; spätere Samples, Batches und `enable()` erzeugen keinen weiteren Write.
- [x] AK6 – `clockScale ≠ 1` ist bei der Erzeugung festgelegt; `enable()` scheitert ohne Write (Adapter, Session-Rig, UI).
- [x] AK7 – Keine Aufrufer-Timing-Pflichten mehr: kein `commandSink`, kein `onSnapshot` in `rideDevices`, kein `clockScale` in UI/Dialog, `FtmsControlConnection` nicht öffentlich. Bestehende Control-, Race-, Sim-, UI- und native E2E-Tests unverändert in ihrer Aussage grün.

## Testplan (`docs/10-testing.md`)

| AK   | Ebene                                          | Datei                                                                           |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------- |
| 1–6  | Integration über echten `createTrainerAdapter` | `packages/ble/src/ftms/adapter.control.test.ts` (`adapterTestRig.ts`)           |
| 6    | Session-Rig                                    | `packages/ble/src/ftms/control.test.ts`                                         |
| 6    | UI                                             | `apps/web/src/ui/connect/trainerControl.test.ts`                                |
| 7    | Bestehende Regressionen, nativer GATT-Fake     | `packages/ble/src/ftms/control*.test.ts`, `apps/web/e2e/native-control.spec.ts` |
| alle | Gate                                           | `E2E_PORT=5186 mise run check`                                                  |

Gegenproben: Ohne Engine-Frischeprüfung, ohne Bestätigung im Sample-Pfad oder mit hartkodiertem `clockScale = 1` schlägt jeweils mindestens ein Fall in `adapter.control.test.ts` fehl.

## Nicht-Ziele

Keine Änderung an `FtmsControlSession`, `ControlProcedure`, Codec, Engine-Limit, Presets oder BLE-Fixtures. Kein neuer Broker.

## Offene Fragen / Risiken

- Der Adapter hält das letzte Engine-Ziel über Reconnects. Nach erneuter Freigabe wird es gesendet, wenn die Engine lebt. Wer nach Neuverbindung zuerst neutral fahren will, muss das weiterhin über Deaktivieren tun.
- Echte Trainer liefern Indoor Bike Data mit eigener Rate (z. B. 1–4 Hz). Bei < 1 Sample pro 1,5 s greift die Frischeprüfung und es wird nichts gesendet. Unverändert gegenüber vorher; Hardwareabnahme offen.

## Doku-Updates (Pflicht beim Abschluss)

- [x] `docs/02-bluetooth.md` E2-03-Abschnitt · [x] Verweis in E2-03 · [ ] Roadmap-Checkbox (keine, reine Architekturpflege) · [ ] ADR (keine neue Entscheidung oder Leitplanke)

Implementiert und am tatsächlichen Code softwaregeprüft. An echter Hardware getestet: **nein** – softwaregeprüft, Hardwareabnahme offen. Bereitgestellt: nein.
