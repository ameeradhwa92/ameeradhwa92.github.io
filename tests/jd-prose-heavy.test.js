/* Regression guard for a prose-heavy posting that broke the recruiter JD matcher end to end.
   The posting is an ordinary senior full-stack advert: narrative section headings ("The role",
   "What you'll be doing", "Required", "Bonus points", "How we work", "Tech stack") and mostly
   full sentences rather than bulleted skill phrases.

   Before the fix it failed in three linked places:
     1. jd-extractor.js recognized none of those headings, so the whole document collapsed into
        one anonymous section and every line inherited "neutral" strength.
     2. With no heading, jd-matcher.js's generic fallback had nothing to suppress it, so all 84
        non-alias prose lines became requirements — "Talks", "How We Work", "This Is Probably
        Not The Right Fit." — which dragged coreTechnologies to 1.46 of 35 and the score to 29%.
     3. The resulting 91 requirements exceeded the Worker's JD_REASONING_REQUIREMENT_MAX (48),
        so jd-scoring was rejected 400 jd-deterministic-invalid before the model ever ran and the
        report fell back to the keyword estimate.

   Assert on all three so a regression in any one of them is named, not just the visible symptom. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const fixturePath = path.join(__dirname, 'fixtures', 'jd-prose-heavy-senior-fullstack.txt');
const profilePath = path.join(repoRoot, 'assets', 'data', 'aimeer-profile.json');
const workerPath = path.join(repoRoot, 'cloud', 'aimeer-worker.js');

function loadHarness() {
  const context = { console, setTimeout, clearTimeout };
  context.globalThis = context;
  context.window = context;
  for (const file of ['jd-extractor.js', 'jd-matcher.js', 'jd-reasoning.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(repoRoot, 'assets', 'js', file), 'utf8'), context);
  }
  return context;
}

const harness = loadHarness();
const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
const jdText = fs.readFileSync(fixturePath, 'utf8');

function analyze() {
  const normalized = harness.JDExtractor.normalize(jdText);
  const result = harness.JDMatcher.scoreJobDescription(normalized, profile);
  const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');
  return { normalized, result, input };
}

/* Mirrors JD_REASONING_REQUIREMENT_MAX in cloud/aimeer-worker.js. Read it from the Worker source
   rather than restating the number, so raising the Worker's cap cannot leave this test asserting
   against a limit the deployed relay no longer enforces. */
function workerRequirementMax() {
  const source = fs.readFileSync(workerPath, 'utf8');
  const match = source.match(/const JD_REASONING_REQUIREMENT_MAX = (\d+);/);
  assert.ok(match, 'JD_REASONING_REQUIREMENT_MAX should be declared in cloud/aimeer-worker.js');
  return Number(match[1]);
}

test('prose-heavy posting resolves its narrative section headings', () => {
  const { normalized } = analyze();

  /* Array.from re-homes the vm realm's array into this one: assert/strict compares prototypes,
     and a cross-realm array fails deepEqual even when the contents match. */
  assert.deepEqual(Array.from(normalized.warnings), [],
    'the posting has real headings, so no "no recognizable section headings" warning should fire');

  const headings = normalized.sections.map((section) => section.heading);
  assert.ok(headings.includes('Required Skills'), '"Required" should resolve to Required Skills');
  assert.ok(headings.includes('Preferred Skills'), '"Bonus points" should resolve to Preferred Skills');
  assert.ok(headings.includes('Responsibilities'), '"What you\'ll be doing" should resolve to Responsibilities');
});

test('prose-heavy posting does not turn company boilerplate into requirements', () => {
  const { result } = analyze();
  const terms = result.requirements.map((item) => item.term.toLowerCase());

  /* "Talks" is deliberately absent from this list. It reads like noise, but it is a real fragment
     of a real bonus item ("Public technical writing, talks, or open-source contributions") that
     the comma split produces, under a heading the posting labelled Bonus points. It is thin
     rather than phantom, and the reasoning budget drops it on priority rather than on parsing. */
  for (const boilerplate of [
    'how we work',
    'this is probably not the right fit.',
    'and review loops.',
    'or equivalent workflows',
    'we expect you to be able to:',
    'bonus points',
    'the role'
  ]) {
    assert.equal(terms.includes(boilerplate), false,
      `"${boilerplate}" is prose or a heading, not a requirement`);
  }
});

test('prose-heavy posting still recognizes the requirements it genuinely states', () => {
  const { result } = analyze();
  const terms = result.requirements.map((item) => item.term);

  assert.ok(terms.includes('7+ years'), 'the stated duration requirement should survive');
  for (const expected of ['C#', 'ASP.NET Core', 'TypeScript']) {
    assert.ok(terms.includes(expected), `${expected} is named in the posting and should be matched`);
  }
});

test('prose-heavy posting fits the cloud scoring budget', () => {
  const { input } = analyze();

  assert.ok(input.requirements.length > 0, 'a scorable posting should yield requirements');
  assert.ok(
    input.requirements.length <= workerRequirementMax(),
    `the cloud payload carries ${input.requirements.length} requirements, ` +
    `over the Worker's limit of ${workerRequirementMax()}`
  );
});

test('prose-heavy posting is accepted by the Worker jd-scoring contract', async () => {
  const { input } = analyze();
  const source = fs.readFileSync(workerPath, 'utf8');
  const specifier = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  const worker = (await import(specifier)).default;

  const originalFetch = global.fetch;
  global.fetch = async (url) => new Response(
    String(url).includes('aimeer-profile.json') ? JSON.stringify(profile) : 'knowledge base',
    { status: 200 }
  );

  try {
    const response = await worker.fetch(
      new Request('https://worker.example.test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8080' },
        body: JSON.stringify({
          mode: 'jd-scoring',
          language: 'en',
          jdText: input.jdText,
          deterministicInput: {
            requirements: input.requirements,
            deterministicResult: input.deterministicResult
          },
          evidenceIds: input.evidenceRegistry.map((record) => record.id)
        })
      }),
      {
        AI: { async run() { return { response: '{}' }; } },
        __CACHES: { default: { async match() { return null; }, async put() {} } }
      }
    );

    /* The model stub returns unusable JSON, so a 502 (the model's answer failed validation) is
       the expected outcome here. What must never happen again is a 400 — the request body itself
       being refused, which is what kept this posting from reaching the model at all. */
    const body = await response.json();
    assert.notEqual(response.status, 400,
      `the Worker refused the request body: ${JSON.stringify(body)}`);
  } finally {
    global.fetch = originalFetch;
  }
});

/* `user.agile-context` is the profile's only `user-provided` record, and no matchLevel admits that
   evidence type. Sending it to the model was a trap: it was the only support for "AI-assisted
   development", so the model cited it at a professional level and the Worker refused the whole
   report with `evidence-provenance-invalid` — every other requirement lost with it. Confirmed
   against the live model: the same payload with that one id removed succeeded on every attempt. */
test('the cloud payload never offers evidence no match level can cite', () => {
  const { input } = analyze();

  for (const record of input.evidenceRegistry) {
    assert.ok(['professional', 'academic'].includes(record.evidenceType),
      `${record.id} is ${record.evidenceType}, which no matchLevel admits, so it must not be sent`);
  }

  const offered = new Set(input.evidenceRegistry.map((record) => record.id));
  for (const requirement of input.requirements) {
    for (const ref of requirement.evidenceRefs) {
      assert.ok(offered.has(ref),
        `${requirement.id} cites ${ref}, which is not in the offered registry`);
    }
  }

  /* The deterministic match lists carry their own copies of the same ids and the Worker validates
     those too — an uncitable id surviving here fails the request at the body check instead. */
  const lists = input.deterministicResult;
  for (const key of ['strongMatches', 'partialMatches', 'gaps', 'unverified']) {
    for (const item of lists[key] || []) {
      for (const ref of item.evidenceRefs || []) {
        assert.ok(offered.has(ref), `${key} cites ${ref}, which is not in the offered registry`);
      }
    }
  }
});

test('a requirement supported only by self-reported context still reaches the model, without refs', () => {
  const { result, input } = analyze();

  /* The deterministic pass ties "AI-assisted development" to user.agile-context. That tie is left
     alone locally — this only governs what is offered to the model. */
  const deterministic = result.requirements.find((item) => item.term === 'AI-assisted development');
  assert.ok(deterministic, 'the posting names AI-assisted development');
  assert.deepEqual(Array.from(deterministic.evidenceRefs), ['user.agile-context'],
    'the local keyword result should keep its self-reported support');

  const sent = input.requirements.find((item) => item.term === 'AI-assisted development');
  if (sent) {
    assert.deepEqual(Array.from(sent.evidenceRefs), [],
      'the model should see the requirement with no citable evidence, not a citation it cannot use');
  }
});
