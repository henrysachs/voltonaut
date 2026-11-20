# Spec E1-04 – Mehrere Geräte im BLE-Labor

- **Ziel:** Trainer und zwei gleichnamige Play-Griffe gleichzeitig anzeigen, getrennt bedienen und ohne Ansichtsbindung mitschneiden.
- **Roadmap:** E1, Diagnosewerkzeug `debug/ble.html`. Keine Hardware-Abnahme der Etappe.
- **Status:** Fokussiert geprüft. Integration, vollständiges Gate und unabhängiges Review stehen aus. An echter Hardware getestet: nein.
- **Module:** `apps/web/debug/ble.html`, `src/debug/ble/`, neue Browserprüfung.

## Architekturentscheidung

Zwei Formen wurden verglichen. Ein App-Modell könnte Sitzungen, Auswahl, Formulare und Explorer gemeinsam besitzen. Eine Geräteregistry kann dagegen den bestehenden Sitzungsbesitz von Capture und Abonnements erhalten.

Gewählt ist die Geräteregistry. Jeder Eintrag besitzt eine Sitzung, Verbindungszustand, GATT-Profil, Firmware, Notizen und eine eigene Befehlswarteschlange. Die Ansicht besitzt nur die Auswahl. Eine langsame Operation auf A blockiert B nicht. GATT-Operationen desselben Geräts bleiben serialisiert. Diagnose-Presets bleiben ausdrücklich ausgelöste Aktionen.

Die native Auswahl startet synchron im Klick. Die Composition prüft die gewählte Browser-Geräte-ID vor dem Erzeugen eines weiteren Transports. Eine erneute Auswahl desselben Geräts wählt den vorhandenen Eintrag. Sie verbindet oder trennt dessen Funkverbindung nicht erneut. Browser-Handles sind Grenzmetadaten, keine im UI dekodierten BLE-Bytes.

## Abnahmekriterien

- [x] „Gerät hinzufügen“ und eine dauerhafte Geräteliste zeigen mindestens drei Verbindungen gleichzeitig.
- [x] Nummer und Geräte-ID unterscheiden auch gleichnamige Griffe. Jede Karte zeigt ihren eigenen Zustand und die Auswahl.
- [x] Hinzufügen, Auswählen und gezieltes Trennen erhalten die anderen Verbindungen und deren Mitschnitte.
- [x] Fehler, wartende Befehle, Marker und Exporte bleiben beim Gerät des Klicks. Späte Verbindungsabschlüsse wechseln nicht die Auswahl.
- [x] Firmware und Notizen bleiben je Gerät getrennt. Export verwendet das bestehende Fixture-Schema.
- [x] Erneute native Auswahl erzeugt weder einen zweiten GATT-Connect noch einen Disconnect, eine zweite Karte oder Capture-Verlust.
- [x] Ausstehender Read auf A blockiert Aktionen auf B nicht. Subscribe-Status bleibt nach Ansichtswechsel korrekt.
- [x] Verbindung erzeugt keine Writes und startet kein Preset. Verschlüsselungssperre und vorhandene Diagnosefunktionen bleiben erhalten.
- [x] Neue Browserprüfung verwendet drei native GATT-Fakes, zeigt drei Ready-Karten und exportiert drei schema-valide Mitschnitte.

## Testplan

Zuerst UI-Regressionen mit den bestehenden DOM- und nativen GATT-Fakes ausführen. Neue Assertions sollen den falschen Ansichtsstatus und die globale Warteschlange reproduzieren. Fehlende neue Karten sind ein UI-Defizit, kein Nachweis echter Funkabbrüche.

Danach fokussierte Vitest-Prüfung, Typecheck, Lint und Browserprüfung auf isoliertem Port 5195 mit temporärer Konfiguration und Cache. Browserbelege und Runner bleiben außerhalb des Repositories. Das vollständige Gate und unabhängige Review führt die integrierende Session aus. Live-Port 5173 und echte Bluetooth-Geräte bleiben unberührt.

Die drei zuerst geschriebenen UI-Regressionen schlugen vor der Änderung fehl. Nach Rückkehr zu A blieb der Status von B sichtbar. Ein ausstehender Read auf A blockierte den Marker auf B. Firmware und Notizen von A erschienen auf B. Nach der Änderung bestehen dieselben Assertions.

`ble-sniffer-multidevice.spec.ts` prüft zusätzlich fünf Browserflüsse. Dazu gehören die native Doppelauswahl ohne zweiten GATT-Zugriff, drei getrennte Exporte, ein gezielter Disconnect, Fehler während Hintergrundaufnahme und ein verspäteter Verbindungsabschluss. Die Picker-Fakes lehnen Aufrufe außerhalb des synchronen Klicks ab.

## Offene Hardware-Abnahme

Henry prüft den gleichzeitigen Betrieb seiner drei Geräte nach separater Freigabe. Automatisierte Fakes beweisen weder die Anzahl möglicher Funkverbindungen noch die Firmwareeigenschaften. Vorhandene Hardware-Captures bleiben unverändert.
