# ADR-022 – Echte Strava-Konfiguration und verifizierte Deautorisierung

- **Status:** Gewählte Form für Henrys ausdrücklichen Aktivierungsauftrag vom 21.11.2026.
- **Bezug:** ADR-017, ADR-018, ADR-020, E10-06.

## Kontext

Die gebaute Auslieferungsstrecke ist gegen lokale HTTP-Anbieter geprüft. In Produktion fehlen noch Strava-Konfiguration und der vorgeschriebene Umgang mit Deautorisierungen. Client-Secrets liegen bereits im GitHub-Environment `production`. Der persönliche OAuth-Klick bleibt beim Nutzer.

## Entscheidung

Der bereits freigegebene einmalige Provisionierungsweg erhält ein enges Strava-Profil für diesen konkreten Auftrag. Manuelles `main`, Produktionsfreigabe, gepinnter SSH-Host, private stdin-Übergabe und ausgeschlossene Secret-Ausgabe bleiben erhalten. OIDC-Datei und bestehende Schlüssel werden nicht überschrieben.

Der bestehende Workflow `provision-server` hat einen festen Profilselektor für OIDC oder Strava. OIDC bleibt die Voreinstellung. Jeder Secret-Schritt liest nur die Werte seines Profils. Es gibt keinen zweiten OIDC-fähigen Provisionierungsworkflow.

Eine getrennte optionale `strava.env` konfiguriert denselben API-Dienst. Der VPS erzeugt einmalig Tokenverschlüsselungsschlüssel und Webhook-Verifikationstoken. Ein Sender darf keinen Ersatzschlüssel liefern. Wiederholung und Parallelität erhalten bestehendes gültiges Schlüsselmaterial. Bei vorhandenem Chiffrat ohne gesicherten Schlüssel wird die Aktivierung verweigert, nicht neu verschlüsselt oder gelöscht.

Die Aktivierung wählt ausdrücklich `declared_ble_v1`. Das ist BLE-Selbstauskunft, kein Hardwareattest. Sim, beschleunigte oder nicht durchgängig geeignete Fenster bleiben gesperrt. Mitgliedsstufe und VIP ändern diese Freigaben nicht.

Ein öffentlicher Webhook-POST ist ohne verlässlichen Signatur- und Schlüsselvertrag nur ein Hinweis. Das offizielle Beispiel zeigt inzwischen `X-Strava-Signature`, während der Subscription-Vertrag keine Bereitstellung des separaten Signing-Secrets erklärt. Ein lokaler Verifikationstoken wird deshalb nicht als angeblicher Signing-Schlüssel verwendet. Athleten-ID, Subscription-ID und Ereigniszeit allein dürfen weder Nutzeraufnahmen löschen noch eine neue Verbindung dauerhaft sperren. Hinweise werden dauerhaft koalesziert und über bestehende Credential-Leases, Generationen, Tokenrevisionen und appweite Read-Budgets gegen den aktuellen Anbieterzustand geprüft.

Reservierungen unterscheiden `upload`, `poll` und `authorization_hint`. Für ungeprüfte Hinweise gilt höchstens die abgerundete Hälfte jeder tatsächlich bekannten Gesamt- und Read-Grenze im Viertelstunden- und Tagesfenster. Bekannte Uploads und Verarbeitungspolls behalten die vollständigen Anbietergrenzen. Die bestehende dauerhafte SQLite-Zeile zählt Nutzung einschließlich offener Reservierungen auch über Prozesse und Neustarts. Anbieterlimits werden nicht überschrieben oder erhöht. Die Hälfte ist eine konservative interne Schutzpolitik, kein gemessener Strava-Grenzwert.

Bei der unbekannten Startkapazität von 1 erlaubt diese Politik keinen Hinweis-GET. Eine bekannte Upload- oder Poll-Anfrage kann weiterhin echte Header lernen. Bereits bis zum Tagesreset verschobene Hinweise werden dadurch nicht vorgezogen. Ein alleinstehender Hinweis kann ohne solche Arbeit länger unbestätigt bleiben. Diese Entscheidung garantiert keinen sofortigen Prüfzeitpunkt und keine abschließende Datenschutzkonformität. Sie schützt die für bekannte Auslieferungen reservierte Kapazität vor anonymem Verbrauch.

Die 8-KiB-JSON-Grenze liegt vor dem Parser und verwendet den von Express erkannten Pfad. Ein Vergleich allein mit dem rohen Request-Target ist unzureichend. Die allgemeine 8-MiB-Grenze für Fahrten bleibt unverändert.

Ein 401 kann ein abgelaufenes Access-Token bedeuten. Eine bestätigte Deautorisierung wird nicht aus einem generischen Clientfehler oder Netzproblem erfunden. Rotation und unklare Antworten behalten die bisherigen sicheren Zustände. Alte Ereignisse und verspätete Ergebnisse erhalten keine Autorität über eine neue Verbindung. Bekannte Upload-IDs und eigene Aufnahmen bleiben erhalten.

Die Subscription wird ausdrücklich nach dem HTTP-Start eingerichtet. Vorhandene andere Callbacks werden nicht gelöscht oder ersetzt. Fehlende, passende, widersprüchliche und unklare Bestände sind unterscheidbar. Verlorene Antworten werden durch erneutes Lesen abgeglichen. Der Verbindungsstart bleibt gesperrt, bis der passende Webhook eingerichtet ist.

## Alternativen

Eine geheime Capability im Callback-URL-Pfad würde den Verifikationsweg verkürzen. Sie würde aber eine Secret-URL-/Logging-Ausnahme schaffen und bei URL-Offenlegung gefälschte Widerrufe erlauben. Das wird verworfen.

Blindes Vertrauen in öffentliche Ereignisse oder automatisches Ersetzen vorhandener Subscriptions wird verworfen. Ebenso wenig darf ein neuer zufälliger Schlüssel alte Chiffrate scheinbar reparieren.

## Folgen und Grenzen

Eine kleine additive Migration hält ausstehende Autorisierungsprüfungen dauerhaft fest. Callback-Antworten bleiben kurz; Provideraufrufe gehören in den koordinierten Worker. Eigene Daten und bisherige Versandbelege werden nicht stillschweigend entfernt.

Henrys Entscheidung gegen Backups bleibt bestehen. Schlüsselverlust kann Reautorisierung nötig machen. Persönliches OAuth, App-Athletenkapazität, tatsächliche Sichtbarkeit und der reale Fahrtpilot brauchen weiterhin den Nutzer. Diese Softwareentscheidung behauptet keine abschließende rechtliche Bewertung der Anbieter-Datenaufbewahrung.
