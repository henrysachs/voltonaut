# ADR-007 – Strikte Leitplanken: mise, Oxlint + anti-slop, strengstes TS, dependency-cruiser, Oxfmt, `mise run check`

**Status:** Angenommen (2026-11-19)

## Kontext
Voltonaut wird großteils von Coding-Agenten gebaut. Henry: „Mir ist wichtig, dass die Agenten schon ein enges Konstrukt haben, in dem sie nicht ausbrechen können." Ausdrücklich gewünscht: Oxlint, mise-en-place, Oxlint-Regeln aus `dmmulroy/anti-slop`.

## Entscheidung
1. **mise** pinnt Node und pnpm exakt (`mise.toml`) und definiert alle Tasks (`dev`, `test`, `lint`, `typecheck`, `depcruise`, `guard`, `fmt`, `fix`, `check`, `build`).
2. **Oxlint** ist der einzige Linter (kein ESLint). Config `oxlint.config.ts` **erweitert die vendorten anti-slop-Regeln** (`tools/oxlint/anti-slop/`, alle generischen Regeln auf `error`, Installation laut anti-slop-README: `src/` kopieren, `oxlint` + `@oxlint/plugins` exakt gleiche Version), dazu Kategorien `correctness/suspicious/perf/pedantic` und type-aware Regeln (`oxlint-tsgolint`). **Warnungen = Fehler.**
3. **TypeScript strengstens:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnused*`, `verbatimModuleSyntax`, `isolatedModules`, `skipLibCheck: false`. Pakete erben `tsconfig.base.json`, Lockerungen verboten.
4. **dependency-cruiser** erzwingt Modulgrenzen (Apps importieren sich nicht; `shared`/`engine`/`rules` ohne DOM/Node/three; `ble` ohne engine; mutierbarer `RideState` nur in `packages/engine/src/internal`; three.js nur in world/avatar/garage; keine Zyklen).
5. **Oxfmt** als Formatter (Beta, exakt gepinnt; Fallback Prettier per ADR-Nachtrag).
6. **Vitest** für Unit/Integration, Playwright für E2E im Sim-Modus.
7. **`mise run check`** = `fmt:check` + `lint` + `typecheck` + `depcruise` + `guard` + `test`. CI (GitHub Actions) führt **genau diesen** Befehl auf jedem PR und auf `main` aus.
8. **Branch-Schutz** auf `main`: PR-Pflicht, Required Check `check`, kein Force-Push, Linear History; **CODEOWNERS** (`@henrysachs`) für alle Leitplanken-Dateien (`mise.toml`, `tsconfig*`, `oxlint.config.ts`, `tools/oxlint/**`, `.oxfmtrc.json`, `.dependency-cruiser.cjs`, `scripts/guard.mjs`, `.github/**`, `pnpm-workspace.yaml`, `docs/decisions/**`).
9. **Agentenregeln** (AGENTS.md): vor Abschluss `mise run check` grün; keine Lockerung von Lint-/TS-/depcruise-Regeln, kein Deaktivieren einer anti-slop-Regel und keine neue Abhängigkeit ohne ADR.

## Konsequenzen
- + Ein Befehl entscheidet über „fertig"; lokal = CI. Architektur ist maschinell geprüft, nicht nur dokumentiert.
- + anti-slop zwingt zu Boundary-Parsing (Zod) und begründeten Assertions – passt zu BLE-Bytes und Server-Validierung.
- − Höhere Einstiegshürde und mehr Reibung (z. B. `// SAFETY:` an Assertions, kein `vi.mock`, three.js-Namen mit „Shape"). Bewusst in Kauf genommen.
- − Oxfmt ist Beta, anti-slop ist vendort (Updates manuell/per Skill), Oxlint-JS-Plugins und `@oxlint/plugins` sind versionsgekoppelt → Upgrades gebündelt per PR.
- − dependency-cruiser prüft Importe, nicht Schreibzugriffe; „nur engine schreibt RideState" zusätzlich über `Readonly`-Typen und `Object.freeze` in Tests.

## Alternativen
ESLint + typescript-eslint (größtes Ökosystem, aber langsam und von Henry nicht gewünscht), Biome (Linter+Formatter, aber keine anti-slop-Kompatibilität), Prettier/dprint (stabiler als Oxfmt; Prettier bleibt Fallback), Nx-Boundaries (ESLint-gebunden, ADR-006).
