const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'i18n.js'), 'utf8');
const chatbot = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'chatbot.js'), 'utf8');
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

function findNode(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const match = findNode(child, predicate);
    if (match) return match;
  }
  return null;
}

function getFirstButton(node) {
  return findNode(node, (entry) => entry.tagName === 'BUTTON');
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
    createElement
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
      title: 'RetailAIM Plus multi-tenant delivery',
      evidenceType: 'professional',
      summary: 'Production ASP.NET Core MVC delivery across Southeast Asia tenants.',
      capabilities: ['ASP.NET Core MVC', 'Azure DevOps', 'CI/CD']
    },
    {
      id: 'ev-azure-devops',
      title: 'Azure DevOps release ownership',
      evidenceType: 'professional',
      summary: 'Owns release pipelines and cloud delivery workflows.',
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

function buildMergedResult(baseResult, overrides = {}) {
  const result = clone(baseResult);
  result.deterministicScore = 72;
  result.verifiedScore = 68;
  result.transferableScore = 79;
  result.requiredGapCeiling = 88;
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
    strengths: [
      {
        term: 'ASP.NET Core MVC',
        note: 'Verified production delivery is already published.'
      }
    ],
    transferable: [
      {
        term: 'Cloud delivery bridge',
        note: 'Azure DevOps release ownership can shorten the move into Kubernetes-based operations.'
      }
    ],
    partialMatches: [
      {
        term: 'Kubernetes',
        note: 'Adjacent cloud delivery exists, but named Kubernetes depth is still a screening topic.'
      }
    ],
    gaps: [
      {
        term: 'Salesforce Marketing Cloud',
        note: 'No published implementation evidence is currently available.'
      }
    ],
    unverified: [
      {
        term: 'Public speaking at conferences',
        note: 'Published profile does not verify this requirement yet.'
      }
    ],
    learningBridges: [
      {
        term: 'Kubernetes',
        note: 'Bridge from Azure DevOps and cloud-release ownership into container operations.'
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

function buildFallback(language = 'en', overrides = {}) {
  return Object.assign({
    mode: 'deterministic-fallback',
    language,
    deterministicScore: 72,
    narrative: language === 'ms'
      ? 'Ringkasan deterministik digunakan. Kekuatan yang disahkan, jurang yang nyata, dan soalan saringan kekal dipaparkan tanpa penaakulan AI.'
      : 'Deterministic fallback is active. Verified strengths, explicit gaps, and recruiter screening questions remain available without AI reasoning.',
    sections: {
      strengths: [{ term: 'ASP.NET Core MVC', note: 'Verified production delivery is already published.' }],
      gaps: [{ term: 'Salesforce Marketing Cloud', note: 'No published implementation evidence is currently available.' }],
      limitations: [{ term: 'Kubernetes', note: 'This remains a partial match and should be validated during screening.' }],
      interviewQuestions: [{ term: 'Kubernetes', question: 'What production cluster rollout, if any, has he handled directly?' }]
    }
  }, overrides);
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
    'Paste a job description or load a local PDF/DOCX for a deterministic compatibility estimate.'
  );
  assert.equal(promo.children[1].id, 'chat-jd-promo-action');
  assert.equal(promo.children[1].getAttribute('data-i18n'), 'chat.jd.promoAction');

  const i18nContext = { window: {} };
  vm.runInNewContext(i18n, i18nContext);
  assert.equal(
    i18nContext.window.I18N_MS['chat.jd.promo'],
    'Tampal huraian jawatan atau muatkan PDF/DOCX setempat untuk anggaran keserasian yang deterministik.'
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
    'Tampal huraian jawatan atau muatkan PDF/DOCX setempat untuk anggaran keserasian yang deterministik.'
  );
  assert.equal(promo.children[1].textContent, 'Buka mod padanan huraian jawatan');

  setLanguage('en');
  assert.equal(
    promo.children[0].textContent,
    'Paste a job description or load a local PDF/DOCX for a deterministic compatibility estimate.'
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

test('JD matcher keeps the deterministic score visible until recruiter reasoning is requested, then renders localized local reasoning sections', async () => {
  const deterministicResult = buildDeterministicResult();
  const mergedResult = buildMergedResult(deterministicResult);
  const buildCalls = [];
  const validateCalls = [];
  const mergeCalls = [];
  const chatbotWithControlledWebLLM = chatbot.replace(
    'return import(WEBLLM_CDN).then(function (webllm) {',
    'return window.__importWebLLM(WEBLLM_CDN).then(function (webllm) {'
  );
  const fakeEngine = {
    chat: {
      completions: {
        create(payload) {
          if (Array.isArray(payload.messages) && payload.messages.some((message) => /strict json/i.test(String(message.content)))) {
            return Promise.resolve({
              choices: [{
                message: {
                  content: JSON.stringify({ narrative: 'Local recruiter reasoning', requirements: [] })
                }
              }]
            });
          }
          return Promise.resolve({
            choices: [{
              message: {
                content: 'AIMeer local reply'
              }
            }]
          });
        }
      }
    }
  };
  const { context, elements, setLanguage } = createChatContext({
    saveData: false,
    fetchImpl(url) {
      const target = String(url);
      if (target.endsWith('aimeer-kb.txt')) return Promise.resolve(makeTextResponse('AIMeer knowledge base'));
      if (target.endsWith('aimeer-profile.json')) return Promise.resolve(makeJsonResponse(PROFILE_FIXTURE));
      throw new Error(`Unexpected fetch: ${target}`);
    }
  });
  context.window.__importWebLLM = () => Promise.resolve({
    CreateMLCEngine(model, options) {
      options.initProgressCallback({ progress: 1 });
      return Promise.resolve(fakeEngine);
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
      buildCalls.push({ normalized, result, profile, language });
      return { language, requirements: result.requirements || [], evidenceRegistry: profile.recruiterEvidence || [] };
    },
    validateModelOutput(raw, input) {
      validateCalls.push({ raw, input });
      return {
        ok: true,
        reasoning: {
          narrative: 'Validated recruiter reasoning',
          requirements: []
        }
      };
    },
    mergeResult(result, reasoning, input) {
      mergeCalls.push({ result, reasoning, input });
      return clone(mergedResult);
    },
    fallback() {
      throw new Error('fallback should not run on the happy local path');
    }
  };

  await loadChat(context, { source: chatbotWithControlledWebLLM });
  await flushAsync();
  elements['chat-launcher'].dispatch('click');
  await flushAsync();

  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC and Kubernetes ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  const beforeReasoning = collectText(elements['chat-jd-result']);
  assert.match(beforeReasoning, /72%/, 'the deterministic score should render immediately');
  assert.doesNotMatch(beforeReasoning, /verified match/i, 'reasoning sections should not render before an explicit request');

  const reasonButton = getFirstButton(elements['chat-jd-result']);
  assert.ok(reasonButton, 'the recruiter result should expose an explicit reasoning action');
  reasonButton.dispatch('click');
  await flushAsync();

  const afterReasoning = collectText(elements['chat-jd-result']);
  assert.equal(buildCalls.length, 1, 'the reasoning payload should be built exactly once');
  assert.equal(validateCalls.length, 1, 'local reasoning output should be validated');
  assert.equal(mergeCalls.length, 1, 'validated reasoning should merge back into the deterministic result');
  assert.match(afterReasoning, /Verified match/i);
  assert.match(afterReasoning, /Transferable opportunity/i);
  assert.match(afterReasoning, /Calibrated fit/i);
  assert.match(afterReasoning, /on this device/i, 'the local reasoning status should explain that reasoning stayed local');

  setLanguage('ms');
  const localized = collectText(elements['chat-jd-result']);
  assert.match(localized, /Padanan disahkan/i);
  assert.match(localized, /pada peranti ini/i, 'the local reasoning status should localize into formal Bahasa Melayu');
});

test('cloud recruiter reasoning localizes its status and falls back without hiding the deterministic score', async () => {
  const deterministicResult = buildDeterministicResult();
  const fallback = buildFallback('ms');
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
      return { language, jdText: normalized.normalizedText, requirements: result.requirements || [], evidenceRegistry: profile.recruiterEvidence || [] };
    },
    validateModelOutput() {
      return { ok: false, error: 'invalid reasoning payload' };
    },
    mergeResult() {
      throw new Error('mergeResult should not run when validation fails');
    },
    fallback(result, input, language) {
      assert.equal(language, 'ms');
      return clone({ ...fallback, inputLanguage: input.language, deterministicScore: result.score });
    }
  };

  await loadChat(context);
  await flushAsync();
  setLanguage('ms');

  elements['chat-jd-input'].value = 'Perlu ASP.NET Core MVC dan pengalaman orkestrasi kontena.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();

  const reasonButton = getFirstButton(elements['chat-jd-result']);
  assert.ok(reasonButton, 'the deterministic cloud result should still expose an explicit reasoning action');
  reasonButton.dispatch('click');
  await flushAsync();

  const rendered = collectText(elements['chat-jd-result']);
  assert.equal(cloudCalls.length, 1, 'cloud reasoning should send a single bounded request');
  assert.match(rendered, /72%/, 'the deterministic score must remain visible after a reasoning failure');
  assert.match(rendered, /Ringkasan deterministik digunakan/i, 'the UI should show the localized fallback narrative');
  assert.match(rendered, /awan selamat/i, 'the cloud reasoning status should be localized in Bahasa Melayu');
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
    reasoningNarrative: 'Second reasoning placeholder.'
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
    },
    fallback(result, input, language) {
      return buildFallback(language, { deterministicScore: result.score, inputLanguage: input.language });
    }
  };

  await loadChat(context);
  await flushAsync();

  elements['chat-jd-input'].value = 'Need ASP.NET Core MVC ownership.';
  elements['chat-jd-analyze'].dispatch('click');
  await flushAsync();
  getFirstButton(elements['chat-jd-result']).dispatch('click');
  await flushAsync();

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
