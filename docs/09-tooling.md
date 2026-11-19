# 09 – Tooling & Leitplanken

Ziel: ein **enges Konstrukt**, in dem Menschen und Coding-Agenten nicht unbemerkt Architektur, Typsicherheit oder Qualität aufweichen können. Alles wird von einem einzigen Befehl geprüft: **`mise run check`** – lokal genauso wie in CI. Entscheidung: ADR-007.

## 1. Werkzeuge im Überblick
| Zweck | Werkzeug | Festlegung |
|---|---|---|
| Tool-Versionen + Tasks | **mise** (mise-en-place) | `mise.toml` pinnt Node und pnpm exakt; alle Befehle sind mise-Tasks |
| Paketmanager / Monorepo | **pnpm workspaces** | ADR-006; `packageManager`-Feld + `engine-strict`; CI mit `--frozen-lockfile` |
| Linter | **Oxlint** + vendorte **anti-slop**-Regeln + `oxlint-tsgolint` (type-aware) | strikt, Warnungen = Fehler; **kein ESLint** |
| Formatter | **Oxfmt** (oxc) | exakt gepinnt; Fallback Prettier (s. §5) |
| Typecheck | **TypeScript** (`tsc -b`, Project References) | strengste Einstellungen (§4) |
| Modulgrenzen | **dependency-cruiser** | `.dependency-cruiser.cjs`, Regeln in §6 |
| Tests | **Vitest** (Workspace-Modus), Playwright (E2E im Sim-Modus) | Server-Tests mit `unplugin-swc` (Decorator-Metadaten für NestJS) |
| CI | **GitHub Actions** | führt **genau** `mise run check` aus |

## 2. mise
```toml
# mise.toml (Skizze – exakte Versionen in E0 festlegen und danach nur per PR ändern)
[tools]
node = "24.11.1"      # Platzhalter: aktuelle LTS zum Zeitpunkt von E0 exakt pinnen ❓
pnpm = "10.33.0"      # Platzhalter: exakt pinnen (anti-slop nutzt 10.33.0) ❓

[settings]
experimental = false

[tasks.install]
run = "pnpm install --frozen-lockfile"

[tasks.dev]
description = "Web (Vite) + Server (Nest watch) parallel"
run = "pnpm --parallel --filter @voltonaut/web --filter @voltonaut/server dev"

[tasks."dev:web"]
run = "pnpm --filter @voltonaut/web dev"
[tasks."dev:server"]
run = "pnpm --filter @voltonaut/server dev"

[tasks.fmt]
run = "oxfmt ."
[tasks."fmt:check"]
run = "oxfmt --check ."

[tasks.lint]
run = "oxlint --type-aware --deny-warnings --report-unused-disable-directives"

[tasks.fix]
run = ["oxlint --fix", "oxfmt .", "oxlint --type-aware --deny-warnings"]

[tasks.typecheck]
run = "tsc -b --pretty"

[tasks.depcruise]
run = "depcruise apps packages --config .dependency-cruiser.cjs"

[tasks.guard]
description = "verbotene Escape-Hatches finden (s. §7)"
run = "node scripts/guard.mjs"

[tasks.test]
run = "vitest run"
[tasks."test:e2e"]
run = "playwright test"

[tasks.check]
description = "MUSS grün sein, bevor eine Aufgabe als erledigt gilt"
depends = ["fmt:check", "lint", "typecheck", "depcruise", "guard", "test"]

[tasks.build]
run = "pnpm -r build"
```
Einstieg für jeden (Mensch oder Agent): `mise install && mise run install && mise run check`.

## 3. Oxlint + anti-slop
Basis ist **[dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)** (MIT): ein Satz meinungsstarker Oxlint-JS-Plugin-Regeln, die „beweisarme" TS-Muster ablehnen (unbegründete Type-Assertions, `unknown`/`object`/offene Dictionaries in Verträgen, Modul-Mocking, ad-hoc-`typeof`, ineffiziente Array-/Reduce-Ketten, fehlende Leerzeilen-Struktur). Darauf setzen wir die eingebauten Oxlint-Kategorien und type-aware Regeln.

### Installation (laut anti-slop-README, „meant to be vendored")
- Es gibt **kein npm-Paket**. `src/` aus dem anti-slop-Repo nach **`tools/oxlint/anti-slop/`** kopieren (Stand bei Planung: Commit `13909c9`, 2026-10-13, Plugin-Version 0.1.2) und Herkunft in `tools/oxlint/anti-slop/UPSTREAM.md` festhalten (Commit, Datum, lokale Abweichungen). `src/vendor/eslint-stylistic/LICENSE` + Provenienz mitkopieren.
- `oxlint` und **`@oxlint/plugins` in exakt derselben Version** installieren (anti-slop entwickelt gegen `1.78.0`), beide exakt gepinnt (`pnpm add -D -E oxlint@1.78.0 @oxlint/plugins@1.78.0 oxlint-tsgolint@<passend>`); Upgrades immer gemeinsam.
- Alternative Einrichtung per Agent-Skill: `npx skills add dmmulroy/anti-slop --skill install-anti-slop` (kopiert, konfiguriert, validiert). Updates später ebenfalls über den Skill („update anti-slop while preserving local customizations").
- Effect-Regeln (`anti-slop-effect/*`) **nicht** aktivieren – wir nutzen Effect nicht.

### `oxlint.config.ts` (Root, einzige Lint-Config)
```ts
import { defineConfig } from "oxlint";

export default defineConfig({
  options: { typeAware: true, denyWarnings: true, reportUnusedDisableDirectives: "error" },
  ignorePatterns: [
    ".agent/**", ".agents/**", ".claude/**", ".codex/**", ".continue/**", ".cursor/**",
    ".gemini/**", ".opencode/**", ".pi/**", ".roo/**", ".windsurf/**",
    "tools/oxlint/anti-slop/**",
    "**/dist/**", "apps/server/drizzle/**",
  ],
  jsPlugins: [{ name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" }],
  plugins: ["typescript", "unicorn", "import", "promise", "vitest", "oxc"],
  categories: { correctness: "error", suspicious: "error", perf: "error", pedantic: "error" },
  rules: {
    // --- anti-slop: ALLE generischen Regeln, Stufe error (laut README) ---
    "oxc/no-accumulating-spread": "error",
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",   // Marker: "// SAFETY: <Begründung>"
    // --- zusätzlich: type-aware + Projektregeln ---
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/strict-boolean-expressions": "error",
    "typescript/switch-exhaustiveness-check": "error",
    "typescript/consistent-type-imports": "error",
    "typescript/ban-ts-comment": ["error", { "ts-expect-error": "allow-with-description", "ts-ignore": true, "ts-nocheck": true }],
    "no-console": ["error", { allow: ["warn", "error"] }],
    "import/no-cycle": "error",
    "import/no-default-export": "error",
  },
  overrides: [
    { files: ["oxlint.config.ts", "**/vite.config.ts", "**/vitest.config.ts", "playwright.config.ts", "**/drizzle.config.ts"],
      rules: { "import/no-default-export": "off" } },
  ],
});
```
Regelnamen der eingebauten Kategorien in E0 gegen `oxlint --rules` der gepinnten Version prüfen; Abweichungen in `open-questions.md`, nicht stillschweigend weglassen.

### Regeln für Agenten
- **Warnungen = Fehler** (`denyWarnings`, zusätzlich `--deny-warnings` im Task).
- **Keine anti-slop-Regel** (und keine andere Regel) darf deaktiviert, auf `warn` gesetzt oder per Override abgeschwächt werden ohne **neues/aktualisiertes ADR** im selben PR. Inline-`oxlint-disable` nur mit `-- Begründung` und nur, wenn `guard` es zulässt; ungenutzte Disables sind Fehler.
- Der vendorte Code unter `tools/oxlint/anti-slop/` ist CODEOWNERS-geschützt; Änderungen daran = Policy-Änderung = ADR.
- Reihenfolge beim Fixen: `mise run fix` = `oxlint --fix` → `oxfmt` → `oxlint` (anti-slop fügt nur Leerzeilen ein; Einrückung/Umbruch macht der Formatter).

### Bekannte Reibungspunkte mit unserem Stack (vorab geprüft, ⚠️ in E0 verifizieren)
| Bereich | Regel | Auswirkung / Umgang |
|---|---|---|
| BLE-Parser (`DataView`), Sniffer-JSON, WS-Nachrichten | `no-unknown-parameters`, `no-unknown-returns`, `no-unsafe-dictionary-type`, `no-runtime-typeof` | Rohdaten nur an **einer Grenze** mit Zod parsen (Type-Predicates und `cause` sind erlaubt); danach nur noch konkrete Typen. Passt zu unserem Boundary-Prinzip. |
| three.js (GLTF-Traversal, `as Mesh`) | `require-safety-comment-for-type-assertion`, `no-chained-type-assertions` | `instanceof`-Checks statt `as`; wo nötig `// SAFETY:`-Kommentar. |
| three.js `Shape`, `ShapeGeometry` | `no-shape-in-symbol-names` | Lokale Import-Bindings mit „shape" könnten anschlagen → `import * as THREE` und `THREE.Shape` (Member-Zugriff ist erlaubt) bzw. umbenennen. ⚠️ |
| Tests | `no-module-mocking` (verbietet `vi.mock`) | Gewollt: Fakes über Adapter/DI (`sim/`, Nest `overrideProvider`). |
| NestJS | Decorators selbst sind nicht betroffen; `no-reflect-get/apply` gilt nur für **unseren** Code (Nest nutzt intern `Reflect.getMetadata`). Exception-Filter `catch(exception: unknown)` → über `cause`-Konvention oder Type-Predicate lösen. ⚠️ |
| Type-awareness | anti-slop-Regeln sind **AST/Scope-basiert, nicht type-aware** (lösen nur Aliase in derselben Datei auf) – type-aware Prüfungen kommen von `oxlint-tsgolint`. Beide laufen im selben `oxlint`-Aufruf. |
| Laufzeit | JS-Plugins werden von Oxlint in Node geladen; Plugin-Quelle ist `.ts` → Node mit Type-Stripping nötig (Node ≥ 22.18/24 ✓ über mise). |
| Versionen | Plugin, `oxlint` und `@oxlint/plugins` sind versionsgekoppelt; anti-slop selbst testet gegen TS 7.0.2 / Oxlint 1.78.0. |

## 4. TypeScript – strengste Einstellungen
`tsconfig.base.json` (alle Pakete erben, keines darf Optionen lockern – geprüft durch `guard`):
```jsonc
{
  "compilerOptions": {
    "target": "ES2023", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUnusedLocals": true, "noUnusedParameters": true,
    "allowUnreachableCode": false, "allowUnusedLabels": false,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true, "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": false,
    "composite": true, "declaration": true, "sourceMap": true
  }
}
```
Pro Paket nur erlaubt: `lib`, `types`, `module`/`moduleResolution` (Web: `ESNext`/`Bundler`), `rootDir`/`outDir`, `references`, und für `apps/server` zusätzlich `experimentalDecorators` + `emitDecoratorMetadata` (NestJS). `lib` steuert Umgebungen: `packages/shared`, `packages/engine`, `packages/rules` haben **kein** `DOM` und **keine** `@types/node` → DOM-/Node-APIs dort sind Compilerfehler.
⚠️ Zu prüfen in E0: Unterstützt die gepinnte TypeScript-Version (6.x vs. nativ 7.x) `emitDecoratorMetadata` für NestJS? Falls nicht: Server mit TS 6 / SWC bauen, Typecheck trotzdem strikt (open-questions T4).

## 5. Formatter: Oxfmt
- Entscheidung: **Oxfmt**, weil gleiche Toolchain wie Oxlint, sehr schnell, formatiert TS/JSON/YAML/TOML/Markdown mit einem Werkzeug. Stand Nov 2026: **Beta** (seit Feb 2026), besteht laut oxc 100 % der Prettier-JS/TS-Conformance-Tests, aktuell v0.79.
- Ignore-Liste wie bei Oxlint (Agent-Verzeichnisse, `tools/oxlint/anti-slop/**`, `dist`), damit vendorter Code nicht umformatiert wird.
- Absicherung: **exakte Version pinnen** (Formatierungsänderungen nur per PR, der `mise run fmt` laufen lässt); `.oxfmtrc.json` mit `printWidth: 100`.
- Fallback: Wenn Oxfmt bei uns Fehler produziert, Wechsel auf Prettier mit äquivalenter Config (`oxfmt` → `prettier --check`), als ADR-Nachtrag.

## 6. dependency-cruiser – Modulgrenzen
`.dependency-cruiser.cjs`, alle Regeln `severity: "error"`:
| Regel | Inhalt |
|---|---|
| `no-cross-app` | `apps/web` ↛ `apps/server` und umgekehrt |
| `packages-not-to-apps` | `packages/*` ↛ `apps/*` |
| `shared-is-leaf` | `packages/shared` importiert nur `zod`; keine Node-Builtins (`dependencyTypes: ["core"]`), kein `three`, keine anderen Workspace-Pakete |
| `engine-pure` | `packages/engine` → nur `packages/shared`; kein `three`, keine Node-Builtins, kein `packages/ble` |
| `rules-pure` | `packages/rules` → nur `shared`, `engine` (öffentlicher Einstieg) |
| `ble-isolated` | `packages/ble` → nur `shared`; nicht `engine`, nicht `three` |
| `engine-internal-private` | Pfade `packages/engine/src/internal/**` (enthält den **mutierbaren** `RideState` und `tick`-Interna) dürfen nur aus `packages/engine/src/**` importiert werden. Alle anderen sehen nur `@voltonaut/engine` (Export: `RideSnapshot` = `Readonly`, `createEngine()`, Intents) |
| `web-layers` | in `apps/web/src`: `world`, `avatar`, `game`, `ui` dürfen `engine` nur über den öffentlichen Einstieg importieren und untereinander nur: `ui → game, avatar(nur customize-API)`; `world`/`avatar` ↛ `ui`; `sync`, `net` ↛ `world`, `avatar` |
| `three-only-in-render` | `three` nur in `apps/web/src/{world,avatar}/**` und `apps/web/src/ui/garage/**` |
| `server-no-browser` | `apps/server` ↛ `packages/ble`, `three`, `apps/web` |
| `no-circular` | keine Zyklen |
| `no-orphans` | keine verwaisten Module (außer Configs, Tests) |
| `not-to-dev-dep` | Produktionscode importiert keine devDependencies |
| `not-to-unresolvable` | alle Importe auflösbar |
Ehrlich: dependency-cruiser prüft **Importe**, nicht **Schreibzugriffe**. „Nur engine schreibt RideState" wird deshalb dreifach abgesichert: (1) mutierbarer Typ liegt in `internal/` (depcruise), (2) nach außen nur `Readonly`/`DeepReadonly`-Snapshots (TypeScript), (3) Snapshots in Dev/Test per `Object.freeze` (Laufzeit, Test schlägt bei Schreibversuch fehl).

## 7. `guard` – Escape-Hatches verbieten
`scripts/guard.mjs` (kleines Node-Skript ohne Abhängigkeiten) schlägt fehl bei:
- `as`-Assertions ohne `// SAFETY:` werden schon von anti-slop abgelehnt; `guard` ergänzt:
- `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error` ohne Begründungstext, `oxlint-disable` ohne `-- Begründung`, jeglichem `eslint-disable`.
- `as any`, `as unknown as` außerhalb von `**/*.test.ts` und `packages/ble/src/**/parse*.ts` (dort nur mit Kommentar).
- gelockerten Compiler-Optionen in irgendeiner `tsconfig*.json` (Vergleich gegen erlaubte Overrides aus §4).
- `oxlint.config.ts`/`.dependency-cruiser.cjs`, deren Regeln auf `off`/`warn` gesetzt wurden, ohne dass ein ADR im selben PR geändert wurde (Diff-Check in CI über `git diff origin/main --name-only`).
- neuen Einträgen in `dependencies`/`devDependencies` ohne Eintrag in `docs/dependencies.md` (Paket, Zweck, ADR-Verweis).

## 8. CI & Branch-Schutz
`.github/workflows/check.yml`: Trigger `pull_request` + `push` auf `main`; Schritte: Checkout (`fetch-depth: 0` für Diff-Check) → `jdx/mise-action` (installiert gepinnte Tools) → `mise run install` → **`mise run check`**. Nichts anderes; wer lokal grün hat, hat in CI grün. Einzige Ergänzung: Job `mutation` (`mise run check:mutation`) auf PRs mit Änderungen in `packages/engine`/`packages/rules` und nächtlich – dann ebenfalls Required (`10-testing.md` §9).
Weitere Workflows: `deploy-web.yml` (nach grünem `check` auf `main`: `mise run build` → `wrangler pages deploy apps/web/dist --project-name voltonaut`; PRs → Preview-Deploy; Secrets `CLOUDFLARE_API_TOKEN` (nur Pages: Edit) und `CLOUDFLARE_ACCOUNT_ID` liefert Henry später – bis dahin übersprungen), `deploy-server.yml` (SSH-Deploy, nur wenn `vars.SERVER_DEPLOY_ENABLED` gesetzt, ADR-009). `wrangler` als exakt gepinnte devDependency.
Empfohlener Branch-Schutz für `main` (Ruleset):
- PR Pflicht, kein direkter Push, kein Force-Push, kein Löschen.
- Required Status Check: `check` (strict: Branch muss aktuell sein).
- Linear History (Squash-Merge).
- `CODEOWNERS`: `@henrysachs` muss Änderungen an `mise.toml`, `tsconfig*.json`, `oxlint.config.ts`, `tools/oxlint/**`, `.oxfmtrc.json`, `.dependency-cruiser.cjs`, `scripts/guard.mjs`, `.github/**`, `pnpm-workspace.yaml`, `docs/decisions/**`, `fixtures/**` (BLE, Golden, API), `apps/web/e2e/__screenshots__/**` freigeben → Agenten können Leitplanken nicht selbst lockern.
- pnpm: `onlyBuiltDependencies` (Install-Skripte nur für freigegebene Pakete), `strict-peer-dependencies=true`.

## Quellen
- anti-slop: https://github.com/dmmulroy/anti-slop (README: Installation, Regeln, Analysegrenzen)
- Oxlint type-aware stabil (tsgolint v7): https://oxc.rs/blog/2026-07-22-type-aware-linting-stable · CLI (`--deny-warnings`): https://oxc.rs/docs/guide/usage/linter/cli.html
- Oxfmt Beta: https://oxc.rs/blog/2026-02-24-oxfmt-beta.html · Releases: https://github.com/oxc-project/oxc/blob/main/apps/oxfmt/CHANGELOG.md
