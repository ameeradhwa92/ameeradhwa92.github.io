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
    dispatch(type, target = this, extra = {}) { const listener = listeners.get(type); if (listener) listener({ key: type, target, preventDefault() {}, ...extra }); },
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
    'chat-status', 'chat-callout', 'chat-jd-toggle', 'chat-jd-drop',
    'chat-jd-panel', 'chat-jd-input', 'chat-jd-file', 'chat-jd-file-trigger',
    'chat-jd-file-name', 'chat-jd-analyze', 'chat-jd-clear', 'chat-jd-disclaimer',
    'chat-jd-status', 'chat-jd-progress', 'chat-jd-result'
  ].forEach((id) => { elements[id] = createElement(); elements[id].id = id; });
  const statusText = createElement();
  const close = createElement('button');
  const stored = new Map(Object.entries(options.storage || {}));
  const timers = [];
  const clearedTimers = [];

  elements['chat-status'].querySelector = () => statusText;
  elements['chat-panel'].querySelector = (selector) => ({
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
    addEventListener() {}
  };
  if (options.cloudEndpoint !== undefined) window.AIMEER_CLOUD_ENDPOINT = options.cloudEndpoint;
  const context = {
    window,
    document,
    navigator: {},
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
    statusText,
    setLanguage(language) {
      root.dataset.lang = language;
      observers.forEach((observer) => observer());
    }
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

test('JD matcher promotion provides English localization hooks and formal Bahasa Melayu strings', async () => {
  const { context, elements } = createChatContext();
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
  const { context, elements } = createChatContext();
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
  const { context, elements } = createChatContext();
  await loadChat(context);
  elements['chat-launcher'].dispatch('click');

  const promo = elements['chat-log'].children.find((child) => child.id === 'chat-jd-promo');
  promo.children[1].dispatch('click');

  assert.equal(elements['chat-jd-panel'].hidden, false);
  assert.equal(elements['chat-jd-toggle'].getAttribute('aria-expanded'), 'true');
  assert.equal(elements['chat-jd-input'].focused, true);
});

test('JD matcher promotion refreshes when the visitor changes the chat language', async () => {
  const { context, elements, setLanguage } = createChatContext();
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
  const { context, elements } = createChatContext();
  await loadChat(context);
  elements['chat-launcher'].dispatch('click');

  elements['chat-chips'].dispatch('click', elements['chat-jd-toggle']);
  assert.equal(elements['chat-panel'].classList.contains('chat-panel--jd-open'), true);
  assert.equal(elements['chat-jd-panel'].hidden, false);

  elements['chat-chips'].dispatch('click', elements['chat-jd-toggle']);
  assert.equal(elements['chat-panel'].classList.contains('chat-panel--jd-open'), false);
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

test('two failed cloud scoring attempts fall back to the deterministic estimate with localized status', async () => {
  const deterministicResult = buildDeterministicResult();
  const cloudCalls = [];
  const { context, elements, setLanguage } = createChatContext({
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

test('shared press feedback includes theme-safe brightness and shadow adjustments', () => {
  assert.match(
    css,
    /\.btn:active,[\s\S]*?\.chat-send:active\s*\{[\s\S]*?transform:\s*translateY\(1px\) scale\(0\.98\);[\s\S]*?filter:\s*brightness\([^)]*\);[\s\S]*?box-shadow:\s*[^;]*var\(--shadow\)[^;]*;/,
    'the shared active rule should combine scale, brightness, and token-based shadow feedback'
  );
});

/* The score and its confidence must describe the same pass. On the AI path the label comes from
   the model's own per-requirement confidence; on the fallback path the keyword ratio IS what the
   displayed number means, so it stays. */
test('recruiter report takes confidence from whichever pass produced the score', async () => {
  const { context } = createChatContext();
  await loadChat(context);
  const resolve = context.window.AIMeerRecruiter.resolveConfidenceLevel;

  const aiResult = { finalScore: 82, aiConfidence: 'medium' };
  const baseline = { score: 48, confidence: { label: 'low' } };

  assert.equal(resolve('ai', aiResult, baseline), 'medium',
    'a merged AI report should report the AI confidence');
  assert.equal(resolve('fallback', { score: 48 }, baseline), 'low',
    'the keyword estimate should keep the keyword confidence');
  assert.equal(resolve('pending', { score: 48 }, baseline), 'low',
    'before the AI settles there is no AI confidence to show');

  /* A merged report whose requirements carried no usable confidence has no aiConfidence at all.
     Falling back beats inventing one. */
  assert.equal(resolve('ai', { finalScore: 82 }, baseline), 'low');
  assert.equal(resolve('ai', { finalScore: 82, aiConfidence: '' }, baseline), 'low');
  assert.equal(resolve('ai', null, null), '');
});

/* Analyze match starts a cloud round trip that can run ten seconds or more — two model calls
   server-side plus one silent retry. A line of text alone made a slow analysis indistinguishable
   from a hang. The bar is derived from statusKind rather than tracked separately, so there is no
   second piece of state to fall out of sync. */
test('the recruiter progress bar is visible exactly while the matcher is working', async () => {
  const { context } = createChatContext();
  await loadChat(context);
  const visible = context.window.AIMeerRecruiter.isJdProgressVisible;

  for (const working of ['reading', 'scoring', 'aiScoring', 'aiRetrying']) {
    assert.equal(visible(working), true, `${working} is an in-flight phase`);
  }
  for (const settled of ['idle', 'loaded', 'pasted', 'scored', 'error', '', undefined]) {
    assert.equal(visible(settled), false, `${settled} is not an in-flight phase`);
  }
});

/* The two tests above only exercise the pure helpers. Neither asserts they are actually wired
   into the real render path — deleting the renderJdProgress() call in renderJdStatus, or
   reverting the confidence line back to the unconditional baseline label, would leave both
   helper-level tests green while the visible behaviour regressed. This test drives the real
   click-through flow (extractor/matcher/JDReasoning wired up, a deferred cloud fetch) so it fails
   if either call site is removed. */
test('the recruiter progress bar call site shows it during AI scoring and hides it once settled, and the merged AI confidence call site overrides the keyword estimate', async () => {
  const deterministicResult = buildDeterministicResult({
    confidence: { label: 'low', reasons: ['Published evidence covers core requirements.'] }
  });
  const pendingScoring = deferred();
  const { context, elements } = createChatContext({
    fetchImpl(url) {
      const target = String(url);
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) return pendingScoring.promise;
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

  /* Idle, before the panel is even used: not an in-flight phase, so the call site must hide it. */
  assert.equal(elements['chat-jd-progress'].hidden, true,
    'the progress bar must be hidden while the matcher is idle');

  elements['chat-launcher'].dispatch('click');
  await flushAsync();

  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC and Kubernetes ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  assert.equal(elements['chat-jd-progress'].hidden, false,
    'the progress bar must be visible while AI scoring is in flight — call-site coverage for isJdProgressVisible');
  const whileScoring = collectText(elements['chat-jd-result']);
  assert.match(whileScoring, /Confidence: Low/,
    'before the AI result merges, the report should still show the keyword-pass confidence');

  /* Both requirements report "medium" so aggregateAiConfidence's mean lands at exactly 0.5 —
     comfortably inside the "medium" band and unambiguously different from the deterministic
     baseline's "low", so the assertion below can only pass if the AI value actually replaced it. */
  const scoringOutput = buildScoringModelOutput({
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
        confidence: 'medium'
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
    ]
  });
  pendingScoring.resolve(makeJsonResponse({ reasoning: scoringOutput }));
  await flushAsync();

  assert.equal(elements['chat-jd-progress'].hidden, true,
    'the progress bar must hide once AI scoring settles — call-site coverage for isJdProgressVisible');
  const afterScoring = collectText(elements['chat-jd-result']);
  assert.match(afterScoring, /Confidence: Medium/,
    'the merged AI confidence must override the keyword-pass confidence — call-site coverage for resolveConfidenceLevel');
  assert.doesNotMatch(afterScoring, /Confidence: Low/,
    'the stale keyword-pass confidence must not remain once the AI result has merged');
});

/* The retry is a second full round trip that previously only reached console.warn. Leaving it
   unlabelled is what made a slow run look like a dead one. */
test('the retry phase has copy in both languages', () => {
  /* Counting definitions rather than slicing the T table by indentation: a missing MS key leaves
     English on screen silently, and one definition means exactly that happened. The `: "` suffix
     keeps the t("jdAiStatusRetrying") call site out of the count. */
  const definitions = chatbot.match(/jdAiStatusRetrying:\s*"/g) || [];
  assert.equal(definitions.length, 2,
    'jdAiStatusRetrying needs an entry in both the en and ms branches of T');
});

/* Project rule: prefers-reduced-motion must disable animation everywhere. */
test('the progress bar animation is disabled under reduced motion', () => {
  const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g;
  const blocks = css.match(block) || [];
  assert.ok(blocks.some((rule) => /\.chat-jd-progress-bar[^{]*\{[^}]*animation:\s*none/.test(rule)),
    'a reduced-motion block must set animation: none on .chat-jd-progress-bar');
});

/* The settle fade is a transition now, not an animation — reduced-motion must disable it too,
   or the bubble still visibly fades when a reply settles. Both halves of the mechanism need
   neutralizing: .chat-msg's transition (or the fade never plays) and .chat-msg-settle's opacity
   (or a settle that lands mid-transition would still render at 0.4). */
test('the settle fade is disabled under reduced motion', () => {
  const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g;
  const blocks = css.match(block) || [];
  assert.ok(blocks.some((rule) => /\.chat-msg\b[^{]*\{[^}]*transition:\s*none/.test(rule)),
    'a reduced-motion block must set transition: none on .chat-msg');
  assert.ok(blocks.some((rule) => /\.chat-msg-settle\b[^{]*\{[^}]*opacity:\s*1\b/.test(rule)),
    'a reduced-motion block must neutralize .chat-msg-settle back to opacity: 1');
});

/* The chat read as dated because nothing moved at the moments a conversation has beats: addMsg
   appended a bubble and set scrollTop directly, so bubbles appeared instantly and the log jumped.
   A restrained ease-out was chosen over an iMessage-style overshoot — next to the site's editorial
   typography a bounce reads as toy-like. */
test('chat bubbles animate in from their own corner', () => {
  assert.match(css, /@keyframes chat-msg-in\s*\{[\s\S]*?scale\(0\.96\)/,
    'chat-msg-in should scale up from 0.96');
  assert.match(css, /\.chat-msg\b[^{]*\{[^}]*animation:\s*chat-msg-in/,
    '.chat-msg should use the entrance animation');
  assert.match(css, /\.chat-msg-bot\b[^{]*\{[^}]*transform-origin:\s*bottom left/,
    'bot bubbles should grow from the bottom-left');
  assert.match(css, /\.chat-msg-user\b[^{]*\{[^}]*transform-origin:\s*bottom right/,
    'user bubbles should grow from the bottom-right');
});

/* .chat-msg-settle used to be its own `animation`. Equal specificity, later in source, and
   `animation` is a shorthand, so applying the settle class cancelled the entrance mid-flight
   the moment a reply resolved fast enough (e.g. WebLLM's .catch running instantAnswer
   synchronously). The fix moved the settle fade to a transition on .chat-msg instead, so this
   asserts the clobber can no longer happen: .chat-msg-settle must not set the animation shorthand
   on the same element. */
test('the settle fade cannot clobber the bubble entrance animation', () => {
  assert.match(css, /\.chat-msg\b[^{]*\{[^}]*transition:\s*opacity/,
    '.chat-msg should carry the opacity transition the settle fade rides on');
  const rule = css.match(/\.chat-msg-settle\s*\{[^}]*\}/);
  assert.ok(rule, '.chat-msg-settle rule should exist');
  assert.doesNotMatch(rule[0], /animation\s*:/,
    '.chat-msg-settle must not set the animation shorthand — that is what cancelled the entrance');
});

/* .chat-jd-progress[hidden] used to be display: none, which drops the 3px bar out of flow inside
   a `flex; gap: 10px` column and shifts the status line and the whole report below it by 13px
   every time the bar toggles. It must stay in flow and merely be invisible instead. */
test('hiding the JD progress bar reserves its space instead of collapsing the layout', () => {
  assert.match(css, /\.chat-jd-progress\[hidden\]\s*\{[^}]*visibility:\s*hidden/,
    '.chat-jd-progress[hidden] should hide via visibility, not remove itself from flow');
  assert.doesNotMatch(css.match(/\.chat-jd-progress\[hidden\]\s*\{[^}]*\}/)[0], /display\s*:\s*none/,
    '.chat-jd-progress[hidden] must not collapse the element with display: none');
});

/* Done in CSS so the existing log.scrollTop = log.scrollHeight calls ease instead of jumping —
   no JS change, and no reduced-motion branch in JS either. */
test('the chat log scrolls smoothly', () => {
  assert.match(css, /\.chat-log\b[^{]*\{[^}]*scroll-behavior:\s*smooth/,
    '.chat-log should scroll smoothly');
});

/* The wait state was the literal string "Thinking…". Dots replace it visually, but the string is
   NOT deleted — it moves to aria-label, so the wait state is still announced. Dropping it would
   make waiting silent to assistive technology: a regression dressed as a visual upgrade. */
test('the waiting bubble shows three dots and still announces itself', async () => {
  const { context, elements } = createChatContext();
  await loadChat(context);
  elements['chat-launcher'].dispatch('click');

  elements['chat-input'].value = 'What did he build at Abbott?';
  elements['chat-form'].dispatch('submit');

  const bubbles = elements['chat-log'].children;
  const waiting = bubbles[bubbles.length - 1];
  assert.equal(waiting.classList.contains('thinking'), true, 'the last bubble should be the waiting one');

  const dots = waiting.children.find((child) => child.className === 'chat-typing');
  assert.ok(dots, 'the waiting bubble should contain a .chat-typing group');
  assert.equal(dots.children.length, 3, 'three dots');
  assert.equal(dots.getAttribute('aria-label'), 'Thinking…',
    'the dots must carry the thinking string for screen readers');
  assert.equal(waiting.textContent, '', 'the literal Thinking… text should be gone');
});

test('the typing dots are styled and staggered', () => {
  assert.match(css, /@keyframes chat-typing-bounce/, 'the dots need a bounce keyframe');
  assert.match(css, /\.chat-typing i\b[^{]*\{[^}]*animation:\s*chat-typing-bounce/,
    'each dot should run the bounce');
  assert.match(css, /\.chat-typing i:nth-child\(2\)[^{]*\{[^}]*animation-delay/,
    'the second dot should be offset');
  assert.match(css, /\.chat-typing i:nth-child\(3\)[^{]*\{[^}]*animation-delay/,
    'the third dot should be offset');

  /* The old whole-bubble pulse is removed: the dots carry the motion now, and pulsing the
     container as well would double it. */
  assert.equal(/\.chat-msg\.thinking\b[^{]*\{[^}]*animation:\s*pulse/.test(css), false,
    'the whole-bubble pulse should be gone');
});

/* ---------------- private mode: the opt-in on-device model ---------------- */

test('the retired WebLLM tier stays gone; Private mode is a same-origin Worker behind a switch', () => {
  const header = html.match(/<header class="chat-head">([\s\S]*?)<\/header>/);
  assert.ok(header, 'the chat header should exist');
  assert.doesNotMatch(html, /chat-model-switch|chat-model-cloud|chat-model-local|id="chat-ai"|chat-progress/);
  assert.doesNotMatch(html, /aimeer-device\.js/);
  assert.doesNotMatch(chatbot, /web-llm|esm\.run|CreateMLCEngine|cdn\.jsdelivr|unpkg/);
  assert.match(header[1], /<button class="chat-private" id="chat-private" type="button" role="switch" aria-checked="false"/);
  assert.match(html, /id="chat-private-box"[^>]*role="status"/);
  assert.match(chatbot, /new Worker\(scriptUrl\("aimeer-local-worker\.js" \+ ASSET_VERSION_QUERY\), \{ type: "module" \}\)/);
  assert.match(chatbot, /scriptUrl\("\.\.\/vendor\/transformers\/transformers\.min\.js"\)/);
  for (const key of ['chat.private.label', 'chat.private.desc']) {
    assert.match(html, new RegExp(`data-i18n="${key.replace(/\./g, '\\.')}"`));
    assert.match(i18n, new RegExp(`"${key.replace(/\./g, '\\.')}":`), `${key} has a Bahasa Melayu string`);
  }
});

const localCore = require(path.join(__dirname, '..', 'assets', 'js', 'aimeer-local-core.js'));
const KB_TEXT = fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'aimeer-kb.txt'), 'utf8');

/* A browser with WebGPU, a stub model Worker that answers every prompt with `reply`, and a
   recorder for every Worker-relay (workers.dev) request. */
function createPrivateContext({ reply = 'He pioneered Flutter adoption at TRM Nett Systems.', storage = {}, cloudFails = false } = {}) {
  const cloudBodies = [];
  const workers = [];
  const harness = createChatContext({
    storage,
    fetchImpl(url, init) {
      const target = String(url);
      if (target.includes('workers.dev')) {
        cloudBodies.push(JSON.parse(init.body));
        if (cloudFails) return Promise.reject(new Error('offline'));
        return Promise.resolve(makeJsonResponse({ reply: 'cloud answer', action: 'answer' }));
      }
      if (target.includes('aimeer-kb.txt')) return Promise.resolve(makeTextResponse(KB_TEXT));
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      return Promise.resolve(makeTextResponse(''));
    }
  });
  ['chat-private', 'chat-private-box'].forEach((id) => { harness.elements[id] = createElement(); harness.elements[id].id = id; });
  class StubWorker {
    constructor(url, options) { this.url = url; this.options = options; this.posted = []; workers.push(this); }
    postMessage(msg) {
      this.posted.push(msg);
      const send = (data) => Promise.resolve().then(() => this.onmessage && this.onmessage({ data }));
      if (msg.type === 'load') send({ type: 'progress', loaded: 50, total: 100 }).then(() => send({ type: 'ready', device: msg.device, dtype: msg.dtype }));
      if (msg.type === 'generate') send({ type: 'token', id: msg.id, text: reply }).then(() => send({ type: 'done', id: msg.id, text: reply }));
    }
    terminate() { this.terminated = true; }
  }
  const { context } = harness;
  context.window.AIMEER_LOCAL = localCore;
  context.window.Worker = StubWorker;
  context.window.WebAssembly = {};
  context.Worker = StubWorker;
  context.WebAssembly = {};
  context.URL = URL;
  context.location = { href: 'http://127.0.0.1:8080/' };
  context.navigator.gpu = { requestAdapter: () => Promise.resolve({ features: new Set(['shader-f16']) }) };
  return { ...harness, cloudBodies, workers };
}

test('the Private switch offers the download with its size before anything loads', async () => {
  const harness = createPrivateContext();
  await loadChat(harness.context);
  harness.elements['chat-launcher'].dispatch('click');
  assert.equal(harness.elements['chat-private'].hidden, false, 'the switch shows once the core is present');
  harness.elements['chat-private'].dispatch('click');
  await flushAsync();
  assert.equal(harness.workers.length, 0, 'no Worker before consent');
  const box = harness.elements['chat-private-box'];
  assert.equal(box.hidden, false);
  assert.match(collectText(box), /about 259 MB/, 'the q4f16 size for an f16-capable GPU is stated');
  const start = box.children.find((child) => /chat-private-actions/.test(child.className)).children[0];
  start.dispatch('click');
  await flushAsync();
  assert.equal(harness.workers.length, 1);
  const load = harness.workers[0].posted[0];
  assert.equal(load.type, 'load');
  assert.equal(load.device, 'webgpu');
  assert.equal(load.dtype, 'q4f16');
  assert.equal(load.model, 'onnx-community/LFM2.5-350M-ONNX');
  assert.match(harness.workers[0].url, /^http:\/\/127\.0\.0\.1:8080\/assets\/js\/aimeer-local-worker\.js$/);
  assert.equal(harness.workers[0].options.type, 'module');
  assert.equal(harness.stored.get('aimeer-private'), '1');
  assert.equal(harness.stored.get('aimeer-local-ready'), '1');
  assert.equal(harness.statusText.textContent, 'AI mode · on this device');
});

test('with Private mode on, chat and the handoff summary never reach the Worker relay', async () => {
  const harness = createPrivateContext({ storage: { 'aimeer-private': '1', 'aimeer-local-ready': '1' } });
  await loadChat(harness.context);
  harness.elements['chat-launcher'].dispatch('click');
  await flushAsync();
  assert.equal(harness.workers.length, 1, 'a stored choice warms the model when the chat opens');
  await ask(harness, 'Does he know Flutter?');
  const texts = botTexts(harness.elements);
  assert.ok(texts.some((text) => /pioneered Flutter adoption/.test(text)), texts.join(' | '));
  const generate = harness.workers[0].posted.find((msg) => msg.type === 'generate');
  assert.match(generate.messages[0].content, /Flutter/, 'the retrieved KB lines reach the prompt');

  await ask(harness, 'What is his expected salary?');
  assert.ok(botTexts(harness.elements).some((text) => /prefers to discuss compensation directly/.test(text)), 'salary is the curated answer');
  assert.equal(harness.workers[0].posted.filter((msg) => msg.type === 'generate').length, 1, 'salary never reaches the model');
  const handoff = harness.elements['chat-log'].children.find((child) => /chat-handoff/.test(child.className));
  assert.ok(handoff, 'salary still offers the handoff');
  harness.context.window.open = () => {};
  handoff.children.find((child) => /chat-handoff-btns/.test(child.className)).children[0].dispatch('click');
  await flushAsync();
  assert.deepEqual(harness.cloudBodies, [], 'no chat, triage or summary request left the device');
});

test('an invented name is filtered out of an on-device answer, and an all-invented one falls back', async () => {
  const harness = createPrivateContext({
    storage: { 'aimeer-private': '1', 'aimeer-local-ready': '1' },
    reply: 'He knows Flutter well. He also built apps at liveaim.com.'
  });
  await loadChat(harness.context);
  harness.elements['chat-launcher'].dispatch('click');
  await flushAsync();
  await ask(harness, 'Does he know Flutter?');
  const texts = botTexts(harness.elements);
  assert.ok(texts.includes('He knows Flutter well.'), texts.join(' | '));
  assert.ok(!texts.some((text) => /liveaim/.test(text)));
});

test('a model already on disk answers when the cloud fails, before the instant table does', async () => {
  const harness = createPrivateContext({ storage: { 'aimeer-local-ready': '1' }, cloudFails: true });
  await loadChat(harness.context);
  harness.elements['chat-launcher'].dispatch('click');
  await flushAsync();
  assert.equal(harness.workers.length, 0, 'Private mode is off, so nothing loads up front');
  await ask(harness, 'Does he know Flutter?');
  await flushAsync();
  assert.equal(harness.cloudBodies.length, 1, 'the cloud was tried first');
  assert.equal(harness.workers.length, 1, 'then the cached model');
  assert.ok(botTexts(harness.elements).some((text) => /pioneered Flutter adoption/.test(text)));
});

test('a browser without WebGPU is told why, and nothing downloads', async () => {
  const harness = createPrivateContext();
  delete harness.context.navigator.gpu;
  await loadChat(harness.context);
  harness.elements['chat-launcher'].dispatch('click');
  harness.elements['chat-private'].dispatch('click');
  await flushAsync();
  assert.match(collectText(harness.elements['chat-private-box']), /needs WebGPU/);
  assert.equal(harness.workers.length, 0);
  assert.equal(harness.stored.get('aimeer-private'), undefined);
});

test('the status line reads secure cloud when the Worker is configured and instant answers when it is not', async () => {
  const cloud = createChatContext();
  await loadChat(cloud.context);
  assert.equal(cloud.statusText.textContent, 'AI mode · secure cloud');
  assert.equal(cloud.elements['chat-status'].className, 'chat-status chat-status-cloud');

  const offline = createChatContext({ cloudEndpoint: '' });
  await loadChat(offline.context);
  assert.equal(offline.statusText.textContent, 'Instant answers · works offline');
  offline.setLanguage('ms');
  assert.equal(offline.statusText.textContent, 'Jawapan segera · berfungsi luar talian');
});

test('the legacy reasoning-mode helper now reports only cloud or unavailable', async () => {
  const { context } = createChatContext();
  await loadChat(context);
  const mode = context.window.AIMeerRecruiter.getReasoningMode;
  assert.equal(mode({ hasResult: true, hasNormalizedText: true, cloudOk: true, localOK: true, dlActive: true, route: 'local' }), 'cloud');
  assert.equal(mode({ hasResult: true, hasNormalizedText: true, cloudOk: false }), 'unavailable');
  assert.equal(mode({ hasResult: false, hasNormalizedText: true, cloudOk: true }), 'unavailable');
});

function createTriageContext(answer) {
  const chatBodies = [];
  const opened = [];
  const harness = createChatContext({
    fetchImpl(url, init) {
      const target = String(url);
      if (target.includes('workers.dev')) {
        const body = JSON.parse(init.body);
        chatBodies.push(body);
        return Promise.resolve(makeJsonResponse(body.mode === 'summary' ? { reply: 'sum' } : answer));
      }
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      return Promise.resolve(makeTextResponse('KB'));
    }
  });
  harness.context.window.open = (href) => opened.push(href);
  return { ...harness, chatBodies, opened };
}

async function ask(harness, question) {
  harness.elements['chat-input'].value = question;
  harness.elements['chat-form'].dispatch('submit');
  await flushAsync();
}

function botTexts(elements) {
  return elements['chat-log'].children.map((child) => collectText(child));
}

test('a triaged salary question gets the curated compensation answer and the handoff, nothing generated', async () => {
  const harness = createTriageContext({ reply: '', action: 'salary', intent: 'compensation' });
  await loadChat(harness.context);
  harness.elements['chat-launcher'].dispatch('click');
  await ask(harness, 'What sort of package is he after?');

  const texts = botTexts(harness.elements);
  assert.ok(texts.some((text) => /prefers to discuss compensation directly/.test(text)), texts.join(' | '));
  assert.ok(harness.elements['chat-log'].children.some((child) => /chat-handoff/.test(child.className)));
  assert.equal(harness.chatBodies[0].mode, 'chat');
});

test('a triaged out-of-knowledge question is handed to Ameer and recorded as unanswered', async () => {
  const harness = createTriageContext({ reply: '', action: 'handoff', intent: 'personal' });
  await loadChat(harness.context);
  harness.elements['chat-launcher'].dispatch('click');
  await ask(harness, 'What is his blood type?');

  const texts = botTexts(harness.elements);
  assert.ok(texts.some((text) => /sounds like a question for Ameer himself/.test(text)));
  const card = harness.elements['chat-log'].children.find((child) => /chat-handoff/.test(child.className));
  assert.ok(card);
  const wa = card.children[1].children[0];
  wa.dispatch('click');
  await flushAsync();
  assert.match(decodeURIComponent(harness.opened[0]), /AIMeer couldn't answer this one: "What is his blood type\?"/);
});

/* A reply bubble is appended as three dots and only reaches its full height when the answer lands.
   Scrolling at append time alone left a long answer running past the bottom of the log, so the
   visitor had to scroll down to read what AIMeer just said. */
test('the chat log scrolls to the bottom once an answer lands, not only when the dots appear', async () => {
  const harness = createTriageContext({ reply: 'He led the .NET delivery for a retail audit platform across five markets.', action: 'answer', intent: 'experience' });
  await loadChat(harness.context);
  const log = harness.elements['chat-log'];
  /* Height grows with the text in the log, the way a real bubble grows when its text lands. */
  Object.defineProperty(log, 'scrollHeight', {
    get() { return 100 + log.children.map((child) => collectText(child)).join('').length; }
  });
  harness.elements['chat-launcher'].dispatch('click');
  await ask(harness, 'What did he build?');

  assert.ok(botTexts(harness.elements).some((text) => /five markets/.test(text)), 'the answer should land');
  assert.equal(log.scrollTop, log.scrollHeight, 'the log should end scrolled to the bottom of the settled answer');
});

test('a job-match question gets its answer plus a one-time offer of the JD matcher', async () => {
  const harness = createTriageContext({ reply: 'He has strong .NET delivery.', action: 'jd', intent: 'job-match' });
  await loadChat(harness.context);
  harness.elements['chat-launcher'].dispatch('click');
  await ask(harness, 'Would he fit our backend role?');
  await ask(harness, 'And for a lead role?');

  const offers = harness.elements['chat-log'].children.filter((child) => /chat-jd-offer/.test(child.className));
  assert.equal(offers.length, 1, 'the matcher is offered once per session');
  assert.match(collectText(offers[0]), /requirement-by-requirement/);
  offers[0].children[1].dispatch('click');
  assert.equal(harness.elements['chat-jd-panel'].hidden, false, 'the offer opens the matcher');
  assert.ok(botTexts(harness.elements).includes('He has strong .NET delivery.'));
});

test('a Worker from before triage (no action) still answers normally', async () => {
  const harness = createTriageContext({ reply: 'Plain cloud answer.' });
  await loadChat(harness.context);
  harness.elements['chat-launcher'].dispatch('click');
  await ask(harness, 'Tell me about Azure.');
  assert.ok(botTexts(harness.elements).includes('Plain cloud answer.'));
  assert.ok(!harness.elements['chat-log'].children.some((child) => /chat-jd-offer|chat-handoff/.test(child.className)));
});

/* jd-decide: the Clef-decided report, merged against the wider decision input. */
function buildDecideModelOutput(overrides = {}) {
  return JSON.stringify(Object.assign({
    narrative: 'Direct ASP.NET Core delivery, with Kubernetes adjacent through Azure DevOps release work.',
    requirements: [
      {
        requirementId: 'req-aspnet-core', recruiterIntent: '', expectedOutcome: '',
        matchLevel: 'direct-professional', evidenceRefs: ['ev-retailaim-plus'], transferableCapabilities: [],
        limitation: '', recruiterFraming: 'Published professional evidence covers ASP.NET Core MVC directly.',
        verificationQuestion: 'Which recent piece of work best shows ASP.NET Core MVC?', confidence: 'high', probability: 0.93
      },
      {
        requirementId: 'req-kubernetes', recruiterIntent: '', expectedOutcome: '',
        matchLevel: 'adjacent-professional', evidenceRefs: ['ev-azure-devops'], transferableCapabilities: ['Release automation'],
        limitation: 'An adjacent judgement, not proof of direct delivery with Kubernetes.',
        recruiterFraming: 'Closely related professional work (Azure DevOps) sits next to Kubernetes.',
        verificationQuestion: 'How would Azure DevOps work carry over to Kubernetes?', confidence: 'medium', probability: 0.71
      }
    ],
    overall: { score: 70, fitBand: 'good', narrative: 'Direct ASP.NET Core delivery, with Kubernetes adjacent through Azure DevOps release work.' },
    engine: 'clef'
  }, overrides));
}

function createDecideContext(responder) {
  const deterministicResult = buildDeterministicResult();
  const cloudCalls = [];
  const harness = createChatContext({
    fetchImpl(url, init) {
      const target = String(url);
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      if (target.includes('workers.dev')) {
        const body = JSON.parse(init.body);
        cloudCalls.push(body);
        return responder(body, cloudCalls.length);
      }
      return Promise.resolve(makeTextResponse('KB'));
    }
  });
  harness.context.window.JDExtractor = {
    extract() { return Promise.resolve({ text: '', source: 'pdf', warnings: [] }); },
    normalize(text) { return { normalizedText: text, warnings: [] }; }
  };
  harness.context.window.JDMatcher = { scoreJobDescription() { return clone(deterministicResult); } };
  vm.runInNewContext(jdReasoning, harness.context);
  return { ...harness, cloudCalls };
}

async function analyze(harness) {
  await loadChat(harness.context);
  await flushAsync();
  harness.elements['chat-launcher'].dispatch('click');
  harness.elements['chat-jd-input'].value = 'Need ASP.NET Core MVC and Kubernetes ownership.';
  harness.elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();
}

function failure(status, body) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) });
}

test('JD analysis asks for Clef decisions first and renders the decision confidence per requirement', async () => {
  const harness = createDecideContext(() => Promise.resolve(makeJsonResponse({ reasoning: buildDecideModelOutput() })));
  await analyze(harness);

  assert.deepEqual(harness.cloudCalls.map((call) => call.mode), ['jd-decide']);
  assert.deepEqual(Object.keys(harness.cloudCalls[0]).sort(), ['deterministicInput', 'evidenceIds', 'jdText', 'language', 'mode']);
  const rendered = collectText(harness.elements['chat-jd-result']);
  assert.match(rendered, /Good fit/);
  assert.match(rendered, /decided by Clef, Cloudflare's decision model/);
  assert.match(rendered, /where it was unsure, the keyword match stands instead/);
  assert.match(rendered, /93% decision confidence/);
  assert.match(rendered, /71% decision confidence/);
  assert.match(rendered, /Owns release pipelines and cloud delivery workflows\./, 'adjacent evidence resolves from the decision registry');

  harness.setLanguage('ms');
  assert.match(collectText(harness.elements['chat-jd-result']), /93% keyakinan keputusan/);
});

test('a jd-decide failure falls through to the jd-scoring flow, which keeps its own retry', async () => {
  for (const decideFailure of [
    () => failure(502, { error: 'decide-unavailable', stage: 'clef', reason: 'clef-run-failed:x' }),
    () => failure(400, { error: 'empty' }), /* a Worker from before jd-decide reads jd-decide as chat */
    () => Promise.resolve(makeJsonResponse({ reasoning: buildDecideModelOutput({ engine: 'gpt' }) }))
  ]) {
    const harness = createDecideContext((body, count) => {
      if (body.mode === 'jd-decide') return decideFailure();
      if (count === 2) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(makeJsonResponse({ reasoning: buildScoringModelOutput() }));
    });
    await analyze(harness);
    assert.deepEqual(harness.cloudCalls.map((call) => call.mode), ['jd-decide', 'jd-scoring', 'jd-scoring']);
    const rendered = collectText(harness.elements['chat-jd-result']);
    assert.match(rendered, /Strong fit/);
    assert.match(rendered, /used secure cloud AI/);
    assert.doesNotMatch(rendered, /decision confidence/);
  }
});

test('a payload the Worker refuses on a jd- rule is not re-sent to jd-scoring', async () => {
  const harness = createDecideContext(() => failure(400, { error: 'jd-privacy-invalid' }));
  await analyze(harness);
  assert.deepEqual(harness.cloudCalls.map((call) => call.mode), ['jd-decide']);
  assert.match(collectText(harness.elements['chat-jd-result']), /Keyword estimate/);
});

test('a file dropped on the upload card takes the same checks as the picker', async () => {
  const { context, elements } = createChatContext();
  const extracted = [];
  context.window.JDExtractor = {
    extract(file) { extracted.push(file.name); return Promise.resolve({ text: 'JD text', source: 'docx', warnings: [] }); },
    normalize(text) { return { normalizedText: text, warnings: [] }; }
  };
  await loadChat(context);
  const drop = elements['chat-jd-drop'];

  drop.dispatch('dragover', drop, { dataTransfer: {} });
  assert.equal(drop.classList.contains('is-dragover'), true);
  drop.dispatch('drop', drop, { dataTransfer: { files: [{ name: 'notes.txt', size: 10 }] } });
  assert.equal(drop.classList.contains('is-dragover'), false);
  assert.match(elements['chat-jd-status'].textContent, /Only PDF and DOCX files are supported/);

  drop.dispatch('drop', drop, { dataTransfer: { files: [{ name: 'role.docx', size: 2048 }] } });
  await flushAsync();
  assert.deepEqual(extracted, ['role.docx']);
  assert.equal(elements['chat-jd-file-name'].textContent, 'role.docx');
  assert.match(elements['chat-jd-status'].textContent, /Local document ready: DOCX text/);

  drop.dispatch('drop', drop, { dataTransfer: { files: [] } });
  assert.deepEqual(extracted, ['role.docx'], 'an empty drop changes nothing');
});
