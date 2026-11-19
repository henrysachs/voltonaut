# ADR-009 – Web auf Cloudflare Pages, API auf Hetzner, Login-Mails über Cloudflare Email Sending (Fallback Resend)

**Status:** Angenommen (2026-11-19). Ersetzt den Hosting-Teil von ADR-002 (GitHub Pages).

## Kontext
Henry hat einen Cloudflare-Account. Der Web-Client ist statisch (Vite-Build), die API läuft auf dem Hetzner-VPS (ADR-004). Für Magic-Link-Login (E5) wird ein Mail-Dienst gebraucht.

## Entscheidung
1. **Web-Hosting: Cloudflare Pages**, Projekt `voltonaut`. Deploy aus GitHub Actions mit **`wrangler pages deploy`** nach grünem `mise run check` (Produktion von `main`, Preview pro PR) – nicht über die Pages-Git-Integration, damit das Gate `mise run check` vor jedem Deploy garantiert ist. Secrets `CLOUDFLARE_API_TOKEN` (Scope: Pages Edit) und `CLOUDFLARE_ACCOUNT_ID` liefert Henry später; bis dahin wird der Deploy-Job übersprungen. Alternative falls gewünscht: Pages-Git-Integration (Build auf Cloudflare) – dann muss Branch-Schutz sicherstellen, dass nur geprüfte Commits auf `main` landen.
2. **Domain (empfohlen):** Web `voltonaut.<domain>`, API `api.voltonaut.<domain>` (Hetzner, optional über Cloudflare-Proxy). Gleiche Site → CORS exakt auf Web-Origin; Auth v1 Bearer-Token, später httpOnly-Cookie möglich (`08-backend.md`).
3. **API-Deploy auf Hetzner** ist in E0 eine **optionale Aufgabe**, freigeschaltet sobald SSH-Deploy-Key und Subdomain vorliegen (`vars.SERVER_DEPLOY_ENABLED`). Bis dahin läuft der Server lokal und in CI.
4. **Login-Mails:** primär **Cloudflare Email Service – Email Sending** (per REST/SMTP aus NestJS), Fallback **Resend Free**; austauschbar über `MailSender`-Interface.
5. `wrangler` als exakt gepinnte devDependency (gilt als ADR-Freigabe für diese Abhängigkeit).

## Konsequenzen
- + Schnelles globales CDN, Preview-Deploys pro PR, Henrys vorhandener Account, DNS/Domain an einem Ort.
- + Gate bleibt einheitlich: nichts wird deployt, was `mise run check` nicht bestanden hat.
- − Cloudflare Email Sending ist **Public Beta** und für beliebige Empfänger nur mit **Workers Paid** (≈ 5 $/Monat, 3 000 Mails inkl.) nutzbar; im Free-Plan nur an verifizierte eigene Adressen. Resend Free (3 000/Monat, 100/Tag) als kostenloser, GA-Fallback.
- − Cloudflare empfiehlt für neue Projekte zunehmend Workers mit Static Assets statt Pages ⚠️ (vor E0 prüfen); Wechsel wäre ein kleiner Workflow-Change, die App bleibt identisch.
- − Zwei Anbieter (Cloudflare + Hetzner) → zwei Sätze Secrets.

## Alternativen
GitHub Pages (ursprünglich; kein Preview pro PR, keine eigene Domain-Verwaltung bei Cloudflare), Web ebenfalls vom VPS ausliefern (ein Anbieter, aber kein CDN, mehr Betrieb), Cloudflare Workers Static Assets (siehe oben), Postmark/Brevo/Amazon SES für Mails.
