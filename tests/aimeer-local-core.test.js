const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('../assets/js/aimeer-local-core.js');
const kb = fs.readFileSync(path.join(__dirname, '..', 'assets', 'data', 'aimeer-kb.txt'), 'utf8');
const chatbot = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'chatbot.js'), 'utf8');
const SALARY_KEYS = new RegExp(chatbot.match(/var SALARY_KEYS = \/(.+)\/;/)[1]);

const chunks = core.chunkKb(kb);
const index = core.buildIndex(chunks);
const top = (question) => core.retrieve(index, question, 4).map((h) => h.chunk.text);

test('the gate needs WebGPU, and picks the smaller build when the GPU has shader-f16', () => {
  const base = { hasWorker: true, hasWasm: true, hasWebGPU: true };
  assert.deepEqual(core.evaluateGate({ ...base, shaderF16: true }),
    { eligible: true, backend: 'webgpu', dtype: 'q4f16', sizeMB: 259, reason: 'webgpu' });
  assert.equal(core.evaluateGate({ ...base, shaderF16: false }).dtype, 'q4');
  assert.equal(core.evaluateGate({ ...base, shaderF16: false }).sizeMB, 297);
  assert.equal(core.evaluateGate({ ...base, hasWebGPU: false }).reason, 'no-webgpu');
  assert.equal(core.evaluateGate({ ...base, hasWorker: false }).reason, 'no-worker');
  assert.equal(core.evaluateGate({ ...base, hasWasm: false }).reason, 'no-wasm');
  assert.equal(core.evaluateGate({ ...base, deviceMemory: 1 }).reason, 'low-memory');
  assert.equal(core.evaluateGate({ ...base, deviceMemory: 2 }).eligible, true);
  assert.equal(core.evaluateGate({ ...base }).eligible, true, 'a hidden deviceMemory is not a refusal');
});

test('probeEnvironment reads the adapter and never rejects', async () => {
  const win = { Worker: function () {}, WebAssembly: {} };
  const f16 = await core.probeEnvironment({ gpu: { requestAdapter: () => Promise.resolve({ features: new Set(['shader-f16']) }) } }, win);
  assert.equal(f16.hasWebGPU, true);
  assert.equal(f16.shaderF16, true);
  const none = await core.probeEnvironment({ gpu: { requestAdapter: () => Promise.resolve(null) } }, win);
  assert.equal(none.hasWebGPU, false);
  const broken = await core.probeEnvironment({ gpu: { requestAdapter: () => Promise.reject(new Error('lost')) } }, win);
  assert.equal(broken.hasWebGPU, false);
  const old = await core.probeEnvironment({}, {});
  assert.deepEqual([old.hasWorker, old.hasWasm, old.hasWebGPU], [false, false, false]);
});

test('the KB chunks into short labelled lines, without headings or site meta', () => {
  assert.ok(chunks.length > 20, `expected a chunk per fact, got ${chunks.length}`);
  for (const c of chunks) {
    assert.ok(c.text.length <= 520, `chunk too long for a small model: ${c.text.slice(0, 80)}`);
    assert.doesNotMatch(c.text, /^(FACTS ABOUT|RECRUITER EVIDENCE|Evidence label:|Privacy exclusions|JD matcher:)/);
  }
  assert.ok(chunks.some((c) => /^Identity: /.test(c.text)));
  /* abbreviations and decimals are not sentence ends */
  assert.ok(chunks.some((c) => /Sdn\. Bhd\./.test(c.text)));
  assert.ok(chunks.some((c) => /CGPA 3\.03/.test(c.text)));
  /* a piece cut from a long career line still says whose it is */
  const trm = chunks.filter((c) => /Port Klang/.test(c.text));
  assert.ok(trm.length && trm.every((c) => /^2015-2023 TRM Nett Systems/.test(c.text)));
});

test('retrieval finds the line a visitor question is about, in English or Bahasa Melayu', () => {
  assert.match(top('Does he know Flutter?').join('\n'), /Flutter/);
  assert.match(top('What did Ameer build for Abbott?').join('\n'), /Abbott/);
  assert.match(top('Where was he born?')[0], /^Origins: born 1992 in Dungun/);
  assert.match(top('Where did he study?').join('\n'), /UiTM/);
  assert.match(top('How can I contact him?')[0], /ameeradhwa92@gmail\.com/);
  assert.match(top('Tell me about him')[0], /^Identity: /);
  assert.match(top('What is RetailAIM IR?')[0], /RetailAIM/);
  assert.match(top('Di mana beliau belajar?').join('\n'), /UiTM/);
  assert.match(top('Apa kemahiran beliau?')[0], /^Skills: /);
});

test('triage answers salary and off-topic questions without the model', () => {
  const triage = (q) => core.triage(q, core.retrieve(index, q, 4), SALARY_KEYS);
  assert.equal(triage('What is his expected salary?'), 'salary');
  assert.equal(triage('Berapa gaji yang dia mahu?'), 'salary');
  assert.equal(triage('What is his favourite food?'), 'handoff');
  assert.equal(triage("what's the weather today"), 'handoff');
  assert.equal(triage('Does he know Kubernetes?'), 'handoff');
  assert.equal(triage('Does he know Flutter?'), 'answer');
  assert.equal(triage('Has he worked with government agencies?'), 'answer');
});

test('the prompt carries the persona, the retrieved facts and the last turn only', () => {
  const hits = core.retrieve(index, 'Does he know Flutter?', 4);
  const identity = chunks.find((c) => /^Identity: /.test(c.text)).text;
  const history = [{ role: 'user', content: 'one' }, { role: 'assistant', content: 'two' }, { role: 'user', content: 'three' }, { role: 'assistant', content: 'four' }];
  const messages = core.buildMessages('Does he know Flutter?', hits, identity, history);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /ONLY the facts below/);
  assert.match(messages[0].content, /FACTS:\n- Identity: /);
  assert.match(messages[0].content, /Flutter/);
  assert.deepEqual(messages.slice(1).map((m) => m.content), ['three', 'four', 'Does he know Flutter?']);
});

test('cleanReply drops invented names, prompt talk, money and cut-off tails', () => {
  const facts = 'Skills: React, TypeScript, Flutter. RetailAIM Plus serves 20+ FMCG brands (live, retailaim.com).';
  assert.equal(core.cleanReply('Yes, he knows React and GraphQL. He also uses TypeScript.', facts), 'He uses TypeScript.');
  assert.equal(core.cleanReply('He built RetailAIM Plus at retailaim.com for 20+ FMCG brands.', facts),
    'He built RetailAIM Plus at retailaim.com for 20+ FMCG brands.');
  assert.equal(core.cleanReply('He built it at liveaim.com.', facts), '');
  assert.equal(core.cleanReply('The provided context does not specify that.', facts), '');
  assert.equal(core.cleanReply('His expected salary is RM 9,000.', facts), '');
  assert.equal(core.cleanReply('He knows **React**. He knows Flutter. He knows TypeScript.', facts), 'He knows React. He knows Flutter.');
  assert.equal(core.cleanReply('He knows React. He has also worked on', facts), 'He knows React.');
  assert.equal(core.cleanReply('AIMeer: He knows Flutter.'), 'He knows Flutter.', 'without facts the grounding check is skipped');
  assert.equal(core.cleanReply('   '), '');
});
