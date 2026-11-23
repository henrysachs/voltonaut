# Spec E5-10 – Mitgliedsstufen, VIP und Verwaltung im Spiel

- **Auftrag:** Henry beauftragt am 21.11.2026 manuell vergebbare Nutzerstufen. Er wählt ausdrücklich Normal, Premium und Pro sowie einen Adminbereich im Spiel.
- **Basis:** `916edbb070ee5c3ffaeea5836cd91dfed3410836`.
- **Status:** Implementiert, am gebauten Artefakt softwaregeprüft und unabhängig geprüft. CI des endgültigen Heads, Integration, Bereitstellung und erster bestätigter Adminzugang stehen noch aus. Bestehende Produktion bleibt unverändert.
- **Module:** `shared`-API-Verträge, Server `auth` und `accounts`, additive Migration, Browser-`sync` und Konto-Menü, Operator-CLI.

## Ziel und Grenzen

Ein Administrator kann bestehenden Nutzerkonten die Mitgliedsstufe Normal, Premium oder Pro und unabhängig davon VIP zuweisen. Diese Angaben gehören verbindlich dem Server. Sie ändern vorerst weder Preise noch Spielrechte, Belohnungen, Trainersteuerung oder Strava-Zulässigkeit.

VIP ist keine Adminberechtigung. Normale Nutzer können ihren Status lesen, aber weder sich noch andere hochstufen. Keine automatische Vergabe an den ersten Login, keine Adminableitung aus E-Mail, Browserdaten oder Anbieterclaims.

## Gewählte Form

[ADR-021](../decisions/ADR-021-membership-and-administration.md) trennt Mitgliedschaft von Verwaltung. `accounts` besitzt eine neue Tabelle `account_status`. Mitgliedschaft enthält `tier` und `vip`, Autorisierung die Rolle `user` oder `admin`. Eine fehlende Tabellenzeile bedeutet Normal, nicht VIP und nicht Admin. Bestehende Nutzer werden nicht verändert oder neu zugeordnet.

Neue eigene Status- und geschützte Adminrouten ergänzen die API. Bestehende Sessionantworten, RiderProfile, Profiluploads und Aufnahmen bleiben unverändert. Nur Tier und VIP sind über die Admin-HTTP-Schreibroute zulässig. Die Schreibtransaktion prüft die aktuelle Actor-Rolle erneut.

Die erstmalige Adminfreischaltung erfolgt ausschließlich über einen kompilierten Operatorbefehl für eine ausdrücklich ausgewählte bestehende User-ID. Der Befehl startet weder HTTP-Server noch Strava-Scheduler. Ein tatsächlicher verifizierter Login und die Auswahl dieses Kontos bleiben vor dem ersten Produktionsgrant nötig.

## Abnahmekriterien

- [x] AK1 – Verbindliche Zod-Verträge modellieren Normal/Premium/Pro und unabhängiges VIP. Alle Kombinationen sind erlaubt. Rolle ist eine getrennte Achse und kein Teil einer veränderbaren Mitgliedschaft.
- [x] AK2 – Neue und bestehende Konten erhalten ohne manuelle Zuweisung ausschließlich Normal/nicht VIP/nonadmin. Additive Migration erhält alte Nutzer, Identitäten, Sessions, Profile, Fahrten, Belege und Chiffrate unverändert.
- [x] AK3 – Eigener Status benötigt eine echte Session. Adminlisten und Änderungen verlangen die aktuelle serverseitige Adminrolle. Anonyme Zugriffe liefern 401, normale und VIP-Nutzer ohne Adminrolle 403.
- [x] AK4 – Admin-Schreibpayload akzeptiert ausschließlich Tier und VIP. Rolle, andere Benutzerfelder und unpassende Origins werden abgelehnt. Zielkonto muss bestehen. Rollenprüfung und Änderung sind in derselben unmittelbaren Transaktion konsistent.
- [x] AK5 – Administrationslisten sind begrenzt und paginiert. E-Mail ist Anzeige, keine Identität oder automatische Berechtigungsquelle. Antworten sind `no-store`.
- [x] AK6 – Adminbereich liegt im bestehenden Ingame-Menü. Fahrt und Geräte laufen weiter. Unberechtigte Nutzer sehen keine Verwaltungsaktionen. Formularpfeile und Texteingaben schalten weder Gang noch Kamera.
- [x] AK7 – Logout, Kontowechsel und neue Sessiongeneration entfernen Adminansichten und Entwürfe. Alte Buttons, verspätete Antworten und abgebrochene Requests dürfen keine Daten in ein anderes Konto übertragen. Keine Admin-Outbox und keine automatischen Schreibwiederholungen.
- [x] AK8 – Kompilierte Operator-CLI im tatsächlichen Produktionspaket kann bestehende Nutzer anzeigen und Admin gezielt vergeben oder entziehen. Unbekannte IDs werden nicht angelegt. HTTP- oder Schedulerstart ist ausgeschlossen. Mitgliedschaft und Rolle überschreiben einander nicht.
- [ ] AK9 – Schema-, SQLite-, HTTP-, Lease-, CLI- und Browsergegenproben belegen die Grenzen. Normales `mise run check`, Build, unabhängiges Review und CI des exakten Heads bestehen. Keine neue Abhängigkeit oder gelockerte Leitplanke.

## Testplan

Defaults und alle Tier/VIP-Kombinationen mit echten SQLite-Constraints prüfen. Upgrade aus sechs bestehenden Migrationen, Neustart und Rollenwiderruf erhalten Eigentümer und Altdaten. HTTP prüft 401/403, Origin, Feldablehnung, fremde Ziele und Pagination. Der tatsächliche gebaute CLI-Befehl darf keinen Listener öffnen. Browserfälle verwenden signierenden Testprovider und echte API, prüfen Zuordnung im Menü, laufende Sim-Fahrt und Konto-/Sessionwechsel.

## Software- und Reviewnachweise

`E2E_PORT=5240 CI=1 mise run check` besteht nach der Korrektur des Bestätigungsrennens mit 850 Unit-Tests und 49 Browserfällen. Der normale Build und drei Browserfälle am gebauten Client bestehen. Tatsächliche Browserantworten entsprechen den Buildbytes. Ein lokaler signierender OIDC-Anbieter ersetzt dabei keinen persönlichen Produktionslogin.

Die erste unabhängige Browserprüfung fand ein Rennen zwischen PATCH-Bestätigung und gehaltenem Refresh. Vier permanente Regressionen scheiterten vor der Korrektur und bestehen danach. Der Schreibbesitzer umfasst jetzt PATCH und vollständiges Nachlesen, unabhängig vom Anzeigezustand. Ein alter Abschluss kann keine neue Sessiongeneration entsperren. Der erhaltene alte HTTP-Gegenbeweis bleibt rot, die frisch gebündelte aktuelle Fassung besteht mit genau einem Bestätigungsread. Das frische Korrekturreview bestätigt zusätzlich Freigabe nach Lesefehlern, gehaltene Pagination und unveränderte Behandlung verlorener Antworten.

Das unabhängige Sicherheitsreview führt 17 Repositorytests und drei zusätzliche Gegenproben aus. Ein separater kompilierter CLI-Prozess entzieht die Rolle nach erfolgreichem HTTP-Guard. Die anschließende Schreibtransaktion lehnt die Änderung ab. Fehlende oder gelöschte Konten, strikte Payloads und alle sechs Mitgliedschaftskombinationen sind geprüft. Historische Migrationen und Snapshot-Tabellen bleiben bytegleich.

Die Elternprüfung erzeugt mit `pnpm --filter @voltonaut/server deploy --prod <Ausgabe>` das tatsächliche Produktionspaket. Dessen CLI besteht mit synthetischer Produktions-OIDC-Konfiguration und verbotenen Netzwerk-, Listener- und Scheduleroperationen. Gezieltes Grant und Revoke erhalten Premium und VIP, unbekannte Ziele werden nicht angelegt. Der bestehende Paket-Smoke bestätigt alle sieben Migrationen, WAL, Health, Bearergrenze und Shutdown. Das ist eine lokale Paketprüfung, kein neuer VPS- oder Hardwarebeleg.

Private Nachweise liegen unter `$TMPDIR/opencode/`: `membership-security-review/`, `membership-corrective-review-T5ezmv/`, `membership-confirmation-fixed-browser-2KX9fk/`, `membership-package-GnuCUA/` und `membership-confirmation-fix-check.log`. Keine echte Anbieterzustimmung, kein Admin-Grant in Produktion und keine Hardwareabnahme durchgeführt. AK9 bleibt bis zur grünen CI des endgültigen Heads offen.

## Nicht-Ziele und offene Abnahmen

Kein Zahlungssystem, Preisplan, Aboablauf, Premium-Gameplay oder allgemeine Rollenverwaltung per HTTP. Keine Änderung an Aufnahmen, Physik oder Strava-Politik. Hardware bleibt getrennt abzunehmen.

Die konkret bestätigte bestehende User-ID für Henrys ersten Adminzugang steht noch aus. Kein automatischer Bootstrap als Ersatz.
