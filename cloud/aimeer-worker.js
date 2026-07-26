/* AIMeer cloud relay — Cloudflare Worker + Workers AI.
   Serves AI answers to devices that can't run the on-device WebLLM model
   (iPhones/iPads, browsers without WebGPU, low-memory GPUs).

   Deploy (free plan, no credit card):
     1. dash.cloudflare.com → Compute (Workers) → Create → "Start with Hello World"
     2. Name it aimeer-ai, deploy, then Edit code → replace everything with this file
     3. Settings → Bindings → Add → Workers AI → variable name: AI
     4. Deploy, copy the https://aimeer-ai.<subdomain>.workers.dev URL into
        CLOUD_ENDPOINT in assets/js/chatbot.js

   No API key lives anywhere: the model runs on this Worker's own AI binding,
   and only requests from the portfolio site's origin are served. */

const SITE = "https://ameeradhwa92.github.io";
const KB_URL = SITE + "/assets/data/aimeer-kb.txt";
const ALLOWED_ORIGINS = [SITE, "http://localhost:8080", "http://127.0.0.1:8080"];
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const JD_EXPLANATION_JD_MAX = 12000;
const JD_EXPLANATION_RESULT_MAX = 12000;
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
const JD_EXPLANATION_DISCLAIMERS = {
  en: "This is an estimated compatibility score based only on the job description and Ameer's published profile. It is not an objective hiring decision, technical assessment, or guarantee of suitability.",
  ms: "Ini ialah skor keserasian anggaran yang berasaskan hanya pada huraian jawatan dan profil terbitan Ameer. Ia bukan keputusan pengambilan pekerja yang objektif, penilaian teknikal, atau jaminan kesesuaian."
};

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

    const mode = body.mode === "summary" ? "summary"
      : body.mode === "jd-explanation" ? "jd-explanation"
        : "chat";
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

    // The system prompt is assembled server-side (persona + the same KB file the
    // site serves) so this endpoint can't be repurposed as a generic LLM proxy.
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

/* Cache the KB for an hour, but only ever cache successful fetches —
   caching a 404 would poison chat mode until the entry expired. */
async function loadKB() {
  const cacheKey = new Request(KB_URL + "?aimeer-kb-cache=v1");
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit && hit.ok) return hit.text();
  /* unique query string sidesteps any stale edge-cache entry for the bare URL */
  const r = await fetch(KB_URL + "?fresh=" + Date.now());
  if (!r.ok) return "";
  const text = await r.text();
  await cache.put(cacheKey, new Response(text, {
    headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=3600" },
  }));
  return text;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
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

function validateStringArray(value, maxItems, maxChars) {
  return Array.isArray(value) && value.length <= maxItems &&
    value.every((item) => isBoundedString(item, maxChars));
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
