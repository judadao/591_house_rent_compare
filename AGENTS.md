# Repository Guidelines

## Project Structure & Module Organization

This repository is currently initialized with contributor documentation only. As implementation begins, keep application code under `src/`, tests under `tests/`, and reusable static assets under `assets/`. Use clear feature-oriented subdirectories, for example `src/scrapers/`, `src/parsers/`, or `src/ui/`, rather than placing unrelated files at the repository root.

Keep configuration files such as `.env.example`, linter settings, and package manifests in the root so setup remains discoverable. Do not commit generated output, local caches, credentials, or downloaded datasets unless they are intentionally versioned fixtures.

## Build, Test, and Development Commands

No build or test tooling has been added yet. When tooling is introduced, document the canonical commands here and keep them stable. Recommended examples:

```bash
npm install      # install Node.js dependencies
npm run dev      # start the local development workflow
npm test         # run the test suite
npm run lint     # run static checks
```

If the project uses another stack, replace these examples with the actual commands and prefer one command per common task.

## Coding Style & Naming Conventions

Follow the conventions of the language and framework selected for the implementation. Use consistent indentation across the codebase, descriptive file names, and small modules with focused responsibilities. Prefer names that describe domain behavior, such as `rentListingParser` or `compareListings`, over vague names like `utils` when a more precise module name is available.

Add formatters and linters early, then run them before committing. Keep comments concise and reserve them for non-obvious behavior or external constraints.

## Testing Guidelines

Place tests in `tests/` or alongside source files using a clear suffix such as `.test.js`, `.spec.ts`, or the equivalent for the chosen stack. Cover parsing, comparison logic, and any network or file handling with fixtures so tests are repeatable. Avoid tests that depend on live external services unless they are explicitly marked as integration tests.

## Commit & Pull Request Guidelines

This repository has no existing Git history, so use short imperative commit messages such as `Add listing parser` or `Document setup commands`. Pull requests should include a concise description, test results, linked issues when relevant, and screenshots or sample output for user-facing changes.

## Security & Configuration Tips

Store secrets in local environment files and commit only safe templates such as `.env.example`. Review scraped or exported data before committing to avoid exposing personal information.
