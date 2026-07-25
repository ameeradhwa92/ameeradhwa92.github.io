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
const MODEL = "@cf/meta/llama-3.1-8b-instruct";

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

    const mode = body.mode === "summary" ? "summary" : "chat";
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .slice(-10)
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return json({ error: "empty" }, 400, cors);
    }

    // The system prompt is assembled server-side (persona + the same KB file the
    // site serves) so this endpoint can't be repurposed as a generic LLM proxy.
    let system = SUMMARY_PROMPT;
    if (mode === "chat") {
      let kb = "";
      try {
        const r = await fetch(KB_URL, { cf: { cacheEverything: true, cacheTtl: 3600 } });
        if (r.ok) kb = await r.text();
      } catch {}
      if (!kb) return json({ error: "kb-unavailable" }, 502, cors);
      system = PERSONA_HEAD + kb;
    }

    try {
      const out = await env.AI.run(MODEL, {
        messages: [{ role: "system", content: system }, ...messages],
        max_tokens: mode === "summary" ? 160 : 300,
        temperature: 0.2,
      });
      return json({ reply: (out.response || "").trim() }, 200, cors);
    } catch (e) {
      return json({ error: "ai-failed", detail: String((e && e.message) || e).slice(0, 200) }, 502, cors);
    }
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
