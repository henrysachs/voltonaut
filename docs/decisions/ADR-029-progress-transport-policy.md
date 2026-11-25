# ADR-029 – Progress-Transport, Quellenpolitik und UTC-Tagesgrenze

- **Status:** Angenommen für die Implementierung von E6-07 bis E6-10 am 25.11.2026.
- **Bezug:** ADR-005, ADR-027, E6-04, E6-05.

## Kontext

E6-04 liefert HR-freie Checkpoints, aber keine Persistenz, Zustimmung, Quellenfreigabe oder Serverbuchung. E6-05 liefert ein atomares Volts-Journal für zusammenhängende kumulative Tickbereiche. Beide zusammen benötigen eine Transportpolitik, die Reihenfolge, Offline-Wiederholung, Mitternacht, Sim-Ausschluss und Kontobindung eindeutig macht.

Vollständige Wake-Replays sind mit den aktuellen Checkpoints nicht möglich: leere Advances, fraktionale Akkumulatorreste und Initialisierungsrohdaten fehlen. Eine zweite Aufnahme parallel zum bestehenden Recorder würde Zustand und Belege duplizieren.

## Entscheidung

1. Der Client bündelt Checkpoints zu lokalen Batches von höchstens 120 Facts beziehungsweise 6 Sekunden. Die Checkpoint-Anzahl ist kein eigenes Limit; bei einem Fact pro Checkpoint sind maximal 120 Checkpoints erlaubt. Pausierte Checkpoints werden zusammengeführt. Der Server fasst höchstens zehn dieser Batches zu einem Bereich von höchstens 1200 Checkpoints, 1200 Facts beziehungsweise 60 Sekunden zusammen.
2. Lokale Batches werden in einer eigenen IndexedDB gespeichert. Maximal 1200 Batches pro Konto und Origin sind erlaubt; keine stille Eviction. Bestätigte Batches werden erst nach serverseitiger Quittung gelöscht.
3. Der Server bestimmt den Belohnungstag aus dem letzten `endedAtMs`. Der Client flusht zusätzlich an UTC-Mitternacht; ein überschreitender Bereich zählt vollständig zum Endtag. Die Zeit darf höchstens fünf Minuten in der Serverzukunft liegen; Offline-Lieferungen sind bis zu sieben Tage alt zulässig. Innerhalb eines Journals darf der Tag nicht zurückfallen.
4. Sim wird client- und serverseitig ausgeschlossen. Produktiv bleibt `RIDE_SOURCE_POLICY=disabled`; nur `declared_ble_v1` erlaubt automatische BLE-Deklarationen. Uhrskalierung, Clock-Skips, staleness und Ticklücken blockieren die Annahme.
5. Native Werte werden nicht geklemmt. Die Serverannahme verwendet die bestehenden Reward-Grenzen und prüft den Energiebeitrag gegen Leistung mal Tickzeit. Ein qualitativ ungültiger Bereich wird ohne Buchung abgewiesen; der Client stoppt dieses Journal und beginnt erst in der nächsten Fahrt ein neues.
6. Zustimmung und Journal gehören einem neuen Servermodul `progress/`. Die serverseitige Session-Token-Generation ist die dauerhafte Sessionbindung; die Browser-Generation fence nur lokale Asyncs.
7. Aktivierung gilt an Journalgrenzen, weil ein neues Journal bei Tick 0 beginnen muss. Widerruf blockiert sofort neue Persistenz und Uploads; bestätigte Bereiche bleiben. Ein laufendes Journal wird nicht neu numeriert, fortgeschrieben oder einem anderen Konto zugeordnet.
8. Die Annahme schreibt Journal-Highwater und Volts in einer gemeinsamen unmittelbaren Transaktion. `economy/` bleibt alleiniger Ledger-Besitzer. XP/Level folgen separat.
9. Bestätigte Progressbereiche erzeugen keine synthetischen `rides`. Manuelle Aufnahmen und Strava bleiben unverändert und lösen keine zweite Progressbelohnung aus. Der Consent-Status meldet die Quellenpolitik; Aktivierung bei deaktivierter Politik wird abgewiesen. Ein bereits gebuchter Checkpoint-Präfix darf bei größerem oder kleinerem Retry-Batching denselben Beleg zurückliefern.

## Alternativen

- **Ein Post pro Checkpoint:** verworfen, weil Write-Last, Journalgröße und Tagesbudget-Abfragen unnötig wachsen.
- **Vollständige zweite Aufnahme für Progress:** verworfen, weil sie native Fakten und Zustand dupliziert und bestehende Aufnahmen verändert.
- **Client-seitiger Belohnungstag:** verworfen, weil dadurch Tageslimits umgangen werden können.
- **Sim standardmäßig erlauben:** verworfen, weil Sim keine Kontobelohnung erhalten darf.
- **Vollständiges Event-Sourcing aller Progress-Rohdaten:** verworfen, weil die aktuelle Tickprüfung für den kleinen Freundekreis ausreicht und zusätzliche Wake-Belege fehlen.

## Folgen

- Offline-Progress überlebt Reload und Netzwerkverlust, ohne HR oder Identitätswechsel zu verlieren.
- Ein aktueller Batch kann bis zu sechs Sekunden unbestätigt sein; die Oberfläche muss das als vorläufig benennen.
- Die erste Serverprüfung ist deterministisch für Tickfolge, Metadaten und Physikbeiträge, aber kein vollständiger Route-Replay und kein Hardwareattest.
- Produktive Quellenfreigabe und echte Hardwarefahrt bleiben getrennte Abnahmen.
