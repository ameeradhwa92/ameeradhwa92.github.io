const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'i18n.js'), 'utf8');

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
