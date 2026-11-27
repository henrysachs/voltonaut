# ADR-034 – Hardware-Mitschnitte als BLE-Fixtures

**Status:** Angenommen (Henrys Freigabe im Chat am 2026-11-27).

## Kontext

`fixtures/**` ist geschützt: `scripts/guard` lässt Änderungen nur mit einem ADR im selben Diff zu. Das verhindert, dass Testdaten angepasst werden, um rote Tests grün zu machen. Echte Hardware-Mitschnitte aus dem BLE-Labor sind aber der einzige Beleg für Protokollverhalten, das Fremdquellen nur behaupten (`AGENTS.md` §3.7, `docs/10-testing.md` §2). Die Play-Mitschnitte vom 20.11.2026 kamen über einen Integrations-PR mit ADR ins Repo. Für Hub One und Click v2 (27.11.2026) fehlte eine stehende Regel, wann und wie ein neuer Mitschnitt aufgenommen wird.

## Entscheidung

Ein neuer Hardware-Mitschnitt darf als **neue** Datei unter `fixtures/ble/` aufgenommen werden, wenn alle Punkte gelten:

- **Echt:** Export des BLE-Labors von realer Hardware, keine synthetischen oder nachbearbeiteten Bytes. Synthetische Daten gehören in `packages/*/src/testdata/`.
- **Freigabe:** Henry gibt jede Aufnahme ausdrücklich frei.
- **Minimal anonymisiert:** Nur `meta.deviceId` (stabile Kennung `hardware-<gerät>-<datum>`) und `meta.ua` (`anonymized hardware capture browser`) werden ersetzt. GATT, Bytes, Zeitstempel, Marker, Gerätename, Firmware und Notizen bleiben unverändert, keine Kürzung oder Zeitverschiebung.
- **Nachvollziehbar:** Ein Import-Skript unter `scripts/` prüft den SHA-256 des Originals und schreibt ohne Überschreiben. Eine Herkunftsnotiz `fixtures/ble/<geräte>-hardware-<datum>.md` nennt Originaldatei, Original- und Fixture-Hash, belegte Fakten und Grenzen.
- **Unveränderlich:** Vorhandene Mitschnitte werden nie geändert oder gelöscht. Ein neuer Befund ist ein neuer Mitschnitt.
- **Genutzt:** Mindestens ein Replay-Test treibt den Mitschnitt durch den produktiven Parser oder Adapter.

Jeder PR, der so einen Mitschnitt aufnimmt, verweist auf dieses ADR und enthält es im Diff, solange der Guard das verlangt. Die Guard-Regel selbst bleibt unverändert.

## Konsequenzen

- Hardwarebefunde werden zu Regressionstests, ohne die Fixture-Sperre aufzuweichen.
- Ein Mitschnitt belegt Protokollantworten, keine physische Wirkung. Spürbarer Widerstand und Fahrgefühl bleiben eine getrennte Hardwareabnahme (`AGENTS.md` §9).
- Mitschnitte von Geräten Dritter (hier ein Bekannter) enthalten nach der Anonymisierung keine personenbezogenen Daten; Gerätename und Firmware sind Produktangaben.

## Alternativen

- **Guard-Ausnahme für `fixtures/ble/`:** verworfen. Das lockert eine Leitplanke (`AGENTS.md` §0.2).
- **Bytes von Hand in Tests übertragen:** verworfen. Verliert Zeitverlauf, GATT und Marker und ist kein Beleg mehr für echtes Geräteverhalten.
- **Ein ADR pro Mitschnitt:** verworfen. Die Regeln sind jedes Mal dieselben.
