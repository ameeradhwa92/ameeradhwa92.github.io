/* AIMeer — Ameer's AI twin. Two-tier portfolio chatbot.
   Tier 1: instant keyword answers, zero download, works everywhere.
   Tier 2: opt-in WebLLM (Llama 3.2 1B) running fully in-browser via WebGPU —
           the only external requests this site ever makes, and only after
           the visitor explicitly enables AI mode. */
(function () {
  "use strict";

  var WEBLLM_CDN = "https://esm.run/@mlc-ai/web-llm@0.2.79";
  var root = document.documentElement;

  /* ---------------- knowledge base (system prompt for AI mode) ---------------- */
  var KB =
    "FACTS ABOUT AMEER ADHWA BIN MOHAMAD\n" +
    "Identity: Full Stack Web Specialist based in Shah Alam, Malaysia. 12+ years shipping software, " +
    "25+ production systems, work used by 20+ FMCG brands in 4 countries. Languages: Bahasa Malaysia (native), " +
    "English (professional). Contact: ameeradhwa92@gmail.com, linkedin.com/in/ameeradhwa92, github.com/ameeradhwa92, " +
    "+60 13-961 0053. A resume PDF is downloadable on this site. Open to hard problems in web, mobile and multi-tenant SaaS.\n\n" +
    "Education: SPM 2009, SMK Balai Besar Dungun (Pure Sciences, A+ in Mathematics). Diploma in Computer Science, " +
    "UiTM Dungun 2010-2013, CGPA 3.03, final-year project: Bus Ticketing System in PHP. B.IT (Hons.) Intelligent Systems " +
    "Engineering, UiTM Shah Alam 2013-2016, final-year project: Mobile Road Tax Sticker Recognizer (Tesseract OCR, Android). " +
    "MUET Band 3 (2015).\n\n" +
    "Career history:\n" +
    "- 2013-2014 MyEMRO Sdn. Bhd., Kuala Lumpur — Web Application Developer. Aircraft MRO (maintenance, repair & overhaul) " +
    "scheduling system in Ruby on Rails (retired, internal).\n" +
    "- 2015-2023 TRM Nett Systems, Petaling Jaya (7 years 10 months) — Web & Mobile Application Developer, Junior to Senior. " +
    "Built 15+ systems for Malaysian government agencies (CIDB, SPAN, SIRIM, Royal Malaysian Customs, Port Klang Authority, LPPEH). " +
    "Introduced Git company-wide and pioneered Flutter adoption. Projects: Service 73 real-time GPS team management (retired); " +
    "LPPEH Board Information System + public verification apps (live, lpeph.gov.my); MARii EEV Label vehicle star-rating (live, " +
    "eev.marii.my); CIDB CCPM construction certification (live, ccpm.cidb.gov.my); SPAN eCLAPS licensing in Laravel (live, " +
    "eclaps.span.gov.my); Kastam eCAF electronic customs forms for PKFZ, North Port & Westport (live, restricted); SIRIM " +
    "Check Your Label IMEI-verification app (live on Google Play and the App Store); Port Klang Authority eDCFZ dangerous-cargo " +
    "declarations (live, edcfz.pka.gov.my); PKFZ PIMS gate & cargo system (live, pkfz.com); ClinicPlus clinic management " +
    "(retired); Senai Airport City FZ, the company's first Flutter production app (retired); Contractor4U CIDB contractor " +
    "marketplace (retired).\n" +
    "- Feb-Aug 2023 NCS Global Technology (remote contract) — Android/iOS Developer on Motorola Solutions' mission-critical " +
    "public-safety Android platform (Kotlin, Java, NDK, JUnit4, defense-in-depth security).\n" +
    "- Aug 2023-present RetailAIM Malaysia Sdn. Bhd. (formerly Always Marketing), Kuala Lumpur — Web Application Developer, " +
    "promoted to Full Stack Web Specialist in Jan 2025. Sole developer of RetailAIM Plus, a multi-tenant ASP.NET Core SaaS " +
    "for 20+ FMCG brands (Nestle, Unilever, Abbott, Farm Fresh) across Malaysia, Singapore, Thailand and the Philippines " +
    "(live, retailaim.com). Also: legacy BackOffice & QuickView admin portal (live, private); next-gen Plus BackOffice in " +
    "React 18 + TypeScript + FastAPI (in development); Abbott CRM — React PWA + .NET 10 clean-architecture monorepo with a " +
    "14-step Salesforce API v60.0 integration and WhatsApp OTP via Bird API (live, private); Promoter Payment System — " +
    "five-level approval payroll with Maybank bulk-payment exports (live, private).\n\n" +
    "Personal: Born in 1992 and raised in Dungun, Terengganu — kindergarten, primary school and secondary school " +
    "(SMK Balai Besar) all in Dungun. Half a life in a small town never limited his ambitions beyond being 'just a " +
    "programmer'. Family: married with three children — one daughter and two sons. Being a hands-on husband and father " +
    "around the clock sharpened his multitasking and his habit of finding the most efficient solution to any problem. " +
    "His dream is seeing his family live a comfortably good life.\n\n" +
    "Salary: not published — Ameer discusses compensation directly and his expectations are negotiable. Never state " +
    "any salary figure; point visitors to email or the WhatsApp button instead.\n\n" +
    "Skills: ASP.NET Core & Framework, C#, Entity Framework, Python FastAPI, Laravel/PHP, REST & SOAP APIs; React, TypeScript, " +
    "Vite, TailwindCSS, ShadCN/Radix, React Query, DevExpress; Flutter/Dart, Android (Kotlin, Java), iOS (Swift), Ionic; " +
    "MS SQL Server, Azure SQL, MySQL, SQLite; Azure DevOps CI/CD, Azure App Service, ARM/Bicep IaC, Git; integrations with " +
    "Salesforce, SAP, AutoCount ERP, iPay88, SenangPay, eGHL, PayPal, WhatsApp Business API, FCM/Pushwoosh.";

  var SYSTEM_PROMPT =
    "You are AIMeer, the AI twin of Ameer Adhwa on his portfolio website. You speak about Ameer in the third person, " +
    "warmly and professionally. Answer visitors' questions using ONLY the facts below. " +
    "Keep answers short (2-5 sentences), factual and friendly. If the question is in Bahasa Malaysia, reply in formal " +
    "Bahasa Malaysia; otherwise reply in English. If the answer is not in the facts, say you do not have that " +
    "information and suggest asking Ameer directly — the chat will show WhatsApp and email buttons for that. " +
    "Never invent projects, employers, dates or links.\n\n" + KB;

  var WA_NUMBER = "60139610053"; /* +60 13-961 0053 in wa.me format */
  var EMAIL = "ameeradhwa92@gmail.com";

  /* ---------------- ui strings (dynamic ones JS must swap itself) ---------------- */
  var T = {
    en: {
      greeting: "Hi, I'm AIMeer — Ameer's AI twin. Ask me about his career, projects and skills. Tap a suggestion below — or enable full AI mode for free-form questions, running entirely in your browser.",
      placeholder: "Ask AIMeer…",
      statusInstant: "Instant answers · no download",
      statusAI: "AI mode · runs locally on your device",
      statusLoading: "Downloading model… ",
      statusPreparing: "Preparing model… (first load compiles GPU shaders)",
      aiReady: "AI mode is on. Everything runs on your device — ask me anything about Ameer's work.",
      aiError: "AI mode failed to load — your connection may have dropped, or the device ran out of memory. Instant answers still work.",
      unsupported: "This browser or device doesn't support WebGPU, so AI mode isn't available here. Instant answers below still work — or email ameeradhwa92@gmail.com.",
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
      sumVia: "sent via AIMeer · ameeradhwa92.github.io"
    },
    ms: {
      greeting: "Salam sejahtera! Saya AIMeer — kembar AI Ameer. Tanya saya tentang kerjaya, projek dan kemahiran beliau. Tekan cadangan di bawah — atau aktifkan mod AI penuh untuk soalan bebas, berjalan sepenuhnya dalam pelayar anda.",
      placeholder: "Tanya AIMeer…",
      statusInstant: "Jawapan segera · tanpa muat turun",
      statusAI: "Mod AI · berjalan setempat pada peranti anda",
      statusLoading: "Memuat turun model… ",
      statusPreparing: "Menyediakan model… (muatan pertama mengompil pelorek GPU)",
      aiReady: "Mod AI telah diaktifkan. Semuanya berjalan pada peranti anda — tanyalah apa-apa sahaja tentang kerja Ameer.",
      aiError: "Mod AI gagal dimuatkan — sambungan mungkin terputus, atau memori peranti tidak mencukupi. Jawapan segera masih berfungsi.",
      unsupported: "Pelayar atau peranti ini tidak menyokong WebGPU, jadi mod AI tidak tersedia di sini. Jawapan segera di bawah masih berfungsi — atau e-mel ameeradhwa92@gmail.com.",
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
      sumVia: "dihantar melalui AIMeer · ameeradhwa92.github.io"
    }
  };
  function lang() { return root.dataset.lang === "ms" ? "ms" : "en"; }
  function t(key) { return T[lang()][key]; }

  /* ---------------- tier 1: instant keyword answers ---------------- */
  /* salary questions always offer the WhatsApp/email handoff, in both tiers */
  var SALARY_KEYS = /\b(salary|pay|paid|earn(s|ing)?|expected|compensation|remuneration|package|gaji|pendapatan|rm|ringgit)\b/;

  var TOPICS = [
    {
      keys: /\b(now|today|current|kini|sekarang|retailaim|saas|fmcg|nestle|unilever|farm fresh|role|job|kerja|jawatan)\b/,
      en: "Ameer is a Full Stack Web Specialist at RetailAIM Malaysia (since Aug 2023, promoted Jan 2025). He's the sole developer of RetailAIM® Plus — a multi-tenant ASP.NET Core SaaS used by 20+ FMCG brands like Nestlé, Unilever, Abbott and Farm Fresh across Malaysia, Singapore, Thailand and the Philippines. He's also rebuilding the back office in React + FastAPI and migrating the Abbott CRM to .NET 10.",
      ms: "Ameer ialah Pakar Web Tindanan Penuh di RetailAIM Malaysia (sejak Ogos 2023, dinaikkan pangkat Jan 2025). Beliau pembangun tunggal RetailAIM® Plus — SaaS ASP.NET Core berbilang penyewa yang digunakan oleh lebih 20 jenama FMCG seperti Nestlé, Unilever, Abbott dan Farm Fresh di Malaysia, Singapura, Thailand dan Filipina. Beliau juga sedang membina semula pejabat belakang dalam React + FastAPI dan memindahkan CRM Abbott ke .NET 10."
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
  var aiEnable = document.getElementById("chat-ai-enable");
  var progress = panel.querySelector(".chat-progress");
  var progressBar = panel.querySelector(".chat-progress-bar");
  var progressText = panel.querySelector(".chat-progress-text");

  var open = false, greeted = false, busy = false;
  var engine = null, aiState = "off"; /* off | loading | ready | failed */
  var history = []; /* {role, content} — capped so prefill stays fast */
  var transcript = []; /* full visitor conversation, for the WhatsApp/email handoff */
  var lastUnanswered = ""; /* the question AIMeer couldn't answer */

  function addMsg(role, text) {
    var el = document.createElement("div");
    el.className = "chat-msg chat-msg-" + role;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function setStatus(mode, extra) {
    status.className = "chat-status chat-status-" + mode;
    statusText.textContent =
      mode === "ai" ? t("statusAI") :
      mode === "loading" ? (extra || t("statusLoading")) :
      t("statusInstant");
  }

  function refreshLangBits() {
    input.placeholder = t("placeholder");
    if (aiState === "ready") setStatus("ai");
    else if (aiState !== "loading") setStatus("instant");
    /* setLang() rewrites the pitch from the dictionary; restore the notice */
    if (aiBox.classList.contains("unsupported")) {
      aiBox.querySelector(".chat-ai-pitch").textContent = t("unsupported");
    }
  }

  /* keep dynamic strings in step with the EN/BM toggle */
  new MutationObserver(refreshLangBits)
    .observe(root, { attributes: true, attributeFilter: ["data-lang"] });

  /* ---------------- attention callout (marketing nudge, shows once) ---------------- */
  var callout = document.getElementById("chat-callout");

  function hideCallout(persist) {
    if (!callout || callout.hidden) return;
    callout.classList.remove("show");
    setTimeout(function () { callout.hidden = true; }, 400);
    if (persist) { try { localStorage.setItem("aimeer-callout", "1"); } catch (e) {} }
  }

  if (callout) {
    var calloutSeen = null;
    try { calloutSeen = localStorage.getItem("aimeer-callout"); } catch (e) {}
    if (!calloutSeen) {
      setTimeout(function () {
        if (open) return;
        callout.hidden = false;
        void callout.offsetWidth;
        callout.classList.add("show");
      }, 1800);
    }
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
      if (!("gpu" in navigator)) {
        aiBox.classList.add("unsupported");
        aiEnable.hidden = true;
        aiBox.querySelector(".chat-ai-pitch").textContent = t("unsupported");
      } else if (localStorage.getItem("chat-ai") === "on") {
        enableAI(); /* returning visitor: weights are already in browser cache */
      }
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

  /* ---------------- tier 2: webllm ---------------- */
  function enableAI() {
    if (aiState === "loading" || aiState === "ready") return;
    aiState = "loading";
    aiEnable.hidden = true;
    progress.hidden = false;
    setStatus("loading");

    navigator.gpu.requestAdapter().then(function (adapter) {
      if (!adapter) throw new Error("no-webgpu-adapter");
      /* f16 shaders halve memory; fall back to f32 weights where unsupported */
      var model = adapter.features.has("shader-f16")
        ? "Llama-3.2-1B-Instruct-q4f16_1-MLC"
        : "Llama-3.2-1B-Instruct-q4f32_1-MLC";
      return import(WEBLLM_CDN).then(function (webllm) {
        return webllm.CreateMLCEngine(model, {
          initProgressCallback: function (p) {
            var pct = Math.round((p.progress || 0) * 100);
            progressBar.style.width = pct + "%";
            if (pct >= 100) {
              progressText.textContent = t("statusPreparing");
              setStatus("loading", t("statusPreparing"));
            } else {
              progressText.textContent = pct + "%";
              setStatus("loading", t("statusLoading") + pct + "%");
            }
          }
        });
      });
    }).then(function (e) {
      engine = e;
      aiState = "ready";
      try { localStorage.setItem("chat-ai", "on"); } catch (err) {}
      aiBox.hidden = true;
      setStatus("ai");
      addMsg("bot", t("aiReady"));
    }).catch(function (err) {
      aiState = "failed";
      try { localStorage.removeItem("chat-ai"); } catch (e2) {}
      progress.hidden = true;
      aiEnable.hidden = false;
      setStatus("instant");
      addMsg("bot", t("aiError"));
      if (window.console && console.warn) console.warn("WebLLM init failed:", err);
    });
  }
  aiEnable.addEventListener("click", enableAI);

  async function askLLM(text, bubble) {
    history.push({ role: "user", content: text });
    if (history.length > 8) history = history.slice(-8);
    var messages = [{ role: "system", content: SYSTEM_PROMPT }].concat(history);
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

  function getSummary() {
    if (aiState !== "ready" || !engine) return Promise.resolve(mechanicalSummary());
    var convo = transcript.slice(-12).map(function (m) {
      return (m.role === "user" ? "Visitor: " : "AIMeer: ") + m.content;
    }).join("\n");
    return engine.chat.completions.create({
      messages: [
        { role: "system", content:
          "Summarize this chat between a website visitor and AIMeer (Ameer's portfolio assistant) " +
          "in at most 3 short sentences addressed to Ameer, in the visitor's language " +
          "(English or Bahasa Malaysia). Plain text only, no preamble." },
        { role: "user", content: convo }
      ],
      stream: false,
      temperature: 0.2,
      max_tokens: 160
    }).then(function (res) {
      var s = t("sumIntro") + "\n\n" + res.choices[0].message.content.trim();
      if (lastUnanswered) s += "\n\n" + t("sumOpen") + ' "' + lastUnanswered.slice(0, 200) + '"';
      return s + "\n\n— " + t("sumVia");
    }).catch(function () { return mechanicalSummary(); });
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
    } else {
      /* a small beat so the instant answer still reads as a reply */
      setTimeout(function () {
        var a = instantAnswer(text);
        finishReply(bubble, a.text, !a.matched, text);
      }, 350);
    }
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    send(input.value);
  });
  chips.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (btn) send(btn.textContent);
  });
})();
