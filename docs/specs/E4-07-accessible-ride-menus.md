# Spec E4-07 – Verständliche Ride-Menüs

- **Auftrag:** Henry verlangt am 24.11.2026 weitere Menüüberarbeitung. Ein Klick außerhalb soll schließen. Das Gerätefenster soll weniger technisch sein.
- **Roadmap-Bezug:** E4, Spiel-HUD und Ingame-Menü aus `04-world-3d.md` §9.
- **Basis:** `c0e300f7e295aa036f2e3892141b43752296d947`.
- **Status:** Implementiert, regulär und unabhängig am tatsächlich gebauten Artefakt softwaregeprüft. Exakte PR-CI, Merge und Bereitstellung stehen aus.
- **Betroffene Module:** `apps/web/index.html`, `src/ui/{gameMenu,connect}`, `src/rideDevices.ts`, `src/styles.css`, Browser- und DOM-Prüfungen.

## Ziel und gewählte Form

Fahrtmenü und Gerätefenster lassen sich mit Klick oder Tap außerhalb schließen. Ein Klick im Fenster schließt nicht. Fahrt, Aufnahme und Verbindungen laufen weiter. Geräte zeigen zuerst verständliche Zustände und Aktionen. Rohzustände, Zielwerte und ACKs bleiben in benannten technischen Details erreichbar.

Zwei Formen wurden betrachtet:

1. **Native Dialog-Light-Dismiss:** `closedby="any"` an beiden vorhandenen Dialogen. Der Browser besitzt Modalität, Escape, Fokus und Außenklick. Diese Form wird gewählt.
2. **Globaler Klickmanager mit eigenen Rechtecksprüfungen:** würde Dialogzustand und Fokusverhalten doppelt implementieren. Nicht nötig.

Die gepinnte Chromium-Version muss das Verhalten in echten Browserfällen bestätigen. Die Anwendung bleibt auf Chrome/Edge ausgerichtet. Kein neuer Fenster-Router.

## Abnahmekriterien

- [x] AK1 – Fahrtmenü und Gerätefenster schließen bei Klick oder Tap außerhalb. Ein Klick auf Überschrift, Tab oder Karte schließt nicht. Escape und explizite Schließenknöpfe bleiben erhalten.
- [x] AK2 – Nach Außenklick ist das auslösende Bedienelement wieder fokussiert. Menüöffnung per Escape und native Fokusgrenzen funktionieren weiter.
- [x] AK3 – Außenklick beendet weder Fahrt noch Aufnahme. Eine bereits aktive explizite Trainersteuerung bleibt beim Schließen aktiv. Verbinden allein erzeugt weiterhin keine Steuerbefehle.
- [x] AK4 – Gerätekarten zeigen verständliche Namen und Zustände. Verbindungs-, Einrichtungs- und Wiederholungsversuche sind verständlich beschrieben. Rohe Statuswerte sind in technischen Details sichtbar, aber nicht die primäre Meldung.
- [x] AK5 – Trainerverbindung und Widerstandssteuerung sind getrennt. Aktivierung bleibt ausdrücklich und fähigkeitsgeprüft. Bestätigter Neutral-/Stopzustand wird nicht als Stillstand ausgegeben. Schließen und Trennen garantieren keinen Nullwiderstand.
- [x] AK6 – Kleine Fenster scrollen intern. Primäre Aktionen und Hinweise bleiben erreichbar. Touchziele mindestens 44 px. Keine doppelten IDs oder zweiten Zustandsbesitzer.
- [x] AK7 – Passende rote Browserfälle vor der Korrektur, danach grün. Vorhandene Gerätewahl-, Reconnect-, Griff- und FTMS-Gegenproben bleiben bestehen. Build, reguläres `mise run check` und unabhängiges Review bestanden.

## Testplan

| AK  | Ebene                       | Nachweis                                                                           |
| --- | --------------------------- | ---------------------------------------------------------------------------------- |
| 1–3 | Playwright, echte Sim-App   | Außen-/Innenklick, Fokus, Fahrt, Aufnahme und aktive Sim-Steuerung                 |
| 4–6 | Playwright und DOM-Tests    | Verständliche Statusdarstellung, technische Details, kleine Fenster und Zielgrößen |
| 5–7 | Bestehende Browserprüfungen | Gerätewahl, Reconnect, Play-Zuordnung und native FTMS-Gegenproben                  |
| 7   | Build und zweiter Agent     | Exakter Kandidat                                                                   |

## Nicht-Ziele

Keine Änderung an BLE-Protokollen, Reconnect-Regeln, Trainersteuerung, Aufnahme, API oder physischer Freigabe. Keine neue Abhängigkeit. Keine persönliche Anmeldung oder echte Geräteauswahl für die Sichtprüfung. Keine Hardwareabnahme.

## Bisherige Nachweise

Sechs neue Browserfälle scheiterten zuerst am fehlenden Außenklick-Verhalten, den rohen Gerätestatus und der technischen Darstellung. Nach der Umsetzung bestehen alle sechs Fälle. Ein zusätzlicher Touch-Fall prüft Innen- und Außentaps in einem echten Touch-Kontext bei 800 × 900. Die 26 gezielten Menü-, Geräte-, Reconnect-, Play- und FTMS-Browserfälle bestehen gemeinsam. Neun bestehende DOM-Tests bestehen unverändert.

Die BLE-Testfakes erkennen den linken Griff jetzt zusätzlich an der neuen Bezeichnung `Linker Play-Griff`. Die fachliche Zuordnung und alle bisherigen Schalt-, Reconnect- und Eigentümergegenproben bleiben erhalten. Die Betriebsanleitungen verwenden ebenfalls die neuen Namen `Linker Play-Griff`, `Rechter Play-Griff` und `Widerstand aktivieren`. Keine Zeitgrenze, Grafikqualität oder physische Steuerlogik wurde geändert.

Das finale reguläre Gate besteht mit 1061 Unit- und Integrationstests sowie 62 Browserfällen. Der normale Build besteht. Das unabhängige Quellreview und ein eigener Browserlauf am tatsächlichen Build bestanden. Der Artefaktlauf prüfte 23 Fälle, verglich alle 17 ausgelieferten Dateien bytegleich und öffnete sieben eigene Screenshots. Laufzeitquellen und Build blieben während dieser Prüfung unverändert.

## Doku-Updates

- [x] `04-world-3d.md` beschreibt Light-Dismiss und die vereinfachte Geräteansicht.
- [x] Roadmap nennt den begrenzten Teilschritt.
