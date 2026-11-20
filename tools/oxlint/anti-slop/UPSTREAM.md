# Upstream provenance

- Repository: https://github.com/dmmulroy/anti-slop
- Commit: `13909c9e07590f5a85d93c62712259fe14a883f7`
- Commit date: 2026-10-14
- Plugin version: 0.1.2 (from the upstream `package.json`)
- License: MIT (`LICENSE`)
- Vendored from upstream `src/` into this directory on 2026-11-19.
- Upstream `README.md` and `package.json` are kept for rule documentation and version provenance.
- The vendored `vendor/eslint-stylistic/` files keep their own `LICENSE` and `UPSTREAM.md`.
- Local deviations: none. Effect rules are present in the vendor tree but intentionally not registered, because this project does not use Effect.
- Updates require a new ADR and Henry's approval, per `AGENTS.md` and `CODEOWNERS`.
- Required tool versions from upstream: `oxlint` and `@oxlint/plugins` at exactly 1.78.0, TypeScript tested by upstream at 7.0.2.
