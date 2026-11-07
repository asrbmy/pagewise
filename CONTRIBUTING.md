# Contributing

1. `npm install`, then `npm run dev`.
2. Run `npm test` before opening a pull request. Add a test for any behaviour you change (see `tests/`).
3. Keep Pagewise private by design: no analytics, no network requests with document content, no new third-party scripts at runtime.
4. Any HTML that did not come from the editor must pass through `src/io/sanitize.js`.
5. UI text goes through `t('English text')` (see `src/i18n`); add translations to each language file when you can.
6. Describe user-visible changes in `README.md`.
