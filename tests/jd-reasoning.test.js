const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const profilePath = path.join(repoRoot, 'assets', 'data', 'aimeer-profile.json');
const extractorPath = path.join(repoRoot, 'assets', 'js', 'jd-extractor.js');
const matcherPath = path.join(repoRoot, 'assets', 'js', 'jd-matcher.js');
const reasoningPath = path.join(repoRoot, 'assets', 'js', 'jd-reasoning.js');

function loadProfile() {
  return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
}

function loadHarness() {
  const context = {
    console,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;
  context.window = context;

  vm.runInNewContext(fs.readFileSync(extractorPath, 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(matcherPath, 'utf8'), context);
  if (fs.existsSync(reasoningPath)) {
    vm.runInNewContext(fs.readFileSync(reasoningPath, 'utf8'), context);
  }

  return {
    JDExtractor: context.JDExtractor,
    JDMatcher: context.JDMatcher,
    JDReasoning: context.JDReasoning
  };
}

function analyze(text) {
  const harness = loadHarness();
  const profile = loadProfile();
  const normalized = harness.JDExtractor.normalize(text);
  const result = harness.JDMatcher.scoreJobDescription(normalized, profile);
  return { harness, profile, normalized, result };
}

function requirementByTerm(result, term) {
  return result.requirements.find((item) => item.term === term);
}

function reasoningForFixture(input, overrides) {
  const byTerm = new Map(input.requirements.map((item) => [item.term, item]));
  const directProfessionalLevels = new Set(['direct-professional', 'adjacent-professional', 'transferable-professional']);
  const entries = input.requirements.map((item) => {
    const override = overrides[item.term] || {};
    const matchLevel = override.matchLevel || (
      item.classification === 'strong'
        ? 'direct-professional'
        : item.classification === 'partial'
          ? 'transferable-professional'
          : item.classification === 'gap'
            ? 'explicit-gap'
            : 'unverified'
    );
    const evidenceRefs = override.evidenceRefs !== undefined
      ? override.evidenceRefs
      : (directProfessionalLevels.has(matchLevel) ? item.evidenceRefs.slice() : []);
    const transferableCapabilities = override.transferableCapabilities || [];

    return {
      requirementId: item.id,
      recruiterIntent: override.recruiterIntent || `Assess credible delivery against ${item.term}.`,
      expectedOutcome: override.expectedOutcome || `Explain the published evidence boundary for ${item.term}.`,
      matchLevel,
      evidenceRefs,
      transferableCapabilities,
      limitation: override.limitation || `Keep ${item.term} within the published evidence boundary.`,
      recruiterFraming: override.recruiterFraming || `Use ${item.term} as a recruiter-safe talking point only.`,
      verificationQuestion: override.verificationQuestion || `What concrete production example best proves ${item.term}?`,
      confidence: override.confidence || 'medium'
    };
  });

  return {
    narrative: 'Bounded recruiter reasoning grounded only in the published deterministic match result.',
    requirements: entries
  };
}

test('profile exposes the recruiter evidence registry', () => {
  const profile = loadProfile();
  assert.ok(Array.isArray(profile.recruiterEvidence), 'profile.recruiterEvidence should exist');
  assert.deepEqual(
    profile.privacyExclusions,
    [
      'salary',
      'nric',
      'home address',
      'date of birth',
      'benefits',
      'leave',
      'medical',
      'signatures',
      'confidential contract language'
    ],
    'profile.privacyExclusions should keep the canonical recruiter-safe exclusions'
  );

  const expectedRecords = [
    ['professional.production-delivery', 'professional'],
    ['professional.azure-delivery', 'professional'],
    ['professional.web-api-architecture', 'professional'],
    ['professional.mobile-delivery', 'professional'],
    ['professional.application-quality', 'professional'],
    ['professional.database-design', 'professional'],
    ['professional.stakeholder-collaboration', 'professional'],
    ['academic.intelligent-systems', 'academic'],
    ['user.agile-context', 'user-provided']
  ];

  const registryById = new Map(profile.recruiterEvidence.map((record) => [record.id, record]));
  const privacyExclusions = profile.privacyExclusions.map((term) => term.toLowerCase());
  const recruiterEvidenceKeys = ['id', 'claim', 'technologies', 'capabilities', 'scope', 'sourceLabel'];

  for (const [id, evidenceType] of expectedRecords) {
    const record = registryById.get(id);
    assert.ok(record, `expected recruiterEvidence record ${id}`);
    assert.equal(record.evidenceType, evidenceType, `${id} should keep its evidence type`);
  }

  for (const record of profile.recruiterEvidence) {
    assert.ok(
      ['professional', 'academic', 'user-provided'].includes(record.evidenceType),
      `unexpected evidence type for ${record.id || '(missing id)'}`
    );

    for (const key of recruiterEvidenceKeys) {
      assert.notEqual(record[key], undefined, `${record.id || '(missing id)'} should include ${key}`);
    }

    assert.equal(typeof record.id, 'string', 'recruiter evidence records should expose id');
    assert.equal(record.id.trim().length > 0, true, 'recruiter evidence ids should be non-empty');

    assert.equal(typeof record.claim, 'string', `${record.id} should have a claim`);
    assert.equal(record.claim.trim().length > 0, true, `${record.id} should have a non-empty claim`);
    assert.ok(Array.isArray(record.technologies), `${record.id} should expose technologies[]`);
    assert.ok(Array.isArray(record.capabilities), `${record.id} should expose capabilities[]`);
    assert.ok(Array.isArray(record.scope), `${record.id} should expose scope[]`);
    assert.equal(typeof record.sourceLabel, 'string', `${record.id} should expose sourceLabel`);
    assert.equal(record.sourceLabel.trim().length > 0, true, `${record.id} should have a non-empty sourceLabel`);

    const textFields = [
      ['id', record.id],
      ['claim', record.claim],
      ['sourceLabel', record.sourceLabel]
    ];

    for (const [fieldName, fieldValue] of textFields) {
      const normalizedValue = fieldValue.toLowerCase();

      for (const exclusion of privacyExclusions) {
        assert.equal(
          normalizedValue.includes(exclusion),
          false,
          `${record.id} ${fieldName} should not include privacy exclusion ${exclusion}`
        );
      }
    }

    const listFields = [
      ['technologies', record.technologies],
      ['capabilities', record.capabilities],
      ['scope', record.scope]
    ];

    for (const [fieldName, values] of listFields) {
      assert.ok(values.length > 0, `${record.id} should keep non-empty ${fieldName}`);

      for (const value of values) {
        assert.equal(typeof value, 'string', `${record.id} ${fieldName} entries should be strings`);
        assert.equal(value.trim().length > 0, true, `${record.id} ${fieldName} entries should be non-empty`);

        const normalizedValue = value.toLowerCase();

        for (const exclusion of privacyExclusions) {
          assert.equal(
            normalizedValue.includes(exclusion),
            false,
            `${record.id} ${fieldName} should not include privacy exclusion ${exclusion}`
          );
        }
      }
    }
  }
});

test('JDReasoning.buildInput returns a bounded recruiter-safe payload', () => {
  const { harness, profile, normalized, result } = analyze(`Required Skills:
- Kubernetes
- Azure
- Azure DevOps
- Bicep
Preferred Skills:
- CI/CD
`);
  assert.ok(harness.JDReasoning, 'JDReasoning should be loaded');

  const oversizedNormalized = {
    ...normalized,
    normalizedText: `${normalized.normalizedText}\n${'platform delivery '.repeat(900)}`
  };
  const input = harness.JDReasoning.buildInput(oversizedNormalized, result, profile, 'en');
  const serialized = JSON.stringify(input);
  const expectedEvidenceIds = Array.from(new Set(result.requirements.flatMap((item) => item.evidenceRefs))).sort();
  const expectedCapabilities = Array.from(new Set(
    input.evidenceRegistry.flatMap((record) => record.capabilities)
  )).sort();

  assert.equal(input.language, 'en');
  assert.equal(input.jdText.length <= 12000, true, 'jdText should stay within the 12,000-character cap');
  assert.equal(JSON.stringify(input.deterministicResult).length <= 12000, true, 'deterministicResult should stay within the 12,000-character cap');
  assert.deepEqual(
    Array.from(input.evidenceRegistry, (record) => record.id).sort(),
    expectedEvidenceIds,
    'input should include only recruiter evidence records referenced by deterministic requirements'
  );
  assert.deepEqual(Array.from(input.capabilityVocabulary).sort(), expectedCapabilities, 'capability vocabulary should be derived from the referenced evidence registry');
  assert.equal(serialized.includes('ameeradhwa92@gmail.com'), false, 'reasoning input should not include contact details');
  assert.equal(serialized.includes('+60 13-961 0053'), false, 'reasoning input should not include phone numbers');
  assert.equal(serialized.toLowerCase().includes('salary'), false, 'reasoning input should exclude privacy terms');
});

test('JDReasoning.validateModelOutput accepts valid strict JSON and markdown-wrapped JSON', () => {
  const { harness, profile, normalized, result } = analyze(`Required Skills:
- Kubernetes
- Azure
- Azure DevOps
- Bicep
Preferred Skills:
- CI/CD
`);
  assert.ok(harness.JDReasoning, 'JDReasoning should be loaded');

  const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');
  const raw = JSON.stringify(reasoningForFixture(input, {
    Kubernetes: {
      matchLevel: 'adjacent-professional',
      evidenceRefs: ['professional.azure-delivery', 'professional.production-delivery'],
      transferableCapabilities: ['cloud delivery', 'infrastructure as code'],
      limitation: 'Published Azure delivery is adjacent to Kubernetes operations, but Kubernetes itself is still unproven.',
      verificationQuestion: 'Which Kubernetes clusters or workloads has he operated in production?'
    }
  }));

  const direct = harness.JDReasoning.validateModelOutput(raw, input);
  const wrapped = harness.JDReasoning.validateModelOutput(`\`\`\`json\n${raw}\n\`\`\``, input);

  assert.deepEqual(direct, wrapped, 'markdown fences should not change the validated reasoning result');
  assert.equal(direct.ok, true, 'strict JSON should validate');
  assert.equal(direct.reasoning.requirements.length, input.requirements.length, 'every deterministic requirement should be covered');
});

test('JDReasoning.validateModelOutput rejects malformed JSON', () => {
  const { harness, profile, normalized, result } = analyze('Required Skills:\n- ASP.NET Core\n- Azure\n');
  assert.ok(harness.JDReasoning, 'JDReasoning should be loaded');
  const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');

  const invalid = harness.JDReasoning.validateModelOutput('{"requirements":[', input);

  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /json/i);
});

test('JDReasoning.validateModelOutput rejects unknown requirement ids, duplicate ids, unknown evidence refs, unsupported capabilities, invalid match levels, overlong fields, and model numeric scores', () => {
  const { harness, profile, normalized, result } = analyze(`Required Skills:
- Kubernetes
- Azure
- Azure DevOps
- Bicep
Preferred Skills:
- CI/CD
`);
  assert.ok(harness.JDReasoning, 'JDReasoning should be loaded');

  const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');
  const valid = reasoningForFixture(input, {
    Kubernetes: {
      matchLevel: 'adjacent-professional',
      evidenceRefs: ['professional.azure-delivery'],
      transferableCapabilities: ['cloud delivery']
    }
  });
  const invalidCases = [
    {
      label: 'unknown requirement ids',
      mutate(payload) {
        payload.requirements[0].requirementId = 'req-unknown';
      },
      pattern: /requirement/i
    },
    {
      label: 'duplicate requirement ids',
      mutate(payload) {
        payload.requirements[1].requirementId = payload.requirements[0].requirementId;
      },
      pattern: /duplicate/i
    },
    {
      label: 'unknown evidence refs',
      mutate(payload) {
        payload.requirements[0].evidenceRefs = ['professional.unknown'];
        payload.requirements[0].matchLevel = 'adjacent-professional';
      },
      pattern: /evidence/i
    },
    {
      label: 'unsupported capabilities',
      mutate(payload) {
        payload.requirements[0].evidenceRefs = ['professional.azure-delivery'];
        payload.requirements[0].transferableCapabilities = ['kubernetes administration'];
        payload.requirements[0].matchLevel = 'adjacent-professional';
      },
      pattern: /capabilit/i
    },
    {
      label: 'invalid match levels',
      mutate(payload) {
        payload.requirements[0].matchLevel = 'perfect-match';
      },
      pattern: /match level/i
    },
    {
      label: 'overlong fields',
      mutate(payload) {
        payload.requirements[0].recruiterIntent = 'x'.repeat(700);
      },
      pattern: /length|long/i
    },
    {
      label: 'model numeric scores',
      mutate(payload) {
        payload.transferableScore = 99;
      },
      pattern: /score/i
    }
  ];

  for (const invalidCase of invalidCases) {
    const payload = JSON.parse(JSON.stringify(valid));
    invalidCase.mutate(payload);
    const validation = harness.JDReasoning.validateModelOutput(JSON.stringify(payload), input);
    assert.equal(validation.ok, false, `${invalidCase.label} should reject the model output`);
    assert.match(validation.error, invalidCase.pattern, `${invalidCase.label} should explain the failure`);
  }
});

test('JDReasoning.mergeResult preserves the deterministic score and applies the 15-point composite cap', () => {
  const { harness, profile, normalized, result } = analyze(`Required Skills:
- Kubernetes
- Azure
- Azure DevOps
- Bicep
Preferred Skills:
- CI/CD
`);
  assert.ok(harness.JDReasoning, 'JDReasoning should be loaded');

  const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');
  const validation = harness.JDReasoning.validateModelOutput(JSON.stringify(reasoningForFixture(input, {
    Kubernetes: {
      matchLevel: 'adjacent-professional',
      evidenceRefs: ['professional.azure-delivery', 'professional.production-delivery'],
      transferableCapabilities: ['cloud delivery', 'infrastructure as code'],
      limitation: 'Published Azure delivery is adjacent to Kubernetes operations, but Kubernetes itself is still unproven.',
      verificationQuestion: 'Which Kubernetes clusters or workloads has he operated in production?'
    }
  })), input);
  assert.equal(validation.ok, true, 'the reasoning fixture should validate before merge');

  const merged = harness.JDReasoning.mergeResult(result, validation.reasoning, input);
  const kubernetes = merged.requirementReasoning.find((item) => item.requirementId === requirementByTerm(result, 'Kubernetes').id);

  assert.equal(merged.deterministicScore, 30, 'deterministic score should remain unchanged');
  assert.equal(merged.verifiedScore, 30, 'verified score should reflect only direct deterministic evidence');
  assert.equal(merged.transferableScore, 83, 'transferable score should apply the adjacent-professional factor');
  assert.equal(merged.compositeScore, 45, 'composite score should respect the deterministic +15 ceiling');
  assert.equal(merged.requiredGapCeiling, 100, 'no explicit required gap should leave the ceiling fully open');
  assert.equal(kubernetes.matchLevel, 'adjacent-professional', 'validated reasoning should remain attached to the requirement');
  assert.deepEqual(
    Array.from(kubernetes.evidenceRefs),
    ['professional.azure-delivery', 'professional.production-delivery'],
    'validated evidence refs should survive merging'
  );
  assert.ok(
    merged.sections.transferableAdvantages.some((item) => item.requirementId === kubernetes.requirementId),
    'adjacent transferable reasoning should surface in the transferable section'
  );
});

test('JDReasoning.fallback returns deterministic recruiter-facing reasoning without AI output', () => {
  const { harness, profile, normalized, result } = analyze(`Required Skills:
- Kubernetes
- Azure
- Azure DevOps
- Bicep
Preferred Skills:
- CI/CD
`);
  assert.ok(harness.JDReasoning, 'JDReasoning should be loaded');

  const input = harness.JDReasoning.buildInput(normalized, result, profile, 'ms');
  const fallback = harness.JDReasoning.fallback(result, input, 'ms');

  assert.equal(fallback.mode, 'deterministic-fallback');
  assert.equal(fallback.language, 'ms');
  assert.equal(fallback.deterministicScore, result.score);
  assert.equal(fallback.sections.strengths.length > 0, true, 'fallback should preserve deterministic strengths');
  assert.equal(fallback.sections.gaps.length > 0 || fallback.sections.limitations.length > 0, true, 'fallback should preserve deterministic gaps or limitations');
  assert.equal(fallback.sections.interviewQuestions.length > 0, true, 'fallback should preserve deterministic interview topics');
  assert.match(fallback.narrative, /deterministik|disahkan|jurang/i);
});
