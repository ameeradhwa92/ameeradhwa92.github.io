const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'i18n.js'), 'utf8');
const chatbot = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'chatbot.js'), 'utf8');
const jdReasoning = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'jd-reasoning.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'css', 'style.css'), 'utf8');
const { evaluate } = require('../assets/js/aimeer-device.js');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createElement(tagName = 'div') {
  const listeners = new Map();
  const classes = new Set();
  const element = {
    tagName: String(tagName || 'div').toUpperCase(),
    hidden: false,
    textContent: '',
    className: '',
    children: [],
    focused: false,
    disabled: false,
    value: '',
    files: null,
    style: { setProperty() {}, removeProperty() {} },
    attributes: new Map(),
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) || null; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, target = this) { const listener = listeners.get(type); if (listener) listener({ key: type, target }); },
    closest(selector) { return selector === 'button' ? this : null; },
    querySelector() { return null; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
      this.parentNode = null;
    },
    click() { this.dispatch('click'); },
    focus() { this.focused = true; }
  };
  Object.defineProperty(element, 'innerHTML', {
    get() { return ''; },
    set() {
      this.children = [];
      this.textContent = '';
    }
  });
  return element;
}

function makeTextResponse(text) {
  return {
    ok: true,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(JSON.parse(text))
  };
}

function makeJsonResponse(data) {
  return {
    ok: true,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(clone(data))
  };
}

function collectText(node) {
  if (!node) return '';
  return [node.textContent || '']
    .concat((node.children || []).map((child) => collectText(child)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countNodes(node, predicate) {
  if (!node) return 0;
  let total = predicate(node) ? 1 : 0;
  for (const child of node.children || []) {
    total += countNodes(child, predicate);
  }
  return total;
}

/* The JD-scoring handoff card renders inside chat-jd-result (a direct child, alongside the
   jd-report section and the disclaimer), not into the chat log — see I2 in the FINAL
   WHOLE-BRANCH REVIEW: the chat log is display:none while the JD panel is open, and scoring
   always settles while it is open, so a card appended to the log was never visible there. */
function jdHandoffCards(elements) {
  return (elements['chat-jd-result'].children || [])
    .filter((child) => child.className && child.className.indexOf('chat-jd-handoff') !== -1);
}

function createChatContext(options = {}) {
  const elements = {};
  [
    'chat-launcher', 'chat-panel', 'chat-log', 'chat-form', 'chat-input', 'chat-chips',
    'chat-status', 'chat-ai', 'chat-ai-enable', 'chat-ai-cancel', 'chat-model-cloud',
    'chat-model-local', 'chat-model-tooltip', 'chat-callout', 'chat-jd-toggle',
    'chat-jd-panel', 'chat-jd-input', 'chat-jd-file', 'chat-jd-file-trigger',
    'chat-jd-file-name', 'chat-jd-analyze', 'chat-jd-clear', 'chat-jd-disclaimer',
    'chat-jd-status', 'chat-jd-result'
  ].forEach((id) => { elements[id] = createElement(); elements[id].id = id; });
  const statusText = createElement();
  const aiPitch = createElement();
  const progress = createElement();
  const progressBar = createElement();
  const progressText = createElement();
  const close = createElement('button');
  const stored = new Map(Object.entries(options.storage || {}));
  const timers = [];
  const clearedTimers = [];
  let adapterRequests = 0;

  elements['chat-status'].querySelector = () => statusText;
  elements['chat-ai'].querySelector = () => aiPitch;
  elements['chat-panel'].querySelector = (selector) => ({
    '.chat-progress': progress,
    '.chat-progress-bar': progressBar,
    '.chat-progress-text': progressText,
    '.chat-close': close
  })[selector] || null;

  const root = createElement();
  root.dataset = {};
  const observers = [];
  const document = {
    documentElement: root,
    readyState: 'complete',
    getElementById(id) { return elements[id] || null; },
    addEventListener() {},
    createElement,
    /* Absent by default, mirroring a page served without a ?v= cache-busting tag,
       which keeps every data-file URL byte-identical to its un-versioned form.
       Set currentScriptSrc to exercise the versioned path. */
    currentScript: options.currentScriptSrc ? { src: options.currentScriptSrc } : undefined
  };
  const window = {
    console: { warn() {} },
    AIMEER_DEVICE: { evaluate },
    addEventListener() {}
  };
  const userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  const platform = options.platform || 'Win32';
  const maxTouchPoints = options.maxTouchPoints || 0;
  const maxBufferSize = options.maxBufferSize === undefined ? 1_500_000_000 : options.maxBufferSize;
  const hasWebGPU = options.hasWebGPU !== false;
  const adapterResults = options.adapterResults ? options.adapterResults.slice() : null;
  progress.hidden = true;
  const context = {
    window,
    document,
    navigator: {
      userAgent,
      platform,
      maxTouchPoints,
      connection: { saveData: options.saveData !== false },
      gpu: hasWebGPU ? {
        requestAdapter() {
          adapterRequests += 1;
          if (adapterResults && adapterResults.length) return adapterResults.shift();
          return Promise.resolve({ limits: { maxBufferSize }, features: new Set(['shader-f16']) });
        }
      } : undefined
    },
    localStorage: {
      getItem(key) { return stored.get(key) || null; },
      setItem(key, value) { stored.set(key, String(value)); },
      removeItem(key) { stored.delete(key); }
    },
    MutationObserver: class {
      constructor(callback) { observers.push(callback); }
      observe() {}
    },
    setTimeout(fn, delay) {
      const id = timers.length + 1;
      timers.push({ id, fn, delay });
      return id;
    },
    clearTimeout(id) { clearedTimers.push(id); },
    fetch(url, init) {
      if (options.fetchImpl) return options.fetchImpl(url, init);
      if (options.fetchPromise) return options.fetchPromise;
      if (options.fetchText === undefined) return new Promise(() => {});
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(options.fetchText)
      });
    },
    Promise
  };
  return {
    context,
    elements,
    stored,
    timers,
    clearedTimers,
    progress,
    statusText,
    setLanguage(language) {
      root.dataset.lang = language;
      observers.forEach((observer) => observer());
    },
    get adapterRequests() { return adapterRequests; }
  };
}

async function loadChat(context, options = {}) {
  vm.runInNewContext(options.source || chatbot, context);
  await new Promise(setImmediate);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsync() {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
    await new Promise(setImmediate);
  }
}

const PROFILE_FIXTURE = {
  recruiterEvidence: [
    {
      id: 'ev-retailaim-plus',
      evidenceType: 'professional',
      claim: 'Production ASP.NET Core MVC delivery across Southeast Asia tenants.',
      technologies: ['ASP.NET Core MVC'],
      capabilities: ['ASP.NET Core MVC', 'Azure DevOps', 'CI/CD'],
      scope: ['multi-tenant web delivery'],
      sourceLabel: 'RetailAIM Plus project history'
    },
    {
      id: 'ev-azure-devops',
      evidenceType: 'professional',
      claim: 'Owns release pipelines and cloud delivery workflows.',
      technologies: ['Azure DevOps'],
      scope: ['cloud delivery'],
      sourceLabel: 'Azure DevOps release ownership',
      capabilities: ['Azure DevOps', 'Cloud delivery', 'Release automation']
    }
  ]
};

function buildDeterministicResult(overrides = {}) {
  return clone({
    score: 72,
    confidence: { label: 'medium', reasons: ['Published evidence covers core requirements.'] },
    categories: {
      coreTechnologies: { score: 24, weight: 30, active: true },
      professionalExperience: { score: 14, weight: 20, active: true },
      architectureDeliveryCloud: { score: 10, weight: 15, active: true },
      domainIntegrations: { score: 7, weight: 10, active: true },
      mobile: { score: 0, weight: 5, active: false },
      educationCoursework: { score: 7, weight: 10, active: true },
      languagesCommunication: { score: 10, weight: 10, active: true }
    },
    strongMatches: [
      {
        term: 'ASP.NET Core MVC',
        label: 'Published multi-tenant delivery evidence is present.',
        evidenceType: 'professional',
        evidence: ['RetailAIM Plus multi-tenant delivery']
      }
    ],
    partialMatches: [
      {
        term: 'Kubernetes',
        label: 'Adjacent cloud delivery evidence exists but no published production Kubernetes rollout is confirmed.',
        evidenceType: 'professional',
        evidence: ['Azure DevOps release ownership']
      }
    ],
    gaps: [
      {
        term: 'Salesforce Marketing Cloud',
        label: 'No published implementation evidence is available.',
        evidenceType: 'gap',
        evidence: []
      }
    ],
    unverified: [
      {
        term: 'Public speaking at conferences',
        label: 'Published profile does not verify this requirement.',
        evidenceType: 'unverified',
        evidence: []
      }
    ],
    interviewTopics: [
      {
        term: 'Kubernetes',
        prompt: 'Ask for concrete production rollout examples and hands-on depth.'
      }
    ],
    requirements: [
      {
        id: 'req-aspnet-core',
        term: 'ASP.NET Core MVC',
        category: 'coreTechnologies',
        strength: 'required',
        classification: 'strong',
        evidenceType: 'professional',
        evidenceRefs: ['ev-retailaim-plus']
      },
      {
        id: 'req-kubernetes',
        term: 'Kubernetes',
        category: 'architectureDeliveryCloud',
        strength: 'required',
        classification: 'partial',
        evidenceRefs: ['ev-azure-devops']
      }
    ],
    ...overrides
  });
}

/* The strict JSON the Worker's jd-scoring mode is expected to relay back: jd-reasoning's
   per-requirement shape plus the AI-led `overall` block that validateModelOutput now
   requires. Matches PROFILE_FIXTURE's evidence ids and buildDeterministicResult's
   requirement ids so the real JDReasoning validate/merge path accepts it. */
function buildScoringModelOutput(overrides = {}) {
  return JSON.stringify(Object.assign({
    narrative: 'Calibrated fit improves when adjacent cloud delivery is counted, but Kubernetes remains a verification topic.',
    requirements: [
      {
        requirementId: 'req-aspnet-core',
        recruiterIntent: 'Own production-grade web delivery on the current stack.',
        expectedOutcome: 'Sustain and extend the current ASP.NET Core platform.',
        matchLevel: 'direct-professional',
        evidenceRefs: ['ev-retailaim-plus'],
        transferableCapabilities: [],
        limitation: 'Published evidence confirms the current stack but not every future module.',
        recruiterFraming: 'Direct published production evidence is already available.',
        verificationQuestion: 'Which high-scale production modules did he own directly?',
        confidence: 'high'
      },
      {
        requirementId: 'req-kubernetes',
        recruiterIntent: 'Support containerized deployment and operations.',
        expectedOutcome: 'Ramp into Kubernetes-backed delivery with adjacent cloud ownership.',
        matchLevel: 'adjacent-professional',
        evidenceRefs: ['ev-azure-devops'],
        transferableCapabilities: ['Azure DevOps', 'Release automation'],
        limitation: 'Published work does not yet confirm a production Kubernetes rollout.',
        recruiterFraming: 'Adjacent cloud delivery shortens the ramp, but screening should confirm direct cluster experience.',
        verificationQuestion: 'What hands-on Kubernetes rollout, if any, has he completed directly?',
        confidence: 'medium'
      }
    ],
    overall: {
      score: 78,
      fitBand: 'strong',
      narrative: 'Strong overlap on the published .NET delivery stack; container operations remain the one screening topic.'
    }
  }, overrides));
}

function buildMergedResult(baseResult, overrides = {}) {
  const result = clone(baseResult);
  result.deterministicScore = 72;
  result.verifiedScore = 68;
  result.transferableScore = 79;
  result.compositeScore = 79;
  result.reasoningNarrative = 'Calibrated fit improves when adjacent cloud delivery is counted, but Kubernetes remains a verification topic.';
  result.requirementReasoning = [
    {
      requirementId: 'req-aspnet-core',
      term: 'ASP.NET Core MVC',
      matchLevel: 'direct-professional',
      recruiterIntent: 'Own production-grade web delivery on the current stack.',
      expectedOutcome: 'Sustain and extend the current ASP.NET Core platform.',
      evidenceRecords: [clone(PROFILE_FIXTURE.recruiterEvidence[0])],
      transferableCapabilities: [],
      limitation: '',
      recruiterFraming: 'Direct published production evidence is already available.',
      verificationQuestion: 'Which high-scale production modules did he own directly?',
      confidence: 'high',
      verified: true
    },
    {
      requirementId: 'req-kubernetes',
      term: 'Kubernetes',
      matchLevel: 'learning-bridge',
      recruiterIntent: 'Support containerized deployment and operations.',
      expectedOutcome: 'Ramp into Kubernetes-backed delivery with adjacent cloud ownership.',
      evidenceRecords: [clone(PROFILE_FIXTURE.recruiterEvidence[1])],
      transferableCapabilities: ['Azure DevOps', 'Release automation'],
      limitation: 'Published work does not yet confirm a production Kubernetes rollout.',
      recruiterFraming: 'Adjacent cloud delivery shortens the ramp, but screening should confirm direct cluster experience.',
      verificationQuestion: 'What hands-on Kubernetes rollout, if any, has he completed directly?',
      confidence: 'medium',
      verified: false
    }
  ];
  result.sections = {
    verifiedStrengths: [
      {
        term: 'ASP.NET Core MVC',
        recruiterFraming: 'Verified production delivery is already published.'
      }
    ],
    transferableAdvantages: [
      {
        term: 'Cloud delivery bridge',
        recruiterFraming: 'Azure DevOps release ownership can shorten the move into Kubernetes-based operations.'
      }
    ],
    learningBridges: [
      {
        term: 'Kubernetes',
        limitation: 'Adjacent cloud delivery exists, but named Kubernetes depth is still a screening topic.'
      }
    ],
    explicitGaps: [
      {
        term: 'Salesforce Marketing Cloud',
        limitation: 'No published implementation evidence is currently available.'
      }
    ],
    unverifiedRequirements: [
      {
        term: 'Public speaking at conferences',
        limitation: 'Published profile does not verify this requirement yet.'
      }
    ],
    limitations: [
      {
        term: 'Kubernetes',
        limitation: 'Bridge from Azure DevOps and cloud-release ownership into container operations.'
      }
    ],
    interviewQuestions: [
      {
        term: 'Kubernetes',
        question: 'What production cluster rollout, if any, has he handled directly?'
      }
    ]
  };
  return Object.assign(result, overrides);
}

test('chat header exposes cloud and local model choices with accessible state', () => {
  const header = html.match(/<header class="chat-head">([\s\S]*?)<\/header>/);

  assert.ok(header, 'the chat header should exist');
  assert.match(
    header[1],
    /<div class="chat-model-switch" id="chat-model-switch"[^>]*>/,
    'the header should contain the model switcher'
  );
  assert.match(
    header[1],
    /<button[^>]*id="chat-model-cloud"[^>]*aria-pressed="(?:true|false)"[^>]*aria-labelledby="chat-model-cloud-label"[^>]*>[\s\S]*?<svg[\s\S]*?<\/svg>[\s\S]*?<span[^>]*id="chat-model-cloud-label"[^>]*data-i18n="chat\.model\.cloud\.label"[^>]*>[\s\S]*?<\/span>[\s\S]*?<\/button>/,
    'the cloud model choice should have a pressed state, translated name, and icon'
  );
  assert.match(
    header[1],
    /<button[^>]*id="chat-model-local"[^>]*aria-pressed="(?:true|false)"[^>]*aria-labelledby="chat-model-local-label"[^>]*aria-describedby="chat-model-tooltip"[^>]*>[\s\S]*?<svg[\s\S]*?<\/svg>[\s\S]*?<span[^>]*id="chat-model-local-label"[^>]*data-i18n="chat\.model\.local\.label"[^>]*>[\s\S]*?<\/span>[\s\S]*?<\/button>/,
    'the local model choice should have a pressed state, translated name, tooltip hook, and icon'
  );
  assert.match(
    header[1],
    /<span[^>]*id="chat-model-tooltip"[^>]*role="tooltip"[^>]*data-i18n="chat\.model\.local\.hint"[^>]*hidden>/,
    'the header should expose a hidden local compatibility tooltip'
  );
});

test('chat chips are reduced to exactly three recruiter-focused presets with the JD toggle wiring intact', () => {
  const chipsBlock = html.match(/<div class="chat-chips" id="chat-chips">([\s\S]*?)<\/div>/);

  assert.ok(chipsBlock, 'the chat chips container should exist');

  const buttons = chipsBlock[1].match(/<button[^>]*>/g) || [];
  assert.equal(buttons.length, 3, 'exactly three preset chips should render');

  assert.match(buttons[0], /data-i18n="chat\.chip1"/, 'the first chip should carry the chat.chip1 translation key');
  assert.match(buttons[1], /data-i18n="chat\.chip2"/, 'the second chip should carry the chat.chip2 translation key');
  assert.match(
    buttons[2],
    /id="chat-jd-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="chat-jd-panel"[^>]*data-i18n="chat\.jd\.toggle"/,
    'the third chip must retain the JD panel toggle id, aria-expanded and aria-controls wiring'
  );
});

test('every versioned asset in index.html shares one cache-busting tag', () => {
  const tags = [...html.matchAll(/(?:href|src)="(assets\/(?:css|js)\/[^"?]+)(\?v=([^"]+))?"/g)];
  const versioned = tags.filter((match) => match[2]);

  assert.ok(versioned.length > 0, 'index.html should carry ?v= cache-busting tags on its CSS and JS');
  assert.equal(
    versioned.length,
    tags.length,
    `every CSS and JS asset must be versioned, or a deploy refreshes some files and serves others stale; un-versioned: ${tags.filter((m) => !m[2]).map((m) => m[1]).join(', ')}`
  );

  const distinct = [...new Set(versioned.map((match) => match[3]))];
  assert.equal(distinct.length, 1, `all ?v= tags must match; found: ${distinct.join(', ')}`);
});

async function collectProfileFetchUrls(options) {
  const fetched = [];
  const { context, elements } = createChatContext({
    ...options,
    fetchImpl(url) {
      const target = String(url);
      fetched.push(target);
      if (target.includes('aimeer-kb.txt')) return Promise.resolve(makeTextResponse('AIMeer knowledge base'));
      if (target.includes('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) return Promise.resolve(makeJsonResponse({ error: 'ai-failed' }));
      throw new Error(`Unexpected fetch: ${target}`);
    }
  });

  context.window.JDExtractor = {
    extract() {
      return Promise.resolve({ text: '', source: 'pdf', warnings: [] });
    },
    normalize(text) {
      return { normalizedText: text, warnings: [] };
    }
  };
  context.window.JDMatcher = {
    scoreJobDescription() {
      return buildDeterministicResult();
    }
  };
  vm.runInNewContext(jdReasoning, context);

  await loadChat(context);
  elements['chat-launcher'].dispatch('click');
  await flushAsync();
  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC and cloud delivery ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  return fetched;
}

test('the cache-busting tag is forwarded from the script src to the profile fetch', async () => {
  const fetched = await collectProfileFetchUrls({
    currentScriptSrc: 'https://ameeradhwa92.github.io/assets/js/chatbot.js?v=2026-07-30a'
  });

  assert.ok(
    fetched.includes('assets/data/aimeer-profile.json?v=2026-07-30a'),
    `the profile fetch must carry the version tag, or a bumped deploy serves stale recruiter data; saw: ${fetched.join(', ')}`
  );
});

test('data fetches stay un-versioned when the page carries no cache-busting tag', async () => {
  const fetched = await collectProfileFetchUrls({});

  assert.ok(
    fetched.includes('assets/data/aimeer-profile.json'),
    `without a ?v= tag on the script src the URL must be byte-identical to its un-versioned form; saw: ${fetched.join(', ')}`
  );
});

test('Bahasa Melayu provides distinct labels and compatibility help for the model choices', () => {
  const context = { window: {} };
  vm.runInNewContext(i18n, context);

  assert.equal(context.window.I18N_MS['chat.model.cloud.label'], 'Guna AI awan selamat');
  assert.equal(context.window.I18N_MS['chat.model.local.label'], 'Guna AI pada peranti');
  assert.match(context.window.I18N_MS['chat.model.local.hint'], /tidak serasi/i);
});

test('JD matcher promotion provides English localization hooks and formal Bahasa Melayu strings', async () => {
  const { context, elements } = createChatContext({ saveData: false });
  await loadChat(context);

  elements['chat-launcher'].dispatch('click');

  const promo = elements['chat-log'].children.find((child) => child.id === 'chat-jd-promo');
  assert.ok(promo, 'opening chat should add the recruiter promotion to the chat log');
  assert.equal(promo.className, 'chat-msg chat-msg-bot chat-jd-promo');
  assert.equal(promo.children[0].getAttribute('data-i18n'), 'chat.jd.promo');
  assert.equal(
    promo.children[0].textContent,
    'Paste a job description or load a local PDF/DOCX. AIMeer analyzes the fit with AI and shows an evidence-backed match report.'
  );
  assert.equal(promo.children[1].id, 'chat-jd-promo-action');
  assert.equal(promo.children[1].getAttribute('data-i18n'), 'chat.jd.promoAction');

  const i18nContext = { window: {} };
  vm.runInNewContext(i18n, i18nContext);
  assert.equal(
    i18nContext.window.I18N_MS['chat.jd.promo'],
    'Tampal huraian jawatan atau muatkan PDF/DOCX setempat. AIMeer menganalisis kesesuaian dengan AI dan memaparkan laporan padanan yang disokong bukti.'
  );
  assert.equal(i18nContext.window.I18N_MS['chat.jd.promoAction'], 'Buka mod padanan huraian jawatan');
});

test('JD matcher promotion is inserted once per chat session', async () => {
  const { context, elements } = createChatContext({ saveData: false });
  await loadChat(context);

  elements['chat-launcher'].dispatch('click');
  elements['chat-panel'].querySelector('.chat-close').dispatch('click');
  elements['chat-launcher'].dispatch('click');

  assert.equal(
    elements['chat-log'].children.filter((child) => child.id === 'chat-jd-promo').length,
    1,
    'reopening chat must not duplicate the recruiter promotion'
  );
});

test('JD matcher promotion action opens the matcher panel and its expanded toggle', async () => {
  const { context, elements } = createChatContext({ saveData: false });
  await loadChat(context);
  elements['chat-launcher'].dispatch('click');

  const promo = elements['chat-log'].children.find((child) => child.id === 'chat-jd-promo');
  promo.children[1].dispatch('click');

  assert.equal(elements['chat-jd-panel'].hidden, false);
  assert.equal(elements['chat-jd-toggle'].getAttribute('aria-expanded'), 'true');
  assert.equal(elements['chat-jd-input'].focused, true);
});

test('JD matcher promotion refreshes when the visitor changes the chat language', async () => {
  const { context, elements, setLanguage } = createChatContext({ saveData: false });
  await loadChat(context);
  elements['chat-launcher'].dispatch('click');
  const promo = elements['chat-log'].children.find((child) => child.id === 'chat-jd-promo');

  setLanguage('ms');
  assert.equal(
    promo.children[0].textContent,
    'Tampal huraian jawatan atau muatkan PDF/DOCX setempat. AIMeer menganalisis kesesuaian dengan AI dan memaparkan laporan padanan yang disokong bukti.'
  );
  assert.equal(promo.children[1].textContent, 'Buka mod padanan huraian jawatan');

  setLanguage('en');
  assert.equal(
    promo.children[0].textContent,
    'Paste a job description or load a local PDF/DOCX. AIMeer analyzes the fit with AI and shows an evidence-backed match report.'
  );
  assert.equal(promo.children[1].textContent, 'Open JD matcher');
});

test('JD matcher uses focused mode while retaining the AI progress card', async () => {
  const { context, elements } = createChatContext({ saveData: false });
  await loadChat(context);
  elements['chat-launcher'].dispatch('click');

  elements['chat-chips'].dispatch('click', elements['chat-jd-toggle']);
  assert.equal(elements['chat-panel'].classList.contains('chat-panel--jd-open'), true);
  assert.equal(elements['chat-jd-panel'].hidden, false);

  elements['chat-chips'].dispatch('click', elements['chat-jd-toggle']);
  assert.equal(elements['chat-panel'].classList.contains('chat-panel--jd-open'), false);
});

test('JD reasoning keeps local waiting state ahead of interim cloud fallback', async () => {
  const { context } = createChatContext({ saveData: false });
  await loadChat(context);

  assert.equal(context.window.AIMeerRecruiter.getReasoningMode({
    hasResult: true,
    hasNormalizedText: true,
    aiState: 'cloud',
    localOK: true,
    preferredMode: null,
    route: 'local',
    cloudOk: true,
    dlActive: true,
    hasEngine: false
  }), 'waiting');
});

test('JD scoring goes straight to secure cloud without waiting for the pending on-device download', async () => {
  const pendingDownload = deferred();
  const deterministicResult = buildDeterministicResult();
  const cloudCalls = [];
  const chatbotWithControlledWebLLM = chatbot.replace(
    'return import(WEBLLM_CDN).then(function (webllm) {',
    'return window.__importWebLLM(WEBLLM_CDN).then(function (webllm) {'
  );
  const { context, elements, progress } = createChatContext({
    saveData: false,
    fetchImpl(url, init) {
      const target = String(url);
      if (target.endsWith('aimeer-kb.txt')) return Promise.resolve(makeTextResponse('AIMeer knowledge base'));
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) {
        cloudCalls.push(JSON.parse(init.body));
        return Promise.resolve(makeJsonResponse({ reasoning: buildScoringModelOutput() }));
      }
      throw new Error(`Unexpected fetch: ${target}`);
    }
  });

  context.window.__importWebLLM = () => pendingDownload.promise;
  context.window.JDExtractor = {
    extract() {
      return Promise.resolve({ text: '', source: 'pdf', warnings: [] });
    },
    normalize(text) {
      return { normalizedText: text, warnings: [] };
    }
  };
  context.window.JDMatcher = {
    scoreJobDescription() {
      return clone(deterministicResult);
    }
  };
  vm.runInNewContext(jdReasoning, context);

  await loadChat(context, { source: chatbotWithControlledWebLLM });
  elements['chat-launcher'].dispatch('click');
  await flushAsync();
  assert.equal(progress.hidden, false, 'the on-device download should still be in flight');

  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC and cloud delivery ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  assert.equal(progress.hidden, false, 'JD scoring must not cancel or await the on-device download');
  assert.equal(cloudCalls.length, 1, 'scoring should reach the secure cloud even while the local model is downloading');
  assert.equal(cloudCalls[0].mode, 'jd-scoring');

  const rendered = collectText(elements['chat-jd-result']);
  assert.match(rendered, /secure cloud AI/i, 'the report should state that scoring used secure cloud AI');
  assert.doesNotMatch(rendered, /still getting ready/i, 'scoring never waits on the on-device model');
  assert.match(rendered, /container operations remain the one screening topic/i, 'the merged AI narrative should render');
});

test('JD scoring runs automatically on the cloud without a click, keeping the deterministic score visible while it works', async () => {
  const deterministicResult = buildDeterministicResult();
  const buildCalls = [];
  const validateCalls = [];
  const mergeCalls = [];
  const cloudCalls = [];
  const pendingScoring = deferred();
  let kbFetches = 0;
  let realMergedResult = null;
  const { context, elements, setLanguage } = createChatContext({
    saveData: true,
    fetchImpl(url, init) {
      const target = String(url);
      if (target.endsWith('aimeer-kb.txt')) {
        kbFetches += 1;
        return Promise.resolve(makeTextResponse('KB-CONTACT-FACT client account details and employer history'));
      }
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) {
        cloudCalls.push(JSON.parse(init.body));
        return pendingScoring.promise;
      }
      throw new Error(`Unexpected fetch: ${target}`);
    }
  });
  context.window.JDExtractor = {
    extract() {
      return Promise.resolve({ text: '', source: 'pdf', warnings: [] });
    },
    normalize(text) {
      return { normalizedText: text, warnings: [] };
    }
  };
  context.window.JDMatcher = {
    scoreJobDescription() {
      return clone(deterministicResult);
    }
  };
  vm.runInNewContext(jdReasoning, context);
  const realJDReasoning = context.window.JDReasoning;
  context.window.JDReasoning = {
    buildInput(normalized, result, profile, language) {
      buildCalls.push({ normalized, result, profile, language });
      return realJDReasoning.buildInput(normalized, result, profile, language);
    },
    validateModelOutput(raw, input) {
      validateCalls.push({ raw, input });
      return realJDReasoning.validateModelOutput(raw, input);
    },
    mergeResult(result, reasoning, input) {
      mergeCalls.push({ result, reasoning, input });
      realMergedResult = realJDReasoning.mergeResult(result, reasoning, input);
      return realMergedResult;
    }
  };

  await loadChat(context);
  await flushAsync();
  elements['chat-launcher'].dispatch('click');
  await flushAsync();

  elements['chat-jd-input'].value =
    'Need ASP.NET Core MVC and Kubernetes ownership. Expected salary range RM12,000 monthly plus medical insurance. Reporting into the Head of Engineering.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  const whileScoring = collectText(elements['chat-jd-result']);
  assert.equal(cloudCalls.length, 1, 'the deterministic pass should trigger cloud scoring on its own, with no user click');
  assert.equal(buildCalls.length, 1, 'the scoring payload should be built exactly once');
  assert.equal(kbFetches, 0, 'recruiter scoring must not fetch the general chat knowledge base');
  assert.match(whileScoring, /72%/, 'the deterministic score stays visible while AI scoring runs');
  assert.match(
    elements['chat-jd-status'].textContent,
    /AIMeer is analyzing the match with AI/,
    'the status line should announce that AI scoring is in flight'
  );

  assert.deepEqual(Object.keys(cloudCalls[0]).sort(), [
    'deterministicInput',
    'evidenceIds',
    'jdText',
    'language',
    'mode'
  ]);
  assert.equal(cloudCalls[0].mode, 'jd-scoring');
  assert.equal('messages' in cloudCalls[0], false, 'the Worker rejects client-supplied chat messages outright');
  assert.equal('system' in cloudCalls[0], false, 'the Worker assembles the system prompt itself');
  /* jdText is the posting's own prose, employer pay and benefits boilerplate included — the
     model needs the real wording to judge fit. Only a third party's personal identifiers are
     withheld, which tests/jd-reasoning.test.js pins directly. */
  assert.match(
    cloudCalls[0].jdText,
    /Reporting into the Head of Engineering/,
    'jdText should carry prose the extractor never turned into a requirement'
  );
  assert.match(
    cloudCalls[0].jdText,
    /Expected salary range RM12,000 monthly plus medical insurance/,
    'employer pay and benefits boilerplate is not private data and must reach the model'
  );

  pendingScoring.resolve(makeJsonResponse({ reasoning: buildScoringModelOutput() }));
  await flushAsync();

  const afterScoring = collectText(elements['chat-jd-result']);
  assert.equal(cloudCalls.length, 1, 'a valid first response must not trigger the retry');
  assert.equal(validateCalls.length, 1, 'the cloud scoring output should be validated');
  assert.equal(mergeCalls.length, 1, 'validated scoring should merge back over the deterministic result');
  assert.equal(realMergedResult.deterministicScore, deterministicResult.score, 'the merge should preserve the deterministic baseline');
  assert.equal(realMergedResult.aiScore, 78, 'the AI-led score should survive the merge');
  assert.equal(realMergedResult.finalScore, 78, 'a score inside the clamp band should pass through unchanged');
  assert.equal(realMergedResult.adjusted, false);
  assert.equal(realMergedResult.fitBand, 'strong');
  assert.equal(realMergedResult.requirementReasoning[1].evidenceRecords[0].claim, 'Owns release pipelines and cloud delivery workflows.');
  assert.ok(realMergedResult.sections.verifiedStrengths.length, 'the merge should emit verifiedStrengths');
  assert.ok(realMergedResult.sections.transferableAdvantages.length, 'the merge should emit transferableAdvantages');
  assert.match(afterScoring, /Strong fit/i, 'the report should lead with the fit band headline derived from the clamped finalScore');
  assert.doesNotMatch(afterScoring, /Calibrated against published evidence/i, 'the calibrated note must not appear when the AI score was not clamped');
  assert.match(afterScoring, /Owns release pipelines and cloud delivery workflows./i, 'the report should surface the resolved evidence claim');
  assert.match(afterScoring, /production Kubernetes rollout/i, 'the report should keep the recruiter-safe limitation text');
  assert.match(afterScoring, /What hands-on Kubernetes rollout, if any, has he completed directly\?/i);
  assert.match(afterScoring, /secure cloud AI/i, 'the report should state that scoring used secure cloud AI');
  assert.match(afterScoring, /Boundary: Published work does not yet confirm a production Kubernetes rollout\./i, 'the per-requirement detail card should still label the limitation as a boundary');
  assert.match(afterScoring, /Verification question: What hands-on Kubernetes rollout/i, 'the per-requirement detail card should still label the verification question');
  assert.match(afterScoring, /Azure DevOps release ownership/i, 'the resolved evidence record should surface its published source label');
  assert.match(afterScoring, /Verified strengths/i, 'the report should render the verified-strengths heading');
  assert.match(afterScoring, /Transferable advantages/i, 'the report should render the transferable-advantages heading');
  assert.match(afterScoring, /Verification questions/i, 'the report should render the deduped interview-question heading');
  assert.equal(
    elements['chat-jd-status'].textContent,
    'Match report ready from pasted text.',
    'the status line should settle once scoring finishes'
  );

  setLanguage('ms');
  const localized = collectText(elements['chat-jd-result']);
  assert.match(localized, /Padanan kukuh/i, 'the fit band headline should localize into formal Bahasa Melayu');
  assert.match(localized, /Kekuatan yang disahkan/i, 'the verified-strengths heading should localize into formal Bahasa Melayu');
  assert.match(localized, /awan selamat/i, 'the cloud scoring status should localize into formal Bahasa Melayu');
});

test('completed AI scoring renders each report section exactly once and drops the legacy deterministic-only heading', async () => {
  const deterministicResult = buildDeterministicResult();
  const { context, elements } = createChatContext({
    saveData: true,
    fetchImpl(url) {
      const target = String(url);
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) {
        return Promise.resolve(makeJsonResponse({
          reasoning: buildScoringModelOutput({
            narrative: 'Reasoning should not duplicate the deterministic partial matches section.'
          })
        }));
      }
      return Promise.resolve(makeTextResponse('AIMeer knowledge base'));
    }
  });
  context.window.JDExtractor = {
    extract() {
      return Promise.resolve({ text: '', source: 'pdf', warnings: [] });
    },
    normalize(text) {
      return { normalizedText: text, warnings: [] };
    }
  };
  context.window.JDMatcher = {
    scoreJobDescription() {
      return clone(deterministicResult);
    }
  };
  vm.runInNewContext(jdReasoning, context);

  await loadChat(context);
  await flushAsync();
  elements['chat-launcher'].dispatch('click');
  await flushAsync();

  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC and Kubernetes ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  const rendered = collectText(elements['chat-jd-result']);
  assert.match(
    rendered,
    /Adjacent cloud delivery shortens the ramp/i,
    'the merged AI reasoning should have rendered'
  );
  assert.equal(
    countNodes(
      elements['chat-jd-result'],
      (node) => node.tagName === 'H6' && node.textContent === 'Transferable advantages'
    ),
    1,
    'the AI-scored report should render the transferable advantages heading exactly once'
  );
  assert.doesNotMatch(
    rendered,
    /Partial or transferable matches/i,
    'the legacy deterministic-only "partial matches" heading must not appear in the AI-led report'
  );
});

test('a settled AI-scored report leads with the fit band, shows the calibrated note when the score was clamped, and the WhatsApp handoff is prefilled with the band, score, and top strengths', async () => {
  const deterministicResult = buildDeterministicResult();
  let openedUrl = null;
  const { context, elements } = createChatContext({
    saveData: true,
    fetchImpl(url) {
      const target = String(url);
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) return Promise.resolve(makeJsonResponse({ reasoning: '{}' }));
      return Promise.resolve(makeTextResponse('AIMeer knowledge base'));
    }
  });
  context.window.JDExtractor = {
    extract() {
      return Promise.resolve({ text: '', source: 'pdf', warnings: [] });
    },
    normalize(text) {
      return { normalizedText: text, warnings: [] };
    }
  };
  context.window.JDMatcher = {
    scoreJobDescription() {
      return clone(deterministicResult);
    }
  };
  context.window.JDReasoning = {
    buildInput(normalized, result, profile, language) {
      return { language, jdText: normalized.normalizedText, requirements: result.requirements || [], evidenceRegistry: profile.recruiterEvidence || [] };
    },
    validateModelOutput() {
      return { ok: true, reasoning: {} };
    },
    mergeResult(result) {
      return buildMergedResult(result, {
        finalScore: 65,
        aiScore: 90,
        adjusted: true,
        fitBand: 'good',
        reasoningNarrative: 'Adjacent cloud delivery narrows the gap on container operations.',
        sections: {
          verifiedStrengths: [
            { term: 'ASP.NET Core MVC', recruiterFraming: 'Directly published production evidence.' },
            { term: 'Azure DevOps', recruiterFraming: 'Owns release pipelines directly.' },
            { term: 'SQL Server', recruiterFraming: 'Published database design ownership.' }
          ],
          transferableAdvantages: [],
          explicitGaps: [],
          unverifiedRequirements: [],
          interviewQuestions: []
        }
      });
    }
  };
  context.window.open = (url) => { openedUrl = url; };

  await loadChat(context);
  await flushAsync();
  elements['chat-launcher'].dispatch('click');
  await flushAsync();
  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  const rendered = collectText(elements['chat-jd-result']);
  assert.match(rendered, /Good fit/i, 'the report should lead with the fit band headline');
  assert.match(rendered, /Adjacent cloud delivery narrows the gap on container operations/i, 'the narrative should render');
  assert.match(rendered, /65%/, 'the clamped final score should render, not the raw AI score or the deterministic baseline');
  assert.doesNotMatch(rendered, /90%/, 'the unclamped AI score must never render');
  assert.match(rendered, /Calibrated against published evidence/i, 'the calibrated note should render when the AI score was clamped');

  /* The handoff card renders inside the JD result panel itself (chat-jd-result), not into
     the chat log — the chat log is display:none while the JD panel is open (see I2), so a
     card appended there would never be visible to the recruiter looking at the report. */
  const handoffCards = jdHandoffCards(elements);
  assert.ok(handoffCards.length > 0, 'a settled AI-scored report should surface the WhatsApp/email handoff card inside the JD result panel');

  const waButton = handoffCards[handoffCards.length - 1].children[1].children[0];
  waButton.dispatch('click');
  await flushAsync();

  assert.ok(openedUrl, 'clicking WhatsApp should open a prefilled chat URL');
  const decoded = decodeURIComponent(openedUrl.split('text=')[1]);
  assert.match(decoded, /AIMeer match report — Good fit \(65%\)\./, 'the handoff prefill should lead with the fit band and the clamped score');
  assert.match(decoded, /Strengths: ASP\.NET Core MVC, Azure DevOps, SQL Server\./, 'the handoff prefill should list up to three verified strengths');
});

test('reopening the JD panel or toggling the site language after scoring has settled does not re-offer or duplicate the WhatsApp/email handoff card', async () => {
  const deterministicResult = buildDeterministicResult();
  const { context, elements, setLanguage } = createChatContext({
    saveData: true,
    fetchImpl(url) {
      const target = String(url);
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) return Promise.resolve(makeJsonResponse({ reasoning: buildScoringModelOutput() }));
      return Promise.resolve(makeTextResponse('AIMeer knowledge base'));
    }
  });
  context.window.JDExtractor = {
    extract() {
      return Promise.resolve({ text: '', source: 'pdf', warnings: [] });
    },
    normalize(text) {
      return { normalizedText: text, warnings: [] };
    }
  };
  context.window.JDMatcher = {
    scoreJobDescription() {
      return clone(deterministicResult);
    }
  };
  vm.runInNewContext(jdReasoning, context);

  await loadChat(context);
  await flushAsync();
  elements['chat-launcher'].dispatch('click');
  await flushAsync();
  elements['chat-chips'].dispatch('click', elements['chat-jd-toggle']);

  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC and Kubernetes ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  function countHandoffCards() {
    return jdHandoffCards(elements).length;
  }

  assert.equal(countHandoffCards(), 1, 'a settled AI-scored report should surface exactly one handoff card inside the JD result panel');

  /* Close, then reopen the JD panel: setRecruiterOpen(true) re-runs renderJdResult(), which
     clears and rebuilds chat-jd-result from scratch — so re-rendering can never duplicate
     the card the way appending to the persistent chat log could. */
  elements['chat-chips'].dispatch('click', elements['chat-jd-toggle']);
  elements['chat-chips'].dispatch('click', elements['chat-jd-toggle']);
  assert.equal(countHandoffCards(), 1, 'reopening the JD panel after scoring has settled must still show exactly one handoff card, not zero or duplicated');

  /* Toggling the site-wide language re-renders the JD report to relocalize it. */
  setLanguage('ms');
  assert.equal(countHandoffCards(), 1, 'toggling to Bahasa Melayu after scoring has settled must still show exactly one handoff card');
  setLanguage('en');
  assert.equal(countHandoffCards(), 1, 'toggling back to English must still show exactly one handoff card');
});

test('the settled handoff card renders inside the visible JD result panel, never the chat log the JD panel hides (I2)', async () => {
  const deterministicResult = buildDeterministicResult();
  const { context, elements } = createChatContext({
    saveData: true,
    fetchImpl(url) {
      const target = String(url);
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) return Promise.resolve(makeJsonResponse({ reasoning: buildScoringModelOutput() }));
      return Promise.resolve(makeTextResponse('AIMeer knowledge base'));
    }
  });
  context.window.JDExtractor = {
    extract() {
      return Promise.resolve({ text: '', source: 'pdf', warnings: [] });
    },
    normalize(text) {
      return { normalizedText: text, warnings: [] };
    }
  };
  context.window.JDMatcher = {
    scoreJobDescription() {
      return clone(deterministicResult);
    }
  };
  vm.runInNewContext(jdReasoning, context);

  await loadChat(context);
  await flushAsync();
  elements['chat-launcher'].dispatch('click');
  await flushAsync();
  elements['chat-chips'].dispatch('click', elements['chat-jd-toggle']);
  assert.equal(
    elements['chat-panel'].classList.contains('chat-panel--jd-open'),
    true,
    'the JD panel must be open for this assertion to mean anything — .chat-panel--jd-open .chat-log is display:none in style.css, and scoring always settles while the panel is open'
  );

  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC and Kubernetes ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  assert.equal(
    elements['chat-log'].children.some((child) => child.className && child.className.indexOf('chat-handoff') !== -1),
    false,
    'the settled handoff card must not land in chat-log — that container is CSS-hidden for the whole time the JD panel (and therefore this settled result) is on screen'
  );
  assert.equal(
    jdHandoffCards(elements).length,
    1,
    'the settled handoff card must land inside chat-jd-result, the container that is actually visible while the JD panel is open'
  );
});

test('the combined gaps list marks each item as an explicit gap or merely unverified, and the fallback handoff prefix uses a short label instead of the full report-headline sentence', async () => {
  const deterministicResult = buildDeterministicResult();
  const { context, elements } = createChatContext({
    saveData: true,
    fetchImpl(url) {
      const target = String(url);
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) return Promise.resolve(makeJsonResponse({ reasoning: buildScoringModelOutput() }));
      return Promise.resolve(makeTextResponse('AIMeer knowledge base'));
    }
  });
  context.window.JDExtractor = {
    extract() {
      return Promise.resolve({ text: '', source: 'pdf', warnings: [] });
    },
    normalize(text) {
      return { normalizedText: text, warnings: [] };
    }
  };
  context.window.JDMatcher = {
    scoreJobDescription() {
      return clone(deterministicResult);
    }
  };
  context.window.JDReasoning = {
    buildInput(normalized, result, profile, language) {
      return { language, jdText: normalized.normalizedText, requirements: result.requirements || [], evidenceRegistry: profile.recruiterEvidence || [] };
    },
    validateModelOutput() {
      return { ok: true, reasoning: {} };
    },
    mergeResult(result) {
      return buildMergedResult(result, {
        fitBand: 'partial',
        finalScore: 45,
        sections: {
          verifiedStrengths: [],
          transferableAdvantages: [],
          explicitGaps: [{ term: 'Salesforce Marketing Cloud', limitation: 'No published implementation evidence is available.' }],
          unverifiedRequirements: [{ term: 'Public speaking at conferences', limitation: 'Published profile does not verify this requirement.' }],
          interviewQuestions: []
        }
      });
    }
  };

  await loadChat(context);
  await flushAsync();
  elements['chat-launcher'].dispatch('click');
  await flushAsync();
  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  const rendered = collectText(elements['chat-jd-result']);
  assert.match(rendered, /Salesforce Marketing Cloud/i, 'the explicit-gap item should render');
  assert.match(rendered, /Published evidence gap/i, 'an explicit gap should carry the "published evidence gap" badge');
  assert.match(rendered, /Public speaking at conferences/i, 'the unverified item should render');
  assert.match(rendered, /Unverified/i, 'a merely-unverified requirement should carry the "unverified" badge, not the gap badge');

  const gapBadge = countNodes(elements['chat-jd-result'], (node) => node.className && node.className.indexOf('is-gap') !== -1);
  const unverifiedBadge = countNodes(elements['chat-jd-result'], (node) => node.className && node.className.indexOf('is-unverified') !== -1);
  assert.equal(gapBadge, 1, 'exactly one item should carry the is-gap badge class');
  assert.equal(unverifiedBadge, 1, 'exactly one item should carry the is-unverified badge class');

  const handoffCards = jdHandoffCards(elements);
  assert.ok(handoffCards.length > 0, 'a settled AI-scored report should surface the handoff card inside the JD result panel');
  let openedUrl = null;
  context.window.open = (url) => { openedUrl = url; };
  const waButton = handoffCards[handoffCards.length - 1].children[1].children[0];
  waButton.dispatch('click');
  await flushAsync();
  const decoded = decodeURIComponent(openedUrl.split('text=')[1]);
  assert.match(decoded, /AIMeer match report — Partial fit \(45%\)\./, 'the handoff prefill should use the fit band for a settled AI result');
});

test('a fallback (keyword-estimate) result prefills the handoff with a short label, not the full report-headline sentence', async () => {
  const { context, elements, cloudCalls } = createScoringFailureContext(
    () => Promise.reject(new TypeError('Failed to fetch'))
  );
  let openedUrl = null;
  context.window.open = (url) => { openedUrl = url; };

  await loadChat(context);
  await flushAsync();
  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();
  assert.equal(cloudCalls.length, 2, 'a network rejection should be retried exactly once before settling on the fallback');

  const handoffCards = jdHandoffCards(elements);
  assert.ok(handoffCards.length > 0, 'a settled fallback report should still surface the handoff card inside the JD result panel');
  const waButton = handoffCards[handoffCards.length - 1].children[1].children[0];
  waButton.dispatch('click');
  await flushAsync();

  assert.ok(openedUrl, 'clicking WhatsApp should open a prefilled chat URL');
  const decoded = decodeURIComponent(openedUrl.split('text=')[1]);
  assert.match(decoded, /AIMeer match report — Keyword estimate \(72%\)\./, 'the fallback handoff prefix should use the short label, not the full report-headline sentence');
  assert.doesNotMatch(decoded, /full AI analysis unavailable right now/i, 'the fallback handoff prefix must not run the full report-headline sentence into the summary');
});

test('in-flight AI scoring keeps its secure-cloud status after the visitor switches to on-device AI', async () => {
  const pendingScoring = deferred();
  const deterministicResult = buildDeterministicResult();
  const chatbotWithControlledWebLLM = chatbot.replace(
    'return import(WEBLLM_CDN).then(function (webllm) {',
    'return window.__importWebLLM(WEBLLM_CDN).then(function (webllm) {'
  );
  const { context, elements } = createChatContext({
    saveData: true,
    fetchImpl(url) {
      const target = String(url);
      if (target.endsWith('aimeer-kb.txt')) return Promise.resolve(makeTextResponse('AIMeer knowledge base'));
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) return pendingScoring.promise;
      throw new Error(`Unexpected fetch: ${target}`);
    }
  });
  context.window.__importWebLLM = () => new Promise(() => {});
  context.window.JDExtractor = {
    extract() {
      return Promise.resolve({ text: '', source: 'pdf', warnings: [] });
    },
    normalize(text) {
      return { normalizedText: text, warnings: [] };
    }
  };
  context.window.JDMatcher = {
    scoreJobDescription() {
      return clone(deterministicResult);
    }
  };
  context.window.JDReasoning = {
    buildInput(normalized, result, profile, language) {
      return {
        language,
        jdText: normalized.normalizedText,
        requirements: result.requirements || [],
        deterministicResult: result,
        evidenceRegistry: profile.recruiterEvidence || []
      };
    },
    validateModelOutput() {
      return { ok: true, reasoning: { narrative: 'cloud scoring', requirements: [], overall: { score: 78, fitBand: 'strong', narrative: 'cloud scoring' } } };
    },
    mergeResult(result) {
      return buildMergedResult(result, { reasoningNarrative: 'cloud scoring' });
    }
  };

  await loadChat(context, { source: chatbotWithControlledWebLLM });
  elements['chat-launcher'].dispatch('click');
  await flushAsync();
  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  elements['chat-model-local'].dispatch('click');
  pendingScoring.resolve(makeJsonResponse({ reasoning: '{"narrative":"cloud scoring","requirements":[]}' }));
  await flushAsync();

  const rendered = collectText(elements['chat-jd-result']);
  assert.match(rendered, /cloud scoring/, 'the merged cloud result should still render after the route change');
  assert.match(rendered, /secure cloud AI/i);
  assert.doesNotMatch(rendered, /on this device/i, 'the report must never claim that cloud scoring stayed on the device');
});

test('two failed cloud scoring attempts fall back to the deterministic estimate with localized status', async () => {
  const deterministicResult = buildDeterministicResult();
  const cloudCalls = [];
  const { context, elements, setLanguage } = createChatContext({
    saveData: true,
    fetchImpl(url, init) {
      const target = String(url);
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) {
        cloudCalls.push(JSON.parse(init.body));
        return Promise.resolve(makeJsonResponse({ reasoning: '{"invalid":true}' }));
      }
      return Promise.resolve(makeTextResponse('AIMeer knowledge base'));
    }
  });
  context.window.JDExtractor = {
    extract() {
      return Promise.resolve({ text: '', source: 'pdf', warnings: [] });
    },
    normalize(text) {
      return { normalizedText: text, warnings: [] };
    }
  };
  context.window.JDMatcher = {
    scoreJobDescription() {
      return clone(deterministicResult);
    }
  };
  context.window.JDReasoning = {
    buildInput(normalized, result, profile, language) {
      return {
        language,
        jdText: normalized.normalizedText,
        requirements: result.requirements || [],
        deterministicResult: result,
        evidenceRegistry: profile.recruiterEvidence || []
      };
    },
    validateModelOutput() {
      return { ok: false, error: 'invalid reasoning payload' };
    },
    mergeResult() {
      throw new Error('mergeResult should not run when validation fails');
    }
  };

  await loadChat(context);
  await flushAsync();
  setLanguage('ms');

  elements['chat-jd-input'].value = 'Perlu ASP.NET Core MVC dan pengalaman orkestrasi kontena.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  const rendered = collectText(elements['chat-jd-result']);
  assert.equal(cloudCalls.length, 2, 'an invalid response should be retried exactly once before falling back');
  cloudCalls.forEach((call) => {
    assert.deepEqual(Object.keys(call).sort(), [
      'deterministicInput',
      'evidenceIds',
      'jdText',
      'language',
      'mode'
    ]);
    assert.equal(call.mode, 'jd-scoring');
    assert.equal(call.language, 'ms');
    assert.equal(call.jdText, 'Perlu ASP.NET Core MVC dan pengalaman orkestrasi kontena.');
    assert.ok(call.deterministicInput);
    assert.equal(Array.isArray(call.deterministicInput.requirements), true);
    assert.equal(call.deterministicInput.deterministicResult.score, 72);
    assert.deepEqual(call.evidenceIds, ['ev-retailaim-plus', 'ev-azure-devops']);
    assert.equal('evidenceRegistry' in call, false);
    assert.equal('capabilityVocabulary' in call, false);
  });
  assert.match(rendered, /72%/, 'the deterministic score must remain visible after scoring fails');
  assert.match(rendered, /Anggaran kata kunci/i, 'the report should show the keyword-estimate headline instead of a fit band when scoring falls back');
  assert.match(rendered, /Penaakulan AI tidak dapat diselesaikan/i, 'the UI should show the localized fallback status');
  assert.match(rendered, /awan selamat/i, 'the cloud scoring status should be localized in Bahasa Melayu');
  assert.doesNotMatch(rendered, /Penaakulan mengikut keperluan/i, 'no AI reasoning sections should render on the fallback path');
  assert.doesNotMatch(rendered, /Kekuatan yang disahkan/i, 'the fallback path has no AI sections, so no verified-strengths heading should render');
  assert.ok(
    jdHandoffCards(elements).length > 0,
    'a settled fallback report should still surface the WhatsApp/email handoff card inside the JD result panel'
  );
});

/* Builds a chat context whose only variable is how the cloud endpoint fails, so the retry
   policy can be exercised one failure class at a time. */
function createScoringFailureContext(cloudResponder) {
  const deterministicResult = buildDeterministicResult();
  const cloudCalls = [];
  const harness = createChatContext({
    saveData: true,
    fetchImpl(url, init) {
      const target = String(url);
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) {
        cloudCalls.push(JSON.parse(init.body));
        return cloudResponder(cloudCalls.length);
      }
      return Promise.resolve(makeTextResponse('AIMeer knowledge base'));
    }
  });
  harness.context.window.JDExtractor = {
    extract() {
      return Promise.resolve({ text: '', source: 'pdf', warnings: [] });
    },
    normalize(text) {
      return { normalizedText: text, warnings: [] };
    }
  };
  harness.context.window.JDMatcher = {
    scoreJobDescription() {
      return clone(deterministicResult);
    }
  };
  harness.context.window.JDReasoning = {
    buildInput(normalized, result, profile, language) {
      return {
        language,
        jdText: normalized.normalizedText,
        requirements: result.requirements || [],
        deterministicResult: result,
        evidenceRegistry: profile.recruiterEvidence || []
      };
    },
    validateModelOutput() {
      return { ok: true, reasoning: { narrative: 'n', requirements: [], overall: { score: 78, fitBand: 'strong', narrative: 'n' } } };
    },
    mergeResult() {
      throw new Error('mergeResult should not run when the cloud call never succeeds');
    }
  };
  return { ...harness, cloudCalls };
}

test('a transport failure is retried once, then settles on the deterministic estimate', async () => {
  const { context, elements, cloudCalls } = createScoringFailureContext(
    () => Promise.reject(new TypeError('Failed to fetch'))
  );

  await loadChat(context);
  await flushAsync();
  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  assert.equal(cloudCalls.length, 2, 'a network rejection should be retried exactly once');
  const rendered = collectText(elements['chat-jd-result']);
  assert.match(rendered, /72%/, 'the deterministic score must survive an offline cloud');
  assert.match(rendered, /AI reasoning could not be completed/i, 'the fallback status should render');
  assert.equal(
    elements['chat-jd-status'].textContent,
    'Match report ready from pasted text.',
    'the status line must settle rather than stay on "analyzing"'
  );
});

/* A 4xx is the Worker refusing this exact payload — a privacy or shape violation. Repeating it
   is guaranteed to fail identically, and in the residual case it would re-transmit the same
   sensitive text a second time. */
test('a 4xx from the Worker is not retried', async () => {
  const { context, elements, cloudCalls } = createScoringFailureContext(
    () => Promise.resolve({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"error":"jd-privacy-invalid"}'),
      json: () => Promise.resolve({ error: 'jd-privacy-invalid' })
    })
  );

  await loadChat(context);
  await flushAsync();
  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  assert.equal(cloudCalls.length, 1, 'a deterministic 400 must not be sent a second time');
  assert.match(collectText(elements['chat-jd-result']), /72%/, 'the deterministic score stays visible');
  assert.equal(
    elements['chat-jd-status'].textContent,
    'Match report ready from pasted text.',
    'the status line must settle'
  );
});

/* The Worker's 502 body names which output-validation rule the model broke. That reason is the
   only way to diagnose a scoring failure that happens only in production, so it has to survive
   the trip into the console diagnostic. */
test('the Worker failure reason reaches the console diagnostic', async () => {
  const warnings = [];
  const { context, elements, cloudCalls } = createScoringFailureContext(
    () => Promise.resolve({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ error: 'reasoning-invalid', reason: 'capability-invalid' })
    })
  );
  context.console = { warn(...args) { warnings.push(args.map(String).join(' ')); } };
  context.window.console = context.console;

  await loadChat(context);
  await flushAsync();
  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  assert.equal(cloudCalls.length, 2, 'a 502 is still retried once');
  assert.equal(
    warnings.some((line) => line.includes('capability-invalid')),
    true,
    'the specific validation rule must appear in the console diagnostic, not just "cloud-502"'
  );
  assert.match(collectText(elements['chat-jd-result']), /72%/, 'the deterministic score still stands');
});

/* Guards the coupling between the message format and the retry regex: the reason is appended
   to the thrown "cloud-<status>" message, and an anchored /^cloud-4\d\d$/ would stop matching
   — silently re-sending a payload the Worker already refused, including on privacy grounds. */
test('a 4xx carrying a reason is still not retried', async () => {
  const { context, elements, cloudCalls } = createScoringFailureContext(
    () => Promise.resolve({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'jd-privacy-invalid', reason: 'jd-privacy-invalid' })
    })
  );

  await loadChat(context);
  await flushAsync();
  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  assert.equal(cloudCalls.length, 1, 'a refused payload must not be transmitted a second time');
  assert.equal(
    elements['chat-jd-status'].textContent,
    'Match report ready from pasted text.',
    'the status line must settle'
  );
});

test('a 5xx from the Worker is still retried once', async () => {
  const { context, elements, cloudCalls } = createScoringFailureContext(
    () => Promise.resolve({
      ok: false,
      status: 502,
      text: () => Promise.resolve('{"error":"ai-failed"}'),
      json: () => Promise.resolve({ error: 'ai-failed' })
    })
  );

  await loadChat(context);
  await flushAsync();
  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  assert.equal(cloudCalls.length, 2, 'a transient upstream failure deserves the retry');
  assert.match(collectText(elements['chat-jd-result']), /72%/, 'the deterministic score stays visible');
});

test('a stale recruiter reasoning response cannot replace a newer JD result', async () => {
  const firstReasoning = deferred();
  const firstResult = buildDeterministicResult({
    score: 72,
    strongMatches: [{ term: 'ASP.NET Core MVC', label: 'Published multi-tenant delivery evidence is present.', evidenceType: 'professional', evidence: ['RetailAIM Plus multi-tenant delivery'] }]
  });
  const secondResult = buildDeterministicResult({
    score: 58,
    strongMatches: [{ term: 'React', label: 'Published React delivery evidence is present.', evidenceType: 'professional', evidence: ['RetailAIM Plus multi-tenant delivery'] }],
    partialMatches: [{ term: 'Salesforce', label: 'Adjacent integration evidence exists.', evidenceType: 'professional', evidence: ['Azure DevOps release ownership'] }]
  });
  const mergedFirst = buildMergedResult(firstResult, {
    reasoningNarrative: 'Old reasoning should never replace the newer JD result.'
  });
  const mergedSecond = buildMergedResult(secondResult, {
    deterministicScore: 58,
    verifiedScore: 54,
    transferableScore: 63,
    compositeScore: 63,
    reasoningNarrative: 'Second reasoning placeholder.',
    sections: {
      verifiedStrengths: [{ term: 'React', recruiterFraming: 'Newer JD strengths must take priority over the stale analysis.' }],
      transferableAdvantages: [],
      explicitGaps: [],
      unverifiedRequirements: [],
      interviewQuestions: []
    }
  });
  let requestCount = 0;
  const { context, elements } = createChatContext({
    saveData: true,
    fetchImpl(url, init) {
      const target = String(url);
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) {
        requestCount += 1;
        if (requestCount === 1) return firstReasoning.promise;
        return Promise.resolve(makeJsonResponse({ reasoning: JSON.stringify({ narrative: 'newer reasoning', requirements: [] }) }));
      }
      return Promise.resolve(makeTextResponse('AIMeer knowledge base'));
    }
  });
  context.window.JDExtractor = {
    extract() {
      return Promise.resolve({ text: '', source: 'pdf', warnings: [] });
    },
    normalize(text) {
      return { normalizedText: text, warnings: [] };
    }
  };
  context.window.JDMatcher = {
    scoreJobDescription(normalized) {
      return normalized.normalizedText.includes('React') ? clone(secondResult) : clone(firstResult);
    }
  };
  context.window.JDReasoning = {
    buildInput(normalized, result, profile, language) {
      return {
        language,
        jdText: normalized.normalizedText,
        requirements: result.requirements || [],
        evidenceRegistry: profile.recruiterEvidence || []
      };
    },
    validateModelOutput() {
      return {
        ok: true,
        reasoning: {
          narrative: 'validated reasoning',
          requirements: []
        }
      };
    },
    mergeResult(result) {
      return clone(result.score === 58 ? mergedSecond : mergedFirst);
    }
  };

  await loadChat(context);
  await flushAsync();

  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();
  assert.equal(requestCount, 1, 'the first analysis should start its own cloud scoring request');

  elements['chat-jd-input'].value = 'Need React architecture ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  const beforeOldResponse = collectText(elements['chat-jd-result']);
  assert.match(beforeOldResponse, /58%/, 'the newer deterministic result should already be visible');
  assert.match(beforeOldResponse, /React/i, 'the newer JD result should replace the earlier deterministic content');

  firstReasoning.resolve(makeJsonResponse({ reasoning: JSON.stringify({ narrative: 'stale cloud reasoning', requirements: [] }) }));
  await flushAsync();

  const afterOldResponse = collectText(elements['chat-jd-result']);
  assert.match(afterOldResponse, /58%/, 'the stale reasoning response must not replace the newer deterministic score');
  assert.match(afterOldResponse, /React/i, 'the newer JD content must remain visible after the stale response resolves');
  assert.doesNotMatch(afterOldResponse, /Old reasoning should never replace the newer JD result/i);
});

test('a language change invalidates an in-flight recruiter reasoning response', async () => {
  const pendingReasoning = deferred();
  let mergeCalls = 0;
  const deterministicResult = buildDeterministicResult();
  const { context, elements, setLanguage } = createChatContext({
    saveData: true,
    fetchImpl(url) {
      const target = String(url);
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) return pendingReasoning.promise;
      return Promise.resolve(makeTextResponse('AIMeer knowledge base'));
    }
  });
  context.window.JDExtractor = {
    extract() {
      return Promise.resolve({ text: '', source: 'pdf', warnings: [] });
    },
    normalize(text) {
      return { normalizedText: text, warnings: [] };
    }
  };
  context.window.JDMatcher = {
    scoreJobDescription() {
      return clone(deterministicResult);
    }
  };
  context.window.JDReasoning = {
    buildInput(normalized, result, profile, language) {
      return { language, jdText: normalized.normalizedText, requirements: result.requirements || [], evidenceRegistry: profile.recruiterEvidence || [] };
    },
    validateModelOutput() {
      return { ok: true, reasoning: { narrative: 'stale language reasoning', requirements: [] } };
    },
    mergeResult() {
      mergeCalls += 1;
      return buildMergedResult(deterministicResult, { reasoningNarrative: 'stale language reasoning' });
    }
  };

  await loadChat(context);
  await flushAsync();
  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  setLanguage('ms');
  pendingReasoning.resolve(makeJsonResponse({ reasoning: JSON.stringify({ narrative: 'stale language reasoning', requirements: [] }) }));
  await flushAsync();

  assert.equal(mergeCalls, 0, 'a response generated for the old language must not merge');
  const renderedMs = collectText(elements['chat-jd-result']);
  assert.match(renderedMs, /72%/);
  assert.doesNotMatch(renderedMs, /stale language reasoning/i);
  assert.equal(
    elements['chat-jd-status'].textContent,
    'Laporan padanan sedia daripada teks tampalan.',
    'the status line must not stay stuck on the AI-analyzing message after the language change'
  );
  /* I3: a mid-flight language toggle used to reset jdState.reasoningMode to "" and fall
     back to computeJdReasoningMode(aiState, route, ...) at render time, which could report
     "local"/"waiting" (borrowed from the general chat tier) even though recruiter reasoning
     is cloud-only and nothing runs on-device here. The report settles into the keyword-only
     fallback for this new language, so it must never claim reasoning ran, or will run, on
     this device — in either language. */
  assert.doesNotMatch(renderedMs, /peranti ini/i, 'the settled fallback after a mid-flight language toggle must never claim reasoning ran or will run on this device');
  assert.match(renderedMs, /Penaakulan perekrut tidak tersedia sekarang/i, 'the localized "unavailable" status should render for the new language, not a claim tied to any device state');
  /* The privacy line is a second, independent claim from the status line above it, and it
     used to be wrong here too: reasoningBusy goes true synchronously, well before the fetch
     to the Worker fires and stays true for the whole round trip, so a toggle landing inside
     that window (this test's scenario, via the pendingReasoning deferred) settles into
     "unavailable" mode AFTER the JD prose has plausibly already left the device. The privacy
     copy must not assert what happened to the DATA (which cannot be known at this point) —
     only what happened to the RESULT. */
  assert.doesNotMatch(
    renderedMs,
    /dihantar/i,
    'the "unavailable" privacy line must not claim anything about whether data was or was not transmitted — the request may already be in flight to the Worker when this state renders'
  );
  assert.match(
    renderedMs,
    /Analisis ini tidak dapat diselesaikan, jadi tiada keputusan AI dipaparkan/i,
    'the localized "unavailable" privacy line should describe the missing result, not a data-transmission claim'
  );

  setLanguage('en');
  const renderedEn = collectText(elements['chat-jd-result']);
  assert.doesNotMatch(renderedEn, /on this device/i, 'toggling back to English after that settled fallback must not claim on-device reasoning either');
  assert.match(renderedEn, /Recruiter reasoning is unavailable right now/i, 'the English "unavailable" status should render after toggling back');
  assert.doesNotMatch(
    renderedEn,
    /(?:content|prose|text) was (?:not )?sent/i,
    'the "unavailable" privacy line must not claim anything about whether data was or was not transmitted, in English either'
  );
  assert.match(
    renderedEn,
    /This analysis could not be completed, so no AI result is shown/i,
    'the English "unavailable" privacy line should describe the missing result, not a data-transmission claim'
  );
});

test('selecting eligible local AI presents Local while the active route is cloud', async () => {
  const { context, elements, stored } = createChatContext();
  await loadChat(context);

  assert.equal(elements['chat-model-cloud'].getAttribute('aria-pressed'), 'true');
  elements['chat-model-local'].dispatch('click');

  assert.equal(elements['chat-model-local'].getAttribute('aria-pressed'), 'true');
  assert.equal(elements['chat-model-cloud'].getAttribute('aria-pressed'), 'false');
  assert.equal(stored.has('aimeer-route'), false);
});

test('legacy persisted cloud is cleared and eligible desktop defaults to local', async () => {
  const { context, elements, stored, progress } = createChatContext({
    storage: { 'aimeer-route': 'cloud' },
    saveData: false
  });

  await loadChat(context);
  assert.equal(stored.has('aimeer-route'), false);
  elements['chat-launcher'].dispatch('click');

  assert.equal(elements['chat-model-local'].getAttribute('aria-pressed'), 'true');
  assert.equal(elements['chat-model-cloud'].getAttribute('aria-pressed'), 'false');
  assert.equal(elements['chat-status'].className, 'chat-status chat-status-loading');
  assert.equal(progress.hidden, false);
});

test('welcome callout still schedules its delayed reveal after prior dismissal', async () => {
  const { context, elements, timers } = createChatContext({
    storage: { 'aimeer-callout': '1' }
  });

  await loadChat(context);

  const reveal = timers.find((timer) => timer.delay === 1800);
  assert.ok(reveal, 'the welcome callout should schedule its delayed reveal on every load');
  reveal.fn();
  assert.equal(elements['chat-callout'].hidden, false);
  assert.equal(elements['chat-callout'].classList.contains('show'), true);
});

test('welcome callout markup and click handler remain present', () => {
  assert.match(
    html,
    /<div class="chat-callout" id="chat-callout" hidden>[\s\S]*?<button class="chat-callout-close"[^>]*>[\s\S]*?<\/button>[\s\S]*?<\/div>/,
    'the page should retain the dismissible welcome callout markup'
  );
  assert.match(
    chatbot,
    /callout\.addEventListener\("click", function \(e\) \{[\s\S]*?hideCallout\(true\);[\s\S]*?openPanel\(\);[\s\S]*?\}\);/,
    'the welcome callout should retain its dismiss/open click handler'
  );
});

test('legacy persisted local is cleared and Save-Data still prefers cloud', async () => {
  const { context, elements, stored, progress } = createChatContext({
    storage: { 'aimeer-route': 'local' },
    saveData: true
  });

  await loadChat(context);
  assert.equal(stored.has('aimeer-route'), false);
  elements['chat-launcher'].dispatch('click');

  assert.equal(elements['chat-model-cloud'].getAttribute('aria-pressed'), 'true');
  assert.equal(elements['chat-model-local'].getAttribute('aria-pressed'), 'false');
  assert.equal(stored.has('aimeer-route'), false);
  assert.equal(progress.hidden, true);
  assert.equal(elements['chat-status'].className, 'chat-status chat-status-cloud');
});

test('stale local preference on ineligible Android is invalidated and routed to cloud', async () => {
  const { context, elements, stored } = createChatContext({
    storage: { 'aimeer-route': 'local' },
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Generic Phone) AppleWebKit/537.36',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    saveData: false
  });

  await loadChat(context);
  elements['chat-launcher'].dispatch('click');

  assert.equal(elements['chat-model-cloud'].getAttribute('aria-pressed'), 'true');
  assert.equal(elements['chat-model-local'].getAttribute('aria-pressed'), 'false');
  assert.equal(stored.has('aimeer-route'), false);
  assert.equal(elements['chat-status'].className, 'chat-status chat-status-cloud');
});

test('switching to cloud while local download is active cancels the download state without persistence', async () => {
  const { context, elements, stored, progress, timers, clearedTimers } = createChatContext({
    saveData: false
  });

  await loadChat(context);
  elements['chat-launcher'].dispatch('click');
  assert.equal(progress.hidden, false);

  elements['chat-model-cloud'].dispatch('click');

  assert.equal(stored.has('aimeer-route'), false);
  assert.equal(elements['chat-model-cloud'].getAttribute('aria-pressed'), 'true');
  assert.equal(elements['chat-model-local'].getAttribute('aria-pressed'), 'false');
  assert.equal(progress.hidden, true);
  assert.equal(elements['chat-status'].className, 'chat-status chat-status-cloud');
  assert.ok(clearedTimers.includes(timers.find((timer) => timer.delay === 20000).id));
});

test('canceling local download keeps the cloud route session-only without persistence', async () => {
  const { context, elements, stored, progress } = createChatContext({
    saveData: false
  });

  await loadChat(context);
  elements['chat-launcher'].dispatch('click');
  assert.equal(progress.hidden, false);

  elements['chat-ai-cancel'].dispatch('click');

  assert.equal(stored.has('aimeer-route'), false);
  assert.equal(elements['chat-model-cloud'].getAttribute('aria-pressed'), 'true');
  assert.equal(elements['chat-model-local'].getAttribute('aria-pressed'), 'false');
  assert.equal(progress.hidden, true);
  assert.equal(elements['chat-status'].className, 'chat-status chat-status-cloud');
});

test('a stale canceled local download cannot mark a later local start ready', async () => {
  const firstEngine = deferred();
  const secondEngine = deferred();
  const engineCalls = [];
  let firstUnloaded = false;
  const chatbotWithControlledWebLLM = chatbot.replace(
    'return import(WEBLLM_CDN).then(function (webllm) {',
    'return window.__importWebLLM(WEBLLM_CDN).then(function (webllm) {'
  );
  assert.notEqual(chatbotWithControlledWebLLM, chatbot, 'the test harness should control the WebLLM import');
  const { context, elements, progress } = createChatContext({
    saveData: false,
    fetchText: 'AIMeer test knowledge base'
  });
  context.window.__importWebLLM = (specifier) => {
    assert.equal(specifier, 'https://esm.run/@mlc-ai/web-llm@0.2.79');
    return Promise.resolve({
      CreateMLCEngine(model, options) {
        return createEngine(model, options);
      }
    });
  };
  function createEngine(model, options) {
    engineCalls.push({ model, options });
    return engineCalls.length === 1 ? firstEngine.promise : secondEngine.promise;
  }

  await loadChat(context, { source: chatbotWithControlledWebLLM });
  await flushAsync();
  elements['chat-launcher'].dispatch('click');
  await flushAsync();
  assert.equal(engineCalls.length, 1, 'the first local start should begin WebLLM init');

  elements['chat-model-cloud'].dispatch('click');
  elements['chat-model-local'].dispatch('click');
  await flushAsync();
  assert.equal(engineCalls.length, 2, 'selecting Local again should begin a fresh WebLLM init');
  assert.equal(elements['chat-status'].className, 'chat-status chat-status-loading');
  assert.equal(progress.hidden, false);

  firstEngine.resolve({ unload() { firstUnloaded = true; } });
  await flushAsync();

  assert.equal(firstUnloaded, true, 'the stale engine should be unloaded when it resolves');
  assert.equal(elements['chat-status'].className, 'chat-status chat-status-loading');
  assert.equal(progress.hidden, false);
  assert.equal(elements['chat-model-local'].getAttribute('aria-pressed'), 'true');
});

test('canceling while local setup is pending does not import WebLLM or create an engine', async () => {
  const setupKb = deferred();
  const setupAdapter = deferred();
  let importCalls = 0;
  let engineCalls = 0;
  const chatbotWithControlledWebLLM = chatbot.replace(
    'return import(WEBLLM_CDN).then(function (webllm) {',
    'return window.__importWebLLM(WEBLLM_CDN).then(function (webllm) {'
  );
  const capableAdapter = { limits: { maxBufferSize: 1_500_000_000 }, features: new Set(['shader-f16']) };
  const { context, elements, progress } = createChatContext({
    saveData: false,
    fetchPromise: setupKb.promise,
    adapterResults: [
      Promise.resolve(capableAdapter),
      setupAdapter.promise
    ]
  });
  context.window.__importWebLLM = () => {
    importCalls += 1;
    return Promise.resolve({
      CreateMLCEngine() {
        engineCalls += 1;
        return new Promise(() => {});
      }
    });
  };

  await loadChat(context, { source: chatbotWithControlledWebLLM });
  await flushAsync();
  elements['chat-launcher'].dispatch('click');
  await flushAsync();
  assert.equal(progress.hidden, false);

  elements['chat-model-cloud'].dispatch('click');
  assert.equal(elements['chat-status'].className, 'chat-status chat-status-cloud');
  assert.equal(progress.hidden, true);

  setupKb.resolve({
    ok: true,
    text: () => Promise.resolve('AIMeer delayed setup knowledge base')
  });
  setupAdapter.resolve(capableAdapter);
  await flushAsync();

  assert.equal(importCalls, 0, 'canceled setup must not import WebLLM');
  assert.equal(engineCalls, 0, 'canceled setup must not create a WebLLM engine');
  assert.equal(elements['chat-status'].className, 'chat-status chat-status-cloud');
});

test('model segments retain 44px touch targets in narrow panels', () => {
  assert.match(
    css,
    /\.chat-model-choice\s*\{[\s\S]*?width:\s*44px;[\s\S]*?min-height:\s*44px;/,
    'each segment should provide a 44px touch target'
  );
  assert.doesNotMatch(
    css,
    /@media\s*\(max-width:\s*390px\)\s*\{[\s\S]*?\.chat-model-choice\s*\{[\s\S]*?(?:width|min-height):\s*(?:3[0-9]|[12][0-9])px;/,
    'the narrow-panel rule should not shrink touch targets below 44px'
  );
});

test('shared press feedback includes theme-safe brightness and shadow adjustments', () => {
  assert.match(
    css,
    /\.btn:active,[\s\S]*?\.chat-send:active\s*\{[\s\S]*?transform:\s*translateY\(1px\) scale\(0\.98\);[\s\S]*?filter:\s*brightness\([^)]*\);[\s\S]*?box-shadow:\s*[^;]*var\(--shadow\)[^;]*;/,
    'the shared active rule should combine scale, brightness, and token-based shadow feedback'
  );
});

test('reduced motion removes chat model choice press scale', () => {
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.chat-model-choice:active[\s\S]*?\{[^}]*transform:\s*none;/,
    'the global reduced-motion active override should include chat model choices'
  );
});
