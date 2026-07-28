const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const workerPath = path.join(repoRoot, 'cloud', 'aimeer-worker.js');
const profilePath = path.join(repoRoot, 'assets', 'data', 'aimeer-profile.json');
const extractorPath = path.join(repoRoot, 'assets', 'js', 'jd-extractor.js');
const matcherPath = path.join(repoRoot, 'assets', 'js', 'jd-matcher.js');
const reasoningPath = path.join(repoRoot, 'assets', 'js', 'jd-reasoning.js');

function loadProfile() {
  return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
}

function loadBrowserHarness() {
  const context = {
    console,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;
  context.window = context;

  vm.runInNewContext(fs.readFileSync(extractorPath, 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(matcherPath, 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(reasoningPath, 'utf8'), context);

  return {
    JDExtractor: context.JDExtractor,
    JDMatcher: context.JDMatcher,
    JDReasoning: context.JDReasoning
  };
}

async function loadWorker() {
  const source = fs.readFileSync(workerPath, 'utf8');
  const specifier = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`;
  const moduleNs = await import(specifier);
  return moduleNs.default;
}

function buildValidRequest(options = {}) {
  const language = typeof options === 'string' ? options : (options.language || 'en');
  const text = typeof options === 'string' || !options.text
    ? `Required Skills:
- Kubernetes
- Azure
- Azure DevOps
- Bicep
Preferred Skills:
- CI/CD
`
    : options.text;
  const harness = loadBrowserHarness();
  const profile = loadProfile();
  const normalized = harness.JDExtractor.normalize(text);
  const deterministicResult = harness.JDMatcher.scoreJobDescription(normalized, profile);
  const input = harness.JDReasoning.buildInput(normalized, deterministicResult, profile, language);

  return {
    mode: 'jd-reasoning',
    language: input.language,
    jdText: input.jdText,
    deterministicInput: {
      requirements: input.requirements,
      deterministicResult: input.deterministicResult
    },
    evidenceIds: input.evidenceRegistry.map((record) => record.id)
  };
}

function buildValidReasoningResponse(request, profile) {
  const evidenceRegistry = (profile.recruiterEvidence || []).filter((record) =>
    request.evidenceIds.includes(record.id)
  );
  const evidenceById = new Map(evidenceRegistry.map((record) => [record.id, record]));
  const evidenceBasedLevels = new Set([
    'direct-professional',
    'adjacent-professional',
    'transferable-professional',
    'academic-foundation'
  ]);
  const requirements = request.deterministicInput.requirements.map((requirement) => {
    const refs = (Array.isArray(requirement.evidenceRefs) ? requirement.evidenceRefs : [])
      .filter((id) => evidenceById.has(id));
    const capabilities = refs
      .flatMap((id) => evidenceById.get(id).capabilities || [])
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 2);
    let matchLevel = 'unverified';
    if (requirement.classification === 'gap') {
      matchLevel = 'explicit-gap';
    } else if (refs.length) {
      matchLevel = requirement.evidenceType === 'academic'
        ? 'academic-foundation'
        : 'direct-professional';
    }

    return {
      requirementId: requirement.id,
      recruiterIntent: `Assess recruiter-safe evidence for ${requirement.term}.`,
      expectedOutcome: `Clarify what published evidence covers for ${requirement.term}.`,
      matchLevel,
      evidenceRefs: evidenceBasedLevels.has(matchLevel) ? refs : [],
      transferableCapabilities: matchLevel === 'transferable-professional' ? capabilities : [],
      limitation: `Keep ${requirement.term} within the published evidence boundary.`,
      recruiterFraming: `Frame ${requirement.term} without overstating unpublished experience.`,
      verificationQuestion: `What concrete delivery example best proves ${requirement.term}?`,
      confidence: refs.length ? 'high' : 'medium'
    };
  });

  return JSON.stringify({
    narrative: 'Structured recruiter reasoning grounded only in the bounded deterministic request and canonical evidence registry.',
    requirements
  });
}

const DETERMINISTIC_MATCH_LISTS = ['strongMatches', 'partialMatches', 'gaps', 'unverified'];

function buildRequestWithNestedMatchMutation(baseRequest, listKey, mutation) {
  const request = JSON.parse(JSON.stringify(baseRequest));
  const deterministicResult = request.deterministicInput.deterministicResult;
  const validMatch = {
    term: 'Kubernetes',
    label: 'Published evidence boundary for the test match.',
    evidenceType: 'professional',
    evidenceRefs: [request.evidenceIds[0]]
  };

  for (const key of DETERMINISTIC_MATCH_LISTS) {
    deterministicResult[key] = [{ ...validMatch }];
  }
  deterministicResult[listKey][0] = {
    ...deterministicResult[listKey][0],
    ...mutation
  };
  return request;
}

async function callWorker(body, options = {}) {
  const worker = await loadWorker();
  const fetchCalls = [];
  const aiCalls = [];
  const kbText = options.kbText || 'AIMeer bounded recruiter knowledge base.';
  const profile = options.profile || loadProfile();
  const profileJson = JSON.stringify(profile);
  const cacheStore = new Map();
  const originalFetch = global.fetch;
  const originalCaches = global.caches;

  global.fetch = async (url) => {
    const target = String(url);
    fetchCalls.push(target);
    if (target.includes('/assets/data/aimeer-kb.txt')) {
      return new Response(kbText, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    if (target.includes('/assets/data/aimeer-profile.json')) {
      return new Response(profileJson, {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`unexpected fetch ${target}`);
  };

  global.caches = {
    default: {
      async match(request) {
        return cacheStore.get(String(request.url)) || null;
      },
      async put(request, response) {
        cacheStore.set(String(request.url), response.clone());
      }
    }
  };

  const env = {};
  if (options.includeAi !== false) {
    env.AI = {
      async run(model, payload) {
        aiCalls.push({ model, payload });
        if (options.aiError) throw options.aiError;
        return {
          response: options.aiResponse !== undefined
            ? options.aiResponse
            : buildValidReasoningResponse(body, profile)
        };
      }
    };
  }

  try {
    const response = await worker.fetch(new Request('https://worker.example.test/', {
      method: 'POST',
      headers: {
        Origin: options.origin || 'http://localhost:8080',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }), env);
    const json = await response.json();
    return { status: response.status, json, fetchCalls, aiCalls };
  } finally {
    global.fetch = originalFetch;
    global.caches = originalCaches;
  }
}

test('jd-reasoning accepts a bounded valid request and returns strict JSON reasoning', async () => {
  const request = buildValidRequest({ language: 'en' });
  const profile = loadProfile();
  const response = await callWorker(request, {
    profile,
    aiResponse: buildValidReasoningResponse(request, profile)
  });

  assert.equal(response.status, 200);
  assert.equal(typeof response.json.reasoning, 'string');

  const parsed = JSON.parse(response.json.reasoning);
  assert.equal(typeof parsed.narrative, 'string');
  assert.equal(Array.isArray(parsed.requirements), true);
  assert.equal(parsed.requirements.length, request.deterministicInput.requirements.length);

  assert.equal(response.aiCalls.length, 1, 'bounded reasoning should invoke Workers AI exactly once');
  assert.equal(response.aiCalls[0].model, '@cf/meta/llama-3.1-8b-instruct-fast');
  assert.equal(response.aiCalls[0].payload.temperature <= 0.2, true, 'reasoning should use a low temperature');
  assert.equal(response.aiCalls[0].payload.max_tokens <= 900, true, 'reasoning should keep bounded output tokens');
  assert.equal(
    response.aiCalls[0].payload.messages.filter((message) => message.role === 'system').length,
    1,
    'the worker should assemble its own single system prompt'
  );
  assert.match(response.aiCalls[0].payload.messages[0].content, /strict json/i);
  assert.equal(
    response.aiCalls[0].payload.messages.some((message) => /client supplied system prompt/i.test(message.content)),
    false,
    'client system prompts must never be forwarded to the model'
  );
  assert.equal(
    response.fetchCalls.some((url) => url.includes('/assets/data/aimeer-kb.txt')),
    true,
    'the worker should load the shared AIMeer knowledge base'
  );
  assert.equal(
    response.fetchCalls.some((url) => url.includes('/assets/data/aimeer-profile.json')),
    true,
    'the worker should load the canonical recruiter evidence registry'
  );
});

test('jd-reasoning Worker enforces evidence provenance for evidence-based match levels', async () => {
  const profile = loadProfile();
  const request = buildValidRequest({ language: 'en' });
  request.evidenceIds = Array.from(new Set([
    ...request.evidenceIds,
    'academic.intelligent-systems',
    'user.agile-context'
  ]));
  const baseReasoning = JSON.parse(buildValidReasoningResponse(request, profile));

  const invalidCases = [
    ['academic evidence cited as professional', 'adjacent-professional', 'academic.intelligent-systems'],
    ['user-provided evidence cited as professional', 'transferable-professional', 'user.agile-context']
  ];
  for (const [label, matchLevel, evidenceRef] of invalidCases) {
    const reasoning = JSON.parse(JSON.stringify(baseReasoning));
    reasoning.requirements[0].matchLevel = matchLevel;
    reasoning.requirements[0].evidenceRefs = [evidenceRef];
    const response = await callWorker(request, {
      profile,
      aiResponse: JSON.stringify(reasoning)
    });

    assert.equal(response.status, 502, `${label} should reject the model output`);
    assert.equal(response.json.error, 'reasoning-invalid');
    assert.equal(response.aiCalls.length, 1, `${label} should be rejected after the single AI response is validated`);
  }

  const validAcademic = JSON.parse(JSON.stringify(baseReasoning));
  validAcademic.requirements[0].matchLevel = 'academic-foundation';
  validAcademic.requirements[0].evidenceRefs = ['academic.intelligent-systems'];
  const academicResponse = await callWorker(request, {
    profile,
    aiResponse: JSON.stringify(validAcademic)
  });
  assert.equal(academicResponse.status, 200, 'academic-foundation should accept academic evidence');

  const validProfessional = JSON.parse(JSON.stringify(baseReasoning));
  validProfessional.requirements[0].matchLevel = 'adjacent-professional';
  validProfessional.requirements[0].evidenceRefs = ['professional.azure-delivery'];
  const professionalResponse = await callWorker(request, {
    profile,
    aiResponse: JSON.stringify(validProfessional)
  });
  assert.equal(professionalResponse.status, 200, 'professional match levels should accept professional evidence');
});

test('jd-reasoning keeps noisy salary and benefits sections out of the bounded browser-to-worker payload', async () => {
  const request = buildValidRequest({
    language: 'en',
text: `Required Skills:
- Bicep leave management system
- CI/CD
- ASP.NET Core medical device integration
- Azure compensation analytics platform
Preferred Skills:
- Kubernetes
Employer Questions:
- What is your expected salary?
- Do you need medical coverage?
- How much annual leave do you expect?
Application Questions:
- Are you willing to relocate?`
  });
  const profile = loadProfile();
  const response = await callWorker(request, {
    profile,
    aiResponse: buildValidReasoningResponse(request, profile)
  });

  assert.equal(request.jdText.toLowerCase().includes('expected salary'), false, 'projected jdText should exclude salary questions');
  assert.equal(request.jdText.toLowerCase().includes('medical coverage'), false, 'projected jdText should exclude medical coverage questions');
  assert.equal(request.jdText.toLowerCase().includes('annual leave'), false, 'projected jdText should exclude annual leave questions');
  assert.match(request.jdText.toLowerCase(), /medical device integration/, 'valid medical device requirements should remain in the projection');
  assert.match(request.jdText.toLowerCase(), /leave management system/, 'valid leave management requirements should remain in the projection');
  assert.match(request.jdText.toLowerCase(), /compensation analytics platform/, 'valid compensation analytics requirements should remain in the projection');
  assert.equal(request.jdText.toLowerCase().includes('employer questions'), false, 'projected jdText should exclude employer question headings');
  assert.equal(request.jdText.toLowerCase().includes('application questions'), false, 'projected jdText should exclude application question headings');
  assert.equal(response.status, 200, 'the recruiter-safe projection should remain valid at the worker contract boundary');
  assert.equal(response.aiCalls.length, 1, 'valid recruiter-safe payloads should still reach Workers AI');
});

test('jd-reasoning Worker rejects clear contractual and employee-admin privacy contexts', async () => {
  const validRequest = buildValidRequest({
    language: 'en',
    text: `Required Skills:
- ASP.NET Core medical device integration
- Azure DevOps leave management system`
  });
  const rejectedContexts = [
    'Expected monthly basic salary',
    'Expected compensation',
    'Total compensation',
    'Compensation package',
    'Compensation history',
    'Compensation range',
    'Remuneration package',
    'Remuneration expectation',
    'Remuneration range',
    'Employee compensation',
    'Pay remuneration',
    'candidate compensation review',
    'candidate remuneration review',
    'admin compensation workflow',
    'Medical coverage',
    'Annual leave',
    'Employee benefits',
    'NRIC verification',
    'Home address',
    'Date of birth',
    'Signatures'
  ];

  for (const context of rejectedContexts) {
    const response = await callWorker({
      ...validRequest,
      jdText: `${validRequest.jdText}\n${context}`
    });

    assert.equal(response.status, 400, `${context} should be rejected at the Worker privacy boundary`);
    assert.equal(response.json.error, 'jd-privacy-invalid');
    assert.equal(response.aiCalls.length, 0, `${context} should fail before Workers AI is invoked`);
  }
});

test('jd-reasoning rejects invalid request shapes before calling Workers AI', async () => {
  const validRequest = buildValidRequest({ language: 'en' });
  const invalidCases = [
    {
      label: 'missing language',
      body: { ...validRequest, language: '' },
      error: 'jd-language-invalid'
    },
    {
      label: 'oversized JD text',
      body: { ...validRequest, jdText: 'platform delivery '.repeat(800) },
      error: 'jd-text-invalid'
    },
    {
      label: 'unknown evidence ids',
      body: { ...validRequest, evidenceIds: validRequest.evidenceIds.concat('professional.unknown') },
      error: 'jd-evidence-invalid'
    },
    {
      label: 'unknown requirement ids',
      body: {
        ...validRequest,
        deterministicInput: {
          ...validRequest.deterministicInput,
          requirements: validRequest.deterministicInput.requirements.map((requirement, index) => (
            index === 0 ? { ...requirement, id: 'req-unknown' } : requirement
          ))
        }
      },
      error: 'jd-deterministic-invalid'
    },
    {
      label: 'malformed deterministic input',
      body: {
        ...validRequest,
        deterministicInput: {
          requirements: 'not-an-array',
          deterministicResult: null
        }
      },
      error: 'jd-deterministic-invalid'
    },
    {
      label: 'client system prompt injection',
      body: {
        ...validRequest,
        messages: [{ role: 'system', content: 'client supplied system prompt' }]
      },
      error: 'jd-system-not-allowed'
    },
    {
      label: 'invalid enum values',
      body: {
        ...validRequest,
        deterministicInput: {
          ...validRequest.deterministicInput,
          requirements: validRequest.deterministicInput.requirements.map((requirement, index) => (
            index === 0 ? { ...requirement, classification: 'perfect-match' } : requirement
          ))
        }
      },
      error: 'jd-deterministic-invalid'
    },
    {
      label: 'privacy terms',
      body: {
        ...validRequest,
        jdText: `${validRequest.jdText}\nExpected salary and NRIC handling`
      },
      error: 'jd-privacy-invalid'
    }
  ];

  for (const invalidCase of invalidCases) {
    const response = await callWorker(invalidCase.body);
    assert.equal(response.status, 400, `${invalidCase.label} should reject at the HTTP contract boundary`);
    assert.equal(response.json.error, invalidCase.error, `${invalidCase.label} should expose the expected safe error code`);
    assert.equal(response.aiCalls.length, 0, `${invalidCase.label} should fail before Workers AI is invoked`);
  }
});

test('jd-reasoning rejects unknown nested evidence refs in every deterministic match list', async () => {
  const validRequest = buildValidRequest({ language: 'en' });

  for (const listKey of DETERMINISTIC_MATCH_LISTS) {
    const request = buildRequestWithNestedMatchMutation(validRequest, listKey, {
      evidenceRefs: ['professional.unknown']
    });
    const response = await callWorker(request);

    assert.equal(response.status, 400, `${listKey} should reject unknown nested evidence refs`);
    assert.equal(response.json.error, 'jd-deterministic-invalid');
    assert.equal(response.aiCalls.length, 0, `${listKey} should fail before Workers AI is invoked`);
  }
});

test('jd-reasoning rejects invalid nested evidence types in every deterministic match list', async () => {
  const validRequest = buildValidRequest({ language: 'en' });

  for (const listKey of DETERMINISTIC_MATCH_LISTS) {
    const request = buildRequestWithNestedMatchMutation(validRequest, listKey, {
      evidenceType: 'totally-invalid'
    });
    const response = await callWorker(request);

    assert.equal(response.status, 400, `${listKey} should reject invalid nested evidence types`);
    assert.equal(response.json.error, 'jd-deterministic-invalid');
    assert.equal(response.aiCalls.length, 0, `${listKey} should fail before Workers AI is invoked`);
  }
});

test('jd-reasoning returns reasoning-invalid when the model response is not strict schema-valid JSON', async () => {
  const request = buildValidRequest({ language: 'ms' });
  const response = await callWorker(request, {
    aiResponse: '{"narrative":"invalid because requirements are missing"}'
  });

  assert.equal(response.status, 502);
  assert.equal(response.json.error, 'reasoning-invalid');
  assert.equal(response.aiCalls.length, 1, 'schema validation failures should still come from a single AI response');
});

test('jd-reasoning accepts all-gap deterministic requests with empty evidence ids', async () => {
  const request = buildValidRequest({
    language: 'en',
    text: `Required Skills:
- COBOL
- Mainframe operations
- AS400
Preferred Skills:
- Actuarial claims systems`
  });
  const profile = loadProfile();
  const response = await callWorker(request, {
    profile,
    aiResponse: buildValidReasoningResponse(request, profile)
  });

  assert.equal(Array.isArray(request.evidenceIds), true, 'all-gap requests should still produce an evidenceIds array');
  assert.equal(request.evidenceIds.length, 0, 'all-gap requests should be allowed to carry an empty evidence registry');
  assert.equal(
    request.deterministicInput.requirements.every((requirement) => Array.isArray(requirement.evidenceRefs) && requirement.evidenceRefs.length === 0),
    true,
    'all-gap deterministic requirements should not need evidence refs'
  );
  assert.equal(
    ['strongMatches', 'partialMatches', 'gaps', 'unverified'].every((key) =>
      request.deterministicInput.deterministicResult[key].every((item) => Array.isArray(item.evidenceRefs) && item.evidenceRefs.length === 0)
    ),
    true,
    'all-gap deterministic match lists should not include nested evidence refs'
  );
  assert.equal(response.status, 200, 'empty evidence registries should still be valid when the deterministic payload is fully bounded');
  assert.equal(response.aiCalls.length, 1, 'valid all-gap requests should still reach Workers AI');
});

test('jd-reasoning rejects empty evidence ids when deterministic metadata still claims strong or partial matches', async () => {
  const request = buildValidRequest({ language: 'en' });
  request.evidenceIds = [];
  request.deterministicInput.requirements = request.deterministicInput.requirements.map((requirement) => ({
    ...requirement,
    evidenceRefs: []
  }));
  for (const listKey of DETERMINISTIC_MATCH_LISTS) {
    request.deterministicInput.deterministicResult[listKey] = request.deterministicInput.deterministicResult[listKey].map((item) => ({
      ...item,
      evidenceRefs: []
    }));
  }

  assert.equal(
    request.deterministicInput.requirements.some((requirement) => requirement.classification === 'strong' || requirement.classification === 'partial'),
    true,
    'the forged request should retain non-gap requirement classifications'
  );
  assert.equal(
    request.deterministicInput.deterministicResult.strongMatches.length > 0 ||
      request.deterministicInput.deterministicResult.partialMatches.length > 0,
    true,
    'the forged request should retain strong or partial match-list metadata'
  );

  const response = await callWorker(request);

  assert.equal(response.status, 400, 'empty evidence must reject forged non-gap deterministic metadata');
  assert.equal(response.json.error, 'jd-deterministic-invalid');
  assert.equal(response.aiCalls.length, 0, 'forged empty-evidence requests must fail before Workers AI is invoked');
});

test('existing chat, summary, and jd-explanation modes remain compatible', async () => {
  const chat = await callWorker({
    mode: 'chat',
    messages: [{ role: 'user', content: 'Tell me about ASP.NET Core work.' }]
  }, {
    aiResponse: 'Chat reply'
  });
  assert.equal(chat.status, 200);
  assert.equal(chat.json.reply, 'Chat reply');

  const summary = await callWorker({
    mode: 'summary',
    messages: [{ role: 'user', content: 'Summarize this conversation.' }]
  }, {
    aiResponse: 'Summary reply'
  });
  assert.equal(summary.status, 200);
  assert.equal(summary.json.reply, 'Summary reply');

  const explanation = await callWorker({
    mode: 'jd-explanation',
    language: 'en',
    messages: [{
      role: 'user',
      content: 'Explain this deterministic recruiter match result.'
    }],
    jdText: 'Required Skills:\n- ASP.NET Core\n',
    matchResult: {
      score: 72,
      confidence: {
        label: 'medium',
        reasons: ['Published evidence covers core requirements.']
      },
      categories: {
        coreTechnologies: {
          score: 24,
          weight: 30,
          key: 'coreTechnologies',
          label: 'Core technologies',
          matchedRequirements: 1,
          totalRequirements: 1,
          matchedTerms: ['ASP.NET Core']
        }
      },
      strongMatches: [{
        term: 'ASP.NET Core',
        label: 'Published multi-tenant delivery evidence is present.',
        evidenceType: 'professional',
        evidence: ['RetailAIM Plus']
      }],
      partialMatches: [],
      gaps: [],
      unverified: [],
      interviewTopics: []
    }
  }, {
    aiResponse: 'Explanation reply'
  });
  assert.equal(explanation.status, 200);
  assert.equal(explanation.json.reply, 'Explanation reply');
});
