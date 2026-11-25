# Spec E0-12 – Labor-Presets über ControlProcedure

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E1 „`apps/web/debug/ble.html` … Presets“ und E2 „Control Point: Write-Queue, Indications, Request Control, Start …“. Architektur-Refactor, keine neue Roadmap-Checkbox.
- **Status:** Review. Implementiert und am tatsächlichen Artefakt softwaregeprüft, Hardwareabnahme offen. Nicht bereitgestellt.
- **Betroffene Module:** `packages/ble/src/ftms/{presets,labControl}.ts`, `packages/ble/src/zwift-play/{handshake,session}.ts`, `apps/web/src/debug/ble/{device,devices,explorer,main,presets}.ts`, Sniffer-Testdaten und Sniffer-E2E.

## Ziel

`ControlProcedure` ist das einzige Modul, das Verfahren auf den FTMS Control Point schreibt und deren Indications auswertet. Bisher lief `runBlePreset` als zweite, schwächere Implementierung. Sie verglich nur das Präfix der letzten Antwort und lieferte bei einer Zeitüberschreitung nur `false`. Die Laborfreigabe blieb danach bestehen. Ein zweiter Klick auf „Sim 5 %“ auf derselben GATT-Verbindung konnte so durch ein verspätetes `80 11 01` des vorherigen Writes bestätigt werden. Genau diese Mehrdeutigkeit schließt `docs/02-bluetooth.md#e2-03-rollenschaltung` aus.

## Entscheidungen

- **FTMS-Presets** sind Daten ohne eigene Schreiblogik: `{ kind: "ftms", authority: "acquire" | "granted", commands: { opcode, bytes }[] }`. `createFtmsLabControl` gilt für genau eine GATT-Sitzung. Es öffnet eine `ControlProcedure` auf dem protokollierenden Sniffer-Transport. Mitschnitt und Abonnements bleiben dadurch gemeinsam. Jeder Befehl wird einzeln über `procedure.run(opcode, bytes)` ausgeführt.
- **Start `0x07`:** `FtmsControlSession.enable` bestätigt nacheinander `00` → `07` → `11` (`controlSession.ts`). Dieselbe Reihenfolge steht in `docs/02-bluetooth.md` und `docs/03-engine-physics.md`. Das Labor übernimmt sie, damit es sich nicht vom Fahrpfad unterscheidet. Das Preset heißt jetzt „FTMS Request Control + Start + Sim 0 %“.
- **Freigabe:** `LabDevice.control: "unrequested" | "granted"` entfällt. `LabControlAuthority` ist `unrequested | running | granted | unusable(reason)`. Folgende Ereignisse machen die Sitzung unbrauchbar: jeder Fehlschlag der Procedure (Frist, verspätete, ungültige oder fehlerhafte Antwort, `notPermitted`, Status `0xFF`/`0x01`, Write-Fehler), Disconnect, Trennen, Schließen und Rohwrites aus dem Explorer auf `0x2AD9`. Danach schreibt das Labor nicht mehr auf den Control Point. Erst ein neuer `connect` erzeugt eine neue Sitzung. Ein zweites Preset während eines laufenden Verfahrens wird ohne Write abgelehnt.
- **Rohwrites bleiben roh.** Der Explorer schreibt weiterhin jede Eingabe unverändert, denn dafür existiert das Labor. Ein Rohwrite auf den FTMS Control Point sperrt nur die Presets dieser Sitzung. Sonst könnte seine späte Antwort eine Preset-Frist erfüllen.
- **Mitschnitt:** Vor einem FTMS-Preset beobachtet die Sniffer-Sitzung `0x2AD9`. Nach einem Fehlschlag entfernt `ControlProcedure` ihren Listener. Späte Indications erscheinen trotzdem weiter im Log.
- **Nicht-FTMS-Presets:** Der Zwift-Play-Handshake wartet auf keine Antwort. Ein generischer Schrittläufer ist dafür unnötig. Das Preset beschreibt nur „beobachten, dann schreiben“ (`observe[]`, `write`). Die Laborkomposition setzt dabei die tatsächlich vorhandene Play-Service-UUID ein. Verschlüsselte Antworten sperren weiterhin über den Recorder.
- **`RIDE_ON`** ist nur noch in `packages/ble/src/zwift-play/handshake.ts` definiert. Play-Session und Preset verwenden diese Konstante.
- `runBlePreset`, `BlePresetStep` und der Präfixvergleich entfallen ersatzlos, ohne V1/V2-Fassade. Alle Aufrufer wurden gleichzeitig umgestellt.

## Abnahmekriterien

- [x] AK1: Kein Labormodul schreibt Preset-Bytes auf `0x2AD9` außer über `ControlProcedure`. `runBlePreset` und der Präfixvergleich existieren nicht mehr.
- [x] AK2: Glückspfad: Request Control + Start + Sim 0 % erzeugt `00`, `07`, `11 00 00 00 00 28 33`, Sim 5 % danach `11 00 00 f4 01 28 33`. Der Mitschnitt enthält alle vier tx-Zeilen und die vier ACKs.
- [x] AK3: Sim 5 % vor einer erfolgreichen Freigabe wird ohne Write abgelehnt.
- [x] AK4: Fehlt das ACK, wird 3 s gewartet. Danach erzeugen erneute Klicks auf Sim 5 % oder Request Control keine weiteren Control-Point-Writes. Der Log zeichnet tx und das späte rx weiter auf.
- [x] AK5: Ein verspätetes `80 11 01` bestätigt keine neue Wartezeit. Ein ACK nach der Frist schlägt fehl. ACKs anderer Opcodes erfüllen keine Wartezeit.
- [x] AK6: Disconnect und Rohwrite auf `0x2AD9` heben die Freigabe auf. Ein Rohwrite auf eine andere Characteristic tut das nicht. Nach Reconnect ist erneut zuerst Request Control nötig.
- [x] AK7: `RIDE_ON` ist einmal definiert. Play-Handshake-Preset und Play-Session senden dieselben Bytes.
- [x] AK8: Replay-E2E bedient beide FTMS-Presets und den Play-Handshake, Multi-Device-Regressionen bleiben grün.

## Testplan (`docs/10-testing.md`)

| AK            | Ebene                       | Datei / Fixture                                                           |
| ------------- | --------------------------- | ------------------------------------------------------------------------- |
| AK1, AK3, AK5 | Unit (Fake-Transport)       | `packages/ble/src/ftms/labControl.test.ts`                                |
| AK2, AK4, AK6 | Unit (Laborgerät + Sniffer) | `apps/web/src/debug/ble/presets.test.ts`                                  |
| AK7           | Unit                        | `labControl.test.ts`, `packages/ble/src/zwift-play/adapter.test.ts`       |
| AK8           | DOM + Playwright-Replay     | `apps/web/src/debug/ble/main.test.ts`, `apps/web/e2e/ble-sniffer.test.ts` |

Die synthetische Sniffer-Replay-Datei `packages/ble/src/testdata/sniffer.ts` enthält zusätzlich `80 07 01`. Sie ist keine geschützte Hardware-Fixture unter `fixtures/`.

## Nicht-Ziele

Keine Änderung an `controlProcedure.ts`, `controlSession.ts`, `control.ts`, `adapter.ts` oder `fakeTrainer`. Diese Dateien gehören zur parallelen Arbeit am Fahrtiming. Keine Änderung an Rohwrites, Fahrpfad, Engine oder Rules. Weitere Presets wie Sim 10 % oder Stop `08 01` gehören nicht zu dieser Spec.

## Offene Fragen / Risiken

- **An echter Hardware getestet: nein. Softwaregeprüft, Hardwareabnahme offen.** Nicht geprüft sind Firmwareverhalten bei `07` nach `00` am KICKR CORE, späte ACKs über Funk und das Widerstandsgefühl.
- Nach einem fehlgeschlagenen Preset bleibt die GATT-Verbindung offen, nur die Presets sind gesperrt. Neu verbinden heißt im Labor „Erneut verbinden“. Ein automatisches Trennen ist nicht vorgesehen.
- Ein Rohwrite auf `0x2AD9` sperrt die Presets auch dann, wenn er kein Steuerkommando enthält. Diese Einschränkung ist beabsichtigt.

## Doku-Updates (Pflicht beim Abschluss)

- [x] Roadmap-Checkbox: keine neue; Hardware-Checkboxen bleiben offen · [x] `docs/02-bluetooth.md` §5 (Presetname, Softwarestand) · [x] ADR: nicht nötig, keine neue Abhängigkeit und keine Leitplankenänderung
