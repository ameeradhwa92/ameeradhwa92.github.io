# Recruiter Knowledge Base and JD Matching Design

**Date:** 2026-07-26  
**Status:** Approved for planning

## Goal

Expand AIMeer with verified recruiter-facing profile facts and a browser-side job-description matcher that accepts pasted text, PDF files, and DOCX files while clearly presenting its score as an estimate rather than an objective hiring decision.

## Scope

This change has two connected sub-projects:

1. Enrich the shared AIMeer knowledge base with recruiter-useful facts mined from the appointment letter, redesignation letter, diploma transcript, and degree transcript.
2. Add a recruiter matching mode to the existing chatbot, including local PDF/DOCX extraction, evidence-based scoring, bilingual UI copy, and a prominent estimate disclaimer.

The feature remains compatible with the current no-framework, no-build-step GitHub Pages architecture.

## Verified source facts

The public KB may include the following facts:

- Current designation: Full Stack Web Specialist at RetailAIM Malaysia Sdn. Bhd.
- Previous designation: Web Application Developer.
- Current employment commencement date: 14 August 2023.
- Redesignation effective date: 1 August 2025.
- The redesignation followed outstanding performance in the previous role and changes to the company’s organizational structure. The performance context is supplied by Ameer; the letter itself confirms the new designation and organizational-structure change.
- Contractual notice period: three months after confirmation, based on the appointment letter. Public wording must identify this as the stated contractual notice period and avoid implying that it can never change.
- Diploma in Computer Science, UiTM Dungun, completed May 2013, CGPA 3.03.
- Bachelor of Information Technology (Hons.) Intelligent Systems Engineering, UiTM Shah Alam, completed April 2016, CGPA 2.79.
- Diploma subjects relevant to matching: structured programming, object-oriented programming, web application development, database management systems, data structures, operating systems, information systems development, networking, visual programming, and programming paradigms.
- Degree subjects relevant to matching: algorithms and algorithm analysis, artificial intelligence programming paradigms, artificial neural networks, knowledge-based systems, fuzzy logic, data mining, evolutionary algorithms, intelligent decision support systems, intelligent agents, IT project management, ethical/social/professional issues, and industrial attachment.
- Academic projects already represented in the profile: PHP bus-ticketing system and Android road-tax sticker recognition using Tesseract OCR.

The KB must not include the source documents’ NRIC numbers, home address, date of birth, salary, benefits, leave entitlement, medical coverage, employee-confidentiality clauses, signatures, or other employment-contract terms that do not help a recruiter evaluate fit.

## Recruiter matching behavior

The chatbot gains a recruiter mode launched by a visible “Match a JD” control. The mode supports:

- Pasting a job description into a text area.
- Selecting a local PDF file.
- Selecting a local DOCX file.
- Replacing or clearing the current JD.
- Running an analysis only after the recruiter explicitly submits it.

PDF and DOCX files are parsed in the browser. The raw file and extracted JD remain in memory and are not persisted. File size and extracted-text limits prevent accidental browser overload; unsupported, encrypted, image-only, or malformed documents receive a clear fallback instructing the recruiter to paste the text instead.

The extraction layer produces normalized text and preserves enough section context to recognize responsibilities, required qualifications, preferred qualifications, technologies, years of experience, and domain terms. Technology aliases are normalized before matching, for example `.NET`/`ASP.NET Core`, `C Sharp`/`C#`, `MS SQL`/`SQL Server`, and `React.js`/`React`.

The score is deterministic and evidence-based. It uses weighted categories:

- Core technologies and frameworks: 35%
- Professional experience and seniority: 20%
- Production architecture, delivery, and cloud/DevOps: 15%
- Domain and integration experience: 10%
- Mobile experience: 5%
- Education and coursework: 10%
- Languages and communication: 5%

Required JD terms carry more weight than preferred terms. Professional production evidence outranks academic exposure. A coursework match is labelled as academic exposure and is never presented as professional experience. Unverified JD requirements are listed separately from genuine gaps.

The result contains the estimated percentage, category breakdown, strong matches, partial/transferable matches, missing or unverified requirements, supporting evidence, and suggested interview topics. It must not claim that the score is a hiring decision, guarantee suitability, or replace technical assessment.

## Disclaimer and privacy copy

Before analysis and above every result, show this exact English disclaimer:

> This is an estimated compatibility score based only on the job description and Ameer’s published profile. It is not an objective hiring decision, technical assessment, or guarantee of suitability.

Provide a formal Bahasa Malaysia equivalent through the existing `data-i18n`/`I18N_MS` model. The disclaimer remains visible even when the narrative explanation is generated by local or cloud AI.

JD text may be sent to the cloud only when the recruiter is already using the cloud AI route and requests an AI-generated explanation. The deterministic score must work without cloud access. The UI must state when an explanation uses secure cloud AI; the default scoring path remains local.

## Architecture

Keep the existing chatbot’s instant, on-device, and cloud tiers. Add a focused recruiter-matching module inside the current chatbot implementation or a small adjacent script, with explicit interfaces:

- `extractJobDescription(file): Promise<{text, source, warnings}>`
- `normalizeJobDescription(text): NormalizedJobDescription`
- `scoreJobDescription(normalizedJd, profileEvidence): MatchResult`
- `renderMatchResult(result): void`

The profile evidence should be structured from the KB’s recruiter section rather than inferred from arbitrary chatbot prose. The existing KB remains the factual source for AI answers and the structured evidence registry becomes the deterministic source for scoring. If both are stored in the same text file, use a clearly delimited machine-readable block that the browser can parse without exposing implementation details in the visible chatbot response.

PDF/DOCX parsing dependencies must be self-hosted because the repository currently permits only the existing WebLLM CDN dependency. No new runtime CDN is allowed. The implementation should avoid a build system and should load parser assets with `defer` in a stable order.

The Worker must continue assembling its persona and KB server-side and must not accept client-provided system prompts. If cloud explanations are added for matching, the Worker should accept a distinct `mode` and validate bounded JD/result payloads before forwarding them to Workers AI.

## Bilingual and accessibility requirements

- Add English DOM strings with `data-i18n` keys and matching formal Bahasa Malaysia strings.
- Keep dynamic recruiter-mode strings in the chatbot `T` table when they are generated by JavaScript.
- Make upload controls keyboard accessible and expose file errors through an `aria-live` region.
- Keep the disclaimer readable on mobile at 375px width.
- Respect `prefers-reduced-motion` and retain a usable text-only path.

## Verification

The implementation plan must include:

- Unit-style browser or Node checks for technology alias normalization, required/preferred weighting, academic-versus-professional labels, and missing-text handling.
- Fixture-based extraction checks for a text PDF, a DOCX, an image-only PDF, an encrypted/invalid file, and pasted text.
- Manual checks at 375, 768, and 1440 widths in both themes and both languages.
- Manual checks that the disclaimer appears before analysis and above every result.
- Manual checks that clearing the recruiter panel removes extracted JD content from the active UI state.
- Verification that instant matching works without the cloud Worker or WebGPU.
- Verification that the public KB contains no salary, NRIC, address, birth date, or confidential contract language.
- Source-pattern checks for matching facts across `index.html`, `i18n.js`, `aimeer-kb.txt`, `chatbot.js`, and the design registry where applicable.

