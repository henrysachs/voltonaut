# ADR-024 – Domänenverträge für reine Belohnungsangebote

- **Status:** Gewählte Implementierungsform für den beauftragten Softwareausbau vom 23.11.2026.
- **Bezug:** ADR-005, E6-02. ADR-023 bleibt für die freigegebene CI-Reihenfolge reserviert.

## Kontext

Rules besitzt bisher nur eine Engineabhängigkeit für die Ganganzeige. Für gemeinsame, kontrolliert konstruierbare Fahrtfakten braucht die neue Angebotsberechnung einen tatsächlichen Domänenvertrag. Shared besitzt bereits die Validierungsbibliothek und gemeinsame Datenverträge.

## Entscheidung

Shared besitzt neue fachlich benannte Schemas und daraus abgeleitete Eingabetypen. Rules erhält eine direkte Workspaceabhängigkeit auf Shared. Der Abhängigkeitsregistereintrag und der Lockfilewechsel sind Teil derselben Einheit. Es entsteht keine neue externe Bibliothek und keine versteckte transitive Abhängigkeit.

Die bestehenden TypeScript-Projektreferenzen bleiben zunächst unverändert. Eine tatsächlich erforderliche zusätzliche Shared-Referenz wird mit dem konkreten roten Typecheck vorgelegt. Diese Entscheidung genehmigt keine Änderung an geschützten TS-Konfigurationen.

Rules berechnet ausschließlich ein Angebot. Aggregierte Fakten, Rohwertschwellen und Tagesrestbudget sind explizite Eingaben. Es gibt keinen Zeitpunkt, Tickakkumulator, Kontozugriff, Grant oder Quellenakzeptanz in diesem Paket.

## Alternativen

Ein indirekter Bibliothekszugriff über fremde Health-Schemas oder Engine-Reexports würde falsche Abhängigkeiten verbergen. Das wird verworfen.

Ein sofortiger Tickakkumulator würde Fenstergrenzen, Pausen und Frische bereits an diese reine Formeleinheit koppeln. Die Ermittlung solcher Tatsachen bleibt eine getrennte Serveraufgabe.

## Folgen

XP-Bestandteile werden einmal je Fahrt abgerundet. Level 1 beginnt bei null, danach bleibt die dokumentierte Kurve erhalten. Diese Präzisierungen ändern noch keine bestehenden Kontobuchungen, weil solche Buchungen nicht implementiert sind. Alle Rules-Produktänderungen benötigen den bestehenden Mutationstest zusätzlich zum normalen Gate.
