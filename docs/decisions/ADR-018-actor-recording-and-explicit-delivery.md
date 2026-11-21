# ADR-018 – Actor-Aufnahme und ausdrückliche Strava-Auslieferung

- **Status:** Gewählte Softwareform für E10-04. Reale Versandrichtlinie und Produktion bleiben freigabepflichtig.
- **Datum:** 2026-11-20
- **Bezug:** [E10-04](../specs/E10-04-complete-ride-delivery.md), ADR-016 und ADR-017.

## Kontext

Der vorhandene Engine-Worker und der Mainthread-Recorder haben keine atomare gemeinsame Aufnahmegrenze. Der Replay-Vertrag verlangt dagegen die vollständige Engine-Aufrufhistorie. Sein bisheriger Eignungsentwurf verwechselt einen späteren Fensterstart mit fehlender Historie. Strava liefert für Datei-Uploads keine transaktionale Idempotenzgarantie. Ein wiederholbarer Kontosync-POST ist deshalb kein geeigneter Strava-Sendemechanismus.

Zwei unabhängige Entwürfe wurden anhand der tatsächlichen Aufrufer verglichen. Gewählt ist die Form mit dem kleineren Aufnahmevertrag ohne zusätzliche Engine-Advances durch Aufnahmeaktionen. Der detaillierte Vergleich liegt im lokalen Aufgabenbeleg `finish-open-work-QzilnV/selection.md`. Modellanbieterübergreifendes Cross-Judging wird nicht behauptet.

## Entscheidung

Der vorhandene Engine-Worker besitzt Aufnahme und vollständiges Fahrtjournal. Der Mainthread zeichnet keine zweite Fahrt auf. Start, Sample, Finish und Verwerfen laufen in derselben Actor-Reihenfolge wie Eingaben und Timeraufwachungen. Eine Aufnahmeaktion liest den committed Enginezustand, verändert aber weder Uhranker noch Advance-Partition oder laufende Pose.

Journal-Lebensdauer und Aufnahmefenster sind getrennt. Beim Abschluss wird der unveränderte vollständige Physikpräfix mit genau den Markern des gewählten Fensters in einen Beleg projiziert. Die Reihenfolge stammt aus dem Actor, nicht aus nachträglichem Sortieren nach Zeit. Frühere Aufnahmegrenzen sind keine Physikeingaben. Mehrere Aufnahmen brauchen keinen Engine-Neustart und kein erweitertes Mehrfenster-Wireformat. Gleiche echte Zeitablesungen werden durch die Sequenz geordnet. Künstliche Epsilonzeiten entfallen.

Ein Grenzübertritt macht das Journal dauerhaft unverfügbar. Derselbe Aufnahmebesitzer kann dann nur noch einen ausdrücklich lokalen Track liefern. Er erfindet keinen vollständigen Präfix. Neue normale Abschlüsse verwenden ausschließlich den Journalvertrag. Vorhandene V1-Datensätze bleiben ein historischer Lesefall desselben Archivs, kein zweiter aktiver Recorder. Ein ungesicherter Abschluss wird erst nach Archivcommit oder ausdrücklicher Nutzerentscheidung freigegeben.

`rides/` besitzt unveränderliche Nutzlast, Nachrechnung, Zusammenfassung und servererzeugten TCX-Export. Ein gemeinsamer reiner Track-/TCX-Pfad bedient Browser und Server. Es gibt eine Fahrtablage und eine Konto-Outbox. Bei geändertem HTTP-Vertrag wechseln alle Fahrtenaufrufer gemeinsam auf einen kanonischen Endpunkt; der alte Pfad bleibt nicht als Weiterleitung oder Parallel-API bestehen. Bestehende Daten und Zuordnungen werden nicht gelöscht oder ohne Journal aufgewertet.

Replay-Konsistenz, BLE-Selbstauskunft und Versandzulässigkeit bleiben getrennte Aussagen. `declared_ble_v1` kann nur eine ausdrücklich eingeschaltete Quellenrichtlinie sein. Sie verleiht weder Hardwareattestierung noch Rewards. Standard ist deaktiviert. Der lokale Nachweis aktiviert dieselbe ehrliche Richtlinie gegen Testanbieter. Eine Clientmarkierung oder ein im Browser ausgelieferter Schlüssel wird nicht zum Echtheitsbeweis.

`strava/` besitzt Verbindung, Credentialarbeit, Fahrtfreigabe und einen dauerhaften Auftrag pro Fahrt. Die Freigabe bindet Quelle und Exporthash, Zielverbindung, Verbindungsgeneration, Quellenrichtlinie und Hinweisrevision. Tokenrevision und Zielgeneration sind verschieden. Ein normaler Refresh erzeugt keinen neuen Fahrtconsent.

Ein Preparing-Lease und ein atomarer Dispatchcommit begrenzen den externen Upload auf höchstens einen POST. Ein veralteter Leasebesitzer erhält keine Sendeberechtigung. Nach Dispatch werden Antwortverlust und Absturz dauerhaft unklar, niemals automatisch neu eingereiht. Bekannte Upload-IDs bleiben beim Polling und bei lokaler Sperre erhalten. Externer Fortschritt und lokale Autorisierung sind getrennt, weil eine bereits angenommene Aktivität durch Trennen nicht zurückgeholt wird.

Refresh, Ressourcenaufrufe und Widerruf beachten denselben dauerhaften Verbindungsbesitzer. Unklare Tokenrotation sperrt weitere Arbeit. Ein HTTP 200 für einen möglicherweise bereits ungültigen alten Token beweist nach unklarer Rotation keinen vollständigen grantweiten Widerruf. Diese Unsicherheit wird sichtbar und nicht durch Leaseablauf beseitigt.

## Konsequenzen und verworfene Formen

- Die Engine selbst und ihre Physik bleiben unverändert. Ereignisse und Kommandos werden einmal geleert und anschließend an Journal und Darstellung verteilt.
- Die Aufnahmegrenzen bestätigen tatsächliche Actorzustände, keine verzögerten Mainthread-Snapshots. Ein großer überlappender Uhrausfall bleibt ein Qualitätsproblem des Fensters.
- Gemeinsame Kapazitätsgrenzen garantieren weiterhin keine beliebig lange Replayaufnahme. Vorlauf und vollständige Ausgaben zählen mit. Lokaler Export darf eine Einschränkung nicht als geprüfte Aufnahme verstecken.
- Verworfen sind Mainthread-Aufnahme plus zusätzliche Workerbelege, Snapshot-Neustart, zusätzliche Advances durch Aufnahmebefehle und ein allgemeines Integrationsframework.
- Die tatsächliche App-Verbindung muss auch die nur im Speicher gehaltene Anwendungssession berücksichtigen. Ein Popup-/Bridge-Verfahren wird vor Festlegung der konkreten Oberfläche separat geprüft. Es darf keine Bearer oder Provider-Tokens in ein Childfenster übertragen.
- Ein tatsächlich gebautes Web- und Workerartefakt, ein kompilierter Server und lokale Anbieter liefern den Gesamtbeleg. Ein Vite-Quelllauf oder eine separate OAuth-HTML-Fixture ersetzt diesen Beleg nicht.
- Es gibt keine neue Abhängigkeit und keine Änderung geschützter Leitplanken. Echte Anbieterzustimmung, Policy, Aufbewahrung, Sichtbarkeit, Hardware und produktiver Betrieb bleiben getrennte Freigaben.
