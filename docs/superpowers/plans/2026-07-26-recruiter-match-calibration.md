# Recruiter JD Match Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recruiter JD matching truthful and useful by extracting meaningful requirements, ignoring application-only text, and scoring only JD-relevant categories with better evidence mappings.

**Architecture:** Keep deterministic scoring in `assets/js/jd-matcher.js`, improve the normalized JD contract in `assets/js/jd-extractor.js`, and store additional published/user-provided evidence in `assets/data/aimeer-profile.json` plus the chatbot KB. Categories absent from a JD remain visible as `Not specified` and do not lower the active-requirement compatibility estimate.

**Tech Stack:** Vanilla JavaScript, JSON, plain-text KB, Node.js built-in test runner, PowerShell verification scripts.

## Global Constraints

- The score remains an estimate based only on the pasted JD and Ameer’s published profile.
- The score is not an objective hiring decision, technical assessment, or guarantee of suitability.
- Professional, academic, published-profile, and user-provided evidence remain visibly distinct.
- Salary, NRIC, home address, date of birth, benefits, leave, medical details, signatures, and confidential contract language stay excluded.
- No framework, build step, or new runtime dependency is introduced.

### Task 1: Add regression coverage for structured matching

**Files:**
- Modify: `tools/test_jd_matcher.mjs`

- [x] **Step 1: Write failing tests** for the supplied Laravel JD covering ignored employer questions, separate five-year and two-year thresholds, Agile/AI-assisted development evidence, active-category scoring, and `Not specified`-eligible inactive categories.
- [x] **Step 2: Run the focused matcher test** and confirm the new assertions fail against the current parser/scorer.

### Task 2: Improve JD extraction and requirement classification

**Files:**
- Modify: `assets/js/jd-extractor.js`
- Modify: `assets/js/jd-matcher.js`

- [x] **Step 1: Add section-aware filtering** for employer/application questions, salary prompts, work location, and administrative lines.
- [x] **Step 2: Extract multiple independent year thresholds** from a single prose line and preserve their nearby technology/context terms.
- [x] **Step 3: Add canonical aliases for delivery practices and professional capabilities** such as Agile, SQL databases, AI-assisted coding, testing, code review, documentation, stakeholder collaboration, troubleshooting, deployment, and production support.
- [x] **Step 4: Group responsibility prose into meaningful requirements** instead of scoring every leftover sentence as an unknown technology.
- [x] **Step 5: Calculate compatibility against active JD categories only**, while retaining category metadata for UI display.
- [x] **Step 6: Distinguish low evidence confidence from low compatibility**, so generic prose does not make a strong profile appear unreliable.
- [x] **Step 7: Run the focused matcher tests and keep the implementation minimal until green.**

### Task 3: Extend profile and KB evidence without overstating claims

**Files:**
- Modify: `assets/data/aimeer-profile.json`
- Modify: `assets/data/aimeer-kb.txt`
- Modify: `assets/js/chatbot.js`

- [x] **Step 1: Add Agile delivery and Claude Code/Codex usage as explicitly labelled user-provided/project context.**
- [x] **Step 2: Add published evidence for the portfolio, Abbott CRM, React BackOffice, AI-assisted development, testing, documentation, and production delivery where already supported by the public profile/resume.**
- [x] **Step 3: Update recruiter explanation copy so `Not specified` categories are not described as gaps.**
- [x] **Step 4: Preserve the recruiter disclaimer in all score and AI explanation paths.**

### Task 4: Verify and hand off

**Files:**
- Modify: `docs/superpowers/specs/2026-07-24-portfolio-site-design.md` only if the canonical recruiter scoring behavior is documented there.

- [x] **Step 1: Run the matcher, extractor, cloud payload, UI, and existing Node tests.**
- [x] **Step 2: Run `git diff --check` and inspect the exact regression output.**
- [x] **Step 3: Report the calibrated score, evidence interpretation, changed files, and whether the Cloudflare Worker source needs manual redeployment.**
