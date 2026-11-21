# ADR-021 – Mitgliedschaft und Administration trennen

- **Status:** Gewählte Form für Henrys Auftrag vom 21.11.2026. Stufen und Adminoberfläche sind ausdrücklich beauftragt.
- **Bezug:** ADR-005, E5-10.

## Kontext

Henry möchte Normal, Premium und Pro vorbereiten und Nutzern manuell zuweisen. VIP ist ein zusätzlicher Sonderstatus. Preise und unterschiedliche Spielrechte sind noch nicht beschlossen. Die Vergabe erfolgt über eine geschützte Oberfläche im Spiel.

## Entscheidung

Mitgliedschaft und Autorisierung bleiben getrennte Achsen. `membership` enthält die Stufe und VIP. `authorization` enthält ausschließlich die Rolle `user` oder `admin`. VIP und höhere Mitgliedsstufen erlauben keine Administration.

`accounts` besitzt beide Angaben in einer neuen Tabelle. Eine fehlende Zeile bedeutet die ungefährlichen Standardwerte. Die Authentifizierung liefert unverändert den bestehenden Session-Principal. Eine Adminaktion prüft ihre gegenwärtige Rolle im Server und eine Änderung erneut innerhalb derselben Datenbanktransaktion. Rollen werden nicht als dauerhafte Autorität in Browserdaten oder Sessionantworten eingefroren.

Die Adminoberfläche darf nur die Mitgliedschaft bestehender Nutzer ändern. Es gibt keinen HTTP-Endpunkt für die Vergabe einer Adminrolle. Ein Operatorbefehl auf dem Server schaltet eine ausdrücklich ausgewählte bestehende User-ID frei oder entzieht die Rolle. Der erste Login und eine bestimmte E-Mail-Adresse erhalten niemals automatisch Adminrechte.

Bestehende Nutzerverträge bleiben unverändert. Neue eigene Status- und Adminrouten vermeiden die Vermischung mit RiderProfile oder Authanbieterclaims. Profil- und Aufnahmepayloads bleiben strikt.

## Alternativen

Eine einzige Statusfolge Normal/Premium/Pro/VIP/Admin würde Mitgliedschaft und Berechtigung vermischen. VIP könnte dann nicht unabhängig vergeben werden. Das wird verworfen.

Die Rolle in `auth.users` und Mitgliedschaft in `accounts` zu speichern ist möglich. Es verteilt die Verwaltung und die transaktionale Änderung jedoch unnötig über zwei Besitzer. Der aktuelle Umfang braucht das nicht.

## Folgen

Es gibt keine Preis- oder Leistungszusage aus einer Stufe. Zukünftiges Billing braucht einen eigenen Vertrag. Bestehende Konten, Zuweisungen und Aufnahmen werden nicht gelöscht oder anhand von E-Mail-Adressen neu gebunden. Ohne bestätigte bestehende User-ID bleibt der erste Adminzugang bewusst unbesetzt.
