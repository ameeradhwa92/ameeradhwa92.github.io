# AGENTS.md

Guidance for coding agents other than Claude Code (Codex, Cursor, Gemini, …) working in
`ameeradhwa92.github.io`. **`CLAUDE.md` in this directory is the single source of record —
read it in full before changing anything.** This file was once a copy of it and drifted
within weeks, so it now carries only the rules that must never be skipped.

## Non-negotiables (each is explained in CLAUDE.md)

- Serve with `python -m http.server 8080` — that port exactly, or the cloud AI tier is
  silently lost. Never open `index.html` via `file://`.
- Green means **all** of these pass, not the first alone:

  ```bash
  node --test "tests/*.test.js"
  node tools/test_jd_extractor.mjs
  node tools/test_jd_matcher.mjs
  node tools/test_recruiter_cloud_payload.mjs
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_recruiter_profile.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_recruiter_ui.ps1
  ```

- Bump the `?v=` tag in `index.html` (and nowhere else) on any CSS/JS change.
- A changed fact changes in four places: `index.html` + `assets/js/i18n.js`,
  `assets/data/aimeer-kb.txt`, `docs/resume-source/resume.html` (re-render the PDF), and
  the registry in `docs/superpowers/specs/2026-07-24-portfolio-site-design.md`. Grep the
  `TOPICS` table in `assets/js/chatbot.js` too.
- New visible copy needs both `data-i18n="key"` in `index.html` and the key in `i18n.js`,
  in Dewan Bahasa dan Pustaka register.
- `cloud/aimeer-worker.js` is **not** deployed from this repo. Bump `WORKER_REVISION` on
  every change, say the paste is manual when handing it back, and confirm the live
  revision with `POST {"mode":"version"}` before trusting any live behaviour.
- The JD validators in `assets/js/jd-reasoning.js` and the Worker must change together.
- Amber is for Retired/EOL badges only; iris `--accent` is the interface, coral `--thread`
  is the journey line and nothing else.
- Pushing to `main` is the deploy.
