# ADR-025 – Trainerwirkung von Spaß-Modus-Items

- **Status:** Vorgeschlagen für Phase 1 von E9-01. Phase 2 (Malus) benötigt Henrys Freigabe.
- **Bezug:** Issue #45, Spec E9-01, AGENTS.md §3.9, Issue #84 (getrennte normale Power-ups).

## Kontext

Im Spaß-Modus verändern Items die Fahrphysik: weniger Luftwiderstand, weniger Masse, Rückenwind. Die Engine leitet aus denselben Fahrparametern das FTMS-Simulationskommando ab. Ein Item wirkt deshalb physisch am Trainer, sobald die Trainersteuerung aktiv ist. Später sollen Malus-Items andere Fahrer bremsen und damit Last erhöhen.

## Entscheidung

1. **Phase 1 wirkt nur in der Fahrphysik.** Power-ups verändern `cdaM2`, Fahrer- und Radmasse (Leichtgewicht nur bei Steigung ≥ 0) und den Wind ausschließlich für die Geschwindigkeitsberechnung. Das Trainerkommando rechnet weiter mit den unveränderten Profilparametern. Ein Test sichert, dass das Kommando mit und ohne aktives Item bei gleichem Zustand identisch ist.
2. **Kein neuer Kommandopfad.** Aktivierung, Verbindung und Messwertempfang lösen kein eigenes Kommando aus. Das bestehende `nextCommand` mit Klemmung und Ratenbegrenzung bleibt unberührt.
3. **Malus mit Lasterhöhung (Phase 2) ist nicht freigegeben.** Vorschlag zur späteren Freigabe: höchstens +2 % effektive Steigung, höchstens 10 s, Opt-out „nur visuell“, gleiche Klemmung. Bis zur Freigabe wirkt ein Malus nur auf Bots.
4. **Getrennt von #84.** Spaß-Modus-Items haben eigene Kennungen und vergeben keine Belohnungen. Die Funktion für effektive Fahrparameter ist allgemein gehalten, damit #84 sie wiederverwenden kann, statt eine zweite Effekttabelle zu bauen.

5. **Aufnahmen.** Das Aufnahmeprotokoll beginnt mit der Sitzung, und der Server rechnet es im normalen Modus nach. Wer den Spaß-Modus betritt, macht deshalb alle späteren Aufnahmen dieser Sitzung zu rein lokalen Aufnahmen (Grund `fun_mode`), statt eine nicht nachrechenbare Fahrt als prüfbar auszugeben.

## Alternativen

- Items auch im Trainerkommando: verworfen. Die Strategie „Effective Grade“ (`docs/03-engine-physics.md` §4) zieht den Luftwiderstand des Trainers ab. Deshalb kann ein kleinerer CdA in niedrigen virtuellen Gängen die Trainerlast erhöhen, und weniger Masse erhöht sie bergab. „Items senken nur die Last“ ließe sich so nicht garantieren.
- Malus sofort mit Lasterhöhung: verworfen, weil es eine physische Wirkung ohne Freigabe wäre.

## Folgen

Items machen den Fahrer auf dem Bildschirm schneller, der Widerstand am Trainer bleibt aber gleich. Phase 1 erzeugt damit keine neue physische Wirkung. Ein spürbarer Effekt am Trainer wäre eine eigene Entscheidung mit Hardwareprobe.
