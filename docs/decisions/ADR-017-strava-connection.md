# ADR-017 – Strava-Verbindung und verschlüsselte Zugangsdaten

- Status: Angenommen (Henrys Freigabe im Chat am 2026-11-27). Serverseitiger Teilschnitt integriert und mit [E10-06](../specs/E10-06-real-strava-activation.md) serverseitig aktiviert; echter Pilot offen.
- Datum: 2026-11-20
- Bezug: [E10-03](../specs/E10-03-strava-connection.md)

## Entscheidung

Ein eigenes Servermodul besitzt Strava-Transaktionen und Verbindungen. Ein allgemeines Integrationsframework wäre die zweite mögliche Form, hätte aber keinen zweiten Nutzer. Accounts und Sessions bleiben bei `auth`. Nur der Composition Root verbindet Tabellenfabriken über `users.id`.

Strava verwendet den dokumentierten vertraulichen OAuth-Codeflow, nicht OIDC. Native `fetch` sendet Formulardaten an feste offizielle Endpunkte. Es gibt keine neue Abhängigkeit, Discovery, ID-Tokenprüfung oder angenommene PKCE-Unterstützung. Grundlage ist die am 20.11.2026 erneut gelesene [offizielle Authentifizierungsdokumentation](https://developers.strava.com/docs/authentication/).

Der authentifizierte Start bindet eine fünf Minuten gültige Transaktion an Account und HttpOnly-Browsercookie. Der Callback beansprucht diese Transaktion einmal vor dem Netzwerkaufruf. Er speichert nur einen unbestätigten verschlüsselten Grant. Erst ein neuer Bearer desselben Eigentümers, derselbe Browser und ein exakter Origin bestätigen die 60 Sekunden gültige Übergabe. Ein fremder Account verbraucht sie nicht.

Ein lokaler Account hat höchstens eine Verbindung. Eine Athleten-ID ist auch bei ausstehendem Widerruf eindeutig. Bestehende Verbindungen werden nicht durch neue Flows ersetzt. Ein Konflikt widerruft keinen Grant automatisch. Unbestätigte abgelaufene Grants bleiben lokal gesperrt und können ausdrücklich getrennt werden, statt ihre letzte widerrufbare Tokenkopie zu verlieren.

AES-256-GCM verschlüsselt Access- und Refresh-Token gemeinsam. Jeder Schreibvorgang nutzt einen zufälligen 12-Byte-Nonce. Authentifizierte Zusatzdaten enthalten exakte Account-ID, Athleten-ID und Schlüsselversion `1`. Die Datenbank enthält Chiffrat, Nonce, Tag und Metadaten, nie den Schlüssel. Der Schlüssel ist ein separat gesichertes Geheimnis. Rotation gehört nicht zu dieser Einheit.

Trennen wechselt vor HTTP dauerhaft nach `revocation_pending`. `/oauth/revoke` erhält Basic-Clientauthentifizierung und den Refresh-Token als Formularfeld. Nur HTTP 200 bestätigt den Widerruf und entfernt das Chiffrat. Timeout, Fehler oder fehlender Schlüssel erhalten den gesperrten Auftrag. Ein erneuter ausdrücklicher Trennbefehl versucht den Widerruf erneut. Es gibt keine automatische Anfrageschleife.

## Folgen

Der öffentliche Status behauptet weder aktuelle Gültigkeit eines Grants noch Uploadfähigkeit. Die Ablaufzeit ist der vom Anbieter gespeicherte Wert. Keine Tokenaktualisierung oder Veröffentlichung wird implementiert. Lokale Protokollfakes beweisen keine Anbieterfreigabe.

Die Integration bleibt standardmäßig deaktiviert. Ein Testanbieter ist ausschließlich über streng auf Loopback begrenzte Entwicklungskonfiguration zulässig und in Produktion verboten. Aktivierung in Produktion bleibt bis zu Logredaktion, Schlüsselbackup, Datenschutz- und Policyklärung sowie genehmigtem Live-Pilot gesperrt.
