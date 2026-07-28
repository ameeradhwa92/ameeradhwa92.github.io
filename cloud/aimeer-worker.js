/* AIMeer cloud relay — Cloudflare Worker + Workers AI.
   Serves AI answers to devices that can't run the on-device WebLLM model
   (iPhones/iPads, browsers without WebGPU, low-memory GPUs).

   Deploy (free plan, no credit card):
     1. dash.cloudflare.com → Compute (Workers) → Create → "Start with Hello World"
     2. Name it aimeer-ai, deploy, then Edit code → replace everything with this file
     3. Settings → Bindings → Add → Workers AI → variable name: AI
     4. Deploy, then manually paste this updated source into the dashboard editor again
        whenever cloud/aimeer-worker.js changes
     5. Copy the https://aimeer-ai.<subdomain>.workers.dev URL into
        CLOUD_ENDPOINT in assets/js/chatbot.js

   No API key lives anywhere: the model runs on this Worker's own AI binding,
   and only requests from the portfolio site's origin are served. */

const SITE = "https://ameeradhwa92.github.io";
const KB_URL = SITE + "/assets/data/aimeer-kb.txt";
const PROFILE_URL = SITE + "/assets/data/aimeer-profile.json";
const ALLOWED_ORIGINS = [SITE, "http://localhost:8080", "http://127.0.0.1:8080"];
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const JD_EXPLANATION_JD_MAX = 12000;
const JD_EXPLANATION_RESULT_MAX = 12000;
const JD_REASONING_JD_MAX = 12000;
const JD_REASONING_RESULT_MAX = 12000;
const JD_REASONING_REQUIREMENT_MAX = 48;
const JD_REASONING_EVIDENCE_MAX = 24;
const JD_REASONING_MAX_TOKENS = 900;
const JD_REASONING_ROOT_KEYS = ["narrative", "requirements"];
const JD_REASONING_REQUIREMENT_KEYS = [
  "requirementId",
  "recruiterIntent",
  "expectedOutcome",
  "matchLevel",
  "evidenceRefs",
  "transferableCapabilities",
  "limitation",
  "recruiterFraming",
  "verificationQuestion",
  "confidence"
];
const JD_REASONING_TEXT_LIMITS = {
  narrative: 900,
  recruiterIntent: 320,
  expectedOutcome: 320,
  limitation: 320,
  recruiterFraming: 320,
  verificationQuestion: 320
};
const JD_REASONING_MATCH_LEVELS = {
  "direct-professional": true,
  "adjacent-professional": true,
  "transferable-professional": true,
  "academic-foundation": true,
  "learning-bridge": true,
  "explicit-gap": true,
  "unverified": true
};
const JD_REASONING_EVIDENCE_BASED_LEVELS = {
  "direct-professional": true,
  "adjacent-professional": true,
  "transferable-professional": true,
  "academic-foundation": true
};
const JD_REASONING_MATCH_EVIDENCE_TYPES = {
  "direct-professional": { professional: true },
  "adjacent-professional": { professional: true },
  "transferable-professional": { professional: true },
  "academic-foundation": { academic: true },
  "learning-bridge": { professional: true, academic: true }
};
const JD_REASONING_CONFIDENCE = {
  low: true,
  medium: true,
  high: true
};
const JD_REASONING_STRENGTH = {
  required: true,
  neutral: true,
  preferred: true
};
const JD_REASONING_CLASSIFICATION = {
  strong: true,
  partial: true,
  gap: true,
  unverified: true
};
const JD_REASONING_EVIDENCE_TYPES = {
  professional: true,
  academic: true,
  "user-provided": true,
  unverified: true
};
const JD_REASONING_ALLOWED_BODY_KEYS = ["mode", "language", "jdText", "deterministicInput", "evidenceIds"];
const JD_REASONING_ALLOWED_INPUT_KEYS = ["requirements", "deterministicResult"];
const JD_REASONING_ALLOWED_REQUIREMENT_KEYS = [
  "id",
  "term",
  "original",
  "strength",
  "category",
  "yearsRequired",
  "specificHandsOn",
  "classification",
  "evidenceType",
  "evidenceRefs"
];
const JD_REASONING_ALLOWED_RESULT_KEYS = [
  "score",
  "deterministicScore",
  "confidence",
  "categories",
  "strongMatches",
  "partialMatches",
  "gaps",
  "unverified"
];
const JD_REASONING_ALLOWED_MATCH_ITEM_KEYS = ["term", "label", "evidenceType", "evidenceRefs"];
const JD_REASONING_ALLOWED_CATEGORY_KEYS = [
  "score",
  "weight",
  "active",
  "key",
  "label",
  "matchedRequirements",
  "totalRequirements"
];
const JD_CATEGORY_KEYS = [
  "coreTechnologies",
  "professionalExperience",
  "architectureDeliveryCloud",
  "domainIntegrations",
  "mobile",
  "educationCoursework",
  "languagesCommunication",
];
const JD_RESULT_LIST_KEYS = ["strongMatches", "partialMatches", "gaps", "unverified", "interviewTopics"];
const JD_CATEGORY_ID_PREFIX = {
  coreTechnologies: "core-technologies",
  professionalExperience: "professional-experience",
  architectureDeliveryCloud: "architecture-delivery-cloud",
  domainIntegrations: "domain-integrations",
  mobile: "mobile",
  educationCoursework: "education-coursework",
  languagesCommunication: "languages-communication"
};
const JD_EXPLANATION_DISCLAIMERS = {
  en: "This is an estimated compatibility score based only on the job description and Ameer's published profile. It is not an objective hiring decision, technical assessment, or guarantee of suitability.",
  ms: "Ini ialah skor keserasian anggaran yang berasaskan hanya pada huraian jawatan dan profil terbitan Ameer. Ia bukan keputusan pengambilan pekerja yang objektif, penilaian teknikal, atau jaminan kesesuaian."
};
const DEFAULT_PRIVACY_EXCLUSIONS = [
  "salary",
  "nric",
  "home address",
  "date of birth",
  "benefits",
  "leave",
  "medical",
  "signatures",
  "confidential contract language"
];
const AMBIGUOUS_PRIVACY_TERMS = {
  salary: true,
  benefits: true,
  leave: true,
  medical: true
};
const CONTEXTUAL_PRIVACY_PATTERNS = [
  /\b(?:expected|expecting|monthly|basic)\s+(?:[a-z]+\s+){0,2}salary\b/i,
  /\bsalary\s+(?:expectation|expectations|range|package|history)\b/i,
  /\b(?:expected|total)\s+compensation\b/i,
  /\bcompensation\s+(?:package|history|range)\b/i,
  /\bremuneration\s+(?:package|expectation|range)\b/i,
  /\b(?:salary|employee|pay)\s+(?:[a-z]+\s+){0,2}(?:compensation|remuneration)\b/i,
  /\b(?:compensation|remuneration)\s+(?:[a-z]+\s+){0,2}(?:salary|employee|pay)\b/i,
  /\b(?:candidate|applicant|employee|staff|admin|administrative|payroll|hr)\s+(?:[a-z]+\s+){0,2}(?:compensation|remuneration)\b/i,
  /\b(?:compensation|remuneration)\s+(?:[a-z]+\s+){0,2}(?:candidate|applicant|employee|staff|admin|administrative|payroll|hr)\b/i,
  /\b(?:compensation|remuneration)\s+(?:review|workflow|administration)\b/i,
  /\b(?:review|workflow|administration)\s+(?:of|for|around|on)?\s*(?:compensation|remuneration)\b/i,
  /\bmedical\s+(?:coverage|insurance|benefits|plan|history)\b/i,
  /\b(?:health|employee)\s+(?:benefits|coverage|insurance|plan)\b/i,
  /\b(?:annual|sick|paid|unpaid|parental|maternity|paternity|casual)\s+leave\b/i,
  /\bleave\s+(?:entitlement|history|balance|policy|policies|allowance)\b/i,
  /\bbenefits\s+(?:package|coverage|plan|plans|history|entitlement)\b/i
];
const HTML_MARKUP_PATTERN = /<\s*\/?\s*[a-z][^>]*>|<!--[\s\S]*?-->|<!--|-->/i;

const PERSONA_HEAD =
  "You are AIMeer, the AI twin of Ameer Adhwa on his portfolio website. You speak about Ameer in the third person, " +
  "warmly and professionally. Answer visitors' questions using ONLY the facts below. " +
  "Keep answers short (2-5 sentences), factual and friendly. If the question is in Bahasa Malaysia, reply in formal " +
  "Bahasa Malaysia; otherwise reply in English. If the answer is not in the facts, say you do not have that " +
  "information and suggest asking Ameer directly — the chat will show WhatsApp and email buttons for that. " +
  "Never invent projects, employers, dates or links.\n\n";

const SUMMARY_PROMPT =
  "Summarize this chat between a website visitor and AIMeer (Ameer's portfolio assistant) " +
  "in at most 3 short sentences addressed to Ameer, in the visitor's language " +
  "(English or Bahasa Malaysia). Plain text only, no preamble.";

const JD_EXPLANATION_PROMPT =
  "You are explaining a deterministic recruiter match result that was already scored locally on Ameer's portfolio site. " +
  "Do not recalculate the score, do not invent evidence, and do not change the result. Explain only the supplied score, " +
  "category breakdown, strong matches, partial matches, published evidence gaps, unverified requirements, and suggested interview topics. " +
  "Preserve distinctions between professional evidence, academic exposure, and user-provided context. Never present academic exposure as professional experience. " +
  "Repeat the supplied estimate disclaimer verbatim as the first sentence, then explain the result in 3-6 short sentences in the requested language.";

const JD_REASONING_PROMPT =
  "You are producing bounded recruiter reasoning for a deterministic recruiter JD match that was already scored locally on Ameer's portfolio site. " +
  "Use only the supplied recruiter-safe JSON input. Do not invent evidence, do not change the deterministic score, do not add any score fields, " +
  "and never present academic exposure as professional delivery. Return strict JSON only with the root keys narrative and requirements. " +
  "The requirements array must include every supplied requirement exactly once. Every requirement object must include requirementId, recruiterIntent, expectedOutcome, matchLevel, evidenceRefs, transferableCapabilities, limitation, recruiterFraming, verificationQuestion, and confidence. " +
  "Use only the provided evidence IDs and transferable capability vocabulary. If direct published evidence is unavailable, keep the reasoning conservative and explicit about the limitation.";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const originOk = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": originOk ? origin : SITE,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST" || !originOk) {
      return json({ error: "forbidden" }, 403, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad-json" }, 400, cors);
    }
    if (!isPlainObject(body)) {
      return json({ error: "invalid-body" }, 400, cors);
    }

    if (!env.AI) {
      /* the Workers AI binding is missing: Settings → Bindings → Add → Workers AI,
         variable name exactly "AI", then Deploy again */
      return json({ error: "no-ai-binding" }, 500, cors);
    }

    const mode = detectMode(body.mode);

    if (mode === "jd-reasoning") {
      let profile = null;
      try {
        profile = await loadReasoningProfile();
      } catch {}
      if (!profile) return json({ error: "profile-unavailable" }, 502, cors);

      const reasoningPayload = validateJdReasoningBody(body, profile);
      if (!reasoningPayload.ok) {
        return json({ error: reasoningPayload.error }, 400, cors);
      }

      try {
        const out = await env.AI.run(MODEL, {
          messages: [
            { role: "system", content: PERSONA_HEAD + "\n\n" + JD_REASONING_PROMPT },
            buildJdReasoningMessage(reasoningPayload.reasoningInput)
          ],
          max_tokens: JD_REASONING_MAX_TOKENS,
          temperature: 0.1,
        });
        const validated = validateJdReasoningModelOutput(out && out.response ? out.response : "", reasoningPayload.reasoningInput);
        if (!validated.ok) {
          return json({ error: "reasoning-invalid" }, 502, cors);
        }
        return json({ reasoning: JSON.stringify(validated.reasoning) }, 200, cors);
      } catch (e) {
        return json({ error: "ai-failed", detail: String((e && e.message) || e).slice(0, 200) }, 502, cors);
      }
    }

    if (mode === "jd-explanation" &&
      (!Array.isArray(body.messages) || body.messages.length !== 1 ||
        !body.messages[0] || body.messages[0].role !== "user")) {
      return json({ error: "invalid-messages" }, 400, cors);
    }

    const messages = sanitizeMessages(body.messages, mode === "jd-explanation" ? 1 : 10, 600);
    if (!messages) return json({ error: "invalid-messages" }, 400, cors);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return json({ error: "empty" }, 400, cors);
    }

    let jdExplanationPayload = null;
    if (mode === "jd-explanation") {
      jdExplanationPayload = validateJdExplanationBody(body);
      if (!jdExplanationPayload.ok) return json({ error: jdExplanationPayload.error }, 400, cors);
    }

    let system = SUMMARY_PROMPT;
    if (mode === "chat" || mode === "jd-explanation") {
      let kb = "";
      try {
        kb = await loadKB();
      } catch {}
      if (!kb) return json({ error: "kb-unavailable" }, 502, cors);
      system = PERSONA_HEAD + kb;
      if (mode === "jd-explanation") {
        system += "\n\n" + JD_EXPLANATION_PROMPT +
          "\nRequested language: " + jdExplanationPayload.language +
          "\nRepeat this disclaimer verbatim as the first sentence: \"" + jdExplanationPayload.disclaimer + "\"";
        messages[0].content +=
          "\n\nNormalized JD:\n" + jdExplanationPayload.jdText +
          "\n\nDeterministic match result JSON:\n" + jdExplanationPayload.resultJson;
      }
    }

    try {
      const out = await env.AI.run(MODEL, {
        messages: [{ role: "system", content: system }, ...messages],
        max_tokens: mode === "summary" ? 160 : mode === "jd-explanation" ? 320 : 300,
        temperature: 0.2,
      });
      return json({ reply: (out.response || "").trim() }, 200, cors);
    } catch (e) {
      return json({ error: "ai-failed", detail: String((e && e.message) || e).slice(0, 200) }, 502, cors);
    }
  },
};

async function loadKB() {
  return loadCachedText(KB_URL, "aimeer-kb-cache=v1", "text/plain");
}

async function loadReasoningProfile() {
  const raw = await loadCachedJson(PROFILE_URL, "aimeer-profile-cache=v1");
  if (!raw || !Array.isArray(raw.recruiterEvidence)) return null;
  const recruiterEvidence = raw.recruiterEvidence.map(sanitizeRecruiterEvidenceRecord).filter(Boolean);
  if (!recruiterEvidence.length) return null;
  const privacyExclusions = uniqueStrings(
    Array.isArray(raw.privacyExclusions) ? raw.privacyExclusions : DEFAULT_PRIVACY_EXCLUSIONS,
    DEFAULT_PRIVACY_EXCLUSIONS.length,
    64
  ).map((item) => item.toLowerCase());
  return {
    recruiterEvidence,
    privacyExclusions: privacyExclusions.length ? privacyExclusions : DEFAULT_PRIVACY_EXCLUSIONS.slice()
  };
}

async function loadCachedText(url, cacheTag, contentType) {
  const cache = getDefaultCache();
  const cacheKey = new Request(url + "?" + cacheTag);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit && hit.ok) return hit.text();
  }
  const response = await fetch(url + "?fresh=" + Date.now());
  if (!response.ok) return "";
  const text = await response.text();
  if (cache) {
    await cache.put(cacheKey, new Response(text, {
      headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=3600" },
    }));
  }
  return text;
}

async function loadCachedJson(url, cacheTag) {
  const text = await loadCachedText(url, cacheTag, "application/json");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getDefaultCache() {
  return typeof caches !== "undefined" && caches && caches.default ? caches.default : null;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

function detectMode(value) {
  return value === "summary" ? "summary"
    : value === "jd-explanation" ? "jd-explanation"
      : value === "jd-reasoning" ? "jd-reasoning"
        : "chat";
}

function sanitizeMessages(rawMessages, limit, maxChars) {
  if (!Array.isArray(rawMessages)) return [];
  const trimmed = rawMessages.slice(-limit);
  for (const message of trimmed) {
    if (!message || (message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") {
      return null;
    }
  }
  return trimmed.map((message) => ({
    role: message.role,
    content: message.content.slice(0, maxChars),
  }));
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isBoundedString(value, maxChars, allowEmpty = true) {
  return typeof value === "string" && value.length <= maxChars && (allowEmpty || value.trim().length > 0);
}

function isNumberInRange(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isIntegerInRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clipText(value, maxChars) {
  return normalizeText(value).slice(0, maxChars);
}

function uniqueStrings(value, maxItems, maxChars) {
  const list = Array.isArray(value) ? value : [];
  const seen = Object.create(null);
  const output = [];
  for (const item of list) {
    const clipped = clipText(item, maxChars);
    if (!clipped || seen[clipped]) continue;
    seen[clipped] = true;
    output.push(clipped);
    if (output.length >= maxItems) break;
  }
  return output;
}

function validateStringArray(value, maxItems, maxChars) {
  return Array.isArray(value) && value.length <= maxItems &&
    value.every((item) => isBoundedString(item, maxChars));
}

function validateEvidenceRefArray(value, allowedEvidenceIds) {
  if (!Array.isArray(value) || value.length > 4 || !Array.isArray(allowedEvidenceIds)) {
    return false;
  }
  const evidenceRefs = uniqueStrings(value, 4, 96);
  return evidenceRefs.length === value.length &&
    evidenceRefs.every((ref) => allowedEvidenceIds.includes(ref));
}

function sanitizeRecruiterEvidenceRecord(record) {
  if (!isPlainObject(record) || !isBoundedString(record.id, 96, false)) return null;
  const evidenceType = clipText(record.evidenceType, 24);
  if (!["professional", "academic", "user-provided"].includes(evidenceType)) return null;
  const claim = clipText(record.claim, 260);
  const sourceLabel = clipText(record.sourceLabel, 80);
  const technologies = uniqueStrings(record.technologies, 8, 120);
  const capabilities = uniqueStrings(record.capabilities, 8, 120);
  const scope = uniqueStrings(record.scope, 6, 120);
  if (!claim || !sourceLabel || !technologies.length || !capabilities.length || !scope.length) return null;
  return {
    id: clipText(record.id, 96),
    evidenceType,
    claim,
    technologies,
    capabilities,
    scope,
    sourceLabel
  };
}

function areEvidenceTypesCompatible(matchLevel, evidenceRecords) {
  const allowedTypes = JD_REASONING_MATCH_EVIDENCE_TYPES[matchLevel];
  if (!allowedTypes || !evidenceRecords.length) return true;
  return evidenceRecords.every((record) => record && allowedTypes[record.evidenceType] === true);
}

function validateMatchItem(item) {
  if (!isPlainObject(item) ||
    !hasOnlyKeys(item, ["term", "label", "evidenceType", "evidence"])) {
    return false;
  }
  return isBoundedString(item.term, 120, false) &&
    isBoundedString(item.label, 220) &&
    isBoundedString(item.evidenceType, 32) &&
    validateStringArray(item.evidence, 3, 140);
}

function validateCategory(category, categoryKey) {
  if (!isPlainObject(category) ||
    !hasOnlyKeys(category, ["key", "label", "weight", "score", "matchedRequirements", "totalRequirements", "matchedTerms"])) {
    return false;
  }
  if (!isNumberInRange(category.score, 0, 100) ||
    !isNumberInRange(category.weight, 0, 100) ||
    category.score > category.weight) {
    return false;
  }
  if (category.key !== undefined && category.key !== categoryKey) return false;
  if (category.label !== undefined && !isBoundedString(category.label, 120)) return false;
  if (category.matchedRequirements !== undefined &&
    !isIntegerInRange(category.matchedRequirements, 0, 100)) return false;
  if (category.totalRequirements !== undefined &&
    !isIntegerInRange(category.totalRequirements, 0, 100)) return false;
  if (category.matchedTerms !== undefined &&
    !validateStringArray(category.matchedTerms, 50, 120)) return false;
  return true;
}

function validateMatchResult(result) {
  const allowedTopLevel = ["score", "confidence", "categories", ...JD_RESULT_LIST_KEYS];
  if (!isPlainObject(result) || !hasOnlyKeys(result, allowedTopLevel) ||
    !isNumberInRange(result.score, 0, 100)) {
    return false;
  }
  if (!isPlainObject(result.confidence) ||
    !hasOnlyKeys(result.confidence, ["label", "reasons"]) ||
    !["low", "medium", "high"].includes(result.confidence.label) ||
    !validateStringArray(result.confidence.reasons, 3, 180)) {
    return false;
  }
  if (!isPlainObject(result.categories)) return false;
  const categoryKeys = Object.keys(result.categories);
  if (categoryKeys.length > JD_CATEGORY_KEYS.length ||
    !categoryKeys.every((key) => JD_CATEGORY_KEYS.includes(key) && validateCategory(result.categories[key], key))) {
    return false;
  }
  return JD_RESULT_LIST_KEYS.every((key) =>
    Array.isArray(result[key]) &&
    result[key].length <= 6 &&
    result[key].every(validateMatchItem)
  );
}

function validateJdExplanationBody(body) {
  const jdText = typeof body.jdText === "string" ? body.jdText.trim() : "";
  if (!jdText || jdText.length > JD_EXPLANATION_JD_MAX) {
    return { ok: false, error: "jd-text-invalid" };
  }
  if (!validateMatchResult(body.matchResult)) {
    return { ok: false, error: "jd-result-invalid" };
  }
  const resultJson = JSON.stringify(body.matchResult);
  if (!resultJson || resultJson.length > JD_EXPLANATION_RESULT_MAX) {
    return { ok: false, error: "jd-result-invalid" };
  }
  if (body.language !== "en" && body.language !== "ms") {
    return { ok: false, error: "jd-language-invalid" };
  }
  const language = body.language;
  if (body.disclaimer !== undefined &&
    (typeof body.disclaimer !== "string" || body.disclaimer !== JD_EXPLANATION_DISCLAIMERS[language])) {
    return { ok: false, error: "jd-disclaimer-invalid" };
  }
  return {
    ok: true,
    jdText,
    resultJson,
    language,
    disclaimer: JD_EXPLANATION_DISCLAIMERS[language],
  };
}

function validateJdReasoningBody(body, profile) {
  if (body.messages !== undefined || body.system !== undefined) {
    return { ok: false, error: "jd-system-not-allowed" };
  }
  if (!hasOnlyKeys(body, JD_REASONING_ALLOWED_BODY_KEYS)) {
    return { ok: false, error: "invalid-body" };
  }
  if (body.language !== "en" && body.language !== "ms") {
    return { ok: false, error: "jd-language-invalid" };
  }

  const jdText = clipText(body.jdText, JD_REASONING_JD_MAX);
  if (!jdText || normalizeText(body.jdText).length > JD_REASONING_JD_MAX) {
    return { ok: false, error: "jd-text-invalid" };
  }

  if (!Array.isArray(body.evidenceIds) || body.evidenceIds.length > JD_REASONING_EVIDENCE_MAX) {
    return { ok: false, error: "jd-evidence-invalid" };
  }

  const evidenceIds = uniqueStrings(body.evidenceIds, JD_REASONING_EVIDENCE_MAX, 96);
  if (evidenceIds.length !== body.evidenceIds.length) {
    return { ok: false, error: "jd-evidence-invalid" };
  }

  const registryById = new Map(profile.recruiterEvidence.map((record) => [record.id, record]));
  const evidenceRegistry = [];
  for (const id of evidenceIds) {
    const record = registryById.get(id);
    if (!record) return { ok: false, error: "jd-evidence-invalid" };
    evidenceRegistry.push(record);
  }

  if (!isPlainObject(body.deterministicInput) ||
    !hasOnlyKeys(body.deterministicInput, JD_REASONING_ALLOWED_INPUT_KEYS) ||
    !Array.isArray(body.deterministicInput.requirements) ||
    body.deterministicInput.requirements.length === 0 ||
    body.deterministicInput.requirements.length > JD_REASONING_REQUIREMENT_MAX ||
    !validateCompactDeterministicResult(body.deterministicInput.deterministicResult, evidenceIds)) {
    return { ok: false, error: "jd-deterministic-invalid" };
  }

  const requirements = [];
  const seenRequirementIds = Object.create(null);
  for (const requirement of body.deterministicInput.requirements) {
    const sanitized = sanitizeCompactRequirement(requirement, evidenceIds);
    if (!sanitized) return { ok: false, error: "jd-deterministic-invalid" };
    if (!isRequirementIdValid(sanitized.id, sanitized.category)) {
      return { ok: false, error: "jd-deterministic-invalid" };
    }
    if (seenRequirementIds[sanitized.id]) return { ok: false, error: "jd-deterministic-invalid" };
    seenRequirementIds[sanitized.id] = true;
    requirements.push(sanitized);
  }

  const deterministicResult = sanitizeCompactDeterministicResult(body.deterministicInput.deterministicResult);
  const deterministicResultJson = JSON.stringify(deterministicResult);
  if (!deterministicResultJson || deterministicResultJson.length > JD_REASONING_RESULT_MAX) {
    return { ok: false, error: "jd-deterministic-invalid" };
  }
  if (!evidenceIds.length && (
    requirements.some((requirement) => requirement.classification !== "gap" && requirement.classification !== "unverified") ||
    deterministicResult.strongMatches.length > 0 ||
    deterministicResult.partialMatches.length > 0
  )) {
    return { ok: false, error: "jd-deterministic-invalid" };
  }

  const privacyTerms = profile.privacyExclusions && profile.privacyExclusions.length
    ? profile.privacyExclusions
    : DEFAULT_PRIVACY_EXCLUSIONS;
  const privacyPayload = [
    jdText,
    JSON.stringify({ requirements, deterministicResult })
  ].join("\n");
  if (containsPrivacyTerms(privacyPayload, privacyTerms)) {
    return { ok: false, error: "jd-privacy-invalid" };
  }

  return {
    ok: true,
    reasoningInput: {
      language: body.language,
      jdText,
      requirements,
      deterministicResult,
      evidenceRegistry,
      capabilityVocabulary: buildCapabilityVocabulary(evidenceRegistry)
    }
  };
}

function sanitizeCompactRequirement(requirement, allowedEvidenceIds) {
  if (!isPlainObject(requirement) || !hasOnlyKeys(requirement, JD_REASONING_ALLOWED_REQUIREMENT_KEYS)) {
    return null;
  }
  const id = clipText(requirement.id, 96);
  const term = clipText(requirement.term, 120);
  const original = clipText(requirement.original, 240);
  const strength = clipText(requirement.strength, 16);
  const category = clipText(requirement.category, 48);
  const classification = clipText(requirement.classification, 24);
  const evidenceType = clipText(requirement.evidenceType, 24);
  if (!id || !term || !JD_REASONING_STRENGTH[strength] ||
    !JD_CATEGORY_KEYS.includes(category) ||
    !JD_REASONING_CLASSIFICATION[classification] ||
    !JD_REASONING_EVIDENCE_TYPES[evidenceType]) {
    return null;
  }
  const yearsRequired = requirement.yearsRequired === null ? null : requirement.yearsRequired;
  if (!(yearsRequired === null || isNumberInRange(yearsRequired, 0, 60))) return null;
  if (typeof requirement.specificHandsOn !== "boolean") return null;
  if (!validateEvidenceRefArray(requirement.evidenceRefs, allowedEvidenceIds)) return null;
  const evidenceRefs = uniqueStrings(requirement.evidenceRefs, 4, 96);
  return {
    id,
    term,
    original,
    strength,
    category,
    yearsRequired,
    specificHandsOn: requirement.specificHandsOn,
    classification,
    evidenceType,
    evidenceRefs
  };
}

function validateCompactDeterministicResult(result, allowedEvidenceIds) {
  if (!isPlainObject(result) || !hasOnlyKeys(result, JD_REASONING_ALLOWED_RESULT_KEYS)) {
    return false;
  }
  if (!isNumberInRange(result.score, 0, 100) || !isNumberInRange(result.deterministicScore, 0, 100)) {
    return false;
  }
  if (!isPlainObject(result.confidence) ||
    !hasOnlyKeys(result.confidence, ["label", "reasons"]) ||
    !JD_REASONING_CONFIDENCE[clipText(result.confidence.label, 16)] ||
    !validateStringArray(result.confidence.reasons, 3, 180)) {
    return false;
  }
  if (!isPlainObject(result.categories)) return false;
  const categoryKeys = Object.keys(result.categories);
  if (!categoryKeys.length || categoryKeys.length > JD_CATEGORY_KEYS.length) return false;
  if (!categoryKeys.every((key) => JD_CATEGORY_KEYS.includes(key) && validateCompactDeterministicCategory(result.categories[key], key))) {
    return false;
  }
  return ["strongMatches", "partialMatches", "gaps", "unverified"].every((key) =>
    Array.isArray(result[key]) &&
    result[key].length <= 8 &&
    result[key].every((item) => validateCompactDeterministicMatchItem(item, allowedEvidenceIds))
  );
}

function validateCompactDeterministicCategory(category, categoryKey) {
  if (!isPlainObject(category) || !hasOnlyKeys(category, JD_REASONING_ALLOWED_CATEGORY_KEYS)) {
    return false;
  }
  if (!isNumberInRange(category.score, 0, 100) ||
    !isNumberInRange(category.weight, 0, 100) ||
    typeof category.active !== "boolean" ||
    category.score > category.weight) {
    return false;
  }
  if (category.key !== undefined && category.key !== categoryKey) return false;
  if (category.label !== undefined && !isBoundedString(category.label, 120)) return false;
  if (category.matchedRequirements !== undefined && !isIntegerInRange(category.matchedRequirements, 0, 100)) return false;
  if (category.totalRequirements !== undefined && !isIntegerInRange(category.totalRequirements, 0, 100)) return false;
  return true;
}

function validateCompactDeterministicMatchItem(item, allowedEvidenceIds) {
  if (!isPlainObject(item) || !hasOnlyKeys(item, JD_REASONING_ALLOWED_MATCH_ITEM_KEYS)) {
    return false;
  }
  return isBoundedString(item.term, 120, false) &&
    isBoundedString(item.label, 220) &&
    isBoundedString(item.evidenceType, 24) &&
    JD_REASONING_EVIDENCE_TYPES[item.evidenceType] === true &&
    validateEvidenceRefArray(item.evidenceRefs, allowedEvidenceIds);
}

function sanitizeCompactDeterministicResult(result) {
  const categories = {};
  for (const key of Object.keys(result.categories || {})) {
    const item = result.categories[key];
    categories[key] = {
      score: Math.max(0, Math.min(100, Number(item.score) || 0)),
      weight: Math.max(0, Math.min(100, Number(item.weight) || 0)),
      active: !!item.active,
      key: clipText(item.key || key, 48),
      label: clipText(item.label, 120),
      matchedRequirements: Number.isInteger(item.matchedRequirements) ? item.matchedRequirements : 0,
      totalRequirements: Number.isInteger(item.totalRequirements) ? item.totalRequirements : 0
    };
  }
  return {
    score: Math.max(0, Math.min(100, Number(result.score) || 0)),
    deterministicScore: Math.max(0, Math.min(100, Number(result.deterministicScore) || 0)),
    confidence: {
      label: clipText(result.confidence && result.confidence.label, 16),
      reasons: uniqueStrings(result.confidence && result.confidence.reasons, 3, 180)
    },
    categories,
    strongMatches: sanitizeCompactDeterministicMatchList(result.strongMatches),
    partialMatches: sanitizeCompactDeterministicMatchList(result.partialMatches),
    gaps: sanitizeCompactDeterministicMatchList(result.gaps),
    unverified: sanitizeCompactDeterministicMatchList(result.unverified)
  };
}

function sanitizeCompactDeterministicMatchList(list) {
  return (Array.isArray(list) ? list : []).slice(0, 8).map((item) => ({
    term: clipText(item && item.term, 120),
    label: clipText(item && item.label, 220),
    evidenceType: clipText(item && item.evidenceType, 24),
    evidenceRefs: uniqueStrings(item && item.evidenceRefs, 4, 96)
  }));
}

function buildCapabilityVocabulary(evidenceRegistry) {
  const seen = Object.create(null);
  const vocabulary = [];
  for (const record of evidenceRegistry) {
    for (const capability of record.capabilities || []) {
      const clipped = clipText(capability, 120);
      if (!clipped || seen[clipped]) continue;
      seen[clipped] = true;
      vocabulary.push(clipped);
    }
  }
  return vocabulary.sort();
}

function containsPrivacyTerms(text, privacyTerms) {
  const haystack = String(text || "").toLowerCase();
  for (const rawTerm of privacyTerms) {
    const term = String(rawTerm || "").toLowerCase().trim();
    if (!term || AMBIGUOUS_PRIVACY_TERMS[term]) continue;
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp("(^|[^a-z0-9])" + escapedTerm + "(?=$|[^a-z0-9])", "i").test(haystack)) {
      return true;
    }
  }
  return CONTEXTUAL_PRIVACY_PATTERNS.some((pattern) => pattern.test(haystack));
}

function isRequirementIdValid(id, category) {
  const prefix = JD_CATEGORY_ID_PREFIX[category];
  return !!prefix && new RegExp("^req-" + prefix + "-[a-z0-9-]+$").test(id);
}

function buildJdReasoningMessage(reasoningInput) {
  return {
    role: "user",
    content:
      (reasoningInput.language === "ms" ? "Pulangkan strict JSON sahaja." : "Return strict JSON only.") +
      "\n\nRequested language: " + reasoningInput.language +
      "\nDeterministic score is client-authoritative and must not be changed." +
      "\n\nReasoning input JSON:\n" + JSON.stringify(reasoningInput)
  };
}

function validateJdReasoningModelOutput(rawOutput, input) {
  const stripped = stripJsonFence(rawOutput);
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return { ok: false, error: "json-invalid" };
  }
  if (!isPlainObject(parsed)) return { ok: false, error: "root-invalid" };
  const rootKeyError = ensureOnlyKeys(parsed, JD_REASONING_ROOT_KEYS, "reasoning root");
  if (rootKeyError) return { ok: false, error: rootKeyError };
  const narrativeError = validateReasoningTextField(parsed.narrative, "narrative");
  if (narrativeError) return { ok: false, error: narrativeError };
  if (!Array.isArray(parsed.requirements) || parsed.requirements.length !== input.requirements.length) {
    return { ok: false, error: "requirements-invalid" };
  }

  const requirementIndex = Object.create(null);
  for (const requirement of input.requirements) {
    requirementIndex[requirement.id] = true;
  }
  const evidenceIndex = Object.create(null);
  for (const record of input.evidenceRegistry) {
    evidenceIndex[record.id] = record;
  }
  const capabilityIndex = Object.create(null);
  for (const capability of input.capabilityVocabulary) {
    capabilityIndex[capability] = true;
  }

  const seenRequirementIds = Object.create(null);
  const requirements = [];
  for (const item of parsed.requirements) {
    if (!isPlainObject(item)) return { ok: false, error: "requirement-object-invalid" };
    const keyError = ensureOnlyKeys(item, JD_REASONING_REQUIREMENT_KEYS, "reasoning requirement");
    if (keyError) return { ok: false, error: keyError };

    const requirementId = clipText(item.requirementId, 96);
    if (!requirementIndex[requirementId] || seenRequirementIds[requirementId]) {
      return { ok: false, error: "requirement-id-invalid" };
    }
    seenRequirementIds[requirementId] = true;

    const matchLevel = clipText(item.matchLevel, 32);
    if (!JD_REASONING_MATCH_LEVELS[matchLevel]) {
      return { ok: false, error: "match-level-invalid" };
    }
    const confidence = clipText(item.confidence, 16);
    if (!JD_REASONING_CONFIDENCE[confidence]) {
      return { ok: false, error: "confidence-invalid" };
    }

    const recruiterIntent = validateReasoningTextField(item.recruiterIntent, "recruiterIntent");
    if (recruiterIntent) return { ok: false, error: recruiterIntent };
    const expectedOutcome = validateReasoningTextField(item.expectedOutcome, "expectedOutcome");
    if (expectedOutcome) return { ok: false, error: expectedOutcome };
    const limitation = validateReasoningTextField(item.limitation, "limitation");
    if (limitation) return { ok: false, error: limitation };
    const recruiterFraming = validateReasoningTextField(item.recruiterFraming, "recruiterFraming");
    if (recruiterFraming) return { ok: false, error: recruiterFraming };
    const verificationQuestion = validateReasoningTextField(item.verificationQuestion, "verificationQuestion");
    if (verificationQuestion) return { ok: false, error: verificationQuestion };

    if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length > 4) {
      return { ok: false, error: "evidence-invalid" };
    }
    const evidenceRefs = uniqueStrings(item.evidenceRefs, 4, 96);
    if (evidenceRefs.length !== item.evidenceRefs.length) {
      return { ok: false, error: "evidence-invalid" };
    }
    const evidenceRecords = [];
    for (const ref of evidenceRefs) {
      if (!evidenceIndex[ref]) return { ok: false, error: "evidence-invalid" };
      evidenceRecords.push(evidenceIndex[ref]);
    }
    if (JD_REASONING_EVIDENCE_BASED_LEVELS[matchLevel] && !evidenceRefs.length) {
      return { ok: false, error: "evidence-required" };
    }
    if (!areEvidenceTypesCompatible(matchLevel, evidenceRecords)) {
      return { ok: false, error: "evidence-provenance-invalid" };
    }

    if (!Array.isArray(item.transferableCapabilities) || item.transferableCapabilities.length > 4) {
      return { ok: false, error: "capability-invalid" };
    }
    const transferableCapabilities = uniqueStrings(item.transferableCapabilities, 4, 120);
    if (transferableCapabilities.length !== item.transferableCapabilities.length) {
      return { ok: false, error: "capability-invalid" };
    }
    for (const capability of transferableCapabilities) {
      if (HTML_MARKUP_PATTERN.test(capability) || !capabilityIndex[capability]) {
        return { ok: false, error: "capability-invalid" };
      }
    }

    requirements.push({
      requirementId,
      recruiterIntent: clipText(item.recruiterIntent, JD_REASONING_TEXT_LIMITS.recruiterIntent),
      expectedOutcome: clipText(item.expectedOutcome, JD_REASONING_TEXT_LIMITS.expectedOutcome),
      matchLevel,
      evidenceRefs,
      transferableCapabilities,
      limitation: clipText(item.limitation, JD_REASONING_TEXT_LIMITS.limitation),
      recruiterFraming: clipText(item.recruiterFraming, JD_REASONING_TEXT_LIMITS.recruiterFraming),
      verificationQuestion: clipText(item.verificationQuestion, JD_REASONING_TEXT_LIMITS.verificationQuestion),
      confidence
    });
  }

  return {
    ok: true,
    reasoning: {
      narrative: clipText(parsed.narrative, JD_REASONING_TEXT_LIMITS.narrative),
      requirements
    }
  };
}

function stripJsonFence(rawOutput) {
  const text = String(rawOutput || "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

function ensureOnlyKeys(target, allowedKeys, contextLabel) {
  const keys = Object.keys(target || {});
  for (const key of keys) {
    if (allowedKeys.includes(key)) continue;
    if (/score/i.test(key)) {
      return "score-field-invalid:" + contextLabel;
    }
    return "unknown-key-invalid:" + contextLabel;
  }
  return "";
}

function validateReasoningTextField(value, key) {
  const maxChars = JD_REASONING_TEXT_LIMITS[key] || 320;
  if (typeof value !== "string") return key + "-invalid";
  if (HTML_MARKUP_PATTERN.test(value)) return key + "-invalid";
  const normalized = normalizeText(value);
  if (!normalized || normalized.length > maxChars) return key + "-invalid";
  return "";
}
