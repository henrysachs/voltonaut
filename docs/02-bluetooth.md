# 02 – Bluetooth

Legende: ✅ = Standard/Spezifikation, in mehreren Quellen bestätigt · ⚠️ **UNVERIFIZIERT** = aus öffentlichem Reverse Engineering, an Henrys Hardware noch nicht getestet · ❓ = unbekannt.

## 1. Web-Bluetooth-Rahmenbedingungen ✅

- Nur Chrome/Edge (Desktop). Secure context nötig: `https://` (Cloudflare Pages) oder `http://localhost`. LAN-IP über HTTP geht **nicht**.
- `navigator.bluetooth.requestDevice()` braucht eine Nutzergeste (Klick) und zeigt einen Auswahldialog. **Alle** Services, auf die später zugegriffen wird, müssen in `filters[].services` oder `optionalServices` stehen – sonst `SecurityError`.
- Wiederverbinden ohne Dialog: `navigator.bluetooth.getDevices()` + `device.watchAdvertisements()`. In Chrome ggf. hinter `chrome://flags/#enable-web-bluetooth-new-permissions-backend` – ❓ Stand für Henrys Chrome-Version prüfen.
- Linux-Chrome braucht teils `chrome://flags/#enable-experimental-web-platform-features`. ❓ Henrys Laptop-OS.
- Jedes Gerät hat eine eigene GATT-Verbindung; Chrome serialisiert GATT-Operationen pro Gerät nicht für uns → eigene Write-Queue pro Adapter.
- Nur **ein** Central darf den Trainer sinnvoll steuern: Zwift-App, Wahoo-App, Garmin etc. vorher schließen/trennen.

## 2. Trainer: Wahoo KICKR CORE über FTMS ✅

Laut DC Rainmaker unterstützt der KICKR CORE (Zwift-Cog-Version) BLE FTMS, BLE Cycling Power, ANT+ FE-C und ANT+ Power; **Steuerung durch beliebige Apps ist möglich**, nur das Schalten war bisher an Zwift gebunden, weil die Controller nur mit Zwift reden. Genau diese Lücke schließen wir (ADR-001). Das Open-Source-Projekt _RideControl_ meldet „getestet mit Wahoo KICKR Core 2 und Zwift Cog" per Web Bluetooth + FTMS.

### Service und Characteristics (Bluetooth SIG Assigned Numbers)

| Name                             | UUID     | Eigenschaft      | Nutzung                                                                           |
| -------------------------------- | -------- | ---------------- | --------------------------------------------------------------------------------- |
| Fitness Machine Service          | `0x1826` | –                | Filter für requestDevice                                                          |
| Fitness Machine Feature          | `0x2ACC` | read             | Fähigkeiten prüfen (Bit 13 Target Settings = Sim-Parameter, Bit 3 = Power-Target) |
| Indoor Bike Data                 | `0x2AD2` | notify           | Watt, Kadenz, Speed (≈ 1–4 Hz)                                                    |
| Training Status                  | `0x2AD3` | notify/read      | optional                                                                          |
| Supported Resistance Level Range | `0x2AD6` | read             | optional                                                                          |
| Supported Power Range            | `0x2AD8` | read             | ERG-Clamp                                                                         |
| Fitness Machine Control Point    | `0x2AD9` | write + indicate | Kommandos                                                                         |
| Fitness Machine Status           | `0x2ADA` | notify           | u. a. `0xFF` = Control Permission Lost                                            |

Hinweis: `0x2AD3` ist Training Status, **nicht** Indoor Bike Data (häufiger Fehler in Doku/Issues).

### Indoor Bike Data `0x2AD2` parsen

- Byte 0–1: Flags (uint16 LE). Danach Felder in fester Reihenfolge, nur vorhanden, wenn ihr Flag es sagt.
- **Bit 0 „More Data" ist invertiert:** Instantaneous Speed (uint16, 0,01 km/h) ist vorhanden, wenn Bit 0 = **0**.
- Bit 1 Average Speed (uint16) · Bit 2 Instantaneous Cadence (uint16, **0,5 rpm**) · Bit 3 Average Cadence (uint16) · Bit 4 Total Distance (**uint24**, m) · Bit 5 Resistance Level (sint16) · Bit 6 Instantaneous Power (sint16, W) · Bit 7 Average Power (sint16) · Bit 8 Expended Energy (uint16 + uint16 + uint8 = 5 Bytes) · Bit 9 HR (uint8) · Bit 10 MET (uint8) · Bit 11 Elapsed Time (uint16) · Bit 12 Remaining Time (uint16).
- Parser als reine Funktion `parseIndoorBikeData(DataView): Partial<TrainerData>` mit Byte-Fixtures testen.

### Control Point `0x2AD9`

Ablauf (Pflicht): **erst** Indications auf `0x2AD9` aktivieren, **dann** schreiben; jede Prozedur wartet auf ihre Response-Indication (`0x80, reqOpCode, result`), bevor die nächste geschrieben wird (sonst ATT-Fehler „Procedure Already In Progress").

| Op-Code | Name                                      | Parameter (LE)                                                                                                        |
| ------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `0x00`  | Request Control                           | – (einmal nach Verbindung)                                                                                            |
| `0x01`  | Reset                                     | – (**entzieht uns die Kontrolle** → danach erneut `0x00`)                                                             |
| `0x04`  | Set Target Resistance Level               | uint8, 0,1                                                                                                            |
| `0x05`  | Set Target Power (ERG)                    | sint16, 1 W                                                                                                           |
| `0x07`  | Start/Resume                              | –                                                                                                                     |
| `0x08`  | Stop/Pause                                | uint8 (1 = stop, 2 = pause)                                                                                           |
| `0x11`  | **Set Indoor Bike Simulation Parameters** | wind sint16 @0,001 m/s · grade sint16 @0,01 % · Crr uint8 @0,0001 · Cw uint8 @0,01 kg/m                               |
| `0x12`  | Set Wheel Circumference                   | uint16 @0,1 mm                                                                                                        |
| `0x80`  | Response Code                             | reqOpCode, result: `0x01` ok, `0x02` not supported, `0x03` invalid param, `0x04` failed, `0x05` control not permitted |

Beispiel `0x11`: 4,5 % Steigung, Crr 0,0040, Cw 0,51 → `11 00 00 C2 01 28 33`. Crr max 0,0255, Cw max 2,55 – **clampen, nicht überlaufen lassen**.

### Verhalten KICKR CORE + Zwift Cog bei FTMS ⚠️

- Wahoo selbst schreibt, dass virtuelles Schalten mit Zwift-Controllern „in anderen Apps derzeit nicht verfügbar" ist – gemeint ist das **native** (trainerseitige) Schalten über Zwifts Protokoll. Unser Weg (Gänge in der App, Widerstand per FTMS) wird davon nicht berührt; Projekte wie BikeControl, Virtual Gears und RideControl machen es genauso. ⚠️ An Henrys Gerät verifizieren.
- ❓ Ob der Trainer nach einer Zwift-Sitzung in einem „virtual shift"-Zustand bleibt, der FTMS-Sim beeinflusst. Testfall in E1: Zwift beenden, Trainer stromlos machen, dann nur Voltonaut verbinden.
- ❓ Welches Modell genau (KICKR CORE „Zwift One" 2024 vs. KICKR CORE 2) und Firmware-Stand (Wahoo-App) – Wahoo nennt für virtuelles Schalten CORE 1 ≥ 1.3.17, CORE 2 ≥ 2.2.44/3.2.44.
- ❓ Trainer-interne Annahme für Fahrergewicht im Sim-Modus (FTMS überträgt kein Gewicht). Beeinflusst, wie stark Steigung sich anfühlt → Kalibrierung in E2 (`03-engine-physics.md` §4).
- ❓ Max. simulierte Steigung (DC Rainmaker: 16 %) und Mindestfluss-/Bremsgrenzen bei niedriger Kadenz.
- Der Trainer kann zusätzlich einen proprietären Zwift-Service anbieten (Zwift-Hub-artiges Protokoll mit Gangübersetzung direkt im Trainer). **Bewusst nicht genutzt** (ADR-001); im Sniffer nur dokumentieren, ob er auftaucht.

### Fallback: Cycling Power Service `0x1818` ✅

Nur lesen (Watt `0x2A63` Cycling Power Measurement, Kadenz aus Crank-Revolution-Daten), kein Steuern. E1 verwendet CPS, wenn FTMS-Service oder Indoor Bike Data fehlen. Die Fahrt läuft ohne Trainer-Steuerung. Physischer Widerstand und virtuelle Gänge werden erst in E2 gekoppelt.

Feldreihenfolge von `0x2A63`: Flags (uint16 LE), **Instantaneous Power (sint16 LE) direkt an Byte 2–3**, danach optionale Felder. Pedal Power Balance (Bit 0) und Accumulated Torque (Bit 2) stehen nach Power, nicht davor. Wheel Revolution Data (Bit 4) belegt sechs Bytes. Crank Revolution Data (Bit 5) belegt vier Bytes; die Event-Zeit hat die Einheit 1/1024 s. Kadenz entsteht aus den Differenzen zweier Frames, einschließlich uint16-Überlauf.

Softwarestand E1-02: Der Picker akzeptiert FTMS **oder** CPS. Fehlende Steuerrechte allein lösen keinen Wechsel aus. Die Fahrt fordert keine Steuerrechte an und schreibt nicht auf den Control Point. Virtuelle Gänge bleiben per Tastatur bedienbar, ohne Aussage über physischen Widerstand.

FTMS-Kadenz wird bei gesetztem Bit 2 gelesen (GSS v9 §3.124). Der Widerspruch zur invertierten Darstellung in FTMS v1.0 Tabelle 4.10 bleibt bis zur Hardware-Fixture als unverifiziert markiert. Synthetische Parser-/Replay-Tests sind kein Hardware-Befund.

## 3. Pulsgurt: Heart Rate Service ✅

- Service `0x180D`, Heart Rate Measurement `0x2A37` (notify).
- Byte 0 Flags: Bit 0 → HR uint16 statt uint8; Bit 1–2 Sensor Contact; Bit 3 Energy Expended (uint16) vorhanden; Bit 4 RR-Intervalle (uint16, **1/1024 s**) folgen.
- Battery Service `0x180F` / `0x2A19` optional.

## 4. Zwift Play Controller (Henrys Hardware) ⚠️ UNVERIFIZIERT

Henry besitzt **Zwift Play** (zwei Griffe, links + rechts), nicht Click. Alles in diesem Abschnitt stammt aus öffentlichem Reverse Engineering (Quellen unten) und ist an Henrys Geräten **nicht** getestet. Click/Ride bleiben als Nebenpfad dokumentiert, weil die Protokolle eng verwandt sind.

### Tasten (laut Zwift-Support / Doku-Zusammenstellungen)

- Links: Steuerkreuz, analoges Paddel (ZL, orange), Seitentaste **LS**.
- Rechts: A, B, Y, Z, analoges Paddel (ZR), Seitentaste **RS**.
- Schalten (Zwift/Rouvy-Konvention): **LS = runter, RS = hoch** („Plus/Minus"); Paddel werden fürs Schalten nicht gebraucht.
- Haptik: beide Griffe können vibrieren → Schaltbestätigung möglich (Kommando `0x12…`, siehe unten).

### Firmware-Weiche: 1.x vs. 2.0.1 (wichtig!)

|                                                                                                                                                                                                             | Firmware ≤ 1.3.1                            | Firmware 2.0.1 (Mai 2026, Rollout zeitweise pausiert)                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Verbindungen                                                                                                                                                                                                | **2** (linker und rechter Griff getrennt)   | **1** (Griffe verlinken sich, eine Verbindung)                                                           |
| Device-Typ im Advertising                                                                                                                                                                                   | 3 = links, 2 = rechts                       | ❓ vermutlich ein Eintrag für das Paar                                                                   |
| Nachrichtenformat                                                                                                                                                                                           | `0x07` `PlayKeyPadStatus` (Protobuf, s. u.) | ❓ nicht dokumentiert; wahrscheinlich `0x23`-Bitmap wie Ride/Click v2 („in line with Click v2 and Ride") |
| Rouvy verlangt 2.0.1. **Erster Schritt der Hardware-Session: Firmware-Version in Zwift Companion ablesen** (H4). Der Decoder muss beide Varianten können; welche aktiv ist, entscheidet der Sniffer-Befund. |

### Erkennung

| Merkmal                                     | Wert                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Manufacturer ID (Advertising)               | `0x094A` (= 2378, Zwift Inc.)                                                           |
| Device-Typ (1. Byte nach Mfr-ID)            | 1 Zwift Hub · **2 Play rechts · 3 Play links** · 7 Ride rechts · 8 Ride links · 9 Click |
| Name                                        | „Zwift Play" (beide Griffe gleich → Seite nur über Device-Typ)                          |
| Service (ältere Firmware)                   | `00000001-19ca-4651-86e5-fa29dcdd09d1`                                                  |
| Service (neuere Firmware / Ride / Click v2) | `0000fc82-0000-1000-8000-00805f9b34fb`                                                  |

`requestDevice`-Filter: `{ manufacturerData: [{ companyIdentifier: 0x094A }] }` plus Namens-Präfix `"Zwift"`; **beide** Service-UUIDs in `optionalServices`, plus `0x180F` (Battery) und `0x180A` (Device Info). Bei FW 1.x zweimal koppeln (zwei Dialoge, „Linken Griff verbinden" / „Rechten Griff verbinden").

### Characteristics (gleiche UUIDs in beiden Service-Varianten)

| Rolle                      | UUID                                   | Eigenschaft                            | Alias in Quellcode |
| -------------------------- | -------------------------------------- | -------------------------------------- | ------------------ |
| Measurement / Async        | `00000002-19ca-4651-86e5-fa29dcdd09d1` | notify                                 | Tastendaten        |
| Control Point / Sync RX    | `00000003-19ca-4651-86e5-fa29dcdd09d1` | write (SwiftControl: without response) | Handshake, Haptik  |
| Command Response / Sync TX | `00000004-19ca-4651-86e5-fa29dcdd09d1` | indicate/read                          | Handshake-Antwort  |

### Handshake

- **Klartext (bevorzugt):** `startNotifications` auf 0x…02 und 0x…04, dann nur die 6 Bytes `"RideOn"` (`52 69 64 65 4F 6E`) auf 0x…03. Play antwortet laut BikeControl/MarcelCode `RideOn 01 04`, danach kommen **unverschlüsselte** Frames auf 0x…02. BikeControl schreibt, Play habe „kein verschlüsseltes Handshake, keine Firmware-Einschränkungen". Wahrscheinlich real, aber aus Quellcode abgeleitet.
- **Verschlüsselt (Makinolo 2023, ajchellew-Mitschnitt):** `"RideOn" + 01 02 + 64-Byte-P-256-Public-Key` (X‖Y ohne `0x04`). Antwort `"RideOn" + 2 Versionsbytes + Geräte-Key` (gesehen: `00 09`, `01 03`, `01 01`). Danach ECDH (secp256r1) → HKDF-SHA256 (salt = deviceKey‖appKey, 36 Bytes: 32 AES-256-Key + 4 Nonce-Präfix) → AES-CCM, 4-Byte-MIC, Frame `[4-Byte-Counter][Ciphertext][MIC]`. **Plan:** nicht implementieren, solange der Klartext-Pfad funktioniert. WebCrypto kann ECDH/HKDF, aber **kein AES-CCM** → bräuchte JS-Lib.
- Die 2 Versionsbytes nach „RideOn" werden ignoriert.

### Nachrichtenformat (erstes Byte = Typ, Rest = Protobuf)

| Typ                      | Bedeutung                                                                        |
| ------------------------ | -------------------------------------------------------------------------------- |
| `0x07`                   | **Play-Tastenstatus** (FW 1.x) – Hauptpfad für Henry                             |
| `0x23` (35)              | Ride / Click v2 (und vermutlich Play FW 2.0.1): 32-Bit-Bitmap, inverse Logik     |
| `0x37` (55)              | Click v1 (Plus/Minus)                                                            |
| `0x15` (21), `0x19` (25) | Idle/Heartbeat bzw. Batterie (Zuordnung in Quellen uneinheitlich)                |
| `0x12…`                  | an 0x…03 geschrieben: Haptik (`12 12 08 0A 06 08 02 10 00 18` laut SwiftControl) |
| `0xFE`                   | Disconnect (laut SwiftControl)                                                   |

`PlayKeyPadStatus` (aus SwiftControl `zwift.proto`), Enum `ON = 0` = gedrückt, `OFF = 1`:

```proto
message PlayKeyPadStatus {
  optional PlayButtonStatus RightPad = 1;       // welcher Griff sendet (ON=rechts? → verifizieren)
  optional PlayButtonStatus Button_Y_Up = 2;    // rechts: Y  | links: Steuerkreuz hoch
  optional PlayButtonStatus Button_Z_Left = 3;  // rechts: Z  | links: links
  optional PlayButtonStatus Button_A_Right = 4; // rechts: A  | links: rechts
  optional PlayButtonStatus Button_B_Down = 5;  // rechts: B  | links: runter
  optional PlayButtonStatus Button_Shift = 6;   // Seitentaste LS/RS → SCHALTEN
  optional PlayButtonStatus Button_On = 7;
  optional sint32 Analog_LR = 8;                // Paddel
  optional sint32 Analog_UD = 9;
}
```

Mapping-Hypothese: `RightPad` + `Button_Shift` gedrückt → `shiftUp`; linker Griff + `Button_Shift` → `shiftDown`. ⚠️ Polarität von `RightPad` und ob die Seitentaste wirklich Feld 6 ist, im Sniffer prüfen.

`0x23`-Bitmap (falls FW 2.0.1), Belegung laut MarcelCode/JustFabi: `0x1` links · `0x2` hoch · `0x4` rechts · `0x8` runter · `0x10` A · `0x20` B · `0x40` Y · `0x80` Z · `0x100`/`0x200` Shifter L · `0x400` Power-up L · `0x800` On/Off L · `0x1000`/`0x2000` Shifter R · `0x4000` Power-up R · `0x8000` On/Off R. **Achtung:** ajchellew/ein Web-Bluetooth-Gist nennen eine abweichende Belegung (Z `0x100`, Shift-up L `0x200`, Shift-down L `0x400`, …, Shift-up R `0x2000`, Shift-down R `0x4000`). Quellen widersprechen sich → nur Sniffer entscheidet.

### Decoder-Design

```ts
interface ControllerProtocol {
  match(adv: {
    name?: string;
    manufacturerData?: Map<number, DataView>;
    services: string[];
  }): boolean;
  handshake(io: GattIO): Promise<void>; // "RideOn" (Klartext)
  decode(msg: DataView): RawButtonState | null; // 0x07-Protobuf oder 0x23-Bitmap → Set<rawButtonId>
}
type ButtonMap = Record<string /* z. B. "play:right:shift" | "bit:0x1000" */, ControllerButton>;
// Adapter emittiert controller.button nur bei Flanken; Dedupe 30 ms (bei verlinkten Griffen evtl. doppelte Meldungen).
```

Minimaler Protobuf-Decoder (Varint + Wire-Type 0) selbst schreiben statt Protobuf-Lib (Bundle-Größe; Felder sind nur Varints). ButtonMap liegt als JSON in `devices/zwift-controller/maps/*.json` und ist per Sniffer-Export überschreibbar.

### BLE-Budget

FW 1.x: Trainer + Puls + 2 Play-Griffe = **4 gleichzeitige Verbindungen** über den Laptop-Adapter (H7). Fallback: Play-Update auf 2.0.1 (1 Verbindung), USB-BLE-Dongle, oder Tastatur.

## 5. Reverse-Engineering-Plan (Termin: wenn Netzkabel da ist)

### Sniffer-/Debug-Seite `debug/ble.html` (Etappe E1)

Funktion:

1. **Scan & Connect:** Button „Gerät wählen" mit breiten Filtern (`acceptAllDevices: true` + lange `optionalServices`-Liste: `0x1826, 0x1818, 0x180D, 0x180F, 0x180A, 0x1816, 00000001-19ca-…, 0000fc82-…`). Zeigt Name, ID, Advertising-Daten (via `watchAdvertisements`: RSSI, manufacturerData hex, serviceData).
2. **GATT-Explorer:** listet alle Primary Services → Characteristics mit Properties (read/write/writeWithoutResponse/notify/indicate) und Descriptors. Button pro Characteristic: Read, Subscribe, Write (Hex- oder ASCII-Eingabe).
3. **Logger:** jede Notification/Indication/Read/Write als Zeile `{tMs (performance.now), device, service, char, dir: 'rx'|'tx', hex, ascii, decoded?}`; Filter und Pausieren; Marker-Button („Jetzt drücke ich: rechts hoch") schreibt eine Annotation in den Log.
4. **Presets:** „Zwift-Controller-Handshake" (subscribe 02+04, write „RideOn"), „FTMS Request Control + Sim 0 %", „FTMS Sim 5 %".
5. **Live-Decoder:** wenn bekannter Parser vorhanden (FTMS, HRS, Zwift 0x23/0x37/0x07), dekodierte Werte daneben anzeigen; Bitmap als 32 Kästchen, die beim Drücken rot werden.
6. **Export:** JSON-Download `{ meta: {ua, date, deviceName, firmware?}, gatt: [...], log: [...] }` → wird als Fixture unter `fixtures/ble/` eingecheckt.

### Mapping-Prozedur (Henry + Agent)

1. Zwift/Companion-App schließen, Controller aufwecken (Taste drücken, LED blinkt).
2. Firmware der Play-Griffe in Zwift Companion notieren. Sniffer: verbinden, GATT-Explorer-Export speichern (welcher Service: `00000001-…` oder `fc82`?). Device Info lesen (Firmware `0x2A26`).
3. Preset Handshake. Erwartung: „RideOn" auf 0x…04. Wenn stattdessen Antwort mit 64 Byte → verschlüsselt → Stop, open-questions aktualisieren.
4. 10 s nichts drücken (Idle-Nachrichten notieren). Dann jede Taste **einzeln** je 3× drücken, vorher Marker setzen. Reihenfolge: RS (rechte Seitentaste), LS (linke Seitentaste), dann alle übrigen Tasten und beide Paddel langsam durchziehen. Bei FW 1.x beide Griffe getrennt aufzeichnen.
5. Export → Fixture. Agent schreibt Decoder-Test gegen Fixture, passt `ButtonMap` an, aktualisiert diesen Abschnitt (⚠️ → ✅).
6. Gleiches für Trainer: GATT-Export, Feature-Bits lesen, Request Control, Sim 0 % / 5 % / 10 % je 30 s treten, Log exportieren (Fixture für Parser + Kalibrierung).
7. Pulsgurt: 60 s Log (Fixture).

## Quellen

- Makinolo – Zwift Play Protokoll (Verschlüsselung, Characteristics): https://www.makinolo.com/blog/2023/10/08/connecting-to-zwift-play-controllers/
- Makinolo – Zwift Ride Protokoll (RideOn ohne Verschlüsselung, 0x23-Bitmap, Device-IDs): https://www.makinolo.com/blog/2024/07/26/zwift-ride-protocol/
- SwiftControl (jonasbark) – UUIDs, Message-Typen, `zwift.proto`, Web-Demo: https://github.com/jonasbark/swiftcontrol (u. a. `lib/bluetooth/ble.dart`, `lib/bluetooth/protocol/zwift.proto`, `web/zwift_ride.html`)
- JustFabi/zwiftclickpair – Bitmap-Belegung Click v2: https://github.com/JustFabi/zwiftclickpair
- BikeControl – Zwift Play ohne verschlüsseltes Handshake: https://bikecontrol.app/controller-zwift-play/
- SwiftControl Handshake-Code (Klartext vs. verschlüsselt): https://github.com/jonasbark/swiftcontrol/blob/f7bfd8c2/lib/bluetooth/devices/base_device.dart
- Zwift-Play-Protokoll-Zusammenstellung (IndoorCyclingApp, GPL-3.0 – nur Fakten nutzen, keinen Code übernehmen): https://codefloe.com/SnappTechnology/IndoorCyclingApp/src/branch/main/docs/ZWIFT_PLAY.md
- Zwift Play Firmware 2.0.1 Release Notes (Verlinkung der Griffe): https://forums.zwift.com/t/zwift-play-firmware-release-notes/607977
- Rouvy – Play braucht FW 2.0.1, Plus/Minus schalten: https://support.rouvy.com/hc/en-us/articles/47742964491665-Remote-controllers-and-control-mapping
- ajchellew/zwiftplay – Handshake-Beobachtungen: https://github.com/ajchellew/zwiftplay
- jat255/zwift_click_handling – ECDH/HKDF für alte Click-Firmware: https://github.com/jat255/zwift_click_handling
- RideControl (Web Bluetooth, KICKR Core 2 + Cog, Click v2): https://github.com/RideControlOrg/RideControl
- bikeboi (Browser-Spiel, Click v1, Web Bluetooth Hinweise): https://github.com/hrafnkell/bikeboi
- FTMS Op-Codes/Feld-Layouts (Zusammenfassung mit Spec-Verweisen): https://github.com/openzigs/onyourleft/issues/43 ; FTMS-Spezifikation: https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/
- Wahoo – Virtual Shifting (Firmware, „nicht in anderen Apps"): https://support.wahoofitness.com/hc/en-us/articles/16865097915666-Virtual-shifting-with-Wahoo-smart-trainers
- DC Rainmaker – KICKR CORE Zwift One Review (Protokolle, Kontrolle durch Dritt-Apps): https://www.dcrainmaker.com/2024/02/wahoo-kickr-review.html
