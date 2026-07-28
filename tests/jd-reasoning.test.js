const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const fixturesRoot = path.join(__dirname, 'fixtures');
const profilePath = path.join(repoRoot, 'assets', 'data', 'aimeer-profile.json');
const extractorPath = path.join(repoRoot, 'assets', 'js', 'jd-extractor.js');
const matcherPath = path.join(repoRoot, 'assets', 'js', 'jd-matcher.js');
const reasoningPath = path.join(repoRoot, 'assets', 'js', 'jd-reasoning.js');
const MANUAL_MATCH_LEVEL_FACTORS = {
  'direct-professional': 1,
  'adjacent-professional': 0.75,
  'transferable-professional': 0.55,
  'academic-foundation': 0.3,
  'learning-bridge': 0.15,
  'explicit-gap': 0,
  unverified: 0
};
const MANUAL_STRENGTH_FACTORS = {
  required: 1,
  neutral: 0.75,
  preferred: 0.5
};
const MANUAL_DETERMINISTIC_FACTORS = {
  strong: 1,
  partial: 0.5,
  gap: 0,
  unverified: 0
};

function loadProfile() {
  return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
}

function loadTask6Fixture(name) {
  return fs.readFileSync(path.join(fixturesRoot, name), 'utf8');
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

function manualClampScore(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function manualBaseFactorForRequirement(requirement) {
  return MANUAL_DETERMINISTIC_FACTORS[requirement && requirement.classification] || 0;
}

function manualVerifiedFactorForRequirement(requirement) {
  if (!requirement) return 0;
  if (requirement.classification !== 'strong') return 0;
  if (requirement.evidenceType === 'professional') return 1;
  if (requirement.category === 'educationCoursework' && requirement.evidenceType === 'academic') return 1;
  return 0;
}

function manualEffectiveFactorForRequirement(requirement, reasoningItem) {
  const baseFactor = manualBaseFactorForRequirement(requirement);
  if (!reasoningItem) return baseFactor;
  if (requirement.classification === 'strong' || requirement.classification === 'gap') return baseFactor;
  if (requirement.specificHandsOn && requirement.yearsRequired !== null) return baseFactor;

  const factor = MANUAL_MATCH_LEVEL_FACTORS[reasoningItem.matchLevel];
  if (!Number.isFinite(factor)) return baseFactor;
  if (!Array.isArray(reasoningItem.evidenceRefs) || !reasoningItem.evidenceRefs.length) return baseFactor;
  return Math.max(baseFactor, factor);
}

function manualScoreByFactor(requirements, categories, factorResolver) {
  const categoryTotals = Object.create(null);
  const categoryMatched = Object.create(null);
  const categoryWeights = Object.create(null);
  let activeWeight = 0;
  let weightedScore = 0;

  for (const [category, value] of Object.entries(categories || {})) {
    categoryWeights[category] = manualClampScore(value && value.weight);
  }

  for (const requirement of requirements) {
    const category = requirement.category;
    const strengthFactor = MANUAL_STRENGTH_FACTORS[requirement.strength] || MANUAL_STRENGTH_FACTORS.neutral;
    categoryTotals[category] = (categoryTotals[category] || 0) + strengthFactor;
    categoryMatched[category] = (categoryMatched[category] || 0) + (factorResolver(requirement) * strengthFactor);
  }

  for (const category of Object.keys(categoryTotals)) {
    const total = categoryTotals[category];
    if (!total) continue;
    const weight = categoryWeights[category] || 0;
    const score = weight * ((categoryMatched[category] || 0) / total);
    weightedScore += score;
    activeWeight += weight;
  }

  return activeWeight ? Math.round(manualClampScore((weightedScore / activeWeight) * 100)) : 0;
}

function manualReasoningAudit(result, reasoning, input) {
  const requirements = Array.isArray(input && input.requirements) ? input.requirements : [];
  const categories = result && typeof result.categories === 'object' ? result.categories : {};
  const reasoningByRequirementId = new Map((reasoning && reasoning.requirements || []).map((item) => [item.requirementId, item]));
  const verifiedScore = manualScoreByFactor(requirements, categories, manualVerifiedFactorForRequirement);
  const transferableScore = manualScoreByFactor(
    requirements,
    categories,
    (requirement) => manualEffectiveFactorForRequirement(requirement, reasoningByRequirementId.get(requirement.id))
  );
  const requiredGapCeiling = manualScoreByFactor(requirements, categories, (requirement) => {
    const reasoningItem = reasoningByRequirementId.get(requirement.id);
    if (reasoningItem && reasoningItem.matchLevel === 'explicit-gap' && requirement.strength === 'required') return 0;
    return 1;
  });
  const deterministicScore = manualClampScore(result && (result.deterministicScore !== undefined ? result.deterministicScore : result.score));
  return {
    verifiedScore,
    transferableScore,
    requiredGapCeiling,
    compositeScore: Math.round(Math.min(transferableScore, deterministicScore + 15, requiredGapCeiling))
  };
}

function reasoningForFixture(input, overrides) {
  const byTerm = new Map(input.requirements.map((item) => [item.term, item]));
  const directProfessionalLevels = new Set(['direct-professional', 'adjacent-professional', 'transferable-professional']);
  const entries = input.requirements.map((item) => {
    const override = overrides[item.term] || {};
    const inferredMatchLevel = (
      item.classification === 'strong'
        ? 'direct-professional'
        : item.classification === 'partial'
          ? 'transferable-professional'
          : item.classification === 'gap'
            ? 'explicit-gap'
            : 'unverified'
    );
    const inferredEvidenceRefs = directProfessionalLevels.has(inferredMatchLevel) ? item.evidenceRefs.slice() : [];
    const matchLevel = override.matchLevel || (
      directProfessionalLevels.has(inferredMatchLevel) && !inferredEvidenceRefs.length
        ? 'unverified'
        : inferredMatchLevel
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

test('JDReasoning.buildInput keeps valid medical and leave domain requirements while filtering admin privacy terms', () => {
  const allowedCases = [
    'Azure medical device integration',
    'Azure leave management system',
    'Azure compensation analytics platform'
  ];
  for (const requirement of allowedCases) {
    const { harness, profile, normalized, result } = analyze(`Required Skills:\n- ${requirement}\n`);
    const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');

    assert.match(input.jdText.toLowerCase(), new RegExp(requirement.toLowerCase()), `${requirement} should remain in the recruiter-safe projection`);
  }

  const rejectedCases = [
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
    'Azure candidate compensation review',
    'Azure candidate remuneration review',
    'Azure admin compensation workflow',
    'Medical coverage',
    'Annual leave',
    'Employee benefits',
    'NRIC verification',
    'Home address',
    'Date of birth',
    'Signatures'
  ];
  for (const requirement of rejectedCases) {
    const { harness, profile, normalized, result } = analyze(`Required Skills:\n- ${requirement}\n`);
    const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');

    assert.equal(
      input.jdText.toLowerCase().includes(requirement.toLowerCase()),
      false,
      `${requirement} should not enter the recruiter-safe projection`
    );
  }
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

test('JDReasoning.validateModelOutput rejects direct-professional conclusions without evidence refs', () => {
  const { harness, profile, normalized, result } = analyze('Required Skills:\n- Azure\n');
  assert.ok(harness.JDReasoning, 'JDReasoning should be loaded');
  const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');
  const payload = reasoningForFixture(input, {});
  payload.requirements[0].matchLevel = 'direct-professional';
  payload.requirements[0].evidenceRefs = [];

  const validation = harness.JDReasoning.validateModelOutput(JSON.stringify(payload), input);

  assert.equal(validation.ok, false);
  assert.match(validation.error, /evidence/i);
});

test('JDReasoning.validateModelOutput enforces evidence provenance for every evidence-based match level', () => {
  const { harness, profile, normalized, result } = analyze('Required Skills:\n- Kubernetes\n');
  assert.ok(harness.JDReasoning, 'JDReasoning should be loaded');
  const baseInput = harness.JDReasoning.buildInput(normalized, result, profile, 'en');
  const evidenceById = new Map(profile.recruiterEvidence.map((record) => [record.id, record]));
  const input = {
    ...baseInput,
    evidenceRegistry: [
      ...baseInput.evidenceRegistry,
      evidenceById.get('academic.intelligent-systems'),
      evidenceById.get('user.agile-context'),
      evidenceById.get('professional.production-delivery')
    ]
  };
  const invalidCases = [
    ['academic evidence cited as professional', 'adjacent-professional', 'academic.intelligent-systems'],
    ['user-provided evidence cited as professional', 'transferable-professional', 'user.agile-context']
  ];

  for (const [label, matchLevel, evidenceRef] of invalidCases) {
    const payload = reasoningForFixture(input, {});
    payload.requirements[0].matchLevel = matchLevel;
    payload.requirements[0].evidenceRefs = [evidenceRef];
    const validation = harness.JDReasoning.validateModelOutput(JSON.stringify(payload), input);

    assert.equal(validation.ok, false, `${label} should reject the model output`);
    assert.match(validation.error, /evidence/i, `${label} should explain the provenance failure`);
  }

  const academicPayload = reasoningForFixture(input, {});
  academicPayload.requirements[0].matchLevel = 'academic-foundation';
  academicPayload.requirements[0].evidenceRefs = ['academic.intelligent-systems'];
  assert.equal(
    harness.JDReasoning.validateModelOutput(JSON.stringify(academicPayload), input).ok,
    true,
    'academic-foundation should accept academic evidence'
  );

  const professionalPayload = reasoningForFixture(input, {});
  professionalPayload.requirements[0].matchLevel = 'adjacent-professional';
  professionalPayload.requirements[0].evidenceRefs = ['professional.production-delivery'];
  assert.equal(
    harness.JDReasoning.validateModelOutput(JSON.stringify(professionalPayload), input).ok,
    true,
    'professional match levels should accept professional evidence'
  );
});

test('JDReasoning.validateModelOutput rejects HTML-bearing model strings', () => {
  const { harness, profile, normalized, result } = analyze('Required Skills:\n- Azure\n');
  assert.ok(harness.JDReasoning, 'JDReasoning should be loaded');
  const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');
  const invalidCases = [
    {
      label: 'script payload',
      mutate(payload) {
        payload.narrative = '<script>alert(1)</script>';
      }
    },
    {
      label: 'bold payload',
      mutate(payload) {
        payload.requirements[0].recruiterIntent = '<b>Intent</b>';
      }
    },
    {
      label: 'image event payload',
      mutate(payload) {
        payload.requirements[0].limitation = '<img src=x onerror=alert(1)>';
      }
    }
  ];

  for (const invalidCase of invalidCases) {
    const payload = reasoningForFixture(input, {});
    invalidCase.mutate(payload);
    const validation = harness.JDReasoning.validateModelOutput(JSON.stringify(payload), input);
    assert.equal(validation.ok, false, `${invalidCase.label} should reject HTML-bearing strings`);
    assert.match(validation.error, /html|markup|tag/i, `${invalidCase.label} should explain the rejection`);
  }
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

test('JDReasoning.mergeResult refuses score lift from incompatible evidence records without prior validation', () => {
  const { harness, profile, normalized, result } = analyze('Required Skills:\n- Kubernetes\n');
  assert.ok(harness.JDReasoning, 'JDReasoning should be loaded');
  const baseInput = harness.JDReasoning.buildInput(normalized, result, profile, 'en');
  const evidenceById = new Map(profile.recruiterEvidence.map((record) => [record.id, record]));
  const input = {
    ...baseInput,
    evidenceRegistry: [
      ...baseInput.evidenceRegistry,
      evidenceById.get('academic.intelligent-systems'),
      evidenceById.get('user.agile-context')
    ]
  };

  for (const evidenceRef of ['academic.intelligent-systems', 'user.agile-context']) {
    const reasoning = reasoningForFixture(input, {});
    reasoning.requirements[0].matchLevel = 'adjacent-professional';
    reasoning.requirements[0].evidenceRefs = [evidenceRef];

    const merged = harness.JDReasoning.mergeResult(result, reasoning, input);
    const entry = merged.requirementReasoning[0];

    assert.equal(entry.effectiveFactor, entry.baseFactor, `${evidenceRef} must not create a score lift`);
    assert.equal(entry.lifted, false, `${evidenceRef} must remain unlifted even when merge bypasses validation`);
  }
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

test('JDReasoning task 6 fixtures preserve deterministic scores and keep every score lift audited and bounded', () => {
  const fixtures = [
    {
      name: 'laravel enterprise',
      filename: 'jd-laravel-enterprise.txt',
      expectedDeterministicScore: 87,
      assertions({ before, after }) {
        const laravelDuration = after.requirementReasoning.find((item) => item.term === '2 years');
        assert.equal(laravelDuration.matchLevel, 'adjacent-professional', 'the reasoning payload should try to transfer adjacent Laravel evidence');
        assert.equal(laravelDuration.effectiveFactor, laravelDuration.baseFactor, 'specific technology-duration requirements must not receive semantic lift');
        assert.match(laravelDuration.limitation, /Laravel/i, 'the Laravel duration limitation should stay visible');
        assert.match(laravelDuration.verificationQuestion, /Laravel/i, 'the Laravel duration should keep a recruiter verification question');
        assert.equal(before.score, 87, 'the approved Laravel baseline must remain 87');
      },
      overrides: {
        '2 years': {
          matchLevel: 'adjacent-professional',
          evidenceRefs: ['professional.production-delivery'],
          transferableCapabilities: ['production deployments'],
          limitation: 'Published Laravel delivery exists, but the profile does not publish two years of named Laravel-only hands-on depth.',
          recruiterFraming: 'Treat the named Laravel duration as a follow-up topic, not a verified duration match.',
          verificationQuestion: 'How much of the published delivery history was hands-on Laravel implementation specifically?'
        },
        Agile: {
          matchLevel: 'unverified',
          evidenceRefs: ['user.agile-context'],
          transferableCapabilities: ['Agile delivery context'],
          limitation: 'Agile context is user-provided rather than independently published by an employer source.',
          verificationQuestion: 'Which Agile ceremonies and delivery ownership does he currently handle directly?'
        },
        'AI-assisted development': {
          matchLevel: 'unverified',
          evidenceRefs: ['user.agile-context'],
          transferableCapabilities: ['AI-assisted development', 'workflow automation'],
          limitation: 'AI-tool usage is user-provided context and should stay within the published project scope.',
          verificationQuestion: 'Which current production tasks rely on Claude Code or Codex today?'
        }
      }
    },
    {
      name: 'kubernetes transfer',
      filename: 'jd-kubernetes-transfer.txt',
      expectedDeterministicScore: 50,
      assertions({ after }) {
        const kubernetes = after.requirementReasoning.find((item) => item.term === 'Kubernetes');
        assert.equal(kubernetes.matchLevel, 'adjacent-professional', 'Kubernetes should receive bounded adjacent transfer only');
        assert.equal(kubernetes.verified, false, 'Kubernetes should remain outside verified direct evidence');
        assert.match(kubernetes.limitation, /Kubernetes/i, 'the Kubernetes limitation should stay visible');
        assert.match(kubernetes.verificationQuestion, /Kubernetes/i, 'the Kubernetes requirement should keep a recruiter verification question');
      },
      overrides: {
        Kubernetes: {
          matchLevel: 'adjacent-professional',
          evidenceRefs: ['professional.azure-delivery', 'professional.production-delivery'],
          transferableCapabilities: ['cloud delivery', 'infrastructure as code'],
          limitation: 'Published Azure delivery is adjacent to Kubernetes operations, but Kubernetes itself is still unproven.',
          recruiterFraming: 'Use the Azure delivery overlap as bounded transfer only.',
          verificationQuestion: 'Which Kubernetes clusters or workloads has he operated directly in production?'
        }
      }
    },
    {
      name: 'mobile framework transfer',
      filename: 'jd-mobile-framework-transfer.txt',
      expectedDeterministicScore: 8,
      assertions({ after }) {
        const xamarin = after.requirementReasoning.find((item) => item.term === 'Xamarin');
        const crossPlatform = after.requirementReasoning.find((item) => item.term === 'Cross-platform Mobile Development');
        assert.equal(xamarin.matchLevel, 'unverified', 'the unproven named framework must not become a direct or adjacent professional claim');
        assert.equal(xamarin.lifted, false, 'the unproven named framework must not receive score lift');
        assert.equal(crossPlatform.matchLevel, 'adjacent-professional', 'cross-platform mobile delivery can receive bounded transfer from published Flutter work');
        assert.equal(crossPlatform.lifted, true, 'cross-platform delivery should receive bounded transfer credit');
        assert.match(crossPlatform.limitation, /Flutter|framework/i, 'the cross-platform limitation should explain the framework boundary');
      },
      overrides: {
        Xamarin: {
          matchLevel: 'unverified',
          evidenceRefs: [],
          transferableCapabilities: [],
          limitation: 'Published mobile work documents Flutter, Android, and iOS delivery, but not Xamarin itself.',
          recruiterFraming: 'Do not present Xamarin as proven production experience.',
          verificationQuestion: 'Has he ever maintained a Xamarin codebase directly?'
        },
        'Cross-platform Mobile Development': {
          matchLevel: 'adjacent-professional',
          evidenceRefs: ['professional.mobile-delivery'],
          transferableCapabilities: ['cross-platform development', 'mobile delivery'],
          limitation: 'Published cross-platform delivery is via Flutter rather than the JD’s named framework.',
          recruiterFraming: 'Use the published Flutter delivery as bounded cross-platform transfer, not named-framework proof.',
          verificationQuestion: 'Which cross-platform mobile delivery patterns from Flutter would transfer fastest here?'
        }
      }
    }
  ];

  for (const fixture of fixtures) {
    const { harness, profile, normalized, result: before } = analyze(loadTask6Fixture(fixture.filename));
    const input = harness.JDReasoning.buildInput(normalized, before, profile, 'en');
    const validation = harness.JDReasoning.validateModelOutput(JSON.stringify(reasoningForFixture(input, fixture.overrides)), input);
    assert.equal(validation.ok, true, `${fixture.name}: the reasoning payload should validate`);

    const after = harness.JDReasoning.mergeResult(before, validation.reasoning, input);
    const expectedAudit = manualReasoningAudit(before, validation.reasoning, input);
    const liftedEntries = after.requirementReasoning.filter((item) => item.lifted);

    assert.equal(before.score, fixture.expectedDeterministicScore, `${fixture.name}: the deterministic fixture baseline should stay stable`);
    assert.equal(after.deterministicScore, before.score, `${fixture.name}: reasoning must not change the deterministic score`);
    assert.equal(after.score, before.score, `${fixture.name}: the top-level score should remain the authoritative deterministic score`);
    assert.equal(after.verifiedScore, expectedAudit.verifiedScore, `${fixture.name}: verified score should match the independent audit`);
    assert.equal(after.transferableScore, expectedAudit.transferableScore, `${fixture.name}: transferable score should match the independent audit`);
    assert.equal(after.requiredGapCeiling, expectedAudit.requiredGapCeiling, `${fixture.name}: required-gap ceiling should match the independent audit`);
    assert.equal(
      after.compositeScore,
      Math.min(after.transferableScore, before.score + 15, after.requiredGapCeiling),
      `${fixture.name}: composite score should respect the bounded merge formula`
    );
    assert.equal(after.compositeScore, expectedAudit.compositeScore, `${fixture.name}: composite score should match the independent audit`);

    for (const entry of liftedEntries) {
      assert.ok(entry.evidenceRefs.length > 0, `${fixture.name}: every score lift must cite evidence refs`);
      assert.ok(entry.limitation, `${fixture.name}: every score lift must keep a limitation`);
      assert.ok(entry.verificationQuestion, `${fixture.name}: every score lift must keep a verification question`);
    }

    fixture.assertions({ before, after, input, validation });
  }
});
