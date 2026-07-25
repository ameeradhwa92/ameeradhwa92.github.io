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

function createElement() {
  const listeners = new Map();
  const classes = new Set();
  return {
    hidden: false,
    textContent: '',
    className: '',
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
    dispatch(type) { const listener = listeners.get(type); if (listener) listener({ key: type, target: this }); },
    querySelector() { return null; },
    appendChild() {},
    focus() {}
  };
}

function createChatContext(options = {}) {
  const elements = {};
  [
    'chat-launcher', 'chat-panel', 'chat-log', 'chat-form', 'chat-input', 'chat-chips',
    'chat-status', 'chat-ai', 'chat-ai-enable', 'chat-ai-cancel', 'chat-model-cloud',
    'chat-model-local', 'chat-model-tooltip'
  ].forEach((id) => { elements[id] = createElement(); });
  const statusText = createElement();
  const aiPitch = createElement();
  const progress = createElement();
  const progressBar = createElement();
  const progressText = createElement();
  const close = createElement();
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
          return Promise.resolve({ limits: { maxBufferSize }, features: new Set(['shader-f16']) });
        }
      } : undefined
    },
    localStorage: {
      getItem(key) { return stored.get(key) || null; },
      setItem(key, value) { stored.set(key, String(value)); },
      removeItem(key) { stored.delete(key); }
    },
    MutationObserver: class { constructor() {} observe() {} },
    setTimeout(fn, delay) {
      const id = timers.length + 1;
      timers.push({ id, fn, delay });
      return id;
    },
    clearTimeout(id) { clearedTimers.push(id); },
    fetch() { return new Promise(() => {}); },
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
    get adapterRequests() { return adapterRequests; }
  };
}

async function loadChat(context) {
  vm.runInNewContext(chatbot, context);
  await new Promise(setImmediate);
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

test('selecting eligible local AI presents Local while the active route is cloud', async () => {
  const { context, elements, stored } = createChatContext();
  await loadChat(context);

  assert.equal(elements['chat-model-cloud'].getAttribute('aria-pressed'), 'true');
  elements['chat-model-local'].dispatch('click');

  assert.equal(elements['chat-model-local'].getAttribute('aria-pressed'), 'true');
  assert.equal(elements['chat-model-cloud'].getAttribute('aria-pressed'), 'false');
  assert.equal(stored.get('aimeer-route'), 'local');
});

test('explicit cloud preference keeps eligible desktop on cloud without starting local', async () => {
  const { context, elements, progress } = createChatContext({
    storage: { 'aimeer-route': 'cloud' },
    saveData: false
  });

  await loadChat(context);
  elements['chat-launcher'].dispatch('click');

  assert.equal(elements['chat-model-cloud'].getAttribute('aria-pressed'), 'true');
  assert.equal(elements['chat-model-local'].getAttribute('aria-pressed'), 'false');
  assert.equal(elements['chat-status'].className, 'chat-status chat-status-cloud');
  assert.equal(progress.hidden, true);
});

test('explicit local preference overrides Save-Data on eligible desktop and starts local when opened', async () => {
  const { context, elements, stored, progress } = createChatContext({
    storage: { 'aimeer-route': 'local' },
    saveData: true
  });

  await loadChat(context);
  elements['chat-launcher'].dispatch('click');

  assert.equal(elements['chat-model-local'].getAttribute('aria-pressed'), 'true');
  assert.equal(stored.get('aimeer-route'), 'local');
  assert.equal(progress.hidden, false);
  assert.equal(elements['chat-status'].className, 'chat-status chat-status-loading');
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

test('switching to cloud while local download is active cancels the download state', async () => {
  const { context, elements, stored, progress, timers, clearedTimers } = createChatContext({
    saveData: false
  });

  await loadChat(context);
  elements['chat-launcher'].dispatch('click');
  assert.equal(progress.hidden, false);

  elements['chat-model-cloud'].dispatch('click');

  assert.equal(stored.get('aimeer-route'), 'cloud');
  assert.equal(elements['chat-model-cloud'].getAttribute('aria-pressed'), 'true');
  assert.equal(elements['chat-model-local'].getAttribute('aria-pressed'), 'false');
  assert.equal(progress.hidden, true);
  assert.equal(elements['chat-status'].className, 'chat-status chat-status-cloud');
  assert.ok(clearedTimers.includes(timers.find((timer) => timer.delay === 20000).id));
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
