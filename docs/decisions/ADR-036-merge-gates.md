# ADR-036 – Merge-Gates ohne Bypass, Sign-off im Guard, engere ADR-Ausnahme

**Status:** Angenommen (Henrys Freigabe im Chat am 2026-11-27: Agenten dürfen die Merge-Gates erzwingen und den Guard verschärfen).

## Kontext

Ein Audit von 82 PRs ergab:

- Jeder Push auf `main` seit #101 ging am Ruleset 27708042 `main-branch-protection` vorbei. Der Admin-Bypass im Modus `pull_request` deckt dort auch die Required Checks ab. So wurden PRs mit rotem oder noch laufendem `check` gemergt (#138, #158, #135, #129, #126, #169).
- `main` war von #138 bis #168 rot, 5 API-Deploys schlugen fehl.
- `mutation` lief bei #138 und #158 erst nach dem Merge.
- 11 Commits auf `main` tragen `Co-Authored-By: Claude`, 26 Nicht-Merge-Commits haben kein `Signed-off-by`.
- Der Non-null-Regex des Guards meldete `!(x instanceof Y)` (5d00ee7).
- Jede geänderte `docs/decisions/ADR-*`-Datei schaltete **alle** geschützten Pfade frei (`scripts/guard/lib/protected-diff.ts`, alte Zeile 28). Ein Tippfehler in ADR-007 hätte mise.toml und oxlint.config.ts freigegeben, weil ADR-007 beide nennt.
- In Trainer-Control (#129, #131) und Strava (#130, #132) fanden Reviewer Tests, die kaputtes Verhalten überleben, nur mit handgeschriebenen Mutanten.

## Entscheidung

### 1. Zwei Rulesets statt einem

Ruleset 27708042 wird zu **`main-pr-review`** (A): nur das PR-Review, Admin-Bypass weiter im Modus `pull_request` für Selbst-Merges ohne fremdes Approval.

```json
{
  "name": "main-pr-review",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" }],
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "required_reviewers": [],
        "require_code_owner_review": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "require_extra_approval_for_unattributed_changes": true,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    }
  ]
}
```

Neu ist **`main-merge-gates`** (B): Required Checks `check` und `mutation`, strict, **ohne Bypass-Akteure**. Force-Push- und Löschschutz wandern aus A hierher, damit auch sie keinen Bypass haben. `integration_id` 15368 ist die App „GitHub Actions“. Ein gleichnamiger Status aus einer anderen Quelle erfüllt den Check deshalb nicht.

```json
{
  "name": "main-merge-gates",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "check", "integration_id": 15368 },
          { "context": "mutation", "integration_id": 15368 }
        ]
      }
    },
    { "type": "non_fast_forward" },
    { "type": "deletion" }
  ]
}
```

Geprüft an den Workflows und der API:

- `.github/workflows/mutation.yml` hat `on: pull_request` ohne `paths`/`branches` und läuft auf jedem PR. Der Job heißt `name: mutation`. GitHub meldet ihn als Check-Run `mutation`, bei Off-Scope-PRs als `skipped` (Lauf 46029485489). Ein übersprungener Job zählt als bestanden.
- Schlägt die Scope-Erkennung fehl, würde ein übersprungener `mutation` als grün gelten. Der Schritt läuft deshalb mit `shell: bash` (pipefail) und weist `git diff` erst einer Variable zu, sodass ein Fehler den Schritt abbricht statt `core=false` zu melden. Der Job `mutation` läuft auch bei einem fehlgeschlagenen `paths`-Job und bricht dann rot ab.
- Bisher meldeten auf PRs zwei Jobs den Kontext `check`: `check.yml` und `deploy-web.yml`. In `.github/workflows/deploy-web.yml` heißt das Gate jetzt `web-check` und läuft nur auf Pushes nach `main`, vor dem Produktionsdeploy. Die Pages-Vorschau pro PR (`AGENTS.md` §7) braucht nur die Secrets-Erkennung und baut selbst; sie wartet nicht mehr auf ein zweites volles Gate. Auf PRs meldet damit nur `check.yml` den Kontext `check`.

Henry setzt beide Rulesets und `web_commit_signoff_required=true` nach dem Merge per GitHub-API. Agenten ändern Rulesets und Repo-Einstellungen nicht.

### 2. Sign-off und KI-Trailer im Guard

`scripts/guard/lib/commit-trailers.ts` prüft die Nicht-Merge-Commits in `GUARD_DIFF_BASE..HEAD`. Git parst die Trailer selbst (`%(trailers:only,unfold)`), genau wie `git interpret-trailers --parse`:

- Jeder Commit braucht `Signed-off-by`.
- Verboten sind `Co-Authored-By` mit einer Adresse unter `@anthropic.com` (etwa `noreply@anthropic.com`), jeder `Claude-Session`-Trailer und eine Autor-Adresse unter `@anthropic.com`. Ein Mensch namens Claude (`claude.martin@example.com`) bleibt erlaubt. GitHub macht beim Squash aus jedem PR-Commit-Autor eine Zeile `Co-authored-by:`. So entstand in a470bd1 `Co-authored-by: Claude <noreply@anthropic.com>`.

Die Prüfung läuft nur auf PRs. `check.yml` setzt `GUARD_DIFF_BASE=origin/<base_ref>` nur bei `pull_request`. Auf Push-Läufen von `main` fehlt die Variable, und der Guard prüft weder Diff noch Trailer. Squash-Commits schreibt GitHub selbst. 2ec2dee und dc0f2e0 tragen Sign-offs mitten im Text und zusätzlich einen Trailer-Block am Ende. Der Test liest beide wie Git und findet nichts. a470bd1 schlägt fehl. Der synthetische Merge-Commit des PR-Merge-Refs fällt durch `--no-merges` heraus. Fehlt diese Historie (flacher Klon), überspringt der Test sich mit Meldung.

Der Sign-off ist nicht an den Commit-Autor gebunden: Jeder `Signed-off-by` genügt. Das ist bewusst lockerer als DCO; er belegt die Zustimmung eines Menschen, nicht die Urheberschaft.

### 3. Non-null-Regex entfällt

Oxlint prüft `typescript/no-non-null-assertion` als Fehler am AST (oxlint.config.ts). `scripts/guard/lib/lint-configs.ts` verlangt die Regel. Eine Probedatei außerhalb des Repos mit `x!.y` meldet `typescript(no-non-null-assertion)`, `!(x instanceof Error)` meldet nichts. Der Regex in `scripts/guard/lib/escape-hatches.ts` ist doppelt und ungenau und wird gelöscht. Tests prüfen: Der Guard meldet `!(x instanceof Y)` nicht, und das Fehlen der Oxlint-Regel bleibt ein Fund.

### 4. ADR-Ausnahme nur für genannte Pfade

`scripts/guard/lib/protected-diff.ts`:

- Ohne geändertes ADR bleibt jeder geschützte Pfad rot.
- Mit geändertem ADR bleibt `docs/decisions/**` frei.
- Jeden anderen geschützten Pfad muss eine Zeile in Backticks nennen, die der Diff einem ADR **hinzufügt**, exakt (Backticks um mise.toml) oder als Verzeichnis mit Schrägstrich am Ende (Backticks um .github/workflows/). Gelesen werden nur die `+`-Zeilen aus `git diff -U0 <base>...HEAD -- docs/decisions/`. Ein neues ADR fügt alle Zeilen hinzu und zählt ganz. Ein Tippfehler in ADR-007 oder ADR-034 schaltet damit nichts frei, was diese ADRs früher nannten. Die Meldung nennt den fehlenden Pfad.
- `stryker.config.json` ist neu geschützt (Guard und CODEOWNERS), damit niemand die Mutationsschwelle des neuen Required Checks still senkt.

Dieser PR ändert folgende geschützte Pfade: `.github/workflows/mutation.yml`, `.github/workflows/deploy-web.yml`, `.github/CODEOWNERS`, `stryker.config.json`, `scripts/guard/`, `scripts/guard.test.mjs` und dieses ADR mit `docs/decisions/README.md`. Ein Test spielt genau diese Pfade gegen dieses ADR durch. Ein späterer Diff an diesem ADR gibt nur die Pfade frei, die er selbst hinzufügt.

### 5. Mutationsumfang

Gemessen lokal mit Stryker unter dem Check-Lock auf ruhiger Maschine, break-Schwelle 80:

| Datei | Score | Mutanten | Entscheidung |
|---|---|---|---|
| `apps/server/src/strava/strava.rate-store.ts` | 89,67 % | 300 | aufgenommen |
| `packages/ble/src/ftms/controlCodec.ts` | 83,82 % | 68 | aufgenommen |
| `packages/ble/src/ftms/controlConnection.ts` | 82,11 % | 95 | aufgenommen |
| `packages/ble/src/ftms/controlSession.ts` | 75,17 % | 298 | Folgearbeit |
| `packages/ble/src/ftms/controlProcedure.ts` | 72,97 % | 185 | Folgearbeit |
| `apps/server/src/strava/strava.delivery-step.ts` | 65,36 % | 179 | Folgearbeit |
| `packages/ble/src/ftms/controlSim.ts` | 37,88 % | 66 | Folgearbeit |

`control.ts` enthält nur Typ-Reexporte und `apps/web/src/game/controlConnection.ts` existiert nicht. Die Trainer-Control-Verbindung liegt in `packages/ble/src/ftms/controlConnection.ts`. Die drei aufgenommenen Dateien ergeben zusammen 87,26 % (404 Mutanten, 4 min 8 s lokal bei `--concurrency 4`). CI speichert die Incremental-Datei nicht und rechnet jeden Lauf voll. Der nächtliche Lauf vom 27.11. brauchte für 6100 Engine-/Rules-Mutanten 45 min 52 s. Die 404 neuen Mutanten haben langsamere Tests (Dry-Run 72 s statt 15 s). Geschätzt kommen pro Lauf 5–10 min hinzu. Das ist nicht in CI gemessen; der erste Lauf dieses PRs liefert den Wert. Die vier Folgedateien brauchen Verhaltenstests gegen ihre Überlebenden. Die Schwelle sinkt nicht, und es gibt keine Ausnahmen. Die Scope-Erkennung in `.github/workflows/mutation.yml` startet den Job bei Änderungen unter `packages/ble/src/ftms/`, `apps/server/src/strava/` und an `stryker.config.json`, also auch bei Teständerungen.

## Konsequenzen

- Ein roter, laufender oder fehlender `check` oder `mutation` blockiert jeden Merge, auch Henrys. Ein kaputtes `main` kann nur ein grüner Fix-PR reparieren.
- Strict plus `mutation` (heute 45–95 min auf PRs) verlangt nach jedem Merge ein Update und einen neuen Lauf betroffener PRs. Das ist gewollt: Mutation vor dem Merge, nicht danach.
- Offene PRs ohne Sign-off (#178, #182, #183) werden nach dem Merge rot. Abhilfe: `git rebase --signoff origin/main`.
- Eine Leitplankenänderung braucht ein ADR, dessen im selben Diff hinzugefügte Zeilen den Pfad ausdrücklich nennen. Ein beliebiges geändertes ADR oder ein altes ADR, das den Pfad irgendwann nannte, genügt nicht mehr.

## Alternativen

- **Bypass-Akteure in B belassen, Disziplin vereinbaren:** verworfen, das war der Stand seit #101.
- **`mutation` per Workflow-`paths` filtern:** verworfen. Ohne Lauf meldet der Kontext nie, und der PR blockiert für immer.
- **Trailer auch auf `main`-Pushes prüfen:** verworfen. GitHub erzeugt den Squash-Text, die Prüfung käme erst nach dem Merge. Sign-off für Web-Commits erzwingt `web_commit_signoff_required`.
- **Nicht bestehende Dateien mit Ausnahmen aufnehmen:** verworfen (`AGENTS.md` §0.2).
- **Merge Queue:** für Repos eines Nutzerkontos nicht verfügbar. Sie würde strict ohne ständige Updates ersetzen; neu prüfen, falls das Repo in eine Organisation wandert.
- **Folgearbeit:** Überlebende der vier Folgedateien töten und die Dateien aufnehmen.
