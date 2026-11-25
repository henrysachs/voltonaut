# Spec E0-15 – Sim-Geräte hinter `BleTransport`

- **Roadmap-Bezug:** E0, Architekturpflege; E0 „`packages/ble/sim` … `?sim=1` im Composition Root“, E2 [E2-03](E2-03-ftms-virtual-shifting.md).
- **Status:** Implementiert und softwaregeprüft, Hardwareabnahme offen. Nicht bereitgestellt.
- **Gestapelt auf:** [E0-11](E0-11-trainer-control-timing.md) (`refactor/trainer-control-timing`). Dessen adaptereigene Steuerung bleibt unverändert.
- **Betroffene Module:** `packages/ble/src/{sim,ftms,hrs,zwift-play,testdata}`, `apps/web/src/{main,rideDevices,ui/connect}`.

## Ziel

Im Sim-Modus laufen dieselben Adapter wie mit echter Hardware: Adapter-Shell, Parser, Feature-Prüfung, Auswahl und Control-Verfahren. Simuliert wird nur das GATT-Peripheriegerät hinter `BleTransport`. `main.ts` entscheidet weiterhin allein über Sim oder echt, aber nur noch durch die Wahl der Transportquelle.

## Befund vor der Änderung (im Code geprüft)

1. BLE, Replay und die Test-Central sind Adapter an `BleTransport`. `createFakeTrainer`, `createFakeHeartRate` und `createFakePlay` implementierten dagegen `DeviceAdapter` selbst. Shell, Parser, Feature-Prüfung und `select` liefen im Sim nicht.
2. Sim-Status kannte nur `disconnected | ready`; `connecting`/`handshaking`/`reconnecting` kamen im Sim nie vor.
3. Sim-`select` war `() => trainer.connect()`.
4. `fakePlay` wurde verbunden, stand aber nicht im Dialog. `pressShiftUp/Down` rief nur der eigene Test auf.
5. `ConnectSlot` packte `select`, `description` und `trainer` um, weil die Adaptertypen verschieden waren.
6. `setupSimDevices` und `setupBluetoothDevices` bauten die Geräteliste doppelt.

## Form

```ts
interface SimPeripheral {
  name: string;
  id: string;
  profile: GattProfile;
  read?(ref): ReadOnlyBytes | undefined;
  write?(ref, payload, link: SimLink): void;
  start(link: SimLink): Unsubscribe; // geskriptete Notifications je Verbindung
}

createSimTransport(peripheral): BleTransport & { drop(): void };

interface DeviceTransports {
  trainer: BleTransport;
  heartRate: BleTransport;
  play: readonly { side: PlaySide; transport: BleTransport }[];
}

createRideDeviceSet({ bus, clock, ticker, clockScale, transports }): RideDeviceSet;
createBluetoothDeviceTransports(central): DeviceTransports;
createSimDeviceTransports({ ticker, samples }): DeviceTransports;
```

- `ftms/simTrainer.ts`: FTMS-Peripherie mit `0x2ACC` (Bit 13), `0x2AD2` aus dem Sim-Skript und `0x2AD9` über den bestehenden `SimControlPoint`. `SimControlPoint` antwortet jetzt auf GATT-Ebene, statt eine eigene `FtmsControl` zu bauen.
- `hrs/simStrap.ts`: Heart-Rate-Peripherie (`0x180D`/`0x2A37`).
- Bytes kommen aus Encodern neben den Parsern: `encodeIndoorBikeData`, `encodeHeartRateMeasurement`, `encodeFitnessMachineFeature`. Die synthetischen Fixtures `ftmsKickr`/`hrsStrap` nutzen dieselben Encoder; ihre erzeugten Bytes bleiben gleich. Keine handgeschriebenen Bytes in `apps/web`.
- `rideDevices.ts`: eine `setupRideDevices(bus, clockScale, source)`. `DeviceSource` ist `{ transports, connectOnMount }`. Sim verbindet beim Mount ohne Picker, echte Geräte erst nach Nutzerklick.
- `ConnectSlot` ist nur noch `{ label, adapter }`. `adapter` ist ein `ConnectableDevice` (`DeviceAdapter` + `select`, optional `description` und `control`). `PlayAdapter` trägt dafür `side`.
- Entfernt: `createFakeTrainer`, `createFakeHeartRate`, `createFakePlay`, `createSimTrainerControl` samt Tests sowie `SimSample.gearIndex` (ohne Aufrufer außerhalb der Fakes).

### Entscheidung zu `fakePlay`

Entfernt, kein Play-Peripheriegerät im Sim. Der Adapter war in der App tot (nicht im Dialog, keine Aufrufer von `pressShift*`). Ein geskripteter Play-Griff ohne Eingabequelle würde nie schalten und nur zwei dauerhaft wartende Slots im Dialog erzeugen. Sim-Schalten bleibt die Tastatur (↑/↓). Die echten Play-Pfade prüfen weiterhin die nativen GATT-Fakes in `play-controller.spec.ts` und `native-control.spec.ts`. Die Sim-Quelle liefert `play: []`; ein späteres Play-Peripheriegerät braucht nur einen Eintrag dort.

## Abnahmekriterien

- [x] AK1 – Sim-Trainer und Sim-Pulsgurt laufen über `createTrainerAdapter`/`createHeartRateAdapter` und `BleTransport`: Status `connecting → handshaking → ready`, Protokoll `ftms`, Feature-Bit 13 gelesen, `trainer.data`/`hr.data` aus den Parsern.
- [x] AK2 – Ein Geräte-Setup-Test läuft parametrisiert über {Sim-Transport, Test-Central über `createWebBluetoothTransport`} mit denselben Peripheriegeräten und Erwartungen.
- [x] AK3 – Trainersicherheit im Sim unverändert: ohne `enable()` kein Write trotz Engine-Ziel; nach `enable()` `00 → 07 → 11 neutral`, danach Ziel mit ACK; Reconnect setzt Autorität zurück und sendet das gecachte Ziel nicht; `clockScale ≠ 1` scheitert ohne Write.
- [x] AK4 – Unerwarteter Linkverlust des Sim-Transports löst den Reconnect-Plan der Shell aus. Beim Sim-Trainer ist die Autorität danach `inactive`; das alte Ziel wird trotz weiterer Engine-Batches nicht gesendet, erst nach erneutem `enable()` folgen `00, 07, 11 neutral, 11 Ziel` (§3.9).
- [x] AK5 – `main.ts` wählt nur die Transportquelle; `setupSimDevices`/`setupBluetoothDevices` sind zu `setupRideDevices` zusammengefasst; `ConnectSlot` ist `{ label, adapter }`.
- [x] AK6 – Encoder sind Umkehrungen der Produktionsparser (Property-Tests).
- [x] AK7 – Sim-Modus bedienbar: Sim-E2E inklusive Pfeiltasten-Schaltung, Geräte-Overlay und aktivierter Sim-Rollenschaltung grün.
- [x] AK8 – Sim-Peripherie durchläuft das Skript zyklisch und sendet nach `disconnect` keine Notifications mehr.

## Testplan (`docs/10-testing.md`)

| AK   | Ebene                        | Datei                                                                                                  |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1–4  | Integration, parametrisiert  | `packages/ble/src/devices.test.ts` (`testdata/peripheralCentral.ts`)                                   |
| 4, 8 | Sim-Peripherie               | `packages/ble/src/sim/peripherals.test.ts`, Trainer-`drop()` in `packages/ble/src/devices.test.ts`     |
| 3    | UI über Sim-Transport        | `apps/web/src/ui/connect/trainerControl.test.ts`                                                       |
| 5    | UI                           | `apps/web/src/ui/connect/dialog.test.ts`                                                               |
| 6    | Property                     | `packages/ble/src/encode.test.ts`                                                                      |
| 7    | E2E Sim und native GATT-Fake | `apps/web/e2e/{sim,ride-menu-dismissal,game-menu,connect-ride,play-controller,native-control}.spec.ts` |
| alle | Gate                         | `E2E_PORT=5190 mise run check`                                                                         |

## Nicht-Ziele

Keine Änderung an `FtmsControlSession`, `ControlProcedure`, Codec, Presets, Debug-Labor, BLE-Fixtures oder E2E-Erwartungen. Kein neuer Gerätebroker, keine parallele V1-Fassade.

## Offene Fragen / Risiken

- Der Sim-Trainer meldet sich jetzt über `connecting`/`handshaking`, bevor `ready` kommt. „Sim connected“ erscheint dadurch ein bis zwei Mikrotasks später; E2E wartet ohnehin per `expect`.
- `0x2ACC` des Sim-Trainers meldet zusätzlich `cadence` und `powerMeasurement`. Das ist ein Sim-Wert, keine Hardwareaussage.
- Lastbedingt instabil auf dem geteilten Rechner: `game-menu.spec.ts:96` und `ride-menu-dismissal.spec.ts:49` (Render-/Distanzfortschritt). Beide scheitern dort auch auf dem unveränderten Elternstand.

## Doku-Updates (Pflicht beim Abschluss)

- [x] `docs/01-architecture.md` Composition Root · [x] `docs/10-testing.md` §6 · [ ] Roadmap-Checkbox (keine, reine Architekturpflege) · [ ] ADR (keine neue Entscheidung, Leitplanke oder Abhängigkeit)

Implementiert und am tatsächlichen Code softwaregeprüft. An echter Hardware getestet: **nein** – softwaregeprüft, Hardwareabnahme offen. Bereitgestellt: nein.
