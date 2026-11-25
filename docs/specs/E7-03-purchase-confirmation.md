# Spec E7-03 – Kauf erst nach Bestätigung

- **Roadmap-Bezug:** `docs/07-roadmap.md` → E7, Shop mit Preisen in ⚡
- **Issue:** #115 · Abhängigkeit: [E7-02](E7-02-server-inventory-shop.md)
- **Status:** Implementiert und softwaregeprüft (Unit, E2E angemeldet mit gemocktem Server). Merge und Bereitstellung offen.
- **Betroffene Module:** `apps/web/src/ui/garage`. Keine Server- oder Vertragsänderung, keine neue Abhängigkeit.

## Ziel

Käufe sind endgültig (`docs/06-gamification.md`). Ein Fehlklick, ein doppelter Tastendruck oder ein Tipper auf dem Handy darf keine Volts kosten. Der Kauf wird deshalb zweistufig, nach dem Muster des Hard Reload im App-Tab.

## Abnahmekriterien

- [x] AK1 – „Kaufen (n ⚡)“ öffnet eine Bestätigung mit Item, Preis und Kontostand danach. Erst „Ja, für n ⚡ kaufen“ sendet `POST /v1/shop/purchase`. „Abbrechen“ schließt die Bestätigung und gibt den Fokus an den Kaufknopf zurück.
- [x] AK2 – Beim Öffnen liegt der Fokus auf „Abbrechen“. Wiederholtes Enter wechselt nur zwischen Kaufknopf und „Abbrechen“ und kauft nie.
- [x] AK3 – Bestätigen und Abbrechen verweisen per `aria-describedby` auf die Frage mit Preis und Warnung. Die Bestätigung ist eine benannte Gruppe.
- [x] AK4 – Die Bestätigung hält den angezeigten Preis fest und sendet ihn als `expectedPriceVolts`. Ändert sich der Preis, bleibt `price_changed` die endgültige Serverantwort. Wird das Item gewechselt oder ist es nicht mehr kaufbar (Kontostand, Besitz, laufender Kauf, Abmeldung), schließt sich die Bestätigung.
- [x] AK5 – E2E: Ein Klick ohne Bestätigung schickt keinen Kauf-Request, mit Bestätigung genau einen.

## Testplan

| AK       | Ebene | Datei                                          |
| -------- | ----- | ---------------------------------------------- |
| AK1, AK4 | Unit  | `apps/web/src/ui/garage/purchaseOffer.test.ts` |
| AK1–AK5  | E2E   | `apps/web/e2e/garage-purchase.spec.ts`         |

## Nicht-Ziele

Kein Rückkauf, keine Rückerstattung, keine serverseitige Bestätigung.
