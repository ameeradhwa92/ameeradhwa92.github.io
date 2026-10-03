/* AIMeer Private mode — the pure half. No DOM, no model: which device can run the
   on-device model and how, which lines of aimeer-kb.txt a question needs, whether a
   question should reach the model at all, the prompt, and the reply clean-up. Kept
   here so node:test can require() it; chatbot.js drives it and aimeer-local-worker.js
   runs the model.

   The model is LFM2.5-350M (Liquid AI, built for on-device use) through Transformers.js on
   WebGPU. No browser LLM runtime runs on WebGL, and the 4-bit builds' quantized embedding
   (GatherBlockQuantized) has no kernel in ONNX Runtime's WASM CPU build, so a browser
   without WebGPU is refused rather than handed a 480 MB CPU build. A 350M model can
   follow instructions but cannot hold the whole KB, so it never sees it: it gets the
   few lines retrieval picks, and the browser answers salary and out-of-knowledge
   questions itself, the same split Clef makes for the cloud tier. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AIMEER_LOCAL = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MODEL = {
    id: "onnx-community/LFM2.5-350M-ONNX",
    name: "LFM2.5-350M",
    /* download, MB: the dtype's weights plus tokenizer and config (≈ 3.5 MB) */
    sizeMB: { q4f16: 259, q4: 297 },
    /* Liquid's recommended settings, greedy: a near-zero temperature is greedy anyway */
    generation: { max_new_tokens: 110, do_sample: false, repetition_penalty: 1.05 }
  };

  /* ---------------- device gate ---------------- */
  /* env: { hasWorker, hasWasm, hasWebGPU, shaderF16, deviceMemory }. deviceMemory is
     undefined where the browser hides it (Safari, Firefox); unknown is not a reason to
     refuse. A GPU with shader-f16 gets the smaller q4f16 build; one without gets q4. */
  function evaluateGate(env) {
    env = env || {};
    var result = function (eligible, dtype, reason) {
      return { eligible: eligible, backend: eligible ? "webgpu" : null, dtype: dtype,
        sizeMB: dtype ? MODEL.sizeMB[dtype] : 0, reason: reason };
    };
    if (!env.hasWorker) return result(false, null, "no-worker");
    /* the runtime itself is WebAssembly, even when the maths runs on the GPU */
    if (!env.hasWasm) return result(false, null, "no-wasm");
    if (!env.hasWebGPU) return result(false, null, "no-webgpu");
    var mem = Number(env.deviceMemory);
    /* ≈ 260–300 MB of weights plus the runtime: a 1 GB device cannot hold it in one tab */
    if (env.deviceMemory != null && isFinite(mem) && mem < 2) return result(false, null, "low-memory");
    return result(true, env.shaderF16 ? "q4f16" : "q4", "webgpu");
  }

  /* Reads the env evaluateGate needs from a real browser. Async because the
     WebGPU adapter is; never rejects. */
  function probeEnvironment(nav, win) {
    nav = nav || {};
    win = win || {};
    var env = {
      hasWorker: typeof win.Worker === "function",
      hasWasm: typeof win.WebAssembly === "object",
      hasWebGPU: false,
      shaderF16: false,
      deviceMemory: nav.deviceMemory
    };
    if (!nav.gpu || typeof nav.gpu.requestAdapter !== "function") return Promise.resolve(env);
    return Promise.resolve().then(function () {
      return nav.gpu.requestAdapter();
    }).then(function (adapter) {
      if (adapter) {
        env.hasWebGPU = true;
        env.shaderF16 = !!(adapter.features && adapter.features.has && adapter.features.has("shader-f16"));
      }
      return env;
    }, function () { return env; });
  }

  /* ---------------- knowledge base → chunks ---------------- */
  /* headings and lines about the site or the matcher, not about Ameer: the model
     copied the JD-matcher line into an answer about years of experience */
  var SKIP_LINE = /^(FACTS ABOUT|RECRUITER EVIDENCE REGISTRY|Evidence label:|Privacy exclusions|JD matcher:)/;
  var CHUNK_MAX = 420;

  /* Sentence ends are ". " before a capital or a digit; "Sdn. Bhd.", "Node.js" and
     "CGPA 3.03" are not. No lookbehind, for older Safari. */
  var ABBREV = /\b(sdn|bhd|dr|mr|mrs|ms|jr|sr|st|vs|e\.g|i\.e|etc|no|hons)\.$/i;
  function splitSentences(text) {
    var out = [], start = 0, re = /[.!?]+\s+(?=[A-Z0-9("'])/g, m;
    text = String(text);
    while ((m = re.exec(text))) {
      var end = m.index + m[0].replace(/\s+$/, "").length;
      if (ABBREV.test(text.slice(start, end))) continue;
      out.push(text.slice(start, end).trim());
      start = m.index + m[0].length;
    }
    if (start < text.length) out.push(text.slice(start).trim());
    return out.filter(Boolean);
  }

  /* One chunk per line or bullet, each carrying its heading ("Career history",
     "2023-present RetailAIM …") so a sentence lifted out of a long line still says
     whose it is. Long lines split at sentence ends into ≤ CHUNK_MAX pieces. */
  function chunkKb(text) {
    var chunks = [], section = "";
    String(text || "").split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line || SKIP_LINE.test(line)) return;
      if (/:$/.test(line)) { section = line.slice(0, -1); return; }
      var bullet = /^- /.test(line);
      var body = bullet ? line.slice(2) : line;
      var label, rest;
      var dash = body.indexOf(" — ");
      var colon = body.indexOf(": ");
      if (bullet && dash > 0 && dash < 140) { label = body.slice(0, dash); rest = body.slice(dash + 3); }
      else if (!bullet && colon > 0 && colon < 60) { label = body.slice(0, colon); rest = body.slice(colon + 2); }
      else { label = bullet ? section : ""; rest = body; }
      var head = label ? label + ": " : "";
      var piece = "";
      /* a sentence that is itself a long list ("…; …; …") splits at its semicolons */
      var parts = [];
      splitSentences(rest).forEach(function (sentence) {
        if (sentence.length <= CHUNK_MAX) parts.push(sentence);
        else parts = parts.concat(sentence.split(/;\s+/));
      });
      parts.forEach(function (sentence) {
        sentence = sentence.trim();
        if (!sentence) return;
        if (piece && (piece + " " + sentence).length > CHUNK_MAX) {
          chunks.push({ id: chunks.length, section: section, text: head + piece });
          piece = sentence;
        } else {
          piece = piece ? piece + " " + sentence : sentence;
        }
      });
      if (piece) chunks.push({ id: chunks.length, section: section, text: head + piece });
    });
    return chunks;
  }

  /* ---------------- retrieval ---------------- */
  var STOP = ("a an and are as at be been but by can could did do does for from had has have he her his him how i if in into is it its " +
    "me my of on or our she so than that the their them then there these they this to was we were what when where which who whom why " +
    "will with would you your ameer adhwa aimeer tell know about please any some also just ever more much many " +
    "today now current currently himself background " +
    "apa siapa bila mana bagaimana kenapa mengapa adakah ialah adalah yang dan atau di ke dari dengan untuk pada ini itu dia beliau " +
    "saya anda awak boleh tak tidak ada sudah telah akan ke lah kah pun").split(" ");
  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = true; });

  /* Visitors ask in words the KB does not use. Each entry adds the KB's own words. */
  var SYNONYMS = {
    school: "education spm smk diploma", study: "education diploma bachelor uitm", studied: "education diploma bachelor uitm",
    university: "education uitm bachelor diploma", degree: "bachelor education uitm", qualification: "education diploma bachelor",
    college: "education uitm diploma", cgpa: "education cgpa", gpa: "education cgpa",
    job: "career developer", jobs: "career developer", work: "career developer projects", worked: "career developer",
    career: "career history", employer: "career sdn bhd", company: "career sdn bhd", companies: "career sdn bhd",
    current: "present retailaim", now: "present retailaim", currently: "present retailaim",
    about: "identity specialist", who: "identity specialist", himself: "identity specialist", background: "identity specialist",
    role: "developer specialist designation", title: "designation specialist",
    born: "origins born dungun", age: "born 1992", old: "born 1992", hometown: "origins dungun terengganu",
    live: "based shah alam", lives: "based shah alam", located: "based shah alam", location: "based shah alam",
    contact: "contact email linkedin whatsapp", email: "contact email", reach: "contact email", hire: "contact open",
    phone: "contact mobile", mobile: "mobile flutter android ios", app: "mobile flutter android ios apps", apps: "mobile flutter android ios",
    skill: "skills", skills: "skills", stack: "skills", tech: "skills", technologies: "skills", languages: "languages skills",
    frontend: "react svelte typescript", backend: "asp net core fastapi laravel", cloud: "azure", database: "sql server postgresql",
    ai: "ai machine learning", government: "government agencies", experience: "years tenure"
  };
  /* Bahasa Melayu questions reach an English KB through these, at full weight: a
     translation is the question's own meaning, not a loosening of it. */
  var TRANSLATIONS = {
    sekolah: "education spm smk", belajar: "education diploma bachelor", universiti: "education uitm", ijazah: "bachelor education",
    kerja: "career developer", syarikat: "career sdn bhd", jawatan: "designation developer", kemahiran: "skills",
    lahir: "born origins", tinggal: "based shah alam", hubungi: "contact email", pengalaman: "years tenure",
    projek: "projects", sistem: "systems", kerajaan: "government agencies", telefon: "mobile", aplikasi: "apps mobile",
    pendidikan: "education", asal: "origins", sekarang: "present retailaim", siapa: "identity specialist"
  };

  function stem(word) {
    if (word.length > 5 && /ing$/.test(word)) return word.slice(0, -3);
    if (word.length > 4 && /ed$/.test(word)) return word.slice(0, -2);
    if (word.length > 3 && /s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
    return word;
  }

  function tokens(text) {
    return (String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]/g) || [])
      .filter(function (w) { return !STOPSET[w] && (w.length > 1 || /\d/.test(w)); })
      .map(stem);
  }

  /* The question's own words (and their Malay-to-English translations) count in full;
     the KB words its synonyms add count half, so a synonym alone rarely clears MIN_SCORE. */
  function queryTerms(question) {
    var terms = tokens(question).map(function (w) { return { w: w, weight: 1 }; });
    var own = {};
    terms.forEach(function (t) { own[t.w] = true; });
    String(question || "").toLowerCase().split(/[^a-z0-9+#.]+/).forEach(function (w) {
      if (TRANSLATIONS[w]) tokens(TRANSLATIONS[w]).forEach(function (x) { if (!own[x]) { own[x] = true; terms.push({ w: x, weight: 1 }); } });
    });
    String(question || "").toLowerCase().split(/[^a-z0-9+#.]+/).forEach(function (w) {
      if (SYNONYMS[w]) tokens(SYNONYMS[w]).forEach(function (x) { if (!own[x]) { own[x] = true; terms.push({ w: x, weight: 0.5 }); } });
    });
    return terms;
  }

  /* Builds a BM25 index once per KB text. */
  function buildIndex(chunks) {
    var df = {}, docs = chunks.map(function (c) {
      var tf = {}, list = tokens(c.text + " " + (c.section || ""));
      list.forEach(function (w) { tf[w] = (tf[w] || 0) + 1; });
      Object.keys(tf).forEach(function (w) { df[w] = (df[w] || 0) + 1; });
      return { chunk: c, tf: tf, len: list.length };
    });
    var avg = docs.reduce(function (s, d) { return s + d.len; }, 0) / Math.max(1, docs.length);
    return { docs: docs, df: df, avg: avg || 1, n: docs.length };
  }

  function score(index, doc, terms) {
    var k1 = 1.2, b = 0.75, s = 0, seen = {};
    terms.forEach(function (term) {
      var w = term.w;
      if (seen[w] || !doc.tf[w]) return;
      seen[w] = true;
      var idf = Math.log(1 + (index.n - index.df[w] + 0.5) / (index.df[w] + 0.5));
      var f = doc.tf[w];
      s += term.weight * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * doc.len / index.avg));
    });
    return s;
  }

  /* The top-k chunks for a question, best first, with their scores. */
  function retrieve(index, question, k) {
    var terms = queryTerms(question);
    if (!terms.length) return [];
    return index.docs.map(function (d) { return { chunk: d.chunk, score: score(index, d, terms) }; })
      .filter(function (h) { return h.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, k || 4);
  }

  /* ---------------- triage: the same three answers Clef gives the cloud tier ---------------- */
  var MIN_SCORE = 1.6;   /* below this, nothing in the KB is about the question */

  function triage(question, hits, salaryPattern) {
    if (salaryPattern && salaryPattern.test(String(question || "").toLowerCase())) return "salary";
    if (!hits.length || hits[0].score < MIN_SCORE) return "handoff";
    return "answer";
  }

  /* ---------------- prompt ---------------- */
  /* Tried on the live model against fifteen visitor questions (2026-10-03): the facts in
     the system turn with four chunks gave the most natural, most accurate answers. Fewer
     facts made it invent more, not less; facts in the user turn, or an instruction to
     "name only what the facts name", made it answer in bare nouns. What it still invents
     is caught by cleanReply, not by more prompt. */
  var PERSONA =
    "You are AIMeer, the assistant on Ameer Adhwa's portfolio website. Speak about Ameer in the third person, " +
    "warmly and professionally. Answer using ONLY the facts below, in English, in 1-3 short sentences. " +
    "If the facts do not answer the question, say you do not have that information and suggest asking Ameer directly. " +
    "Never invent projects, employers, dates, numbers or links.";

  /* identity: the always-on first line, so "who is he" style questions have an anchor */
  function buildMessages(question, hits, identity, history) {
    var facts = [];
    if (identity) facts.push(identity);
    hits.forEach(function (h) { if (h.chunk.text !== identity) facts.push(h.chunk.text); });
    var system = PERSONA + "\n\nFACTS:\n" + facts.map(function (f) { return "- " + f; }).join("\n");
    var messages = [{ role: "system", content: system }];
    (history || []).slice(-2).forEach(function (m) {
      if (m && (m.role === "user" || m.role === "assistant") && m.content) messages.push({ role: m.role, content: String(m.content) });
    });
    messages.push({ role: "user", content: String(question) });
    return messages;
  }

  /* ---------------- reply clean-up ---------------- */
  var MONEY = /\bRM\s?\d|\d[\d,.]*\s?(k|ringgit|myr)\b|\bsalary (of|is)\b/i;
  /* the model talking about its prompt instead of about Ameer */
  var META = /\b(provided|given) (context|facts|information|document|text)\b|\bthe (context|document)\b|\bplease provide\b/i;
  var NAME_OK = /^(ameer|aimeer|adhwa|mohamad|bin|he|his|him|yes|no|the|this|it|i|english|malaysia|malaysian|january|february|march|april|may|june|july|august|september|october|november|december)$/i;

  /* A sentence that names something the facts do not (a library, a site, a number) is
     dropped. Names are capitalised or carry a digit or a dot; a sentence's first word
     only counts when it has a digit or a dot. Deterministic, so a small model's
     confident inventions ("React Query", "liveaim.com") never reach the visitor. */
  function grounded(sentence, haystack) {
    var words = sentence.match(/[A-Za-z0-9][A-Za-z0-9+#./-]*[A-Za-z0-9+#]|[A-Za-z0-9]/g) || [];
    var namesOk = words.every(function (word, i) {
      var named = /[0-9.]/.test(word) || (i > 0 && /[A-Z]/.test(word));
      if (!named || NAME_OK.test(word)) return true;
      return haystack.indexOf(word.toLowerCase().replace(/\.$/, "")) !== -1;
    });
    return namesOk;
  }

  /* "" means "treat as a miss": the caller falls back to the instant answer. facts is the
     text the model was shown (plus the question); without it the grounding check is skipped. */
  function cleanReply(text, facts) {
    var out = String(text || "")
      .replace(/<\|[^|]*\|>/g, " ")
      .replace(/<think>[\s\S]*?<\/think>/gi, " ")
      .replace(/^\s*(AIMeer|Assistant|Answer)\s*:\s*/i, "")
      .replace(/[*#`_]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!out || MONEY.test(out) || META.test(out)) return "";
    var sentences = splitSentences(out).map(function (s) { return s.trim(); }).filter(Boolean);
    /* the token budget can stop it mid-sentence; a cut-off tail goes */
    if (sentences.length > 1 && !/[.!?)"']$/.test(sentences[sentences.length - 1])) sentences.pop();
    var first = sentences[0];
    if (facts) {
      var haystack = String(facts).toLowerCase();
      sentences = sentences.filter(function (s) { return grounded(s, haystack); });
    }
    /* its inventions tend to start in the third sentence, so there is no third */
    sentences = sentences.slice(0, 2);
    /* "He also …" reads oddly once the sentence it followed was dropped */
    if (sentences.length && sentences[0] !== first) sentences[0] = sentences[0].replace(/^(He|Ameer) also /, "$1 ");
    out = sentences.join(" ");
    if (out.length > 500) {
      var cut = out.slice(0, 500);
      var end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
      out = end > 160 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
    }
    return out;
  }

  /* the text cleanReply grounds against: everything the model was shown */
  function factsOf(messages) {
    return (messages || []).map(function (m) { return m.content; }).join("\n");
  }

  return {
    MODEL: MODEL,
    MIN_SCORE: MIN_SCORE,
    evaluateGate: evaluateGate,
    probeEnvironment: probeEnvironment,
    chunkKb: chunkKb,
    buildIndex: buildIndex,
    retrieve: retrieve,
    triage: triage,
    buildMessages: buildMessages,
    cleanReply: cleanReply,
    factsOf: factsOf
  };
});
