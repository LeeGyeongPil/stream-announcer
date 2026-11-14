# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-11-14

### Fixed

- `MarkdownGuard` now recognizes code fences and table rows in streams that use `\r\n` line endings (also when `\r` and `\n` arrive in separate chunks), so raw code is no longer announced.

## [0.1.0] - 2026-11-14

### Added

- `createStreamAnnouncer` with `on-complete`, `sentence` and `off` modes, heartbeat, abort and error handling.
- `SentenceBuffer` (sentence boundaries via `Intl.Segmenter`, held last fragment, idle and length flush).
- `MarkdownGuard` and `stripInlineMarkdown`: code fences and tables become short summaries, raw code is never announced.
- `createLiveRegion`: one pre-created status region, queued writes that each stay `spacingMs` (default 150) before the next text replaces them, repeat-text handling, `aria-busy` support.
- `LiveRegion.clear(owner?)` drops texts that are still waiting for their turn (all of them, or only those queued with `announce(text, { owner })`).
- `region` option of `createStreamAnnouncer`: share one live region between several announcers; each one drops only its own waiting texts.
- `abort()` and `error()` drop sentences still waiting in the live region and announce only the final status; `start()` drops everything an earlier response left waiting; `done()` still lets waiting sentences finish before "Response complete.".
- Built-in English and Korean announcement texts with partial overrides.
- `stream-announcer/react`: `useStreamAnnouncer` and `useAnnounceText`.
- `stream-announcer/testing`: `memorySink`, `recordLiveRegion`, `replay`, `naiveAnnounce`.
- Node example (`npm run example`, `--lang en|ko`) and a Vite demo page with an English / Korean menu; the page reads `?mode=&fixture=&speed=&lang=&autoplay=` from the address.

### Known issues

- `node examples/replay.mjs --help` lists `STREAM_ANNOUNCER_LANG` and `LANG` but omits `LC_ALL` and `LC_MESSAGES`, which are also honored for the output language.
