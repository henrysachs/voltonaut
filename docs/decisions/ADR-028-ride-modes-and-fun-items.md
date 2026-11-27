# ADR-028 – Spielmodi und Trainerwirkung von Spaß-Modus-Items

- **Status:** Angenommen (Henrys Freigabe im Chat am 2026-11-27) für Phase 1 von E9-01 und für Phase 2 (Malus) mit den Grenzen aus Punkt 3.
- **Bezug:** Issue #45, Spec E9-01, AGENTS.md §3.9, Issue #78 (ERG als nächster Modus), Issue #84 (getrennte normale Power-ups).

## Kontext

Der Spaß-Modus ist der erste wählbare Spielmodus neben „Normal“. Henry möchte ihn ausdrücklich als einen von mehreren Modi sehen, nicht als Sonderfall. ERG-Workouts (#78) sind als nächster Modus geplant. Ohne gemeinsame Naht müsste jeder Modus Engine-Zustand, Snapshot, Tick, Aufnahme, Fortschritt, HUD, Welt und Menü einzeln anfassen.

Im Spaß-Modus verändern Items die Fahrphysik: weniger Luftwiderstand, weniger Masse, Rückenwind. Die Engine leitet aus denselben Fahrparametern das FTMS-Simulationskommando ab. Ein Item würde deshalb physisch am Trainer wirken, sobald die Trainersteuerung aktiv ist. Später sollen Malus-Items andere Fahrer bremsen und damit Last erhöhen.

## Entscheidung

### Spielmodi

1. **Ein Modusvertrag in `packages/shared`** (`rideMode.ts`): `RideMode` ist die Union aller Modi. `RIDE_MODES` beschreibt je Modus die Eigenschaften, die Kern und App brauchen: `recordable` (Aufnahmeprotokoll kann ihn nachrechnen), `progress` (Fortschritts-Checkpoints und Belohnungen) und `trainer` (Kommandopfad, bisher nur `simulation`). Worker, Menü und Snapshot fragen diese Eigenschaften ab, nicht einen bestimmten Modus.
2. **Modus-Zustand als diskriminierte Union.** `RideState.mode` ist `{ kind: "normal" } | { kind: "fun"; heldItem; activeItem; activeRemainingS }`. Der Normalmodus kann kein Item halten. Ein Wechsel ersetzt den ganzen Abschnitt. Der Zufallszustand bleibt fahrtweit, damit ein erneuter Wechsel die Folge fortsetzt.
3. **Eine Verzweigungsstelle im Tick.** `enterMode` (`internal/modeTick.ts`) wechselt den Modus und liefert seinen Beitrag zum Tick: Tasten-Intents, Physik-Effekt und Schritte nach der Bewegung. Der `switch` ist exhaustiv. Der Normalmodus liefert `NO_EFFECT` und keine Events. Seine Physik bleibt dadurch bit-identisch.
4. **Snapshot als Union.** `RideSnapshot.mode` spiegelt den Modus-Zustand. HUD (`itemText`) und Welt (`showsItemBoxes`) verzweigen exhaustiv darauf. `trainerMode` kommt aus den Moduseigenschaften.
5. **Der Modus hat einen Besitzer.** Die Engine besitzt den Modus. Der Worker liest den angeforderten Modus aus der Engine und führt keine eigene Kopie.
6. **Das Menü rendert die Modi aus `RIDE_MODE_IDS`.** `RideMode` ist aus dieser Liste abgeleitet, damit Liste und Typ nicht auseinanderlaufen. Bezeichnung und Hinweis stehen je Modus in einer Tabelle.

Ein neuer Modus wie ERG braucht damit: einen Eintrag in `RideMode` und `RIDE_MODES`, einen Zweig in `initialModeState`, `enterMode` und `modeSnapshot`, Menütext und gegebenenfalls einen HUD-Zweig. Der Compiler meldet jede fehlende Stelle. Ein Plugin-Framework ist bewusst nicht vorgesehen.

### Spaß-Modus-Items

1. **Phase 1 wirkt nur in der Fahrphysik.** Power-ups verändern `cdaM2`, Fahrer- und Radmasse (Leichtgewicht nur bei Steigung ≥ 0) und den Wind ausschließlich für die Geschwindigkeitsberechnung. Das Trainerkommando rechnet weiter mit den unveränderten Profilparametern. Ein Test sichert, dass das Kommando mit und ohne aktives Item bei gleichem Zustand identisch ist.
2. **Kein neuer Kommandopfad.** Aktivierung, Verbindung und Messwertempfang lösen kein eigenes Kommando aus. Das bestehende `nextCommand` mit Klemmung und Ratenbegrenzung bleibt unberührt.
3. **Malus mit Lasterhöhung (Phase 2) ist freigegeben** (Henry im Chat am 2026-11-27) mit diesen Grenzen: höchstens +2 % effektive Steigung, höchstens 10 s, Opt-out „nur visuell“, gleiche Klemmung. Die Umsetzung bleibt eine physische Wirkung nach AGENTS.md §3.9 und braucht eine Hardwareprobe. Bis sie umgesetzt ist, wirkt ein Malus nur auf Bots.
4. **Getrennt von #84.** Spaß-Modus-Items haben eigene Kennungen und vergeben keine Belohnungen. Die Effektrechnung (`physics/effects.ts`, `PhysicsEffect`) kennt keine Items, damit #84 sie ohne zweite Effekttabelle wiederverwenden kann.
5. **Aufnahmen.** Das Aufnahmeprotokoll beginnt mit der Sitzung, und der Server rechnet es ohne Modus nach. Wer einen Modus ohne `recordable` betritt, macht deshalb alle späteren Aufnahmen dieser Sitzung zu rein lokalen Aufnahmen (Grund `ride_mode`), statt eine nicht nachrechenbare Fahrt als prüfbar auszugeben. Während einer laufenden oder noch nicht freigegebenen Aufnahme lassen sich solche Modi nicht wählen.

## Alternativen

- Spaß-Modus als fest verdrahteter Sonderfall: verworfen, weil ERG (#78) dieselben Stellen erneut umbauen müsste.
- Plugin-Registry mit dynamisch geladenen Modi: verworfen, weil es keinen zweiten Aufrufer und keine Laufzeitanforderung dafür gibt. Die geschlossene Union mit exhaustiven `switch` reicht.
- Items auch im Trainerkommando: verworfen. Die Strategie „Effective Grade“ (`docs/03-engine-physics.md` §4) zieht den Luftwiderstand des Trainers ab. Deshalb kann ein kleinerer CdA in niedrigen virtuellen Gängen die Trainerlast erhöhen, und weniger Masse erhöht sie bergab. „Items senken nur die Last“ ließe sich so nicht garantieren.
- Malus sofort mit Lasterhöhung: verworfen, weil es eine physische Wirkung ohne Freigabe wäre.

## Folgen

- Items machen den Fahrer auf dem Bildschirm schneller, der Widerstand am Trainer bleibt aber gleich. Phase 1 erzeugt damit keine neue physische Wirkung. Ein spürbarer Effekt am Trainer wäre eine eigene Entscheidung mit Hardwareprobe.
- ERG wird `trainer` um einen zweiten Kommandopfad erweitern. Das ist eine physische Wirkung und braucht die Freigaben aus AGENTS.md §3.9.
- Eine nachrechenbare Variante des Spaß-Modus bräuchte Modus- und Item-Einträge in RecordingV2. Das ist ein eigener Schritt.
