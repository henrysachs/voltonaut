# ADR-031 – Server-Inventar, atomare Käufe und Operator-Gutschrift

- **Status:** Angenommen für E7-02 (Entscheidungen Henrys über den Auftraggeber, 25.11.2026)
- **Bezug:** Issue #64, Spec [E7-02](../specs/E7-02-server-inventory-shop.md), [ADR-027](ADR-027-server-volts-ledger.md), ADR-005

## Kontext

Die Garage zeigt seit E7-01 Katalog und Preise, kann aber nichts verkaufen. Besitz muss nach Reload und auf jedem Gerät gleich sein. Volts und Inventar besitzt der Server (ADR-005). Das Volts-Journal (ADR-027) bucht bereits idempotente Abbuchungen und bietet ein Transaktions-Port für eine spätere Kombination mit dem Inventar.

Zwei Lücken blockieren eine echte Abnahme: Der Server kennt noch keine Level, weil die Progression fehlt. Volts lassen sich noch nicht verdienen (#59).

## Entscheidung

1. **`inventory/` besitzt die Tabelle `inventory`** mit Primärschlüssel `(user_id, item_id)` und einer eindeutigen `purchase_request_id` je Konto. Gespeichert werden nur gekaufte Items (`source = 'shop'`). Standard-Items gelten ohne Zeile als besessen und erscheinen in `GET /v1/me/inventory` mit `source = 'default'` und `acquiredAt = null`.
2. **Ein Kauf ist ein SQLite-Commit.** `POST /v1/shop/purchase` läuft in `EconomyService.transaction` (unmittelbare Transaktion). Darin prüft `decidePurchase` aus `@voltonaut/rules` Katalog, Shop-Freischaltung, erwarteten Preis und Besitz. Danach bucht das Ledger die Abbuchung mit dem Schlüssel `purchase:<requestId>`, und das Inventar trägt das Item auf derselben Verbindung ein. Scheitert ein Schritt, rollt beides zurück.
3. **Idempotenz über die `requestId` des Clients.** Dieselbe `requestId` bestätigt denselben Kauf (gleiches Item, gleicher Erwerbszeitpunkt) ohne zweite Abbuchung; der Beleg nennt den aktuellen Kontostand, nicht den Stand direkt nach dem ersten Kauf. Eine `requestId` für ein anderes Item ergibt `409 ledger_conflict`. Ein bereits besessenes Item ergibt mit neuer `requestId` `409 already_owned`. Der Client behält die `requestId` nach unbestätigtem Ausgang, auch über eine erneute Anmeldung desselben Kontos, und verwirft sie erst nach Beleg, endgültiger Ablehnung oder Kontowechsel.
4. **Mindestlevel wird vorerst nicht geprüft (Übergang).** Bis zur Progression sind alle Shop-Items bei genug Volts kaufbar. Garage und Code kennzeichnen das als „Prüfung folgt“. Mit der Progression bekommt `decidePurchase` das Level des Kontos.
5. **Operator-Gutschrift statt Verdienstweg.** Das Journal kennt den Grund `operator_grant`: nur positive Deltas, keine Fahrtfelder, per SQLite-CHECK erzwungen. Nur der Operatorbefehl `node dist/main.js admin credit --operator <adminUserId> <userId> <volts> <reference>` schreibt sie mit dem Schlüssel `operator:<reference>`. Gleiche Referenz und gleicher Betrag sind idempotent, abweichende Wiederholungen ein Konflikt. Eine Gutschrift, die den Kontostand über `Number.MAX_SAFE_INTEGER` heben würde, wird abgewiesen. Es gibt keinen Web-Endpunkt dafür.

6. **Jede Gutschrift hat einen Operator (Ergänzung, Issue #116, 25.11.2026).** `--operator` ist Pflicht und muss ein aktives Konto mit Rolle `admin` sein. Henry hat diese Variante gewählt, weil `SUDO_USER` und der Host-Login im Server-Container nicht sichtbar sind. Die Kennung steht in der Audit-Tabelle `volts_grant_operators` (ein Eintrag je Gutschrift, in derselben Transaktion wie die Buchung, unveränderlich per Trigger, ein gelöschtes Operator-Konto wird abgewiesen). Gutschriften von vor der Einführung markiert die Migration `0013` als `unknown_before_audit`, ohne einen Operator zu erfinden. Eine Wiederholung derselben Referenz durch einen anderen Operator ist ein Konflikt. Der Kontoexport des gutgeschriebenen Kontos enthält den Operator nicht (Datensparsamkeit). Löscht das gutgeschriebene Konto seine Daten, verschwinden die Audit-Einträge mit dem Journal. Löscht der Operator sein Konto, bleibt die pseudonyme Konto-ID im Audit stehen. Der Audit-Eintrag verweist ohne Kaskade auf die Buchung: Die Kontolöschung entfernt ihn ausdrücklich vor dem Journal, und ein künftiger Neubau von `volts_ledger` scheitert sichtbar, statt das Audit still zu leeren. Grenzen: Die Admin-Prüfung läuft im CLI vor der Buchungstransaktion; ein gleichzeitiges `admin revoke` des Operators wird nicht erkannt (für ein Operator-CLI hingenommen, eine gleichzeitige Kontolöschung fängt der Trigger ab). Eine per Roh-SQL oder Restore ohne Audit-Eintrag geschriebene Gutschrift lässt eine spätere Wiederholung mit `500` scheitern.

## Konsequenzen

- Henry kann Kauf, Ablehnung bei zu wenig Volts und geräteübergreifenden Besitz abnehmen, ohne dass Fahrtbelohnungen freigegeben sein müssen.
- Level-Items sind bis zur Progression früher kaufbar als vorgesehen. Bereits gekaufte Items bleiben auch nach Einführung der Prüfung im Besitz.
- Fehlerhafte Gutschriften lassen sich nur durch eine Gegenbuchung korrigieren, nicht durch Löschen. Eine Gegenbuchung ist nicht Teil dieser Entscheidung.
- Die Migration `0011_volts_operator_grant` legt `inventory` additiv an, baut `volts_ledger` neu und kopiert alle Zeilen. Der Neubau entfernt die Lösch-Trigger aus `0010` (E5-11); `0011` legt sie wieder an und sichert `inventory` ebenso ab.
- Ausrüsten nur besessener Items bleibt #65.

## Verworfene Alternativen

- **Inventar als eigene Transaktion nach der Abbuchung:** Ein Absturz dazwischen hinterließe bezahlte, aber fehlende Items.
- **Wallet-Spalte:** widerspricht ADR-027.
- **Gutschrift über einen Admin-Web-Endpunkt:** größere Angriffsfläche ohne Bedarf vor dem Verdienstweg.
