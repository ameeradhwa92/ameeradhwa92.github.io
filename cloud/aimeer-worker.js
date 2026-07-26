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

    if (!env.AI) {
      /* the Workers AI binding is missing: Settings → Bindings → Add → Workers AI,
         variable name exactly "AI", then Deploy again */
      return json({ error: "no-ai-binding" }, 500, cors);
    }

    const mode = body.mode === "summary" ? "summary"
      : body.mode === "jd-explanation" ? "jd-explanation"
        : "chat";
    const messages = sanitizeMessages(body.messages, mode === "jd-explanation" ? 2 : 10, 600);
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

function validateJdExplanationBody(body) {
  const jdText = typeof body.jdText === "string" ? body.jdText.trim() : "";
  if (!jdText || jdText.length > JD_EXPLANATION_JD_MAX) {
    return { ok: false, error: "jd-text-invalid" };
  }
  if (!body.matchResult || typeof body.matchResult !== "object" || Array.isArray(body.matchResult)) {
    return { ok: false, error: "jd-result-invalid" };
  }
  const resultJson = JSON.stringify(body.matchResult);
  if (!resultJson || resultJson.length > JD_EXPLANATION_RESULT_MAX) {
    return { ok: false, error: "jd-result-invalid" };
  }
  const language = body.language === "ms" ? "ms" : "en";
  return {
    ok: true,
    jdText,
    resultJson,
    language,
    disclaimer: JD_EXPLANATION_DISCLAIMERS[language],
  };
}
