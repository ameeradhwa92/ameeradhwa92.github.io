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

  /* ---------------- knowledge base (fetched, shared with the cloud worker) ---------------- */
  var KB = "", kbPromise = null;
  var PROFILE = null, profilePromise = null;
  function ensureKB() {
    if (KB) return Promise.resolve(KB);
    if (!kbPromise) {
      kbPromise = fetch(KB_URL).then(function (r) {
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
      profilePromise = fetch(PROFILE_URL).then(function (r) {
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

  /* ---------------- recruiter explanation payload helpers ---------------- */
  function clipText(value, maxChars) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
  }

  function compactExplanationList(items, maxItems) {
    return (Array.isArray(items) ? items : []).slice(0, maxItems).map(function (item) {
      return {
        term: clipText(item && item.term, 120),
        label: clipText(item && item.label, 220),
        evidenceType: clipText(item && item.evidenceType, 32),
        evidence: (Array.isArray(item && item.evidence) ? item.evidence : []).slice(0, 3).map(function (entry) {
          return clipText(entry, 140);
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
      if (typeof item.key === "string") compact[key].key = clipText(item.key, 64);
      if (typeof item.label === "string") compact[key].label = clipText(item.label, 120);
      if (Number.isInteger(item.matchedRequirements)) {
        compact[key].matchedRequirements = Math.max(0, Math.min(100, item.matchedRequirements));
      }
      if (Number.isInteger(item.totalRequirements)) {
        compact[key].totalRequirements = Math.max(0, Math.min(100, item.totalRequirements));
      }
      if (Array.isArray(item.matchedTerms)) {
        compact[key].matchedTerms = item.matchedTerms.slice(0, 50).map(function (term) {
          return clipText(term, 120);
        });
      }
    });
    return compact;
  }

  function compactExplanationResult(result) {
    var compact = {
      score: Math.round((Number(result && result.score) || 0) * 10) / 10,
      confidence: {
        label: clipText(result && result.confidence && result.confidence.label, 16),
        reasons: (Array.isArray(result && result.confidence && result.confidence.reasons)
          ? result.confidence.reasons : []).slice(0, 3).map(function (reason) {
            return clipText(reason, 180);
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
      jdText: clipText(normalizedText, JD_EXPLANATION_JD_MAX),
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

  function computeJdExplanationMode(state) {
    if (!state || !state.hasResult || !state.hasNormalizedText) return "unavailable";
    if (state.hasEngine && state.aiState === "ready") return "local";
    if (state.localOK) {
      if (state.preferredMode === "cloud") return state.cloudOk ? "cloud" : "unavailable";
      if (state.dlActive || state.aiState === "loading" || state.route === "local" || state.preferredMode === "local") {
        return "waiting";
      }
      return "unavailable";
    }
    if (state.cloudOk && (state.aiState === "cloud" || state.route === "cloud")) return "cloud";
    return "unavailable";
  }

  if (!window.AIMeerRecruiter) window.AIMeerRecruiter = {};
  window.AIMeerRecruiter.buildExplanationPayload = buildJdExplanationPayload;
  window.AIMeerRecruiter.getExplanationMode = computeJdExplanationMode;
  window.AIMeerRecruiter.nextExplanationToken = nextExplanationToken;
  window.AIMeerRecruiter.canApplyExplanationToken = canApplyExplanationToken;
  window.AIMeerRecruiter.nextAnalysisToken = nextAnalysisToken;
  window.AIMeerRecruiter.canApplyAnalysisToken = canApplyAnalysisToken;
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
      jdInputPlaceholder: "Paste the job description here…",
      jdDisclaimer: "This is an estimated compatibility score based only on the job description and Ameer's published profile. It is not an objective hiring decision, technical assessment, or guarantee of suitability.",
      jdFileEmpty: "No file selected",
      jdStatusIdle: "Paste a job description or choose a local PDF/DOCX to start.",
      jdStatusReading: "Reading the local document…",
      jdStatusScoring: "Scoring the job description locally…",
      jdStatusLoaded: "Local document ready: {source}.",
      jdStatusLoadedWithWarnings: "Local document ready: {source}. Warnings: {warnings}",
      jdStatusPasted: "Using the pasted job description text.",
      jdStatusScored: "Deterministic match ready from {source}.",
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
      jdResultScoreLabel: "Estimated compatibility",
      jdResultSourceLabel: "Source",
      jdResultConfidenceLabel: "Confidence",
      jdResultConfidenceHigh: "High",
      jdResultConfidenceMedium: "Medium",
      jdResultConfidenceLow: "Low",
      jdResultCategories: "Weighted category breakdown",
      jdResultNotSpecified: "Not specified in this JD",
      jdResultStrong: "Strong matches",
      jdResultPartial: "Partial or transferable matches",
      jdResultGaps: "Requirements with published evidence gaps",
      jdResultUnverified: "Requirements not verified in the published profile",
      jdResultInterview: "Suggested interview topics",
      jdEvidenceProfessional: "Professional evidence",
      jdEvidenceAcademic: "Academic exposure",
      jdEvidenceUser: "User-provided context",
      jdEvidenceGap: "Published evidence gap",
      jdEvidenceUnverified: "Unverified",
      jdNoMatches: "No items in this section.",
      jdInterviewPrompt: "{term}: ask for concrete delivery examples and hands-on depth.",
      jdCategoryCoreTechnologies: "Core technologies",
      jdCategoryProfessionalExperience: "Professional experience and seniority",
      jdCategoryArchitectureDeliveryCloud: "Production architecture, delivery, and cloud",
      jdCategoryDomainIntegrations: "Domain and integrations",
      jdCategoryMobile: "Mobile delivery",
      jdCategoryEducationCoursework: "Education and coursework",
      jdCategoryLanguagesCommunication: "Communication and collaboration",
      jdExplainAction: "Explain this result with AIMeer",
      jdExplainLoading: "Generating explanation…",
      jdExplainTitle: "AIMeer explanation",
      jdExplainHintLocal: "This explanation stays on this device and uses the deterministic score shown above.",
      jdExplainHintCloud: "This explanation uses secure cloud AI and sends only a bounded normalized JD plus the deterministic result to AIMeer's Worker.",
      jdExplainHintWaiting: "On-device AIMeer is still getting ready. This explanation will stay on this device once the local model is ready.",
      jdExplainHintUnavailable: "AI explanation is unavailable right now. The deterministic score above remains the authoritative result.",
      jdExplainError: "AIMeer could not explain this result right now. The deterministic score above remains the authoritative result."
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
      jdInputPlaceholder: "Tampal huraian jawatan di sini…",
      jdDisclaimer: "Ini ialah skor keserasian anggaran yang berasaskan hanya pada huraian jawatan dan profil terbitan Ameer. Ia bukan keputusan pengambilan pekerja yang objektif, penilaian teknikal, atau jaminan kesesuaian.",
      jdFileEmpty: "Belum ada fail dipilih",
      jdStatusIdle: "Tampal huraian jawatan atau pilih PDF/DOCX setempat untuk bermula.",
      jdStatusReading: "Sedang membaca dokumen setempat…",
      jdStatusScoring: "Sedang mengira skor huraian jawatan secara setempat…",
      jdStatusLoaded: "Dokumen setempat sedia digunakan: {source}.",
      jdStatusLoadedWithWarnings: "Dokumen setempat sedia digunakan: {source}. Amaran: {warnings}",
      jdStatusPasted: "Menggunakan teks huraian jawatan yang ditampal.",
      jdStatusScored: "Padanan deterministik siap daripada {source}.",
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
      jdResultScoreLabel: "Keserasian anggaran",
      jdResultSourceLabel: "Sumber",
      jdResultConfidenceLabel: "Tahap keyakinan",
      jdResultConfidenceHigh: "Tinggi",
      jdResultConfidenceMedium: "Sederhana",
      jdResultConfidenceLow: "Rendah",
      jdResultCategories: "Pecahan kategori berwajaran",
      jdResultNotSpecified: "Tidak dinyatakan dalam JD ini",
      jdResultStrong: "Padanan kukuh",
      jdResultPartial: "Padanan separa atau boleh dipindahkan",
      jdResultGaps: "Keperluan dengan jurang bukti terbitan",
      jdResultUnverified: "Keperluan yang belum disahkan dalam profil terbitan",
      jdResultInterview: "Topik temu duga yang dicadangkan",
      jdEvidenceProfessional: "Bukti profesional",
      jdEvidenceAcademic: "Pendedahan akademik",
      jdEvidenceUser: "Konteks yang dibekalkan pengguna",
      jdEvidenceGap: "Jurang bukti terbitan",
      jdEvidenceUnverified: "Belum disahkan",
      jdNoMatches: "Tiada item dalam seksyen ini.",
      jdInterviewPrompt: "{term}: minta contoh penyampaian sebenar dan kedalaman pengalaman langsung.",
      jdCategoryCoreTechnologies: "Teknologi teras",
      jdCategoryProfessionalExperience: "Pengalaman profesional dan senioriti",
      jdCategoryArchitectureDeliveryCloud: "Seni bina produksi, penyampaian, dan awan",
      jdCategoryDomainIntegrations: "Domain dan integrasi",
      jdCategoryMobile: "Penyampaian mudah alih",
      jdCategoryEducationCoursework: "Pendidikan dan kerja kursus",
      jdCategoryLanguagesCommunication: "Komunikasi dan kolaborasi",
      jdExplainAction: "Terangkan keputusan ini dengan AIMeer",
      jdExplainLoading: "Sedang menjana penjelasan…",
      jdExplainTitle: "Penjelasan AIMeer",
      jdExplainHintLocal: "Penjelasan ini kekal pada peranti ini dan menggunakan skor deterministik yang dipaparkan di atas.",
      jdExplainHintCloud: "Penjelasan ini menggunakan AI awan selamat dan menghantar hanya JD ternormal terhad serta keputusan deterministik ke Worker AIMeer.",
      jdExplainHintWaiting: "AIMeer setempat masih disediakan. Penjelasan ini akan kekal pada peranti ini sebaik sahaja model setempat siap.",
      jdExplainHintUnavailable: "Penjelasan AI tidak tersedia sekarang. Skor deterministik di atas kekal sebagai keputusan autoritatif.",
      jdExplainError: "AIMeer tidak dapat menerangkan keputusan ini sekarang. Skor deterministik di atas kekal sebagai keputusan autoritatif."
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
      keys: /\b(skill|stack|tech|teknologi|kemahiran|framework|language|bahasa pengaturcaraan|tool)\b/,
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
  var jdResult = document.getElementById("chat-jd-result");
  var recruiterUI = !!(jdToggle && jdPanel && jdInput && jdFile && jdFileTrigger && jdFileName &&
    jdAnalyze && jdClear && jdDisclaimer && jdStatus && jdResult);

  var open = false, greeted = false, busy = false;
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
    result: null,
    normalizedText: "",
    resultSource: "",
    explanation: "",
    explanationMode: "",
    explanationBusy: false,
    explanationError: "",
    explanationRequestToken: 0,
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

  function formatScore(value) {
    var rounded = Math.round((Number(value) || 0) * 10) / 10;
    return String(rounded).replace(/\.0$/, "");
  }

  function sourceLabel(source) {
    return source === "pdf" ? t("jdSourcePdf")
      : source === "docx" ? t("jdSourceDocx")
        : t("jdSourcePaste");
  }

  function categoryLabel(key) {
    return key === "coreTechnologies" ? t("jdCategoryCoreTechnologies")
      : key === "professionalExperience" ? t("jdCategoryProfessionalExperience")
        : key === "architectureDeliveryCloud" ? t("jdCategoryArchitectureDeliveryCloud")
          : key === "domainIntegrations" ? t("jdCategoryDomainIntegrations")
            : key === "mobile" ? t("jdCategoryMobile")
              : key === "educationCoursework" ? t("jdCategoryEducationCoursework")
                : t("jdCategoryLanguagesCommunication");
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
    jdState.explanationRequestToken = nextExplanationToken(jdState.explanationRequestToken);
    jdState.result = null;
    jdState.normalizedText = "";
    jdState.resultSource = "";
    jdState.explanation = "";
    jdState.explanationMode = "";
    jdState.explanationBusy = false;
    jdState.explanationError = "";
    if (recruiterUI) jdResult.innerHTML = "";
  }

  function explanationLanguage() {
    return root.getAttribute("data-lang") === "ms" ? "ms" : "en";
  }

  function getJdExplanationMode() {
    return computeJdExplanationMode({
      hasResult: !!jdState.result,
      hasNormalizedText: !!jdState.normalizedText,
      aiState: aiState,
      localOK: localOK,
      preferredMode: preferredMode,
      route: route,
      cloudOk: cloudOk,
      dlActive: dlActive,
      hasEngine: !!engine
    });
  }

  function explanationHintKey(mode) {
    return mode === "local" ? "jdExplainHintLocal"
      : mode === "cloud" ? "jdExplainHintCloud"
        : mode === "waiting" ? "jdExplainHintWaiting"
          : "jdExplainHintUnavailable";
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
    else if (jdState.statusKind === "loaded") {
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

  function appendEvidenceList(parent, evidence) {
    if (!evidence || !evidence.length) return;
    var list = createJdNode("ul", "chat-jd-evidence");
    evidence.forEach(function (entry) {
      list.appendChild(createJdNode("li", "", entry));
    });
    parent.appendChild(list);
  }

  function renderMatchItems(titleKey, items, modeClass) {
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
      head.appendChild(createJdNode("span", "chat-jd-term", item.term));
      if (modeClass === "gap") head.appendChild(createJdBadge(t("jdEvidenceGap"), "is-gap"));
      else if (modeClass === "unverified") head.appendChild(createJdBadge(t("jdEvidenceUnverified"), "is-unverified"));
      else if (item.evidenceType === "academic") head.appendChild(createJdBadge(t("jdEvidenceAcademic"), "is-academic"));
      else if (item.evidenceType === "user-provided") head.appendChild(createJdBadge(t("jdEvidenceUser"), "is-user"));
      else head.appendChild(createJdBadge(t("jdEvidenceProfessional"), "is-professional"));
      li.appendChild(head);
      appendEvidenceList(li, item.evidence);
      list.appendChild(li);
    });
    section.appendChild(list);
    return section;
  }

  function renderInterviewTopics(items) {
    var section = createJdNode("section", "chat-jd-section");
    section.appendChild(createJdNode("h6", "", t("jdResultInterview")));
    if (!items.length) {
      section.appendChild(createJdNode("p", "chat-jd-empty", t("jdNoMatches")));
      return section;
    }
    var list = createJdNode("ul", "chat-jd-topic-list");
    items.forEach(function (item) {
      list.appendChild(createJdNode("li", "", formatT("jdInterviewPrompt", { term: item.term })));
    });
    section.appendChild(list);
    return section;
  }

  function renderJdExplanation(section) {
    var mode = getJdExplanationMode();
    var explainSection = createJdNode("section", "chat-jd-section");
    explainSection.appendChild(createJdNode("h6", "", t("jdExplainTitle")));
    explainSection.appendChild(createJdNode("p", "chat-jd-hint", t(explanationHintKey(mode))));

    var button = document.createElement("button");
    button.type = "button";
    button.className = "chat-jd-action" + (mode === "local" ? " chat-jd-action-primary" : "");
    button.textContent = jdState.explanationBusy ? t("jdExplainLoading") : t("jdExplainAction");
    button.disabled = jdState.explanationBusy || mode === "waiting" || mode === "unavailable";
    button.addEventListener("click", requestJdExplanation);
    explainSection.appendChild(button);

    if (jdState.explanationError) {
      explainSection.appendChild(createJdNode("p", "chat-jd-status is-error", jdState.explanationError));
    }

    if (jdState.explanation) {
      jdState.explanation.split(/\n{2,}/).forEach(function (paragraph) {
        var text = paragraph.replace(/\s+/g, " ").trim();
        if (text) explainSection.appendChild(createJdNode("p", "", text));
      });
    }

    section.appendChild(explainSection);
  }

  function renderJdResult() {
    if (!recruiterUI) return;
    jdResult.innerHTML = "";
    if (!jdState.result) return;

    var result = jdState.result;
    jdResult.appendChild(createJdNode("p", "chat-jd-result-disclaimer", t("jdDisclaimer")));

    var summary = createJdNode("section", "chat-jd-result-card");
    var scoreRow = createJdNode("div", "chat-jd-score-row");
    var scoreBlock = createJdNode("div", "");
    scoreBlock.appendChild(createJdNode("div", "chat-jd-score-label", t("jdResultScoreLabel")));
    scoreBlock.appendChild(createJdNode("div", "chat-jd-score", formatScore(result.score) + "%"));
    scoreRow.appendChild(scoreBlock);
    var meta = createJdNode("div", "chat-jd-meta");
    meta.textContent = t("jdResultSourceLabel") + ": " + sourceLabel(jdState.resultSource || "paste");
    scoreRow.appendChild(meta);
    summary.appendChild(scoreRow);
    summary.appendChild(createJdNode("p", "chat-jd-confidence",
      t("jdResultConfidenceLabel") + ": " + confidenceLabel(result.confidence && result.confidence.label)));
    jdResult.appendChild(summary);

    var categories = createJdNode("section", "chat-jd-category-list");
    categories.appendChild(createJdNode("h6", "", t("jdResultCategories")));
    [
      "coreTechnologies",
      "professionalExperience",
      "architectureDeliveryCloud",
      "domainIntegrations",
      "mobile",
      "educationCoursework",
      "languagesCommunication"
    ].forEach(function (key) {
      var item = result.categories && result.categories[key];
      if (!item) return;
      var card = createJdNode("div", "chat-jd-category-item");
      var row = createJdNode("div", "chat-jd-category-row");
      row.appendChild(createJdNode("span", "chat-jd-category-label", categoryLabel(key)));
      row.appendChild(createJdNode("span", "chat-jd-category-score",
        item.active ? formatScore(item.score) + " / " + formatScore(item.weight) : t("jdResultNotSpecified")));
      card.appendChild(row);
      var bar = createJdNode("div", "chat-jd-category-bar");
      var fill = createJdNode("span", "", "");
      fill.style.width = (item.active && item.weight ? Math.max(0, Math.min(100, (item.score / item.weight) * 100)) : 0) + "%";
      bar.appendChild(fill);
      card.appendChild(bar);
      categories.appendChild(card);
    });
    jdResult.appendChild(categories);

    jdResult.appendChild(renderMatchItems("jdResultStrong", result.strongMatches || [], "strong"));
    jdResult.appendChild(renderMatchItems("jdResultPartial", result.partialMatches || [], "partial"));
    jdResult.appendChild(renderMatchItems("jdResultGaps", result.gaps || [], "gap"));
    jdResult.appendChild(renderMatchItems("jdResultUnverified", result.unverified || [], "unverified"));
    jdResult.appendChild(renderInterviewTopics(result.interviewTopics || []));
    renderJdExplanation(jdResult);
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
    input.placeholder = t("placeholder");
    refreshStatus();
    applyAiBox();
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
    try { localStorage.setItem("aimeer-route", cloudOk ? "cloud" : "off"); } catch (e) { }
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

  function explainJdLocally(payload) {
    return ensureKB().then(function (kb) {
      if (!engine) throw new Error("local-unavailable");
      return engine.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              PROMPT_HEAD + kb +
              "\n\nYou are explaining a deterministic recruiter match result that was already scored locally. " +
              "Do not recalculate the score or invent new evidence. Preserve distinctions between professional evidence, " +
              "academic exposure, and user-provided context. Never present academic exposure as professional experience. " +
              "Repeat this estimate disclaimer verbatim as the first sentence: \"" + payload.disclaimer + "\" " +
              "Then explain the supplied score, category breakdown, strong matches, partial matches, published evidence gaps, " +
              "unverified requirements, and suggested interview topics in 3-6 short sentences."
          },
          {
            role: "user",
            content:
              payload.messages[0].content +
              "\n\nNormalized JD:\n" + payload.jdText +
              "\n\nDeterministic match result JSON:\n" + JSON.stringify(payload.matchResult)
          }
        ],
        stream: false,
        temperature: 0.2,
        max_tokens: 320
      });
    }).then(function (res) {
      var reply = res && res.choices && res.choices[0] && res.choices[0].message
        ? String(res.choices[0].message.content || "").trim()
        : "";
      if (!reply) throw new Error("local-empty");
      return reply;
    });
  }

  function explainJdViaCloud(payload) {
    return fetch(CLOUD_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error("cloud-" + r.status);
      return r.json();
    }).then(function (d) {
      var reply = String((d && d.reply) || "").trim();
      if (!reply) throw new Error("cloud-empty");
      return reply;
    });
  }

  function requestJdExplanation() {
    if (!jdState.result || !jdState.normalizedText || jdState.explanationBusy) return;
    var mode = getJdExplanationMode();
    if (mode === "waiting" || mode === "unavailable") {
      jdState.explanationError = t("jdExplainError");
      renderJdResult();
      return;
    }
    var payload = buildJdExplanationPayload(jdState.normalizedText, jdState.result, explanationLanguage());
    var requestToken = nextExplanationToken(jdState.explanationRequestToken);
    jdState.explanationRequestToken = requestToken;
    jdState.explanationBusy = true;
    jdState.explanationError = "";
    jdState.explanation = "";
    jdState.explanationMode = mode;
    renderJdResult();

    var runner = mode === "local" ? explainJdLocally(payload) : explainJdViaCloud(payload);
    runner.then(function (reply) {
      if (!canApplyExplanationToken(requestToken, jdState.explanationRequestToken)) return;
      jdState.explanationBusy = false;
      jdState.explanation = reply;
      jdState.explanationError = "";
      renderJdResult();
    }).catch(function (err) {
      if (!canApplyExplanationToken(requestToken, jdState.explanationRequestToken)) return;
      if (window.console && console.warn) console.warn("JD explanation failed:", err);
      jdState.explanationBusy = false;
      jdState.explanation = "";
      jdState.explanationError = t("jdExplainError");
      renderJdResult();
    });
  }

  /* ---------------- whatsapp / email handoff ---------------- */
  function mechanicalSummary() {
    var qs = [];
    transcript.forEach(function (m) {
      if (m.role === "user") qs.push(m.content.slice(0, 120));
    });
    qs = qs.slice(-6);
    var s = t("sumIntro") + "\n\n" + t("sumAsked") + "\n" +
      qs.map(function (q) { return "• " + q; }).join("\n");
    if (lastUnanswered) s += "\n\n" + t("sumOpen") + ' "' + lastUnanswered.slice(0, 200) + '"';
    return s + "\n\n— " + t("sumVia");
  }

  function decorateSummary(body) {
    var s = t("sumIntro") + "\n\n" + body.trim();
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

  function offerHandoff() {
    var old = log.querySelector(".chat-handoff");
    if (old) old.remove();
    var card = document.createElement("div");
    card.className = "chat-msg chat-msg-bot chat-handoff";
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
      jdState.result = result;
      jdState.normalizedText = normalized && normalized.normalizedText
        ? normalized.normalizedText
        : (normalized && normalized.rawText ? normalized.rawText : text);
      jdState.resultSource = source || "paste";
      jdState.explanation = "";
      jdState.explanationMode = "";
      jdState.explanationBusy = false;
      jdState.explanationError = "";
      renderJdResult();
      setJdStatus("scored", {
        level: "success",
        source: jdState.resultSource,
        warnings: warnings
      });
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
