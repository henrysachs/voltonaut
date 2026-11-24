# ADR-027 – Serverseitiges Volts-Journal und gemeinsame Rules-Rechnung

- **Status:** Angenommen für die Implementierung von E6-05 am 24.11.2026.
- **Bezug:** ADR-005, ADR-006, E6-02, E6-05.

## Kontext

Der Server ist laut ADR-005 autoritativ für Volts. Die reine Angebotsrechnung liegt bereits in `packages/rules`; der Server braucht für die verbindliche Buchung dieselbe Rechnung statt einer zweiten Implementierung. Dafür fehlt bisher die direkte Workspace-Abhängigkeit.

Ein nur mutabler Kontostand wäre einfach, aber nicht auditierbar. Ein separates Wallet plus Journal müsste doppelt geschrieben und bei Fehlern repariert werden. Für den kleinen Freundeskreis reicht SQLite mit einem unveränderlichen Journal als alleiniger Wahrheit.

## Entscheidung

1. `apps/server` erhält die direkte Workspace-Abhängigkeit `@voltonaut/rules`. Keine neue externe Bibliothek wird installiert. Eine zusätzliche TypeScript-Projektreferenz wird nur bei einem konkreten roten Typecheck ergänzt.
2. Das Modul `economy/` besitzt `volts_ledger`. Andere Module schreiben diese Tabelle nicht direkt, sondern nutzen den exportierten `EconomyService`.
3. Der Kontostand ist `SUM(delta_volts)` je Konto. Es gibt keine mutable Wallet-Spalte. Das Tagesbudget ist die Summe der Belohnungsbuchungen des expliziten UTC-Belohnungstags.
4. Jede Buchung besitzt einen eindeutigen Schlüssel aus Konto und Idempotenzschlüssel sowie einen Hash des fachlichen Auftrags. Fahrtbereiche verwenden `ride:<journalId>:<startTick>`. Kaufaufträge müssen bereits mit `purchase:` beginnen; der Server speichert diesen Schlüssel unverändert. Identische Wiederholungen liefern denselben unveränderlichen Beleg zurück; abweichende Aufträge sind ein Konflikt.
5. Belohnungen und Abbuchungen laufen in unmittelbaren SQLite-Transaktionen. `EconomyService.transaction` erlaubt später einem Shop-Modul, Inventar und Ledger-Abbuchung atomar zu buchen, ohne fremde Ledger-Tabellen zu lesen.
6. Belohnungen konsumieren kumulative `RewardFacts` bis zum Ende eines Tickbereichs. Das Ledger speichert die kumulierten Volts-Komponenten und bucht nur deren Differenz zum vorherigen Bereich. Die Summe aller Bereiche entspricht exakt der einmaligen Rundung der Gesamtfahrt. Bereiche müssen lückenlos zusammenhängen; ein Journal gehört global einem Konto. Bereichsgröße, Quellenfreigabe, Mitternachtsfahrten und Transport bleiben Issue #56 bis #59.
7. `GET /v1/me/volts` ist der einzige öffentliche API-Pfad dieser Einheit. Es gibt noch keinen Belohnungs- oder Kauf-POST.

## Alternativen

- **Nur Wallet-Spalte:** verworfen, weil Herkunft, Idempotenz und Konflikte nicht nachvollziehbar sind.
- **Eine Buchung je Gesamtfahrt:** verworfen, weil bestätigter Fortschritt während der Fahrt erst am Fahrtende sichtbar würde und spätere Checkpoint-Abschnitte das Schlüsselschema neu bauen müssten.
- **Wallet plus Journal:** verworfen, weil zwei gespeicherte Wahrheiten synchron gehalten werden müssten.
- **Vollständiges Event-Sourcing:** verworfen, weil alle Account-Zustände dafür umgebaut werden müssten und für E6-05 keinen Mehrwert bietet.
- **Web3, Crypto oder Blockchain:** verworfen, weil Wallets, Schlüssel, Gebühren und zusätzliche Betriebsrisiken keine Anforderung dieser Ingame-Währung sind.

## Folgen

- Volts-Buchungen sind auditierbar und idempotent; Wiederholung erzeugt keine doppelte Vergabe.
- SUM-Abfragen wachsen mit der Journalgröße. Die Indexe unterstützen Konto, Tag und Schreibzeit. Ein späterer Lese-Cache muss aus dem Journal rekonstruierbar bleiben.
- Fahrtbelege enthalten nur unveränderliche Posting-Fakten. Der aktuelle Kontostand wird separat über `GET /v1/me/volts` gelesen.
- Änderungen an `packages/rules` benötigen weiterhin `mise run check:mutation`.
