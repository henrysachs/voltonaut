# ADR-025 – Trainerwirkung von Spaß-Modus-Items

- **Status:** Vorgeschlagen für Phase 1 von E9-01. Phase 2 (Malus) benötigt Henrys Freigabe.
- **Bezug:** Issue #45, Spec E9-01, AGENTS.md §3.9, Issue #84 (getrennte normale Power-ups).

## Kontext

Im Spaß-Modus verändern Items die Fahrphysik: weniger Luftwiderstand, weniger Masse, Rückenwind. Die Engine leitet aus denselben Fahrparametern das FTMS-Simulationskommando ab. Ein Item wirkt deshalb physisch am Trainer, sobald die Trainersteuerung aktiv ist. Später sollen Malus-Items andere Fahrer bremsen und damit Last erhöhen.

## Entscheidung

1. **Phase 1 senkt die Last nur.** Power-ups verändern ausschließlich `cdaM2` und Fahrer- und Radmasse nach unten sowie den Wind in der Fahrphysik. Der Wind geht nicht in das Trainerkommando ein (`windMps` bleibt 0). Ein Property-Test sichert, dass die effektive Trainersteigung mit aktivem Item nie höher ist als ohne.
2. **Kein neuer Kommandopfad.** Items wirken nur über die effektiven Fahrparameter im bestehenden `nextCommand`, mit dessen Klemmung auf −10 bis +20 % und dessen Ratenbegrenzung. Aktivierung, Verbindung und Messwertempfang lösen kein eigenes Kommando aus.
3. **Malus mit Lasterhöhung (Phase 2) ist nicht freigegeben.** Vorschlag zur späteren Freigabe: höchstens +2 % effektive Steigung, höchstens 10 s, Opt-out „nur visuell“, gleiche Klemmung. Bis zur Freigabe wirkt ein Malus nur auf Bots.
4. **Getrennt von #84.** Spaß-Modus-Items haben eigene Kennungen und vergeben keine Belohnungen. Die Funktion für effektive Fahrparameter ist allgemein gehalten, damit #84 sie wiederverwenden kann, statt eine zweite Effekttabelle zu bauen.

## Alternativen

- Items nur in der Physik, Trainer unverändert: Das wäre sicher, würde aber Fahrgefühl und Bildschirm widersprechen lassen. Weil Phase-1-Items die Last ohnehin nur senken, wird das verworfen.
- Malus sofort mit Lasterhöhung: verworfen, weil es eine physische Wirkung ohne Freigabe wäre.

## Folgen

Mit aktivem Aero-Boost oder Leichtgewicht wird der Trainer leichter. Der Hardwarenachweis (Gefühl, Reaktionszeit) bleibt offen, bis eine reale Probefahrt stattgefunden hat.
