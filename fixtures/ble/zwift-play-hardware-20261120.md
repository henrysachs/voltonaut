# Zwift Play, Hardwaremitschnitte vom 20.11.2026

Echte, von Henry im BLE-Labor aufgezeichnete Geräteantworten. Keine synthetischen Hardware-Fixtures. Beide Originale bleiben unverändert außerhalb des Repositories. Neue Fixture-Dateien sind ausdrücklich freigegebene Ergänzungen; vorhandene Fixtures bleiben unverändert.

| Griff | Originaldatei | SHA-256 des Originals |
| --- | --- | --- |
| rechts | `ble-2026-11-20T16-54-57.901Z.json` | `7b54166efab49a02af8b937197b95fe454a224af317bf84f6ff8bd77520f8adc` |
| links | `ble-2026-11-20T17-05-04.565Z.json` | `a2f68e9c0cafb2936ee7110eb3cbe6ba2ccc1d3dd30d11a53e4d196e66df4253` |

## Anonymisierung

Ausschließlich `meta.deviceId` wurde durch `hardware-play-right-20261120` beziehungsweise `hardware-play-left-20261120` ersetzt. Ausschließlich `meta.ua` wurde durch `anonymized hardware capture browser` ersetzt. Alle anderen JSON-Werte, insbesondere GATT-Properties, Bytes, Zeitstempel, Marker, Gerätebezeichnung und leeres Firmwarefeld, bleiben identisch. Keine Kürzung oder Zeitverschiebung. JSON-Einrückung ist keine Protokolländerung.

`scripts/import-play-captures.mjs <Originalverzeichnis>` prüft die Original-Hashes und erzeugt neue Dateien ohne Überschreiben. Der Adapter-Replay-Test injiziert lediglich eine versetzte Uhr; die gespeicherten Zeiten bleiben erhalten.

Anonymisierte Dateien:

- `zwift-play-right-hardware-20261120.json`: SHA-256 `124bd07844248d7f7a8d75f6a638d6b9c411c0f2015d7e581638450541e3f510`, 1.071 Logeinträge, 465 `0x07`-Frames.
- `zwift-play-left-hardware-20261120.json`: SHA-256 `88ab87809277f96bf7c37cb1485c5ea7d7a5360d18ab305bea7bc49315d11b39`, 272 Logeinträge, 182 `0x07`-Frames.

## Belegte Fakten und Grenzen

Beide Griffe verwenden Service `00000001-19ca-4651-86e5-fa29dcdd09d1`, Notify `…02`, WriteWithoutResponse `…03`, Read/Indicate `…04`. Beide antworten mit genau sechs `RideOn`-Bytes. Seitenfeld `1`: rechts `0`, links `1`. Digitale Felder `2–6`: rechts Y/Z/A/B/Seitentaste, links hoch/links/rechts/runter/Seitentaste. `0` bedeutet gedrückt, `1` losgelassen. Markierte Drück-/Loslassvorgänge sind vollständig vorhanden.

Feld `7` ist nicht physisch vermessen und bekommt keine Spielaktion. Felder `8/9` werden als rohe Zigzag-Werte gelesen. Rechts erreicht Kanal 8 −100 bis +100; Kanal 9 bleibt null. Links bleiben beide null. Physische Richtung, Kalibrierung, Winkel, Lenk- oder Bremswirkung und Firmware bleiben unbekannt. `…06`, `0x15` und `0x19` bekommen keine erfundene Bedeutung.

Parser und Lifecycle wurden eigenständig in TypeScript implementiert. Das öffentlich dokumentierte SwiftControl-Schema dient ausschließlich als Faktenreferenz. Kein GPL-Code, keine kopierte Schema-Datei, kein Protobuf-Paket. Referenz: <https://github.com/jonasbark/swiftcontrol/blob/f7bfd8c2/lib/bluetooth/protocol/zwift.proto#L6-L24>.
