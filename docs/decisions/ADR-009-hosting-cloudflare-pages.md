# ADR-009 – Web auf Cloudflare Pages, API auf Hetzner, Login-Mails über Cloudflare Email Sending (Fallback Resend)

**Status:** Angenommen (2026-11-19). Ersetzt den Hosting-Teil von ADR-002 (GitHub Pages). **Änderung 19.11.2026:** Domains festgezogen (`stammkneipe.dev`); API-Deploy hinter dem vorhandenen Traefik statt Caddy/systemd (ADR-004).

## Kontext
Henry hat einen Cloudflare-Account. Der Web-Client ist statisch (Vite-Build), die API läuft auf dem Hetzner-VPS (ADR-004). Für Magic-Link-Login (E5) wird ein Mail-Dienst gebraucht.

## Entscheidung
1. **Web-Hosting: Cloudflare Pages**, Projekt `voltonaut`. Deploy aus GitHub Actions mit **`wrangler pages deploy`** nach grünem `mise run check` (Produktion von `main`, Preview pro PR) – nicht über die Pages-Git-Integration, damit das Gate `mise run check` vor jedem Deploy garantiert ist. Secrets `CLOUDFLARE_API_TOKEN` (Scope: Pages Edit) und `CLOUDFLARE_ACCOUNT_ID` liefert Henry später; bis dahin wird der Deploy-Job übersprungen. Alternative falls gewünscht: Pages-Git-Integration (Build auf Cloudflare) – dann muss Branch-Schutz sicherstellen, dass nur geprüfte Commits auf `main` landen.
2. **Domains (festgelegt 19.11.2026, Zone `stammkneipe.dev` bei Cloudflare):**
   - Web-App: `voltonaut.stammkneipe.dev` (Cloudflare Pages, Custom Domain).
   - API / WebSocket: `voltonaut-api.stammkneipe.dev` (A-Record auf Henrys Hetzner-VPS).
   Beide Hosts liegen bewusst **eine Ebene** unter der Apex-Domain, weil das kostenlose Cloudflare Universal SSL nur eine Ebene unter der Apex abdeckt (`api.voltonaut.stammkneipe.dev` wäre nicht abgedeckt). Web und API sind verschiedene Origins (CORS exakt auf die Web-Origin `https://voltonaut.stammkneipe.dev`), aber dieselbe Site – Auth v1 Bearer-Token, später httpOnly-Cookie möglich (`08-backend.md`).
   DNS der API: A-Record auf den VPS. Proxy über Cloudflare (orange Wolke) ist für WebSockets in Ordnung; wenn proxied, muss der SSL-Modus **Full (strict)** sein.
3. **API-Deploy auf Hetzner** ist in E0 eine **optionale Aufgabe (E0-opt)**: Docker-Image + Compose-Projekt hinter dem vorhandenen Traefik (ADR-004). SSH-Zugang ist seit 19.11.2026 vorhanden; offen bleiben der DNS-A-Record für `voltonaut-api.stammkneipe.dev` und das CI-Deploy-Secret. Freigeschaltet sobald DNS liegt (`vars.SERVER_DEPLOY_ENABLED`). Bis dahin läuft der Server lokal und in CI.
4. **Login-Mails:** primär **Cloudflare Email Service – Email Sending** (per REST/SMTP aus NestJS), Fallback **Resend Free**; austauschbar über `MailSender`-Interface.
5. `wrangler` als exakt gepinnte devDependency (gilt als ADR-Freigabe für diese Abhängigkeit).

## Konsequenzen
- + Schnelles globales CDN, Preview-Deploys pro PR, Henrys vorhandener Account, DNS/Domain an einem Ort.
- + Gate bleibt einheitlich: nichts wird deployt, was `mise run check` nicht bestanden hat.
- + Festgelegte Hostnamen vermeiden eine zweite Subdomain-Ebene und bleiben im Free-Universal-SSL.
- − Cloudflare Email Sending ist **Public Beta** und für beliebige Empfänger nur mit **Workers Paid** (≈ 5 $/Monat, 3 000 Mails inkl.) nutzbar; im Free-Plan nur an verifizierte eigene Adressen. Resend Free (3 000/Monat, 100/Tag) als kostenloser, GA-Fallback.
- − Cloudflare empfiehlt für neue Projekte zunehmend Workers mit Static Assets statt Pages ⚠️ (vor E0 prüfen); Wechsel wäre ein kleiner Workflow-Change, die App bleibt identisch.
- − Zwei Anbieter (Cloudflare + Hetzner) → zwei Sätze Secrets.
- − Bei proxied API muss Cloudflare SSL auf **Full (strict)** stehen, sonst Zertifikatsfehler oder unsicheres Flexible-SSL gegen Traefik.

## Alternativen
GitHub Pages (ursprünglich; kein Preview pro PR, keine eigene Domain-Verwaltung bei Cloudflare), Web ebenfalls vom VPS ausliefern (ein Anbieter, aber kein CDN, mehr Betrieb), Cloudflare Workers Static Assets (siehe oben), Postmark/Brevo/Amazon SES für Mails, `api.voltonaut.stammkneipe.dev` (verworfen wegen Universal-SSL-Limit).
