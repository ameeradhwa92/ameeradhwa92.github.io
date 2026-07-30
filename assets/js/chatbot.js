/* AIMeer — Ameer's AI twin. Hybrid three-tier portfolio chatbot.
   Tier 1: instant keyword answers, zero download, works everywhere.
   Tier 2: WebLLM (Llama 3.2 1B) running fully in-browser via WebGPU on capable
           devices — auto-downloads in the background, cancellable in the panel.
   Tier 3: devices that can't run the local model (iPhones, old GPUs, no WebGPU)
           are routed to a Cloudflare Worker relay (cloud/aimeer-worker.js) so
           AI answers are always available. The active route is shown in the
           chat status line. */
(function () {
  "use strict";

  var WEBLLM_CDN = "https://esm.run/@mlc-ai/web-llm@0.2.79";
  var KB_URL = "assets/data/aimeer-kb.txt";
  var PROFILE_URL = "assets/data/aimeer-profile.json";
  /* Cloudflare Worker relay for devices that can't run the local model.
     Deploy cloud/aimeer-worker.js, then paste its workers.dev URL here. */
  var CLOUD_ENDPOINT = typeof window.AIMEER_CLOUD_ENDPOINT === "string"
    ? window.AIMEER_CLOUD_ENDPOINT
    : "https://aimeer-ai.ameer-adhwa.workers.dev/";
  var cloudOk = !!CLOUD_ENDPOINT;
  var root = document.documentElement;

  /* Cache busting.  GitHub Pages serves assets with Cache-Control: max-age=600,
     so a stale visitor self-heals within ten minutes; the ?v= tag on our own
     <script src> in index.html makes that deterministic instead.  We forward the
     same tag to the two data files because they are fetched at runtime and are
     not covered by the script tag: a stale aimeer-kb.txt makes AIMeer answer
     from retired facts, which is worse than stale code.  Read from our own src
     rather than hardcoded, so index.html stays the ONLY place to bump it.
     Returns "" when there is no ?v= (local preview, test harness), leaving the
     URLs byte-identical to their un-versioned form. */
  function assetVersionQuery() {
    var currentScript = document && document.currentScript;
    var src = currentScript && currentScript.src;
    var match = src ? String(src).match(/[?&]v=([^&#]+)/) : null;
    return match ? "?v=" + match[1] : "";
  }
  var ASSET_VERSION_QUERY = assetVersionQuery();

  /* ---------------- knowledge base (fetched, shared with the cloud worker) ---------------- */
  var KB = "", kbPromise = null;
  var PROFILE = null, profilePromise = null;
  function ensureKB() {
    if (KB) return Promise.resolve(KB);
    if (!kbPromise) {
      kbPromise = fetch(KB_URL + ASSET_VERSION_QUERY).then(function (r) {
        if (!r.ok) throw new Error("kb-" + r.status);
        return r.text();
      }).then(function (txt) {
        KB = txt;
        return KB;
      }).catch(function (err) {
        kbPromise = null;
        throw err;
      });
    }
    return kbPromise;
  }

  function ensureProfile() {
    if (PROFILE) return Promise.resolve(PROFILE);
    if (!profilePromise) {
      profilePromise = fetch(PROFILE_URL + ASSET_VERSION_QUERY).then(function (r) {
        if (!r.ok) throw new Error("profile-" + r.status);
        return r.json();
      }).then(function (data) {
        PROFILE = data;
        return PROFILE;
      }).catch(function (err) {
        profilePromise = null;
        throw err;
      });
    }
    return profilePromise;
  }

  var PROMPT_HEAD =
    "You are AIMeer, the AI twin of Ameer Adhwa on his portfolio website. You speak about Ameer in the third person, " +
    "warmly and professionally. Answer visitors' questions using ONLY the facts below. " +
    "Keep answers short (2-5 sentences), factual and friendly. If the question is in Bahasa Malaysia, reply in formal " +
    "Bahasa Malaysia; otherwise reply in English. If the answer is not in the facts, say you do not have that " +
    "information and suggest asking Ameer directly — the chat will show WhatsApp and email buttons for that. " +
    "Never invent projects, employers, dates or links.\n\n";

  /* ---------------- bounded recruiter helper compatibility ----------------
     Older local tools consume this public helper block directly.  The live
     scoring request below uses JDReasoning and the jd-scoring contract, whose
     system prompt is assembled by the Worker and never by this file; this shim
     remains bounded and is not used as a free-form request path. */
  var JD_EXPLANATION_JD_MAX = 12000;
  var JD_EXPLANATION_RESULT_MAX = 12000;
  var JD_EXPLANATION_CATEGORY_KEYS = [
    "coreTechnologies",
    "professionalExperience",
    "architectureDeliveryCloud",
    "domainIntegrations",
    "mobile",
    "educationCoursework",
    "languagesCommunication"
  ];
  var JD_EXPLANATION_DISCLAIMERS = {
    en: "This is an estimated compatibility score based only on the job description and Ameer's published profile. It is not an objective hiring decision, technical assessment, or guarantee of suitability.",
    ms: "Ini ialah skor keserasian anggaran yang berasaskan hanya pada huraian jawatan dan profil terbitan Ameer. Ia bukan keputusan pengambilan pekerja yang objektif, penilaian teknikal, atau jaminan kesesuaian."
  };

  function clipExplanationText(value, maxChars) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
  }

  function compactExplanationList(items, maxItems) {
    return (Array.isArray(items) ? items : []).slice(0, maxItems).map(function (item) {
      return {
        term: clipExplanationText(item && item.term, 120),
        label: clipExplanationText(item && item.label, 220),
        evidenceType: clipExplanationText(item && item.evidenceType, 32),
        evidence: (Array.isArray(item && item.evidence) ? item.evidence : []).slice(0, 3).map(function (entry) {
          return clipExplanationText(entry, 140);
        })
      };
    });
  }

  function compactExplanationCategories(categories) {
    var source = categories && typeof categories === "object" ? categories : {};
    var compact = {};
    JD_EXPLANATION_CATEGORY_KEYS.forEach(function (key) {
      var item = source[key];
      if (!item || typeof item !== "object") return;
      compact[key] = {
        score: Math.max(0, Math.min(100, Number(item.score) || 0)),
        weight: Math.max(0, Math.min(100, Number(item.weight) || 0))
      };
      if (typeof item.key === "string") compact[key].key = clipExplanationText(item.key, 64);
      if (typeof item.label === "string") compact[key].label = clipExplanationText(item.label, 120);
      if (Number.isInteger(item.matchedRequirements)) {
        compact[key].matchedRequirements = Math.max(0, Math.min(100, item.matchedRequirements));
      }
      if (Number.isInteger(item.totalRequirements)) {
        compact[key].totalRequirements = Math.max(0, Math.min(100, item.totalRequirements));
      }
      if (Array.isArray(item.matchedTerms)) {
        compact[key].matchedTerms = item.matchedTerms.slice(0, 50).map(function (term) {
          return clipExplanationText(term, 120);
        });
      }
    });
    return compact;
  }

  function compactExplanationResult(result) {
    var compact = {
      score: Math.round((Number(result && result.score) || 0) * 10) / 10,
      confidence: {
        label: clipExplanationText(result && result.confidence && result.confidence.label, 16),
        reasons: (Array.isArray(result && result.confidence && result.confidence.reasons)
          ? result.confidence.reasons : []).slice(0, 3).map(function (reason) {
            return clipExplanationText(reason, 180);
          })
      },
      categories: compactExplanationCategories(result && result.categories),
      strongMatches: compactExplanationList(result && result.strongMatches, 6),
      partialMatches: compactExplanationList(result && result.partialMatches, 6),
      gaps: compactExplanationList(result && result.gaps, 6),
      unverified: compactExplanationList(result && result.unverified, 6),
      interviewTopics: compactExplanationList(result && result.interviewTopics, 6)
    };
    while (JSON.stringify(compact).length > JD_EXPLANATION_RESULT_MAX) {
      if (compact.unverified.length) compact.unverified.pop();
      else if (compact.gaps.length) compact.gaps.pop();
      else if (compact.partialMatches.length) compact.partialMatches.pop();
      else if (compact.strongMatches.length) compact.strongMatches.pop();
      else if (compact.interviewTopics.length) compact.interviewTopics.pop();
      else if (compact.confidence.reasons.length) compact.confidence.reasons.pop();
      else break;
    }
    return compact;
  }

  function buildJdExplanationPayload(normalizedText, result, language) {
    var lang = language === "ms" ? "ms" : "en";
    return {
      mode: "jd-explanation",
      language: lang,
      messages: [{
        role: "user",
        content: lang === "ms"
          ? "Terangkan keputusan padanan huraian jawatan ini tanpa mengubah skor deterministik."
          : "Explain this job-description match result without changing the deterministic score."
      }],
      jdText: clipExplanationText(normalizedText, JD_EXPLANATION_JD_MAX),
      matchResult: compactExplanationResult(result || {}),
      disclaimer: JD_EXPLANATION_DISCLAIMERS[lang]
    };
  }

  function nextExplanationToken(current) {
    return (Number(current) || 0) + 1;
  }

  function canApplyExplanationToken(requestToken, currentToken) {
    return requestToken === currentToken;
  }

  function nextAnalysisToken(current) {
    return (Number(current) || 0) + 1;
  }

  function canApplyAnalysisToken(requestToken, currentToken) {
    return requestToken === currentToken;
  }

  function computeJdReasoningMode(state) {
    if (!state || !state.hasResult || !state.hasNormalizedText) return "unavailable";
    if (state.hasEngine && state.aiState === "ready") return "local";
    if (state.localOK) {
      if (state.dlActive || state.aiState === "loading" || state.route === "local" || state.preferredMode === "local") {
        return "waiting";
      }
      if (state.cloudOk && (state.aiState === "cloud" || state.route === "cloud" || state.preferredMode === "cloud")) {
        return "cloud";
      }
      return "unavailable";
    }
    if (state.cloudOk && (state.aiState === "cloud" || state.route === "cloud" || state.preferredMode === "cloud")) {
      return "cloud";
    }
    return "unavailable";
  }

  /* Which pass's confidence belongs beside the displayed score. renderJdResult shows
     result.finalScore once AI scoring merges, but used to print the deterministic
     baseline.confidence.label unconditionally — so an AI score of 82% sat next to the keyword
     pass's "Low", computed in jd-matcher.js from strongCount/total and never told what the model
     concluded. Neither value was wrong; printing them adjacent implied they measured the same
     thing. On the fallback path the keyword confidence is exactly right, so it stays. */
  function resolveConfidenceLevel(scoringMode, result, baseline) {
    if (scoringMode === "ai" && result && result.aiConfidence) return result.aiConfidence;
    return baseline && baseline.confidence ? baseline.confidence.label || "" : "";
  }

  /* Array + indexOf rather than an object-literal lookup, matching the convention in
     jd-reasoning.js: a plain-object map would report "constructor" and "toString" as in-flight. */
  var JD_PROGRESS_STATUS_KINDS = ["reading", "scoring", "aiScoring", "aiRetrying"];

  function isJdProgressVisible(statusKind) {
    return JD_PROGRESS_STATUS_KINDS.indexOf(String(statusKind || "")) !== -1;
  }

  if (!window.AIMeerRecruiter) window.AIMeerRecruiter = {};
  window.AIMeerRecruiter.buildExplanationPayload = buildJdExplanationPayload;
  window.AIMeerRecruiter.getExplanationMode = computeJdReasoningMode;
  window.AIMeerRecruiter.getReasoningMode = computeJdReasoningMode;
  window.AIMeerRecruiter.nextExplanationToken = nextExplanationToken;
  window.AIMeerRecruiter.canApplyExplanationToken = canApplyExplanationToken;
  window.AIMeerRecruiter.nextAnalysisToken = nextAnalysisToken;
  window.AIMeerRecruiter.canApplyAnalysisToken = canApplyAnalysisToken;
  window.AIMeerRecruiter.resolveConfidenceLevel = resolveConfidenceLevel;
  window.AIMeerRecruiter.isJdProgressVisible = isJdProgressVisible;
  window.AIMeerRecruiter.jdExplanationLimits = {
    jdText: JD_EXPLANATION_JD_MAX,
    resultChars: JD_EXPLANATION_RESULT_MAX
  };

  var WA_NUMBER = "60139610053"; /* +60 13-961 0053 in wa.me format */
  var EMAIL = "ameeradhwa92@gmail.com";

  /* ---------------- ui strings (dynamic ones JS must swap itself) ---------------- */
  var T = {
    en: {
      greeting: "Hi, I'm AIMeer — Ameer's AI twin. Ask me about his career, projects and skills, or tap a suggestion below. Full AI mode gets ready by itself — on your device when it can, via secure cloud when it can't.",
      placeholder: "Ask AIMeer…",
      statusInstant: "Instant answers · no download",
      statusAI: "AI mode · on your device",
      statusCloud: "AI mode · secure cloud",
      statusLoading: "Downloading model… ",
      statusPreparing: "Preparing model… (first load compiles GPU shaders)",
      aiDownloading: "AIMeer is preparing its on-device AI in the background (≈ 0.9 GB, one time — your questions will never leave this device). You can already chat while it downloads.",
      aiPitchManual: "On-device AI runs a small language model entirely in your browser — your questions never leave this device. One-time download ≈ 0.9 GB.",
      enableBtn: "Enable on-device AI",
      cancelCloud: "Cancel — use cloud AI",
      cancelPlain: "Cancel download",
      aiReady: "AI mode is on. Everything runs on your device — ask me anything about Ameer's work.",
      aiReadyCloud: "AI mode is on via secure cloud — this device can't run the on-device model, so answers are generated by a cloud model instead. Ask me anything about Ameer's work.",
      aiInterim: "Answers come from the secure cloud for now — the on-device model is still downloading and takes over automatically when it's ready.",
      cloudInterim: "The on-device model is taking a while to download, so I'll answer through the secure cloud in the meantime — I'll switch over automatically once it's ready.",
      aiUpgraded: "The on-device model is ready — I've switched from cloud to on-device AI, so your questions now stay on this device.",
      canceledCloud: "Download canceled — switched to cloud AI. Everything still works.",
      canceledPlain: "Download canceled. Instant answers keep working — you can enable on-device AI anytime above.",
      aiError: "AI mode failed to load — your connection may have dropped, or the device ran out of memory. Instant answers still work.",
      aiErrorCloud: "The on-device model couldn't load, so I've switched to cloud AI — everything still works.",
      unsupported: "This device can't run the on-device AI model and the cloud AI service isn't available right now, so free-form AI answers are off. Instant answers below still work — or email ameeradhwa92@gmail.com.",
      fallbackDefault: "I don't have an instant answer for that one — sounds like a question for Ameer himself. Send him this chat with the buttons below, or try a suggested topic.",
      thinking: "Thinking…",
      handoffPrompt: "Ask Ameer directly — I'll attach a short summary of this chat:",
      handoffWa: "WhatsApp Ameer",
      handoffMail: "Email instead",
      summarizing: "Preparing summary…",
      mailSubject: "Question from your portfolio (via AIMeer)",
      sumIntro: "Hi Ameer! I've been chatting with AIMeer on your portfolio.",
      sumAsked: "What I asked:",
      sumOpen: "AIMeer couldn't answer this one:",
      sumVia: "sent via AIMeer · ameeradhwa92.github.io",
      jdPromo: "Paste a job description or load a local PDF/DOCX. AIMeer analyzes the fit with AI and shows an evidence-backed match report.",
      jdPromoAction: "Open JD matcher",
      jdInputPlaceholder: "Paste the job description here…",
      jdDisclaimer: "This is an estimated compatibility score based only on the job description and Ameer's published profile. It is not an objective hiring decision, technical assessment, or guarantee of suitability.",
      jdFileEmpty: "No file selected",
      jdStatusIdle: "Paste a job description or choose a local PDF/DOCX to start.",
      jdStatusReading: "Reading the local document…",
      jdStatusScoring: "Preparing the match locally…",
      jdAiStatusScoring: "AIMeer is analyzing the match with AI…",
      jdAiStatusRetrying: "The first AI attempt did not come back cleanly — AIMeer is trying once more…",
      jdStatusLoaded: "Local document ready: {source}.",
      jdStatusLoadedWithWarnings: "Local document ready: {source}. Warnings: {warnings}",
      jdStatusPasted: "Using the pasted job description text.",
      jdStatusScored: "Match report ready from {source}.",
      jdSourcePaste: "pasted text",
      jdSourcePdf: "PDF text",
      jdSourceDocx: "DOCX text",
      jdErrorMissingText: "Paste a job description or choose a local PDF/DOCX before analyzing.",
      jdErrorUnavailable: "Recruiter matching is not ready in this tab yet. Please refresh and try again.",
      jdErrorProfile: "The published recruiter profile could not be loaded for local scoring. Please refresh and try again.",
      jdErrorFileType: "Only PDF and DOCX files are supported. Please paste the job description text instead.",
      jdErrorFileSize: "This document is larger than 10 MB. Please paste the job description text instead.",
      jdErrorPdf: "Could not read this PDF locally. Please paste the job description text instead.",
      jdErrorDocx: "This DOCX file is unsupported, encrypted, or malformed. Please paste the job description text instead.",
      jdWarnPdfNoText: "No readable text was found in this PDF. Please paste the job description text instead.",
      jdWarnDocxNoText: "No readable text was found in this DOCX file. Please paste the job description text instead.",
      jdWarnTrimmed: "Only the first 60,000 characters were analyzed locally.",
      jdWarnGenericText: "No recognizable section headings were found; matching uses generic text only.",
      jdFallbackLabel: "Keyword estimate — full AI analysis unavailable right now.",
      jdCalibratedNote: "Calibrated against published evidence.",
      jdFitStrong: "Strong fit",
      jdFitGood: "Good fit",
      jdFitPartial: "Partial fit",
      jdFitLimited: "Limited overlap",
      jdResultConfidenceLabel: "Confidence",
      jdResultConfidenceHigh: "High",
      jdResultConfidenceMedium: "Medium",
      jdResultConfidenceLow: "Low",
      jdEvidenceGap: "Published evidence gap",
      jdEvidenceUnverified: "Unverified",
      jdNoMatches: "No items in this section.",
      jdReasonTitle: "Recruiter reasoning",
      jdReasonStatusCloud: "Recruiter reasoning used secure cloud AI, weighing the job description wording, the keyword-based baseline, and recruiter-safe evidence.",
      jdReasonStatusUnavailable: "Recruiter reasoning is unavailable right now, so the keyword-based estimate above stands on its own.",
      jdReasonStatusFallback: "AI reasoning could not be completed, so this report uses the keyword-based estimate above instead.",
      jdReasonRequirements: "Requirement-by-requirement reasoning",
      jdHandoffSummary: "AIMeer match report — {band} ({score}%).",
      jdHandoffStrengths: "Strengths: {terms}.",
      jdHandoffFallbackLabel: "Keyword estimate",
      jdReasonVerifiedStrengths: "Verified strengths",
      jdReasonTransferableAdvantages: "Transferable advantages",
      jdReasonPriorityGaps: "Priority gaps",
      jdReasonInterviewQuestions: "Verification questions",
      jdReasonIntentLabel: "Requirement intent",
      jdReasonOutcomeLabel: "Expected outcome",
      jdReasonBoundaryLabel: "Boundary",
      jdReasonFramingLabel: "Recruiter framing",
      jdReasonVerificationLabel: "Verification question",
      jdReasonEvidenceLabel: "Evidence references",
      jdReasonCapabilitiesLabel: "Transferable capabilities",
      jdReasonPrivacyCloud: "The job description wording was sent to secure cloud AI for this analysis; personal identifiers are withheld rather than sent.",
      jdReasonPrivacyUnavailable: "This analysis could not be completed, so no AI result is shown.",
      jdReasonNoRequirementDetails: "No requirement-level reasoning is available yet.",
      jdReasonMatchDirectProfessional: "Direct professional match",
      jdReasonMatchAdjacentProfessional: "Adjacent professional match",
      jdReasonMatchTransferableProfessional: "Transferable professional match",
      jdReasonMatchAcademicFoundation: "Academic foundation",
      jdReasonMatchLearningBridge: "Learning bridge",
      jdReasonMatchExplicitGap: "Explicit gap",
      jdReasonMatchUnverified: "Unverified"
    },
    ms: {
      greeting: "Salam sejahtera! Saya AIMeer — kembar AI Ameer. Tanya saya tentang kerjaya, projek dan kemahiran beliau, atau tekan cadangan di bawah. Mod AI penuh disediakan secara automatik — pada peranti anda jika mampu, melalui awan selamat jika tidak.",
      placeholder: "Tanya AIMeer…",
      statusInstant: "Jawapan segera · tanpa muat turun",
      statusAI: "Mod AI · pada peranti anda",
      statusCloud: "Mod AI · awan selamat",
      statusLoading: "Memuat turun model… ",
      statusPreparing: "Menyediakan model… (muatan pertama mengompil pelorek GPU)",
      aiDownloading: "AIMeer sedang menyediakan AI setempat di latar belakang (≈ 0.9 GB, sekali sahaja — soalan anda tidak akan meninggalkan peranti ini). Anda sudah boleh bersembang sementara ia dimuat turun.",
      aiPitchManual: "AI setempat menjalankan model bahasa kecil sepenuhnya dalam pelayar anda — soalan anda tidak meninggalkan peranti ini. Muat turun sekali sahaja ≈ 0.9 GB.",
      enableBtn: "Aktifkan AI setempat",
      cancelCloud: "Batal — guna AI awan",
      cancelPlain: "Batal muat turun",
      aiReady: "Mod AI telah diaktifkan. Semuanya berjalan pada peranti anda — tanyalah apa-apa sahaja tentang kerja Ameer.",
      aiReadyCloud: "Mod AI diaktifkan melalui awan selamat — peranti ini tidak dapat menjalankan model setempat, jadi jawapan dijana oleh model awan. Tanyalah apa-apa sahaja tentang kerja Ameer.",
      aiInterim: "Buat masa ini jawapan datang daripada awan selamat — model setempat masih dimuat turun dan akan mengambil alih secara automatik apabila siap.",
      cloudInterim: "Model setempat mengambil masa untuk dimuat turun, jadi buat sementara waktu saya menjawab melalui awan selamat — saya akan bertukar secara automatik apabila ia siap.",
      aiUpgraded: "Model setempat sudah siap — saya beralih daripada awan kepada AI setempat, jadi soalan anda kini kekal pada peranti ini.",
      canceledCloud: "Muat turun dibatalkan — beralih kepada AI awan. Semuanya masih berfungsi.",
      canceledPlain: "Muat turun dibatalkan. Jawapan segera masih berfungsi — anda boleh mengaktifkan AI setempat pada bila-bila masa di atas.",
      aiError: "Mod AI gagal dimuatkan — sambungan mungkin terputus, atau memori peranti tidak mencukupi. Jawapan segera masih berfungsi.",
      aiErrorCloud: "Model setempat gagal dimuatkan, jadi saya beralih kepada AI awan — semuanya masih berfungsi.",
      unsupported: "Peranti ini tidak dapat menjalankan model AI setempat dan perkhidmatan AI awan tidak tersedia buat masa ini, jadi jawapan AI bebas dimatikan. Jawapan segera di bawah masih berfungsi — atau e-mel ameeradhwa92@gmail.com.",
      fallbackDefault: "Saya tiada jawapan segera untuk soalan itu — nampaknya soalan untuk Ameer sendiri. Hantar sembang ini kepada beliau dengan butang di bawah, atau cuba topik yang dicadangkan.",
      thinking: "Sedang berfikir…",
      handoffPrompt: "Tanya Ameer secara terus — saya akan lampirkan ringkasan sembang ini:",
      handoffWa: "WhatsApp Ameer",
      handoffMail: "E-mel sahaja",
      summarizing: "Menyediakan ringkasan…",
      mailSubject: "Soalan daripada portfolio anda (melalui AIMeer)",
      sumIntro: "Hai Ameer! Saya baru berbual dengan AIMeer di portfolio anda.",
      sumAsked: "Soalan saya:",
      sumOpen: "AIMeer tidak dapat menjawab soalan ini:",
      sumVia: "dihantar melalui AIMeer · ameeradhwa92.github.io",
      jdPromo: "Tampal huraian jawatan atau muatkan PDF/DOCX setempat. AIMeer menganalisis kesesuaian dengan AI dan memaparkan laporan padanan yang disokong bukti.",
      jdPromoAction: "Buka mod padanan huraian jawatan",
      jdInputPlaceholder: "Tampal huraian jawatan di sini…",
      jdDisclaimer: "Ini ialah skor keserasian anggaran yang berasaskan hanya pada huraian jawatan dan profil terbitan Ameer. Ia bukan keputusan pengambilan pekerja yang objektif, penilaian teknikal, atau jaminan kesesuaian.",
      jdFileEmpty: "Belum ada fail dipilih",
      jdStatusIdle: "Tampal huraian jawatan atau pilih PDF/DOCX setempat untuk bermula.",
      jdStatusReading: "Sedang membaca dokumen setempat…",
      jdStatusScoring: "Sedang menyediakan padanan secara setempat…",
      jdAiStatusScoring: "AIMeer sedang menganalisis padanan dengan AI…",
      jdAiStatusRetrying: "Percubaan AI pertama tidak menjadi — AIMeer sedang mencuba sekali lagi…",
      jdStatusLoaded: "Dokumen setempat sedia digunakan: {source}.",
      jdStatusLoadedWithWarnings: "Dokumen setempat sedia digunakan: {source}. Amaran: {warnings}",
      jdStatusPasted: "Menggunakan teks huraian jawatan yang ditampal.",
      jdStatusScored: "Laporan padanan sedia daripada {source}.",
      jdSourcePaste: "teks tampalan",
      jdSourcePdf: "teks PDF",
      jdSourceDocx: "teks DOCX",
      jdErrorMissingText: "Tampal huraian jawatan atau pilih PDF/DOCX setempat sebelum menganalisis.",
      jdErrorUnavailable: "Padanan perekrut belum sedia dalam tab ini. Muat semula dan cuba lagi.",
      jdErrorProfile: "Profil perekrut terbitan tidak dapat dimuatkan untuk pemarkahan setempat. Muat semula dan cuba lagi.",
      jdErrorFileType: "Hanya fail PDF dan DOCX disokong. Sila tampal teks huraian jawatan sebagai ganti.",
      jdErrorFileSize: "Dokumen ini melebihi 10 MB. Sila tampal teks huraian jawatan sebagai ganti.",
      jdErrorPdf: "PDF ini tidak dapat dibaca secara setempat. Sila tampal teks huraian jawatan sebagai ganti.",
      jdErrorDocx: "Fail DOCX ini tidak disokong, disulitkan, atau rosak. Sila tampal teks huraian jawatan sebagai ganti.",
      jdWarnPdfNoText: "Tiada teks yang boleh dibaca ditemui dalam PDF ini. Sila tampal teks huraian jawatan sebagai ganti.",
      jdWarnDocxNoText: "Tiada teks yang boleh dibaca ditemui dalam fail DOCX ini. Sila tampal teks huraian jawatan sebagai ganti.",
      jdWarnTrimmed: "Hanya 60,000 aksara pertama dianalisis secara setempat.",
      jdWarnGenericText: "Tiada tajuk seksyen yang dapat dikenal pasti; padanan menggunakan teks umum sahaja.",
      jdFallbackLabel: "Anggaran kata kunci — analisis AI penuh tidak tersedia buat masa ini.",
      jdCalibratedNote: "Ditentukur berdasarkan bukti terbitan.",
      jdFitStrong: "Padanan kukuh",
      jdFitGood: "Padanan baik",
      jdFitPartial: "Padanan separa",
      jdFitLimited: "Pertindihan terhad",
      jdResultConfidenceLabel: "Tahap keyakinan",
      jdResultConfidenceHigh: "Tinggi",
      jdResultConfidenceMedium: "Sederhana",
      jdResultConfidenceLow: "Rendah",
      jdEvidenceGap: "Jurang bukti terbitan",
      jdEvidenceUnverified: "Belum disahkan",
      jdNoMatches: "Tiada item dalam seksyen ini.",
      jdReasonTitle: "Penaakulan perekrut",
      jdReasonStatusCloud: "Penaakulan perekrut menggunakan AI awan selamat, menimbang kandungan huraian jawatan, garis dasar berasaskan kata kunci, dan bukti selamat perekrut.",
      jdReasonStatusUnavailable: "Penaakulan perekrut tidak tersedia sekarang, jadi anggaran berasaskan kata kunci di atas berdiri dengan sendirinya.",
      jdReasonStatusFallback: "Penaakulan AI tidak dapat diselesaikan, jadi laporan ini menggunakan anggaran berasaskan kata kunci di atas.",
      jdReasonRequirements: "Penaakulan mengikut keperluan",
      jdHandoffSummary: "Laporan padanan AIMeer — {band} ({score}%).",
      jdHandoffStrengths: "Kekuatan: {terms}.",
      jdHandoffFallbackLabel: "Anggaran kata kunci",
      jdReasonVerifiedStrengths: "Kekuatan yang disahkan",
      jdReasonTransferableAdvantages: "Kelebihan boleh dipindahkan",
      jdReasonPriorityGaps: "Jurang keutamaan",
      jdReasonInterviewQuestions: "Soalan pengesahan",
      jdReasonIntentLabel: "Niat keperluan",
      jdReasonOutcomeLabel: "Hasil yang dijangka",
      jdReasonBoundaryLabel: "Batasan",
      jdReasonFramingLabel: "Pembingkaian perekrut",
      jdReasonVerificationLabel: "Soalan pengesahan",
      jdReasonEvidenceLabel: "Rujukan bukti",
      jdReasonCapabilitiesLabel: "Keupayaan boleh dipindahkan",
      jdReasonPrivacyCloud: "Kandungan huraian jawatan dihantar kepada AI awan selamat untuk analisis ini; pengenalan diri peribadi ditahan, bukan dihantar.",
      jdReasonPrivacyUnavailable: "Analisis ini tidak dapat diselesaikan, jadi tiada keputusan AI dipaparkan.",
      jdReasonNoRequirementDetails: "Butiran penaakulan mengikut keperluan belum tersedia.",
      jdReasonMatchDirectProfessional: "Padanan profesional langsung",
      jdReasonMatchAdjacentProfessional: "Padanan profesional bersebelahan",
      jdReasonMatchTransferableProfessional: "Padanan profesional boleh dipindahkan",
      jdReasonMatchAcademicFoundation: "Asas akademik",
      jdReasonMatchLearningBridge: "Jambatan pembelajaran",
      jdReasonMatchExplicitGap: "Jurang nyata",
      jdReasonMatchUnverified: "Belum disahkan"
    }
  };
  function lang() { return root.dataset.lang === "ms" ? "ms" : "en"; }
  function t(key) { return T[lang()][key]; }
  function formatT(key, values) {
    var text = t(key) || "";
    Object.keys(values || {}).forEach(function (name) {
      text = text.replace(new RegExp("\\{" + name + "\\}", "g"), values[name]);
    });
    return text;
  }

  /* ---------------- tier 1: instant keyword answers ---------------- */
  /* salary questions always offer the WhatsApp/email handoff, in every tier */
  var SALARY_KEYS = /\b(salary|pay|paid|earn(s|ing)?|expected|compensation|remuneration|package|gaji|pendapatan|rm|ringgit)\b/;

  var TOPICS = [
    {
      keys: /\b(now|today|current|kini|sekarang|retailaim|saas|fmcg|nestle|unilever|farm fresh|role|job|kerja|jawatan)\b/,
      en: "Ameer is a Full Stack Web Specialist at RetailAIM Malaysia, where he has worked since Aug 2023 and was redesignated effective 1 Aug 2025. The redesignation letter confirms the designation and organizational-structure change; the outstanding-performance context is supplied by Ameer. He's the sole developer of RetailAIM® Plus — a multi-tenant ASP.NET Core SaaS used by 20+ FMCG brands across Malaysia, Singapore, Thailand and the Philippines.",
      ms: "Ameer ialah Pakar Web Tindanan Penuh di RetailAIM Malaysia, tempat beliau bekerja sejak Ogos 2023 dan ditukar penetapan jawatan berkuat kuasa 1 Ogos 2025. Surat penetapan semula mengesahkan jawatan dan perubahan struktur organisasi; konteks prestasi cemerlang dibekalkan oleh Ameer. Beliau pembangun tunggal RetailAIM® Plus — SaaS ASP.NET Core berbilang penyewa yang digunakan oleh lebih 20 jenama FMCG di Malaysia, Singapura, Thailand dan Filipina."
    },
    {
      keys: /\b(abbott|salesforce|crm|whatsapp|otp|bird)\b/,
      en: "The Abbott CRM is a React PWA on a .NET 10 clean-architecture monorepo, live (private) for Abbott Nutrition. It runs a 14-step conditional Salesforce API v60.0 workflow across dual clouds, with duplicate detection, WhatsApp OTP via the Bird API, and digital consent capture. Infrastructure is defined in Bicep IaC.",
      ms: "CRM Abbott ialah React PWA di atas monorepo seni bina bersih .NET 10, kini beroperasi (persendirian) untuk Abbott Nutrition. Ia menjalankan aliran kerja bersyarat 14 langkah API Salesforce v60.0 merentas dua awan, dengan pengesanan pendua, OTP WhatsApp menerusi API Bird dan rakaman keizinan digital. Infrastrukturnya ditakrifkan dalam Bicep IaC."
    },
    {
      keys: /\b(government|kerajaan|trm|cidb|span|sirim|kastam|customs|port klang|lppeh|marii|gov)\b/,
      en: "From 2015 to 2023 (7 yrs 10 mos) Ameer was at TRM Nett Systems, shipping 15+ systems for Malaysian agencies — CIDB, SPAN, SIRIM, Royal Malaysian Customs, Port Klang Authority and LPPEH — on web, Android and iOS. Still live today: LPPEH BIS, MARii EEV Label, CIDB CCPM, SPAN eCLAPS, Kastam eCAF, SIRIM Check Your Label, PKA eDCFZ and PKFZ PIMS. He also introduced Git company-wide and pioneered Flutter there.",
      ms: "Dari 2015 hingga 2023 (7 thn 10 bln) Ameer berkhidmat di TRM Nett Systems, menyampaikan lebih 15 sistem untuk agensi Malaysia — CIDB, SPAN, SIRIM, Kastam Diraja Malaysia, Lembaga Pelabuhan Klang dan LPPEH — di web, Android dan iOS. Masih beroperasi hari ini: BIS LPPEH, Label EEV MARii, CCPM CIDB, eCLAPS SPAN, eCAF Kastam, Check Your Label SIRIM, eDCFZ PKA dan PIMS PKFZ. Beliau turut memperkenalkan Git di seluruh syarikat dan memelopori Flutter di sana."
    },
    {
      keys: /\b(live|running|production|aktif|beroperasi|masih)\b/,
      en: "Nine of his systems are verifiably live right now: RetailAIM Plus (retailaim.com), LPPEH BIS (lpeph.gov.my), MARii EEV (eev.marii.my), CIDB CCPM (ccpm.cidb.gov.my), SPAN eCLAPS (eclaps.span.gov.my), Kastam eCAF (restricted), SIRIM Check Your Label (Google Play & App Store), PKA eDCFZ (edcfz.pka.gov.my) and PKFZ PIMS (pkfz.com) — plus private ones like the Abbott CRM and Promoter Payment System. Retired systems are honestly marked on the timeline.",
      ms: "Sembilan sistem beliau masih beroperasi sekarang: RetailAIM Plus (retailaim.com), BIS LPPEH (lpeph.gov.my), EEV MARii (eev.marii.my), CCPM CIDB (ccpm.cidb.gov.my), eCLAPS SPAN (eclaps.span.gov.my), eCAF Kastam (terhad), Check Your Label SIRIM (Google Play & App Store), eDCFZ PKA (edcfz.pka.gov.my) dan PIMS PKFZ (pkfz.com) — serta sistem persendirian seperti CRM Abbott dan Sistem Pembayaran Promoter. Sistem yang dihentikan ditanda secara jujur pada garis masa."
    },
    {
      keys: /\b(skill|stack|tech|teknologi|kemahiran|framework|language|bahasa pengaturcaraan|tool|cloud|azure|awan)\b/,
      en: "Core stack: ASP.NET Core & C# with Entity Framework, plus Python FastAPI and Laravel/PHP on the backend; React + TypeScript (Vite, TailwindCSS, ShadCN) and DevExpress on the frontend; Flutter/Dart, native Android (Kotlin/Java) and iOS (Swift) on mobile; MS SQL Server / Azure SQL for data; Azure DevOps pipelines, App Service and Bicep IaC for delivery. Integrations include Salesforce, SAP, iPay88, SenangPay, eGHL and the WhatsApp Business API.",
      ms: "Tindanan teras: ASP.NET Core & C# dengan Entity Framework, serta Python FastAPI dan Laravel/PHP di hujung belakang; React + TypeScript (Vite, TailwindCSS, ShadCN) dan DevExpress di hujung hadapan; Flutter/Dart, Android natif (Kotlin/Java) dan iOS (Swift) untuk mudah alih; MS SQL Server / Azure SQL untuk data; saluran paip Azure DevOps, App Service dan Bicep IaC untuk penghantaran. Integrasi termasuk Salesforce, SAP, iPay88, SenangPay, eGHL dan API WhatsApp Business."
    },
    {
      keys: /\b(mobile|flutter|android|ios|app store|google play|apps?|mudah alih)\b/,
      en: "Ameer has shipped mobile since 2015: native Android (Kotlin/Java) and iOS (Swift) apps for SIRIM, Port Klang Authority, PKFZ, LPPEH and CIDB — several still on Google Play and the App Store (e.g. SIRIM Check Your Label). He built his company's first Flutter production app (Senai Airport City FZ) and spent 2023 on Motorola Solutions' mission-critical public-safety Android platform.",
      ms: "Ameer telah membangunkan aplikasi mudah alih sejak 2015: aplikasi Android natif (Kotlin/Java) dan iOS (Swift) untuk SIRIM, Lembaga Pelabuhan Klang, PKFZ, LPPEH dan CIDB — beberapa masih di Google Play dan App Store (cth. Check Your Label SIRIM). Beliau membina aplikasi produksi Flutter pertama syarikatnya (Zon Bebas Senai Airport City) dan menghabiskan tahun 2023 pada platform Android keselamatan awam kritikal misi Motorola Solutions."
    },
    {
      keys: /\b(motorola|ncs|public safety|kotlin|mission)\b/,
      en: "In Feb–Aug 2023, via NCS Global Technology, Ameer worked as an Android/iOS developer on Motorola Solutions' mission-critical public-safety Android platform — Kotlin, Java and NDK under defense-in-depth security, high test coverage (JUnit4), and daily code review and incident-response discipline.",
      ms: "Pada Feb–Ogos 2023, menerusi NCS Global Technology, Ameer bertugas sebagai pembangun Android/iOS pada platform Android keselamatan awam kritikal misi Motorola Solutions — Kotlin, Java dan NDK di bawah keselamatan pertahanan berlapis, liputan ujian tinggi (JUnit4), serta disiplin semakan kod dan tindak balas insiden setiap hari."
    },
    {
      keys: /\b(education|study|degree|diploma|uitm|university|belajar|pendidikan|ijazah|universiti|spm|muet)\b/,
      en: "Diploma in Computer Science at UiTM Dungun (2010–2013, CGPA 3.03, FYP: a PHP Bus Ticketing System), then B.IT (Hons.) in Intelligent Systems Engineering at UiTM Shah Alam (2013–2016, FYP: a road-tax sticker recognizer using Tesseract OCR on Android). Also SPM 2009 with an A+ in Mathematics, and MUET Band 3. Certificates are viewable in the Education section.",
      ms: "Diploma Sains Komputer di UiTM Dungun (2010–2013, PNGK 3.03, PTA: Sistem Tiket Bas PHP), kemudian Sarjana Muda IT (Kepujian) Kejuruteraan Sistem Pintar di UiTM Shah Alam (2013–2016, PTA: pengecam pelekat cukai jalan menggunakan OCR Tesseract pada Android). Turut memperoleh SPM 2009 dengan A+ Matematik dan MUET Band 3. Sijil boleh dilihat dalam bahagian Pendidikan."
    },
    {
      keys: /\b(family|wife|married|marriage|children|kids|daughter|sons?|father|dad|born|birth(day)?|personal|hobby|isteri|berkahwin|anak|keluarga|lahir|dilahirkan|kelahiran|bapa|peribadi)\b/,
      en: "Ameer was born in 1992 and grew up entirely in Dungun, Terengganu — kindergarten through secondary school (SMK Balai Besar). Half a life in a small town never limited his dreams beyond being \"just a programmer\". Today he's a husband and father of three — a daughter and two sons — and credits that 24/7 juggle with sharpening his multitasking and his instinct for the most efficient solution. His real dream: seeing his family live a comfortably good life.",
      ms: "Ameer dilahirkan pada tahun 1992 dan dibesarkan sepenuhnya di Dungun, Terengganu — dari tadika hingga sekolah menengah (SMK Balai Besar). Separuh hayat di pekan kecil tidak pernah menghadkan impiannya daripada sekadar menjadi \"pengatur cara semata-mata\". Kini beliau seorang suami dan bapa kepada tiga cahaya mata — seorang puteri dan dua putera — dan tugas 24 jam itulah yang mengasah kebolehan berbilang tugas serta naluri mencari penyelesaian paling cekap. Impian sebenarnya: melihat keluarganya hidup selesa."
    },
    {
      keys: SALARY_KEYS,
      en: "Ameer prefers to discuss compensation directly — his expectations are negotiable and depend on the role. Email ameeradhwa92@gmail.com or use the WhatsApp button when it appears, and he'll be happy to talk numbers.",
      ms: "Ameer lebih gemar membincangkan pampasan secara terus — jangkaannya boleh dirunding dan bergantung pada peranan. E-mel ameeradhwa92@gmail.com atau gunakan butang WhatsApp apabila ia dipaparkan untuk berbincang lanjut."
    },
    {
      keys: /\b(contact|email|hire|reach|hubungi|menghubungi|e-?mel|telefon|phone|linkedin|github|resume|résumé)\b/,
      en: "Email ameeradhwa92@gmail.com (fastest), or find him at linkedin.com/in/ameeradhwa92 and github.com/ameeradhwa92, phone +60 13-961 0053. The résumé PDF is downloadable from the top navigation. He's open to hard problems in web, mobile and multi-tenant SaaS.",
      ms: "E-mel ameeradhwa92@gmail.com (paling pantas), atau hubungi beliau di linkedin.com/in/ameeradhwa92 dan github.com/ameeradhwa92, telefon +60 13-961 0053. Resume PDF boleh dimuat turun dari navigasi atas. Beliau terbuka kepada masalah sukar dalam web, mudah alih dan SaaS berbilang penyewa."
    },
    {
      keys: /\b(who|about|experience|years|siapa|pengalaman|tahun|background|latar)\b/,
      en: "Ameer Adhwa Bin Mohamad is a Full Stack Web Specialist from Shah Alam, Malaysia — 12+ years, 25+ production systems, from a diploma classroom in Dungun to government platforms and multi-tenant SaaS serving 20+ FMCG brands in four countries. Scroll the timeline for the whole journey, 2010 to today.",
      ms: "Ameer Adhwa Bin Mohamad ialah Pakar Web Tindanan Penuh dari Shah Alam, Malaysia — lebih 12 tahun pengalaman, lebih 25 sistem produksi, daripada bilik kuliah diploma di Dungun kepada platform kerajaan dan SaaS berbilang penyewa yang melayani lebih 20 jenama FMCG di empat buah negara. Susuri garis masa untuk perjalanan penuh, 2010 hingga kini."
    }
  ];

  function instantAnswer(text) {
    var q = " " + text.toLowerCase() + " ";
    var best = null, bestScore = 0;
    TOPICS.forEach(function (topic) {
      var m = q.match(new RegExp(topic.keys.source, "g"));
      var score = m ? m.length : 0;
      if (score > bestScore) { bestScore = score; best = topic; }
    });
    return { text: best ? best[lang()] : t("fallbackDefault"), matched: !!best };
  }

  /* did the AI reply amount to "I don't know"? */
  var DONT_KNOW =
    /(don'?t|do not) (have|know)|not (mentioned|available|in the facts)|no (such )?information|cannot (answer|say)|tiada maklumat|tidak (mempunyai|dinyatakan|pasti)/i;

  /* ---------------- dom ---------------- */
  var launcher = document.getElementById("chat-launcher");
  var panel = document.getElementById("chat-panel");
  if (!launcher || !panel) return;
  var log = document.getElementById("chat-log");
  var form = document.getElementById("chat-form");
  var input = document.getElementById("chat-input");
  var chips = document.getElementById("chat-chips");
  var status = document.getElementById("chat-status");
  var statusText = status.querySelector(".chat-status-text");
  var aiBox = document.getElementById("chat-ai");
  var aiPitch = aiBox.querySelector(".chat-ai-pitch");
  var aiEnable = document.getElementById("chat-ai-enable");
  var cancelBtn = document.getElementById("chat-ai-cancel");
  var progress = panel.querySelector(".chat-progress");
  var progressBar = panel.querySelector(".chat-progress-bar");
  var progressText = panel.querySelector(".chat-progress-text");
  var modelCloud = document.getElementById("chat-model-cloud");
  var modelLocal = document.getElementById("chat-model-local");
  var modelTooltip = document.getElementById("chat-model-tooltip");
  var jdToggle = document.getElementById("chat-jd-toggle");
  var jdPanel = document.getElementById("chat-jd-panel");
  var jdInput = document.getElementById("chat-jd-input");
  var jdFile = document.getElementById("chat-jd-file");
  var jdFileTrigger = document.getElementById("chat-jd-file-trigger");
  var jdFileName = document.getElementById("chat-jd-file-name");
  var jdAnalyze = document.getElementById("chat-jd-analyze");
  var jdClear = document.getElementById("chat-jd-clear");
  var jdDisclaimer = document.getElementById("chat-jd-disclaimer");
  var jdStatus = document.getElementById("chat-jd-status");
  var jdProgress = document.getElementById("chat-jd-progress");
  var jdResult = document.getElementById("chat-jd-result");
  var recruiterUI = !!(jdToggle && jdPanel && jdInput && jdFile && jdFileTrigger && jdFileName &&
    jdAnalyze && jdClear && jdDisclaimer && jdStatus && jdResult);

  var open = false, greeted = false, jdPromoAdded = false, busy = false;
  var jdPromoCopy = null, jdPromoAction = null;
  var engine = null, canceled = false, downloadGeneration = 0;
  var dlActive = false;      /* the on-device download is running */
  var fallbackTimer = null;  /* switches answers to cloud if the download is slow */
  var LOCAL_TIMEOUT = window.AIMEER_LOCAL_TIMEOUT || 20000; /* ms of downloading before cloud takes over answering */
  var route = "pending"; /* pending | local | cloud | none */
  var localOK = false;   /* device could run the on-device model (for manual retry) */
  try { localStorage.removeItem("aimeer-route"); } catch (e) { }
  var preferredMode = null; /* explicit cloud/local choice, independent of the live route */
  var announcedCloud = false;
  var aiState = "off"; /* off | loading | ready (local) | cloud | failed */
  var history = []; /* {role, content} — capped so prefill stays fast */
  var transcript = []; /* full visitor conversation, for the WhatsApp/email handoff */
  var lastUnanswered = ""; /* the question AIMeer couldn't answer */
  var jdState = {
    open: false,
    fileToken: 0,
    fileName: "",
    extractedText: "",
    extractedSource: "",
    deterministicResult: null,
    result: null,
    normalizedText: "",
    resultSource: "",
    scoringMode: "", /* "" | pending | ai | fallback — what produced jdState.result */
    reasoningMode: "unavailable", /* "cloud" | "unavailable" — never "", so renderJdReasoning never
      has to guess a mode from ambient chat-tier state (see FINAL WHOLE-BRANCH REVIEW, I3) */
    reasoningBusy: false,
    reasoningFallback: false,
    reasoningLanguage: "",
    reasoningRequestToken: 0,
    analysisRequestToken: 0,
    statusKind: "idle",
    statusLevel: "",
    statusSource: "",
    statusWarnings: [],
    errorKey: ""
  };

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "chat-msg chat-msg-" + role;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function addJdPromo() {
    if (!recruiterUI || jdPromoAdded) return;
    jdPromoAdded = true;
    var promo = document.createElement("div");
    promo.id = "chat-jd-promo";
    promo.className = "chat-msg chat-msg-bot chat-jd-promo";

    var copy = document.createElement("p");
    copy.className = "chat-jd-promo-copy";
    copy.setAttribute("data-i18n", "chat.jd.promo");
    copy.textContent = t("jdPromo");
    jdPromoCopy = copy;
    promo.appendChild(copy);

    var action = document.createElement("button");
    action.id = "chat-jd-promo-action";
    action.type = "button";
    action.className = "chat-jd-action chat-jd-promo-action";
    action.setAttribute("data-i18n", "chat.jd.promoAction");
    action.textContent = t("jdPromoAction");
    jdPromoAction = action;
    action.addEventListener("click", function () { setRecruiterOpen(true); });
    promo.appendChild(action);

    log.appendChild(promo);
    log.scrollTop = log.scrollHeight;
  }

  function formatScore(value) {
    var rounded = Math.round((Number(value) || 0) * 10) / 10;
    return String(rounded).replace(/\.0$/, "");
  }

  function sourceLabel(source) {
    return source === "pdf" ? t("jdSourcePdf")
      : source === "docx" ? t("jdSourceDocx")
        : t("jdSourcePaste");
  }

  function confidenceLabel(level) {
    return level === "high" ? t("jdResultConfidenceHigh")
      : level === "medium" ? t("jdResultConfidenceMedium")
        : t("jdResultConfidenceLow");
  }

  function localizeExtractorMessage(message) {
    var text = String(message || "");
    if (text.indexOf("larger than 10 MB") !== -1) return t("jdErrorFileSize");
    if (text.indexOf("Only PDF and DOCX files are supported") !== -1) return t("jdErrorFileType");
    if (text.indexOf("Could not read this PDF locally") !== -1) return t("jdErrorPdf");
    if (text.indexOf("No readable text was found in this PDF") !== -1) return t("jdWarnPdfNoText");
    if (text.indexOf("This DOCX file is unsupported, encrypted, or malformed") !== -1) return t("jdErrorDocx");
    if (text.indexOf("No readable text was found in this DOCX") !== -1) return t("jdWarnDocxNoText");
    if (text.indexOf("Only the first 60,000 characters were analyzed locally") !== -1) return t("jdWarnTrimmed");
    if (text.indexOf("No recognizable section headings were found") !== -1) return t("jdWarnGenericText");
    return text;
  }

  function extractorErrorKey(message) {
    var text = String(message || "");
    if (text.indexOf("larger than 10 MB") !== -1) return "jdErrorFileSize";
    if (text.indexOf("Only PDF and DOCX files are supported") !== -1) return "jdErrorFileType";
    if (text.indexOf("Could not read this PDF locally") !== -1) return "jdErrorPdf";
    if (text.indexOf("This DOCX file is unsupported, encrypted, or malformed") !== -1) return "jdErrorDocx";
    if (text.indexOf("No readable text was found in this PDF") !== -1) return "jdWarnPdfNoText";
    if (text.indexOf("No readable text was found in this DOCX") !== -1) return "jdWarnDocxNoText";
    return "jdErrorUnavailable";
  }

  function setJdFileName() {
    if (!recruiterUI) return;
    jdFileName.textContent = jdState.fileName || t("jdFileEmpty");
  }

  function clearJdResult(invalidateAnalysis) {
    if (invalidateAnalysis !== false) {
      jdState.analysisRequestToken = nextAnalysisToken(jdState.analysisRequestToken);
    }
    jdState.reasoningRequestToken = nextExplanationToken(jdState.reasoningRequestToken);
    jdState.deterministicResult = null;
    jdState.result = null;
    jdState.normalizedText = "";
    jdState.resultSource = "";
    jdState.scoringMode = "";
    jdState.reasoningMode = "unavailable";
    jdState.reasoningBusy = false;
    jdState.reasoningFallback = false;
    jdState.reasoningLanguage = "";
    if (recruiterUI) jdResult.innerHTML = "";
  }

  function reasoningLanguage() {
    return root.dataset.lang === "ms" ? "ms" : "en";
  }

  /* JD scoring is cloud-only (Task 3b): jdState.reasoningMode is only ever explicitly set
     to "cloud" or "unavailable" by the request flow below, never derived from the general
     chat tier's on-device/waiting state. There used to be a getJdReasoningMode() helper that
     fell back to computeJdReasoningMode(aiState, route, ...) whenever reasoningMode was falsy
     — that fallback could report "local" or "waiting" (borrowed from the general chat AI
     tier) even though recruiter reasoning itself never runs on-device, so the UI could claim
     "ran on this device" or "will stay on this device" for a request that in fact only ever
     goes to the cloud Worker or nowhere at all. Removed; see FINAL WHOLE-BRANCH REVIEW, I3. */
  function reasoningStatusKey(mode) {
    if (jdState.reasoningFallback) return "jdReasonStatusFallback";
    return mode === "cloud" ? "jdReasonStatusCloud" : "jdReasonStatusUnavailable";
  }

  function setJdStatus(kind, options) {
    jdState.statusKind = kind || "idle";
    jdState.statusLevel = options && options.level ? options.level : "";
    jdState.statusSource = options && options.source ? options.source : "";
    jdState.statusWarnings = options && options.warnings ? options.warnings.slice() : [];
    jdState.errorKey = options && options.errorKey ? options.errorKey : "";
    renderJdStatus();
  }

  function renderJdStatus() {
    if (!recruiterUI) return;
    var message = "";
    if (jdState.statusKind === "reading") message = t("jdStatusReading");
    else if (jdState.statusKind === "scoring") message = t("jdStatusScoring");
    else if (jdState.statusKind === "aiScoring") {
      message = t("jdAiStatusScoring");
      if (jdState.statusWarnings.length) message += " " + jdState.statusWarnings.join(" ");
    } else if (jdState.statusKind === "aiRetrying") {
      message = t("jdAiStatusRetrying");
      if (jdState.statusWarnings.length) message += " " + jdState.statusWarnings.join(" ");
    } else if (jdState.statusKind === "loaded") {
      message = formatT(
        jdState.statusWarnings.length ? "jdStatusLoadedWithWarnings" : "jdStatusLoaded",
        { source: sourceLabel(jdState.statusSource), warnings: jdState.statusWarnings.join(" ") }
      );
    } else if (jdState.statusKind === "pasted") {
      message = t("jdStatusPasted");
    } else if (jdState.statusKind === "scored") {
      message = formatT("jdStatusScored", { source: sourceLabel(jdState.statusSource) });
      if (jdState.statusWarnings.length) message += " " + jdState.statusWarnings.join(" ");
    } else if (jdState.statusKind === "error") {
      message = t(jdState.errorKey || "jdErrorUnavailable");
    } else {
      message = t("jdStatusIdle");
    }
    jdStatus.className = "chat-jd-status" +
      (jdState.statusLevel === "error" ? " is-error" : jdState.statusLevel === "success" ? " is-success" : "");
    jdStatus.textContent = message;
    renderJdProgress();
  }

  /* Driven from statusKind so the bar cannot disagree with the message above it. */
  function renderJdProgress() {
    if (!jdProgress) return;
    jdProgress.hidden = !isJdProgressVisible(jdState.statusKind);
  }

  /* The status line's source and extractor warnings belong to the deterministic pass;
     automatic AI scoring only swaps the headline while its request is in flight. */
  function markJdScoringInFlight() {
    setJdStatus("aiScoring", {
      source: jdState.statusSource,
      warnings: jdState.statusWarnings.slice()
    });
  }

  function markJdScoringRetrying() {
    setJdStatus("aiRetrying", {
      source: jdState.statusSource,
      warnings: jdState.statusWarnings.slice()
    });
  }

  function markJdScoringSettled() {
    setJdStatus("scored", {
      level: "success",
      source: jdState.statusSource,
      warnings: jdState.statusWarnings.slice()
    });
  }

  function createJdNode(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function createJdBadge(text, className) {
    return createJdNode("span", "chat-jd-badge " + className, text);
  }

  function matchLevelLabel(level) {
    return level === "direct-professional" ? t("jdReasonMatchDirectProfessional")
      : level === "adjacent-professional" ? t("jdReasonMatchAdjacentProfessional")
        : level === "transferable-professional" ? t("jdReasonMatchTransferableProfessional")
          : level === "academic-foundation" ? t("jdReasonMatchAcademicFoundation")
            : level === "learning-bridge" ? t("jdReasonMatchLearningBridge")
              : level === "explicit-gap" ? t("jdReasonMatchExplicitGap")
                : t("jdReasonMatchUnverified");
  }

  function appendEvidenceList(parent, evidence) {
    if (!evidence || !evidence.length) return;
    var list = createJdNode("ul", "chat-jd-evidence");
    evidence.forEach(function (entry) {
      list.appendChild(createJdNode("li", "", entry));
    });
    parent.appendChild(list);
  }

  function renderReasoningTextRow(parent, labelKey, text) {
    var value = String(text || "").replace(/\s+/g, " ").trim();
    if (!value) return;
    var row = createJdNode("p", "chat-jd-reason-row");
    row.appendChild(createJdNode("span", "chat-jd-reason-label", t(labelKey) + ": "));
    row.appendChild(createJdNode("span", "", value));
    parent.appendChild(row);
  }

  function renderRequirementReasoning(result) {
    var items = Array.isArray(result && result.requirementReasoning) ? result.requirementReasoning : [];
    var section = createJdNode("section", "chat-jd-section");
    section.appendChild(createJdNode("h6", "", t("jdReasonRequirements")));
    if (!items.length) {
      section.appendChild(createJdNode("p", "chat-jd-empty", t("jdReasonNoRequirementDetails")));
      return section;
    }
    var list = createJdNode("div", "chat-jd-requirement-list");
    items.forEach(function (item) {
      var card = document.createElement("details");
      card.className = "chat-jd-requirement-card";
      var summary = document.createElement("summary");
      summary.className = "chat-jd-requirement-summary";
      summary.appendChild(createJdNode("span", "chat-jd-term", item.term));
      summary.appendChild(createJdBadge(matchLevelLabel(item.matchLevel), item.verified ? "is-professional" : "is-user"));
      card.appendChild(summary);

      var body = createJdNode("div", "chat-jd-requirement-body");
      renderReasoningTextRow(body, "jdReasonIntentLabel", item.recruiterIntent);
      renderReasoningTextRow(body, "jdReasonOutcomeLabel", item.expectedOutcome);
      renderReasoningTextRow(body, "jdReasonBoundaryLabel", item.limitation);
      renderReasoningTextRow(body, "jdReasonFramingLabel", item.recruiterFraming);
      renderReasoningTextRow(body, "jdReasonVerificationLabel", item.verificationQuestion);
      if (Array.isArray(item.transferableCapabilities) && item.transferableCapabilities.length) {
        renderReasoningTextRow(body, "jdReasonCapabilitiesLabel", item.transferableCapabilities.join(", "));
      }
      if (Array.isArray(item.evidenceRecords) && item.evidenceRecords.length) {
        renderReasoningTextRow(body, "jdReasonEvidenceLabel", item.evidenceRecords.map(function (entry) {
          if (!entry) return "";
          return [entry.claim, entry.sourceLabel].filter(Boolean).join(" — ");
        }).filter(Boolean).join("; "));
      }
      card.appendChild(body);
      list.appendChild(card);
    });
    section.appendChild(list);
    return section;
  }

  /* Shallow-copies each item and tags it with a gapKind so the combined "Priority
     gaps" list (explicitGaps + unverifiedRequirements) can still show a recruiter
     which of the two materially different claims an item is — "no evidence he's
     done X" vs. "X wasn't verified in the published profile" — without mutating
     the original result.sections arrays. */
  function tagGapKind(items, gapKind) {
    return (items || []).map(function (item) {
      var copy = {};
      for (var key in item) {
        if (Object.prototype.hasOwnProperty.call(item, key)) copy[key] = item[key];
      }
      copy.gapKind = gapKind;
      return copy;
    });
  }

  /* Renders one recruiter-report list (Strong / Transferable / Gaps): each item
     shows its term (with a gap/unverified badge when the item carries a gapKind),
     the canonical evidence claim(s) resolved from evidenceRecords, and a one-line
     recruiter framing (or, for gaps, the limitation). All model-supplied text goes
     through createJdNode/appendEvidenceList, which only ever assign .textContent —
     never innerHTML. */
  function renderReasoningSection(titleKey, items, valueKey) {
    var section = createJdNode("section", "chat-jd-section");
    section.appendChild(createJdNode("h6", "", t(titleKey)));
    if (!items.length) {
      section.appendChild(createJdNode("p", "chat-jd-empty", t("jdNoMatches")));
      return section;
    }
    var list = createJdNode("ul", "chat-jd-match-list");
    items.forEach(function (item) {
      var li = createJdNode("li", "chat-jd-match-item");
      var head = createJdNode("div", "chat-jd-match-head");
      head.appendChild(createJdNode("div", "chat-jd-term", (item && item.term) || ""));
      if (item && item.gapKind === "gap") head.appendChild(createJdBadge(t("jdEvidenceGap"), "is-gap"));
      else if (item && item.gapKind === "unverified") head.appendChild(createJdBadge(t("jdEvidenceUnverified"), "is-unverified"));
      li.appendChild(head);
      var evidenceClaims = Array.isArray(item && item.evidenceRecords)
        ? item.evidenceRecords.map(function (entry) { return entry && entry.claim; }).filter(Boolean)
        : [];
      appendEvidenceList(li, evidenceClaims);
      var value = String((item && (item[valueKey] || item.note || item.limitation || item.question)) || "").trim();
      if (value) li.appendChild(createJdNode("p", "chat-jd-framing", value));
      list.appendChild(li);
    });
    section.appendChild(list);
    return section;
  }

  /* .jd-report-interview: the first 5 unique, non-empty verification questions
     drawn from result.sections.interviewQuestions (each item's `question` field). */
  function renderReportInterview(items) {
    var section = createJdNode("section", "chat-jd-section jd-report-interview");
    section.appendChild(createJdNode("h6", "", t("jdReasonInterviewQuestions")));
    var seen = {};
    var questions = [];
    (items || []).forEach(function (item) {
      var question = String((item && (item.question || item.verificationQuestion)) || "").trim();
      if (!question || seen[question]) return;
      seen[question] = true;
      questions.push(question);
    });
    questions = questions.slice(0, 5);
    if (!questions.length) {
      section.appendChild(createJdNode("p", "chat-jd-empty", t("jdNoMatches")));
      return section;
    }
    var list = createJdNode("ul", "chat-jd-topic-list");
    questions.forEach(function (question) {
      list.appendChild(createJdNode("li", "", question));
    });
    section.appendChild(list);
    return section;
  }

  function fitBandKey(band) {
    return band === "strong" ? "jdFitStrong"
      : band === "good" ? "jdFitGood"
        : band === "partial" ? "jdFitPartial"
          : "jdFitLimited";
  }

  /* Scoring is automatic (Task 3) and cloud-only (Task 3b) — there is no manual trigger
     and no on-device path, so this only ever renders "cloud" (a request was sent) or
     "unavailable" (nothing was sent), plus the fallback status when reasoning did not
     settle. jdState.reasoningMode is always one of those two explicit values (never ""),
     so this never has to guess a mode from ambient chat-tier state — see I3. */
  function renderJdReasoning(section) {
    var mode = jdState.reasoningMode || "unavailable";
    var reasonSection = createJdNode("section", "chat-jd-section chat-jd-reasoning");
    reasonSection.appendChild(createJdNode("h6", "", t("jdReasonTitle")));
    reasonSection.appendChild(createJdNode("p", "chat-jd-hint", t(reasoningStatusKey(mode))));
    reasonSection.appendChild(createJdNode("p", "chat-jd-meta", t(mode === "cloud" ? "jdReasonPrivacyCloud" : "jdReasonPrivacyUnavailable")));

    section.appendChild(reasonSection);
  }

  /* Recruiter match report. Leads with the qualitative verdict (fit band + narrative)
     and treats the percentage as supporting detail, not the headline — see
     docs/superpowers/specs/2026-07-30-recruiter-copilot-ai-scoring-design.md. Every
     field below can originate from the model, so every value is written via
     .textContent (through createJdNode/appendEvidenceList), never innerHTML. */
  function renderJdResult() {
    if (!recruiterUI) return;
    jdResult.innerHTML = "";
    if (!jdState.result) return;

    var result = jdState.result;
    var baseline = jdState.deterministicResult || result;
    var isFallback = jdState.scoringMode === "fallback";
    var report = createJdNode("section", "jd-report");

    /* 1. Fit band headline (or the keyword-estimate label when AI scoring never
       settled). Skip the headline entirely while scoring is still pending — there
       is no band to show yet, and the deterministic score alone would be misleading. */
    if (isFallback) {
      report.appendChild(createJdNode("h5", "jd-report-band", t("jdFallbackLabel")));
    } else if (result.fitBand) {
      report.appendChild(createJdNode("h5", "jd-report-band", t(fitBandKey(result.fitBand))));
    }

    /* 2. Recruiter narrative (model-authored, may be empty). */
    var narrativeText = String(result.reasoningNarrative || "").trim();
    if (narrativeText) {
      report.appendChild(createJdNode("p", "jd-report-narrative", narrativeText));
    }

    /* 3. Percentage + confidence, de-emphasized on purpose — supporting detail,
       not the headline. finalScore only exists once AI scoring has merged; before
       that (pending) or if it never did (fallback), fall back to the deterministic
       baseline score. */
    var scoreValue = typeof result.finalScore === "number" ? result.finalScore : baseline.score;
    report.appendChild(createJdNode("p", "jd-report-score",
      formatScore(scoreValue) + "% · " + t("jdResultConfidenceLabel") + ": " +
      confidenceLabel(resolveConfidenceLevel(jdState.scoringMode, result, baseline))));
    if (result.adjusted) {
      report.appendChild(createJdNode("p", "jd-report-calibrated", t("jdCalibratedNote")));
    }

    renderJdReasoning(report);

    /* 4 & 5. Strong / Transferable / Gaps and the interview questions only exist
       once AI reasoning has merged (result.sections); pending and fallback states
       have no sections to show. */
    if (result.sections && typeof result.sections === "object") {
      var verifiedStrengths = result.sections.verifiedStrengths || [];
      var transferableAdvantages = result.sections.transferableAdvantages || [];
      /* Merged into one list per the plan, but each item keeps a badge marking
         whether it's a confirmed gap or merely unverified — those are materially
         different claims to put in front of a recruiter. */
      var gaps = tagGapKind(result.sections.explicitGaps, "gap")
        .concat(tagGapKind(result.sections.unverifiedRequirements, "unverified"));
      report.appendChild(renderReasoningSection("jdReasonVerifiedStrengths", verifiedStrengths, "recruiterFraming"));
      report.appendChild(renderReasoningSection("jdReasonTransferableAdvantages", transferableAdvantages, "recruiterFraming"));
      report.appendChild(renderReasoningSection("jdReasonPriorityGaps", gaps, "limitation"));
      report.appendChild(renderReportInterview(result.sections.interviewQuestions || []));
    }

    if (Array.isArray(result.requirementReasoning) && result.requirementReasoning.length) {
      report.appendChild(renderRequirementReasoning(result));
    }

    jdResult.appendChild(report);

    /* 6. Disclaimer, unchanged, then the WhatsApp/mailto handoff whenever scoring has
       settled (ai or fallback), never mid-flight. This renders INSIDE the JD result panel
       (jdResult), not into the chat log: .chat-panel--jd-open .chat-log is display:none
       while the JD panel is open, and scoring always settles while it is open, so a
       chat-log card was being offered into a container the recruiter could not see (and
       likely never would, since closing the panel to look for it is not an obvious move).
       jdResult.innerHTML is rebuilt from scratch at the top of this function on every
       call, so simply re-appending here on every settled render cannot duplicate or
       re-scroll anything the way appending to the persistent chat log could — see I2. */
    jdResult.appendChild(createJdNode("p", "chat-jd-result-disclaimer", t("jdDisclaimer")));
    if (jdState.scoringMode === "ai" || isFallback) {
      jdResult.appendChild(buildHandoffCard("chat-jd-section chat-jd-handoff"));
    }
  }

  function resetRecruiterState() {
    if (!recruiterUI) return;
    jdState.fileToken += 1;
    jdState.fileName = "";
    jdState.extractedText = "";
    jdState.extractedSource = "";
    if (jdInput) jdInput.value = "";
    if (jdFile) jdFile.value = "";
    setJdFileName();
    clearJdResult();
    setJdStatus("idle");
  }

  function setRecruiterOpen(nextOpen) {
    if (!recruiterUI) return;
    jdState.open = !!nextOpen;
    panel.classList.toggle("chat-panel--jd-open", jdState.open);
    jdPanel.hidden = !jdState.open;
    jdToggle.setAttribute("aria-expanded", jdState.open ? "true" : "false");
    jdToggle.classList.toggle("is-active", jdState.open);
    if (jdState.open) {
      jdInput.focus();
      renderJdStatus();
      renderJdResult();
    }
  }

  function setStatus(mode, extra) {
    status.className = "chat-status chat-status-" + mode;
    statusText.textContent =
      mode === "ai" ? t("statusAI") :
        mode === "cloud" ? t("statusCloud") :
          mode === "loading" ? (extra || t("statusLoading")) :
            t("statusInstant");
  }

  function refreshStatus() {
    if (aiState === "ready") setStatus("ai");
    else if (aiState === "cloud") setStatus("cloud");
    else if (aiState !== "loading") setStatus("instant");
    syncModelSwitch();
  }

  function showLocalCompatibilityHint() {
    if (!modelTooltip || localOK) return;
    modelTooltip.hidden = false;
  }

  function persistPreferredRoute(mode) {
    preferredMode = mode;
  }

  function clearPreferredRoute() {
    preferredMode = null;
    try { localStorage.removeItem("aimeer-route"); } catch (e) { }
  }

  function cancelLocalDownload() {
    if (!dlActive) return false;
    downloadGeneration += 1;
    canceled = true;
    dlActive = false;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    progressBar.style.width = "0";
    progress.hidden = true;
    ringReady();
    syncModelSwitch();
    return true;
  }

  function setPreferredRoute(mode) {
    if (mode !== "cloud" && mode !== "local") return;
    if (mode === "cloud") {
      var canceledDownload = cancelLocalDownload();
      persistPreferredRoute("cloud");
      switchToCloud(canceledDownload ? "canceledCloud" : null);
      return;
    }
    if (!localOK) {
      if (preferredMode === "local") clearPreferredRoute();
      showLocalCompatibilityHint();
      if (cloudOk && aiState !== "cloud") switchToCloud();
      else syncModelSwitch();
      return;
    }
    persistPreferredRoute("local");
    hideLocalCompatibilityHint();
    if (!dlActive && aiState !== "ready") startLocalAI();
    else syncModelSwitch();
  }

  function hideLocalCompatibilityHint() {
    if (modelTooltip) modelTooltip.hidden = true;
  }

  function syncModelSwitch() {
    if (!modelCloud || !modelLocal) return;
    var activeMode = route === "local" || aiState === "ready"
      ? "local"
      : (route === "cloud" || aiState === "cloud" || cloudOk ? "cloud" : null);
    var selectedMode = preferredMode === "local" && !localOK ? activeMode : (preferredMode || activeMode);
    var localSelected = selectedMode === "local";
    var cloudSelected = selectedMode === "cloud";
    modelCloud.classList.toggle("is-selected", cloudSelected);
    modelLocal.classList.toggle("is-selected", localSelected);
    modelLocal.classList.toggle("is-unavailable", !localOK);
    modelCloud.setAttribute("aria-pressed", cloudSelected ? "true" : "false");
    modelLocal.setAttribute("aria-pressed", localSelected ? "true" : "false");
    if (localOK) hideLocalCompatibilityHint();
  }

  if (modelCloud && modelLocal) {
    modelCloud.addEventListener("click", function () { setPreferredRoute("cloud"); });
    modelLocal.addEventListener("click", function () {
      setPreferredRoute("local");
    });
    modelLocal.addEventListener("focus", showLocalCompatibilityHint);
    modelLocal.addEventListener("blur", hideLocalCompatibilityHint);
  }

  /* ---------------- launcher ring: grey → progress fill → teal glow ---------------- */
  function ringPending() { launcher.classList.add("ai-pending"); }
  function ringProgress(pct) {
    launcher.classList.add("ai-downloading");
    launcher.style.setProperty("--dl", pct);
  }
  function ringReady() {
    launcher.classList.remove("ai-pending", "ai-downloading");
    launcher.style.removeProperty("--dl");
  }

  /* ---------------- the AI box under the header ---------------- */
  function applyAiBox() {
    aiBox.classList.remove("unsupported");
    if (aiState === "cloud" && dlActive) {
      /* interim: cloud answers while the on-device download keeps going */
      aiBox.hidden = false;
      aiPitch.textContent = t("aiInterim");
      aiEnable.hidden = true;
      progress.hidden = false;
      cancelBtn.hidden = false;
      cancelBtn.textContent = t("cancelPlain");
      syncModelSwitch();
      return;
    }
    if (aiState === "ready" || aiState === "cloud") {
      aiBox.hidden = true;
      syncModelSwitch();
      return;
    }
    aiBox.hidden = false;
    if (aiState === "loading") {
      aiPitch.textContent = t("aiDownloading");
      aiEnable.hidden = true;
      progress.hidden = false;
      cancelBtn.hidden = false;
      cancelBtn.textContent = cloudOk ? t("cancelCloud") : t("cancelPlain");
    } else if (aiState === "failed" || (route === "none" && localOK)) {
      aiPitch.textContent = aiState === "failed" ? t("aiError") : t("aiPitchManual");
      aiEnable.hidden = false;
      aiEnable.textContent = t("enableBtn");
      progress.hidden = true;
    } else if (route === "none") {
      aiBox.classList.add("unsupported");
      aiPitch.textContent = t("unsupported");
      aiEnable.hidden = true;
      progress.hidden = true;
    } else {
      /* route pending, or local download not started yet */
      aiPitch.textContent = t("aiDownloading");
      aiEnable.hidden = true;
      progress.hidden = true;
    }
    syncModelSwitch();
  }

  function refreshLangBits() {
    var activeLanguage = reasoningLanguage();
    if (jdState.reasoningBusy && jdState.reasoningLanguage && jdState.reasoningLanguage !== activeLanguage) {
      /* A structured response is language-specific.  Leave the deterministic
         baseline visible and invalidate the in-flight response. */
      jdState.reasoningRequestToken = nextExplanationToken(jdState.reasoningRequestToken);
      jdState.reasoningBusy = false;
      jdState.reasoningMode = "unavailable";
      jdState.reasoningFallback = false;
      jdState.reasoningLanguage = "";
      jdState.result = jdState.deterministicResult;
      /* no AI score applies to the new language, so the report is the keyword estimate */
      jdState.scoringMode = "fallback";
      markJdScoringSettled();
    }
    input.placeholder = t("placeholder");
    refreshStatus();
    applyAiBox();
    if (jdPromoCopy) jdPromoCopy.textContent = t("jdPromo");
    if (jdPromoAction) jdPromoAction.textContent = t("jdPromoAction");
    if (recruiterUI) {
      jdInput.placeholder = t("jdInputPlaceholder");
      jdDisclaimer.textContent = t("jdDisclaimer");
      setJdFileName();
      renderJdStatus();
      renderJdResult();
    }
  }

  /* keep dynamic strings in step with the EN/BM toggle */
  new MutationObserver(refreshLangBits)
    .observe(root, { attributes: true, attributeFilter: ["data-lang"] });

  if (recruiterUI) {
    setRecruiterOpen(false);
    refreshLangBits();
  }

  /* ---------------- attention callout (marketing nudge, shows on each load) ---------------- */
  var callout = document.getElementById("chat-callout");

  function hideCallout(persist) {
    if (!callout || callout.hidden) return;
    callout.classList.remove("show");
    setTimeout(function () { callout.hidden = true; }, 400);
    if (persist) { try { localStorage.setItem("aimeer-callout", "1"); } catch (e) { } }
  }

  if (callout) {
    setTimeout(function () {
      if (open) return;
      callout.hidden = false;
      void callout.offsetWidth;
      callout.classList.add("show");
    }, 1800);
    callout.addEventListener("click", function (e) {
      hideCallout(true);
      if (!e.target.closest(".chat-callout-close")) openPanel();
    });
  }

  /* ---------------- open / close ---------------- */
  function openPanel() {
    hideCallout(true);
    panel.hidden = false;
    void panel.offsetWidth;
    panel.classList.add("open");
    launcher.classList.add("hidden");
    launcher.setAttribute("aria-expanded", "true");
    open = true;
    if (!greeted) {
      greeted = true;
      addMsg("bot", t("greeting"));
      if (aiState === "cloud" && !announcedCloud) {
        announcedCloud = true;
        addMsg("bot", t("aiReadyCloud"));
      }
    }
    addJdPromo();
    /* opening the chat is intent — start the local download right away */
    if (route === "local" && aiState === "off") {
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
      startLocalAI();
    }
    refreshLangBits();
    input.focus();
  }

  function closePanel() {
    panel.classList.remove("open");
    launcher.classList.remove("hidden");
    launcher.setAttribute("aria-expanded", "false");
    open = false;
    setTimeout(function () { if (!open) panel.hidden = true; }, 340);
    launcher.focus();
  }

  launcher.addEventListener("click", openPanel);
  panel.querySelector(".chat-close").addEventListener("click", closePanel);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && open) closePanel();
  });

  /* ---------------- route decision: local model, cloud relay, or neither ---------------- */
  function decideRoute() {
    var pref = preferredMode;
    var requestAdapter = navigator.gpu && navigator.gpu.requestAdapter
      ? navigator.gpu.requestAdapter()
      : Promise.resolve(null);
    return requestAdapter.then(function (adapter) {
      var policy = window.AIMEER_DEVICE.evaluate({
        userAgent: navigator.userAgent || "",
        platform: navigator.platform || "",
        maxTouchPoints: navigator.maxTouchPoints || 0,
        hasWebGPU: !!adapter,
        maxBufferSize: adapter && adapter.limits ? (adapter.limits.maxBufferSize || 0) : 0,
        saveData: !!(navigator.connection && navigator.connection.saveData)
      });
      localOK = policy.localEligible;
      if (pref === "local" && !localOK) {
        clearPreferredRoute();
        pref = null;
      }
      syncModelSwitch();
      if (pref === "cloud" && cloudOk) return "cloud";
      if (pref === "local" && localOK) return "local";
      if (pref === "off") return "none"; /* visitor canceled before; manual enable still offered */
      if (policy.cloudPreferred) {
        return cloudOk ? "cloud" : "none";
      }
      return localOK ? "local" : (cloudOk ? "cloud" : "none");
    }).catch(function () {
      localOK = false;
      if (pref === "local") clearPreferredRoute();
      syncModelSwitch();
      return Promise.resolve(cloudOk ? "cloud" : "none");
    });
  }

  function switchToCloud(msgKey) {
    route = "cloud";
    aiState = "cloud";
    ringReady();
    refreshStatus();
    applyAiBox();
    if (recruiterUI && jdState.result) renderJdResult();
    syncModelSwitch();
    if (greeted && msgKey) {
      announcedCloud = true;
      addMsg("bot", t(msgKey));
    }
  }

  /* ---------------- tier 2: on-device webllm, auto-started ---------------- */
  function startLocalAI() {
    if (dlActive || aiState === "ready") return;
    var generation = ++downloadGeneration;
    aiState = "loading";
    route = "local";
    canceled = false;
    dlActive = true;
    ringProgress(0);
    setStatus("loading");
    applyAiBox();

    /* if the download takes longer than ~20s, cloud takes over answering while
       the download keeps going in the background — local swaps back in when done */
    if (cloudOk) {
      fallbackTimer = setTimeout(function () {
        fallbackTimer = null;
        if (generation !== downloadGeneration || aiState !== "loading" || canceled) return;
        aiState = "cloud";
        refreshStatus();
        applyAiBox();
        if (greeted) {
          announcedCloud = true;
          addMsg("bot", t("cloudInterim"));
        }
      }, LOCAL_TIMEOUT);
    }

    Promise.all([ensureKB(), navigator.gpu.requestAdapter()]).then(function (r) {
      if (generation !== downloadGeneration || canceled) return null;
      var adapter = r[1];
      if (!adapter) throw new Error("no-webgpu-adapter");
      /* f16 shaders halve memory; fall back to f32 weights where unsupported */
      var model = adapter.features.has("shader-f16")
        ? "Llama-3.2-1B-Instruct-q4f16_1-MLC"
        : "Llama-3.2-1B-Instruct-q4f32_1-MLC";
      return import(WEBLLM_CDN).then(function (webllm) {
        if (generation !== downloadGeneration || canceled) return null;
        return webllm.CreateMLCEngine(model, {
          initProgressCallback: function (p) {
            if (generation !== downloadGeneration || canceled) return;
            var pct = Math.round((p.progress || 0) * 100);
            ringProgress(pct);
            progressBar.style.width = pct + "%";
            progressText.textContent = pct >= 100 ? t("statusPreparing") : pct + "%";
            /* don't clobber the status line once cloud has taken over answering */
            if (aiState === "loading") {
              setStatus("loading", pct >= 100 ? t("statusPreparing") : t("statusLoading") + pct + "%");
            }
          }
        });
      });
    }).then(function (e) {
      if (generation !== downloadGeneration || canceled) {
        /* visitor bailed while this resolved — drop the engine again */
        try { if (e && e.unload) e.unload(); } catch (err) { }
        return;
      }
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
      var wasInterim = aiState === "cloud";
      engine = e;
      aiState = "ready";
      dlActive = false;
      ringReady();
      setStatus("ai");
      applyAiBox();
      if (greeted) addMsg("bot", t(wasInterim ? "aiUpgraded" : "aiReady"));
    }).catch(function (err) {
      if (generation !== downloadGeneration) return;
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
      dlActive = false;
      if (canceled) return;
      if (window.console && console.warn) console.warn("WebLLM init failed:", err);
      if (aiState === "cloud") {
        /* cloud already answering — just stop showing the download UI */
        route = "cloud";
        ringReady();
        applyAiBox();
      } else if (cloudOk) {
        switchToCloud("aiErrorCloud");
      } else {
        aiState = "failed";
        route = "none";
        ringReady();
        setStatus("instant");
        applyAiBox();
        if (greeted) addMsg("bot", t("aiError"));
      }
    });
  }
  aiEnable.addEventListener("click", startLocalAI);

  cancelBtn.addEventListener("click", function () {
    if (!dlActive) return;
    cancelLocalDownload();
    preferredMode = cloudOk ? "cloud" : null;
    if (cloudOk) {
      switchToCloud("canceledCloud");
    } else {
      aiState = "off";
      route = "none";
      ringReady();
      setStatus("instant");
      applyAiBox();
      if (greeted) addMsg("bot", t("canceledPlain"));
    }
  });

  var autoTimer = null;
  function scheduleAutoStart() {
    var kick = function () {
      autoTimer = setTimeout(function () { startLocalAI(); }, 2200);
    };
    if (document.readyState === "complete") kick();
    else window.addEventListener("load", kick);
  }

  ringPending();
  decideRoute().then(function (r) {
    if (aiState !== "off") return; /* a manual/auto start already won the race */
    route = r;
    if (r === "local") {
      if (open) startLocalAI();
      else scheduleAutoStart();
    } else {
      if (r === "cloud") {
        aiState = "cloud";
        if (greeted && !announcedCloud) {
          announcedCloud = true;
          addMsg("bot", t("aiReadyCloud"));
        }
      }
      ringReady();
    }
    syncModelSwitch();
    if (open) { refreshStatus(); applyAiBox(); }
  });

  async function askLLM(text, bubble) {
    if (!KB) await ensureKB();
    history.push({ role: "user", content: text });
    if (history.length > 8) history = history.slice(-8);
    var messages = [{ role: "system", content: PROMPT_HEAD + KB }].concat(history);
    var reply = "";
    var stream = await engine.chat.completions.create({
      messages: messages,
      stream: true,
      temperature: 0.2,
      max_tokens: 300
    });
    for await (var chunk of stream) {
      var delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (delta && delta.content) {
        reply += delta.content;
        bubble.textContent = reply;
        bubble.classList.remove("thinking");
        log.scrollTop = log.scrollHeight;
      }
    }
    history.push({ role: "assistant", content: reply });
    return reply;
  }

  /* ---------------- tier 3: cloud relay ---------------- */
  function askCloud(text) {
    history.push({ role: "user", content: text });
    if (history.length > 8) history = history.slice(-8);
    return fetch(CLOUD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "chat", messages: history })
    }).then(function (r) {
      if (!r.ok) throw new Error("cloud-" + r.status);
      return r.json();
    }).then(function (d) {
      var reply = (d.reply || "").trim();
      if (!reply) throw new Error("cloud-empty");
      history.push({ role: "assistant", content: reply });
      return reply;
    });
  }

  /* The Worker's jd-scoring mode accepts exactly these keys and rejects any body that
     carries messages or system — the system prompt is assembled server-side on purpose.
     jdText is whatever JDReasoning.buildInput's screen already approved (the JD's own
     prose, or a withheld-notice when it carried personal identifiers); nothing here
     re-derives or re-screens it, and 12000 mirrors the Worker's own clip so an oversize
     payload never round-trips. */
  function buildJdScoringCloudPayload(input) {
    var safeInput = input || {};
    var evidenceIds = (Array.isArray(safeInput.evidenceRegistry) ? safeInput.evidenceRegistry : [])
      .map(function (record) { return record && typeof record.id === "string" ? record.id : ""; })
      .filter(Boolean);
    return {
      mode: "jd-scoring",
      language: safeInput.language === "ms" ? "ms" : "en",
      jdText: String(safeInput.jdText || "").slice(0, 12000),
      deterministicInput: {
        requirements: Array.isArray(safeInput.requirements) ? safeInput.requirements : [],
        deterministicResult: safeInput.deterministicResult && typeof safeInput.deterministicResult === "object"
          ? safeInput.deterministicResult
          : {}
      },
      evidenceIds: evidenceIds
    };
  }

  function requestJdScoringViaCloud(input) {
    return fetch(CLOUD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildJdScoringCloudPayload(input))
    }).then(function (r) {
      /* A failed response body carries `error` and, for a 502 reasoning-invalid, `reason` —
         the specific output-validation rule the model broke. Fold it into the thrown message
         so the console.warn in applyScoringFallback names the actual cause instead of a bare
         status code; without it a live scoring failure is indistinguishable from any other.
         Diagnostic only — this string reaches console.warn, never the DOM. Keep the
         "cloud-<status>" prefix intact: the retry policy below matches on it. */
      if (!r.ok) {
        return r.json().catch(function () { return null; }).then(function (d) {
          var reason = d && typeof d.reason === "string" && d.reason ? d.reason
            : (d && typeof d.error === "string" ? d.error : "");
          throw new Error("cloud-" + r.status + (reason ? ":" + reason : ""));
        });
      }
      return r.json();
    }).then(function (d) {
      var reply = String((d && (d.reasoning || d.reply)) || "").trim();
      if (!reply) throw new Error("cloud-empty");
      return reply;
    });
  }

  /* AI scoring is cloud-only: the on-device 1B model cannot produce the structured
     score this contract needs, so a pending local download never gates or delays it.
     One silent retry, then the deterministic pass stands on its own as a labeled
     keyword estimate. */
  function requestJdReasoning() {
    if (!jdState.deterministicResult || !jdState.normalizedText || jdState.reasoningBusy) return;
    var deterministicResult = jdState.deterministicResult;
    var analysisToken = jdState.analysisRequestToken;
    var requestToken = nextExplanationToken(jdState.reasoningRequestToken);
    var currentLanguage = reasoningLanguage();
    var reasoningInput = null;
    jdState.reasoningRequestToken = requestToken;
    jdState.reasoningLanguage = currentLanguage;

    function canApplyReasoning() {
      return canApplyExplanationToken(requestToken, jdState.reasoningRequestToken) &&
        analysisToken === jdState.analysisRequestToken &&
        deterministicResult === jdState.deterministicResult &&
        currentLanguage === reasoningLanguage() &&
        currentLanguage === jdState.reasoningLanguage;
    }

    function applyScoringFallback(reason) {
      if (!canApplyReasoning()) return;
      if (window.console && console.warn && reason) console.warn("JD scoring fallback:", reason);
      jdState.reasoningBusy = false;
      jdState.reasoningFallback = true;
      jdState.scoringMode = "fallback";
      jdState.result = deterministicResult;
      renderJdResult();
      markJdScoringSettled();
    }

    function requestScoringAttempt() {
      return requestJdScoringViaCloud(reasoningInput).then(function (rawOutput) {
        var validation = window.JDReasoning.validateModelOutput(rawOutput, reasoningInput);
        if (!validation || !validation.ok) {
          throw new Error(validation && validation.error ? validation.error : "reasoning-invalid");
        }
        return validation.reasoning;
      });
    }

    if (!window.JDReasoning ||
      typeof window.JDReasoning.buildInput !== "function" ||
      typeof window.JDReasoning.validateModelOutput !== "function" ||
      typeof window.JDReasoning.mergeResult !== "function") {
      jdState.reasoningMode = "unavailable";
      applyScoringFallback("reasoning-unavailable");
      return;
    }
    if (!cloudOk) {
      jdState.reasoningMode = "unavailable";
      applyScoringFallback("cloud-unavailable");
      return;
    }

    jdState.reasoningBusy = true;
    jdState.reasoningMode = "cloud";
    jdState.reasoningFallback = false;
    jdState.scoringMode = "pending";
    renderJdResult();
    markJdScoringInFlight();

    ensureProfile().then(function (profile) {
      if (!canApplyReasoning()) return null;
      reasoningInput = window.JDReasoning.buildInput(
        { normalizedText: jdState.normalizedText, rawText: jdState.normalizedText },
        deterministicResult,
        profile,
        currentLanguage
      );
      return requestScoringAttempt().catch(function (firstError) {
        if (!canApplyReasoning()) return null;
        /* A 4xx is the Worker refusing this exact payload — a privacy or shape violation.
           Sending it again would fail identically, so retry only transport failures,
           unparseable responses and invalid model output.
           The (?::|$) is load-bearing: requestJdScoringViaCloud appends ":<reason>" to the
           message when the Worker names a failure reason, and an anchored /^cloud-4\d\d$/
           would stop matching — silently re-transmitting a payload the Worker already
           refused, including one it refused on privacy grounds. */
        if (/^cloud-4\d\d(?::|$)/.test(String(firstError && firstError.message))) throw firstError;
        if (window.console && console.warn) console.warn("JD scoring retry after:", firstError);
        markJdScoringRetrying();
        return requestScoringAttempt();
      });
    }).then(function (reasoning) {
      /* Staleness returns silently — a newer analysis already owns jdState and the status
         line.  Anything else must settle, or the status line stays on "analyzing" forever. */
      if (!canApplyReasoning()) return;
      if (!reasoning) {
        applyScoringFallback("reasoning-empty");
        return;
      }
      jdState.reasoningBusy = false;
      jdState.reasoningFallback = false;
      jdState.scoringMode = "ai";
      jdState.result = window.JDReasoning.mergeResult(deterministicResult, reasoning, reasoningInput);
      renderJdResult();
      markJdScoringSettled();
    }).catch(function (err) {
      applyScoringFallback(err);
    });
  }

  /* ---------------- whatsapp / email handoff ---------------- */
  /* When a JD match report has settled (ai or fallback), lead the handoff summary
     with the fit band, score, and up to three verified strengths — so a recruiter
     forwarding the chat gets the report headline, not just a raw transcript. */
  function jdHandoffPrefixText() {
    if (!jdState.result || (jdState.scoringMode !== "ai" && jdState.scoringMode !== "fallback")) return "";
    var result = jdState.result;
    var baseline = jdState.deterministicResult || result;
    var scoreValue = typeof result.finalScore === "number" ? result.finalScore : baseline.score;
    /* jdFallbackLabel is a full sentence made for the report headline; the handoff
       line needs a short label so it doesn't run two sentences together. */
    var bandLabel = jdState.scoringMode === "fallback" ? t("jdHandoffFallbackLabel") : t(fitBandKey(result.fitBand));
    var strengths = (result.sections && Array.isArray(result.sections.verifiedStrengths))
      ? result.sections.verifiedStrengths
      : [];
    var terms = [];
    strengths.forEach(function (item) {
      var term = item && String(item.term || "").trim();
      if (term && terms.indexOf(term) === -1) terms.push(term);
    });
    terms = terms.slice(0, 3);
    var line = formatT("jdHandoffSummary", { band: bandLabel, score: formatScore(scoreValue) });
    if (terms.length) line += " " + formatT("jdHandoffStrengths", { terms: terms.join(", ") });
    return line;
  }

  function mechanicalSummary() {
    var qs = [];
    transcript.forEach(function (m) {
      if (m.role === "user") qs.push(m.content.slice(0, 120));
    });
    qs = qs.slice(-6);
    var jdLine = jdHandoffPrefixText();
    var s = t("sumIntro") + "\n\n" + (jdLine ? jdLine + "\n\n" : "") + t("sumAsked") + "\n" +
      qs.map(function (q) { return "• " + q; }).join("\n");
    if (lastUnanswered) s += "\n\n" + t("sumOpen") + ' "' + lastUnanswered.slice(0, 200) + '"';
    return s + "\n\n— " + t("sumVia");
  }

  function decorateSummary(body) {
    var jdLine = jdHandoffPrefixText();
    var s = t("sumIntro") + "\n\n" + (jdLine ? jdLine + "\n\n" : "") + body.trim();
    if (lastUnanswered) s += "\n\n" + t("sumOpen") + ' "' + lastUnanswered.slice(0, 200) + '"';
    return s + "\n\n— " + t("sumVia");
  }

  function getSummary() {
    var convo = transcript.slice(-12).map(function (m) {
      return (m.role === "user" ? "Visitor: " : "AIMeer: ") + m.content;
    }).join("\n");
    if (aiState === "ready" && engine) {
      return engine.chat.completions.create({
        messages: [
          {
            role: "system", content:
              "Summarize this chat between a website visitor and AIMeer (Ameer's portfolio assistant) " +
              "in at most 3 short sentences addressed to Ameer, in the visitor's language " +
              "(English or Bahasa Malaysia). Plain text only, no preamble."
          },
          { role: "user", content: convo }
        ],
        stream: false,
        temperature: 0.2,
        max_tokens: 160
      }).then(function (res) {
        return decorateSummary(res.choices[0].message.content);
      }).catch(function () { return mechanicalSummary(); });
    }
    if (aiState === "cloud") {
      return fetch(CLOUD_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "summary", messages: [{ role: "user", content: convo }] })
      }).then(function (r) {
        if (!r.ok) throw new Error("cloud-" + r.status);
        return r.json();
      }).then(function (d) {
        if (!d.reply) throw new Error("cloud-empty");
        return decorateSummary(d.reply);
      }).catch(function () { return mechanicalSummary(); });
    }
    return Promise.resolve(mechanicalSummary());
  }

  function sendToAmeer(channel, btn) {
    var label = btn.textContent;
    btn.disabled = true;
    btn.textContent = t("summarizing");
    getSummary().then(function (summary) {
      btn.disabled = false;
      btn.textContent = label;
      if (channel === "wa") {
        window.open("https://wa.me/" + WA_NUMBER + "?text=" + encodeURIComponent(summary),
          "_blank", "noopener");
      } else {
        window.location.href = "mailto:" + EMAIL +
          "?subject=" + encodeURIComponent(t("mailSubject")) +
          "&body=" + encodeURIComponent(summary);
      }
    });
  }

  /* Shared by offerHandoff() (general chat, appended into the persistent chat log) and
     renderJdResult() (JD match report, appended into the JD result panel — see I2). Takes
     the container class name so each caller gets its own visual treatment. */
  function buildHandoffCard(className) {
    var card = document.createElement("div");
    card.className = className;
    var p = document.createElement("p");
    p.textContent = t("handoffPrompt");
    var row = document.createElement("div");
    row.className = "chat-handoff-btns";
    var wa = document.createElement("button");
    wa.type = "button";
    wa.className = "chat-handoff-wa";
    wa.textContent = t("handoffWa");
    wa.addEventListener("click", function () { sendToAmeer("wa", wa); });
    var mail = document.createElement("button");
    mail.type = "button";
    mail.className = "chat-handoff-mail";
    mail.textContent = t("handoffMail");
    mail.addEventListener("click", function () { sendToAmeer("mail", mail); });
    row.appendChild(wa);
    row.appendChild(mail);
    card.appendChild(p);
    card.appendChild(row);
    return card;
  }

  function offerHandoff() {
    var old = log.querySelector(".chat-handoff");
    if (old) old.remove();
    var card = buildHandoffCard("chat-msg chat-msg-bot chat-handoff");
    log.appendChild(card);
    log.scrollTop = log.scrollHeight;
  }

  /* ---------------- send ---------------- */
  function finishReply(bubble, reply, unanswered, question) {
    bubble.classList.remove("thinking");
    bubble.textContent = reply;
    transcript.push({ role: "assistant", content: reply });
    if (transcript.length > 24) transcript = transcript.slice(-24);
    if (unanswered) {
      lastUnanswered = question;
      offerHandoff();
    } else if (SALARY_KEYS.test(question.toLowerCase())) {
      offerHandoff();
    }
    busy = false;
  }

  function send(text) {
    text = text.trim();
    if (!text || busy) return;
    addMsg("user", text);
    transcript.push({ role: "user", content: text });
    input.value = "";
    busy = true;
    var bubble = addMsg("bot", t("thinking"));
    bubble.classList.add("thinking");

    if (aiState === "ready" && engine) {
      askLLM(text, bubble).then(function (reply) {
        finishReply(bubble, reply, DONT_KNOW.test(reply), text);
      }).catch(function (err) {
        if (window.console && console.warn) console.warn("WebLLM chat failed:", err);
        var a = instantAnswer(text);
        finishReply(bubble, a.text, !a.matched, text);
      });
    } else if (aiState === "cloud") {
      askCloud(text).then(function (reply) {
        finishReply(bubble, reply, DONT_KNOW.test(reply), text);
      }).catch(function (err) {
        if (window.console && console.warn) console.warn("Cloud AI failed:", err);
        var a = instantAnswer(text);
        finishReply(bubble, a.text, !a.matched, text);
      });
    } else {
      /* a small beat so the instant answer still reads as a reply */
      setTimeout(function () {
        var a = instantAnswer(text);
        finishReply(bubble, a.text, !a.matched, text);
      }, 350);
    }
  }

  function analyzeRecruiterMatch() {
    if (!recruiterUI) return;
    if (!window.JDExtractor || !window.JDMatcher ||
      typeof window.JDExtractor.extract !== "function" ||
      typeof window.JDExtractor.normalize !== "function" ||
      typeof window.JDMatcher.scoreJobDescription !== "function") {
      setJdStatus("error", { level: "error", errorKey: "jdErrorUnavailable" });
      return;
    }

    var pasted = jdInput.value.replace(/\s+/g, " ").trim();
    var source = pasted ? "paste" : jdState.extractedSource;
    var text = pasted ? jdInput.value.trim() : jdState.extractedText;
    if (!text) {
      setJdStatus("error", { level: "error", errorKey: "jdErrorMissingText" });
      clearJdResult();
      return;
    }

    var requestToken = nextAnalysisToken(jdState.analysisRequestToken);
    jdState.analysisRequestToken = requestToken;
    clearJdResult(false);
    setJdStatus("scoring", { source: source });

    ensureProfile().then(function (profile) {
      if (!canApplyAnalysisToken(requestToken, jdState.analysisRequestToken)) return;
      var normalized = window.JDExtractor.normalize(text);
      var warnings = (normalized.warnings || []).map(localizeExtractorMessage);
      var result = window.JDMatcher.scoreJobDescription(normalized, profile);
      if (!canApplyAnalysisToken(requestToken, jdState.analysisRequestToken)) return;
      jdState.deterministicResult = result;
      jdState.result = result;
      jdState.normalizedText = normalized && normalized.normalizedText
        ? normalized.normalizedText
        : (normalized && normalized.rawText ? normalized.rawText : text);
      jdState.resultSource = source || "paste";
      jdState.scoringMode = "pending";
      jdState.reasoningMode = "unavailable";
      jdState.reasoningBusy = false;
      jdState.reasoningFallback = false;
      renderJdResult();
      setJdStatus("scored", {
        level: "success",
        source: jdState.resultSource,
        warnings: warnings
      });
      /* AI scoring starts on its own — the visitor never has to ask for it. */
      requestJdReasoning();
    }).catch(function (err) {
      if (!canApplyAnalysisToken(requestToken, jdState.analysisRequestToken)) return;
      if (window.console && console.warn) console.warn("Recruiter scoring failed:", err);
      clearJdResult();
      setJdStatus("error", { level: "error", errorKey: "jdErrorProfile" });
    });
  }

  if (recruiterUI) {
    jdFileTrigger.addEventListener("click", function () {
      jdFile.click();
    });
    jdFile.addEventListener("change", function () {
      var file = jdFile.files && jdFile.files[0] ? jdFile.files[0] : null;
      var token = ++jdState.fileToken;
      jdInput.value = "";
      jdState.fileName = file && file.name ? file.name : "";
      jdState.extractedText = "";
      jdState.extractedSource = "";
      setJdFileName();
      clearJdResult();

      if (!file) {
        setJdStatus("idle");
        return;
      }

      var lowerName = jdState.fileName.toLowerCase();
      if (!/\.pdf$|\.docx$/.test(lowerName)) {
        setJdStatus("error", { level: "error", errorKey: "jdErrorFileType" });
        return;
      }
      if (typeof file.size === "number" && file.size > (10 * 1024 * 1024)) {
        setJdStatus("error", { level: "error", errorKey: "jdErrorFileSize" });
        return;
      }
      if (!window.JDExtractor || typeof window.JDExtractor.extract !== "function") {
        setJdStatus("error", { level: "error", errorKey: "jdErrorUnavailable" });
        return;
      }

      setJdStatus("reading");
      window.JDExtractor.extract(file).then(function (payload) {
        if (token !== jdState.fileToken) return;
        jdState.extractedText = payload && payload.text ? payload.text : "";
        jdState.extractedSource = payload && payload.source === "docx" ? "docx" : "pdf";
        setJdStatus("loaded", {
          level: jdState.extractedText ? "success" : "error",
          source: jdState.extractedSource,
          warnings: (payload && payload.warnings ? payload.warnings : []).map(localizeExtractorMessage)
        });
      }).catch(function (err) {
        if (token !== jdState.fileToken) return;
        jdState.extractedText = "";
        jdState.extractedSource = /\.docx$/.test(lowerName) ? "docx" : "pdf";
        setJdStatus("error", {
          level: "error",
          errorKey: extractorErrorKey(err && err.message)
        });
      });
    });

    jdInput.addEventListener("input", function () {
      if (jdInput.value.trim() && (jdState.fileName || jdState.extractedText)) {
        jdState.fileToken += 1;
        jdState.fileName = "";
        jdState.extractedText = "";
        jdState.extractedSource = "";
        jdFile.value = "";
        setJdFileName();
      }
      clearJdResult();
      if (jdInput.value.trim()) {
        setJdStatus("pasted");
      } else if (jdState.extractedText) {
        setJdStatus("loaded", {
          level: "success",
          source: jdState.extractedSource
        });
      } else {
        setJdStatus("idle");
      }
    });

    jdAnalyze.addEventListener("click", analyzeRecruiterMatch);
    jdClear.addEventListener("click", resetRecruiterState);
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    send(input.value);
  });
  chips.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    if (btn.id === "chat-jd-toggle") {
      setRecruiterOpen(!jdState.open);
      return;
    }
    send(btn.textContent);
  });
})();
