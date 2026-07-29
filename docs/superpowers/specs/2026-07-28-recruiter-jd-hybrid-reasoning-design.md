# Recruiter JD Hybrid Reasoning Design

**Date:** 2026-07-28  
**Status:** Approved for implementation planning

## Goal

Elevate AIMeer's recruiter JD matcher from lexical compatibility scoring into a bounded hybrid assistant that interprets recruiter intent, identifies credible adjacent and transferable capabilities, preserves evidence boundaries, and exposes every remaining verification question without inflating the authoritative deterministic score.

## Non-goals

- Replacing deterministic extraction or scoring with an unconstrained LLM.
- Inferring technology-specific duration from total career tenure.
- Treating academic work or user-provided context as professional delivery.
- Sending the full private profile, contact information, or confidential contract data to an AI model.
- Changing AIMeer's local/cloud routing, cancellation policy, or focused-panel contract.

## Architecture

The matcher uses two stages:

1. `JDExtractor` and `JDMatcher` produce a reproducible deterministic result. This remains the authoritative baseline and retains section-aware extraction, administrative filtering, inactive categories, aliases, provenance, and duration-gap behavior.
2. `JDReasoning` receives only the normalized requirements, deterministic classifications, a bounded recruiter-safe evidence registry, and an allowlisted capability vocabulary. The local or cloud model returns strict JSON. JavaScript validates the response, resolves evidence references, computes any bounded semantic lift, and renders the result.

The browser and Worker use equivalent reasoning instructions and schema validation. The Worker adds a distinct `jd-reasoning` mode, continues assembling persona/profile context server-side, and never accepts client-supplied system prompts.

## Evidence registry

`assets/data/aimeer-profile.json` gains stable recruiter evidence records. Each record has:

```json
{
  "id": "professional.azure-delivery",
  "evidenceType": "professional",
  "claim": "Published project history documents Azure DevOps pipelines, Azure App Service delivery, Bicep infrastructure-as-code, and production deployments.",
  "technologies": ["Azure DevOps", "Azure App Service", "Bicep"],
  "capabilities": ["ci-cd-and-deployment", "infrastructure-as-code", "production-support"],
  "scope": "professional",
  "sourceLabel": "published career history"
}
```

Only these records may be cited by reasoning. Academic and user-provided records retain their existing classifications. Privacy exclusions remain enforced at profile construction, payload construction, Worker validation, and tests.

## Deterministic result contract

`JDMatcher.scoreJobDescription()` keeps the existing `score` property and adds `deterministicScore`, stable requirement IDs, requirement source text, priority, duration metadata, and evidence references. Existing lists and category objects remain compatible with the current renderer and Worker explanation contract.

The deterministic result never consumes an LLM score.

## Structured reasoning contract

The model output uses these match levels:

- `direct-professional`
- `adjacent-professional`
- `transferable-professional`
- `academic-foundation`
- `learning-bridge`
- `explicit-gap`
- `unverified`

Each requirement must include its known requirement ID, recruiter intent, expected outcome, match level, evidence references, transferable capabilities, limitation, recruiter framing, verification question, and confidence. The browser converts valid evidence references into canonical evidence text before rendering.

Unknown requirement IDs, duplicate IDs, unknown evidence references, unsupported capabilities, invalid enums, overlong strings, or malformed JSON invalidate the complete reasoning response.

## Scoring

The existing score remains the deterministic baseline. Priority factors remain `required: 1.00`, `neutral: 0.75`, and `preferred: 0.50`; category weights and inactive-category behavior remain unchanged.

The result additionally exposes:

- `verifiedScore`: literal evidence coverage, with direct professional evidence treated as verified. Academic evidence can verify a literal education requirement but never professional technology delivery.
- `transferableScore`: weighted coverage using validated semantic levels.
- `compositeScore`: a bounded presentation score that cannot exceed the deterministic result plus 15 points and cannot exceed the weighted ceiling imposed by required explicit gaps.

Starting semantic factors are `1.00`, `0.75`, `0.55`, `0.30`, `0.15`, `0`, and `0` in the taxonomy order above. These are calibration priors, not model-provided truth. Semantic lift is allowed only for partial or unverified requirements with valid evidence references. It cannot erase a mandatory gap, create technology-specific duration, or reward willingness to learn without adjacent demonstrated adoption.

## UI

The focused JD panel remains intact and continues to show the AI progress card. The deterministic result renders immediately with its current score and categories. The result view adds:

- deterministic compatibility, verified match, transferable opportunity, and calibrated fit;
- expandable requirement-level reasoning;
- verified strengths, transferable advantages, partial matches, explicit gaps, unverified requirements, learning bridges, and interview questions;
- a concise recruiter narrative;
- visible local/cloud reasoning status and a deterministic fallback message.

All generated content uses `textContent`. Dynamic copy lives in the chatbot `T` table; any new static DOM copy receives both `data-i18n` and formal Bahasa Melayu entries. Existing theme, focus, mobile, and reduced-motion rules remain required.

Reasoning is explicitly requested after the deterministic result appears. This avoids sending JD text to cloud AI by default and preserves useful matching when AI is unavailable.

## Data flow and concurrency

JD text or a local file is normalized, scored, and rendered locally. An explicit reasoning action builds a bounded payload and selects the current local/cloud route. The request captures the current JD analysis token and result identity. Clearing or replacing the JD invalidates both analysis and reasoning tokens. A response for an older JD is ignored.

Local and cloud failures preserve the deterministic result and show a localized fallback. The existing WebLLM generation guards remain untouched.

## Privacy and safety

- No salary, NRIC, address, birth date, benefits, leave, medical information, signatures, or confidential contract language enters the reasoning payload.
- No client-supplied system prompt is accepted by the Worker.
- Evidence references are resolved from the canonical registry rather than trusted from model prose.
- Model prose is bounded, rendered as text, and excluded from score arithmetic.
- Cloud payloads contain only bounded normalized JD text, deterministic requirements/result data, language, and recruiter-safe evidence IDs.

## Verification

The implementation must add dedicated matcher, reasoning, and Worker-contract tests while preserving the existing 31-test suite. Fixtures must cover direct, adjacent, transferable, academic, user-provided, duration-gap, administrative-filtering, unsupported-claim, invalid-reference, score-cap, fallback, stale-response, bilingual, and Laravel-regression behavior. Every changed score must record the old deterministic score, new deterministic score, validated classifications, allowed lift, composite result, and recruiter-defensible explanation.

Cloud Worker changes require manual redeployment through the Cloudflare dashboard after implementation. No Worker redeploy is implied by this design document alone.


