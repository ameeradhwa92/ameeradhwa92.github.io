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

function manualComputeFitBand(score) {
  const value = manualClampScore(score);
  if (value >= 75) return 'strong';
  if (value >= 60) return 'good';
  if (value >= 40) return 'partial';
  return 'limited';
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
  const deterministicScore = manualClampScore(result && (result.deterministicScore !== undefined ? result.deterministicScore : result.score));
  // Independent re-derivation of the clamp band: finalScore must stay inside
  // [deterministicScore - 10, max(deterministicScore + 35, 65)], bounded to 0-100.
  // The ceiling is floored at 65 (owner-approved, see FINAL WHOLE-BRANCH REVIEW I1) so a
  // well-evidenced adjacent-stack judgment can still reach "Good fit" even when the keyword
  // pass found nothing (deterministicScore 0 -> ceiling would otherwise be 35).
  const aiScore = manualClampScore(reasoning && reasoning.overall ? reasoning.overall.score : deterministicScore);
  const bandMin = Math.max(0, deterministicScore - 10);
  const bandMax = Math.min(100, Math.max(deterministicScore + 35, 65));
  const finalScore = Math.round(Math.min(bandMax, Math.max(bandMin, aiScore)));
  return {
    verifiedScore,
    transferableScore,
    aiScore: Math.round(aiScore),
    finalScore,
    adjusted: Math.round(aiScore) !== finalScore,
    fitBand: manualComputeFitBand(finalScore)
  };
}

const DEFAULT_OVERALL = {
  score: 62,
  fitBand: 'good',
  narrative: 'AI-led recruiter-facing summary grounded only in the published deterministic match result and evidence registry.'
};

function reasoningForFixture(input, overrides, overallOverride) {
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
    requirements: entries,
    overall: Object.assign({}, DEFAULT_OVERALL, overallOverride || {})
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
  assert.match(input.jdText, /platform delivery/, 'jdText should carry the job description prose, not only the extracted requirement terms');
});

test('JDReasoning.buildInput forwards employer offer prose and withholds personal identifiers', () => {
  /* These describe the employer's own offer or a technical domain. They are not private data
     about anyone, and a screen that rejected them would reject nearly every real posting. */
  const forwarded = [
    'Azure medical device integration',
    'Azure leave management system',
    'Azure compensation analytics platform',
    'Expected monthly basic salary RM12,000',
    'Salary range is negotiable',
    'Expected compensation discussed at offer stage',
    'Total compensation includes a performance bonus',
    'Compensation package is competitive',
    'Remuneration package reviewed annually',
    'Employee compensation is benchmarked to market',
    'Payroll compensation review workflow ownership',
    'Medical coverage for you and your dependents',
    'Medical insurance from day one',
    'Health benefits and dental',
    '18 days annual leave plus public holidays',
    'Parental leave and flexible hours',
    'Employee benefits package includes gym membership',
    /* Employers use both of these to describe or ask about their own offer, so they stay
       forwarded even though their record-style siblings below are blocked. Withholding a real
       posting's whole prose over the employer's own words is the over-blocking this screen
       exists to avoid. */
    'State your salary history in the application form',
    'Leave entitlement: 18 days annual leave plus public holidays',
    'Leave entitlement grows with tenure',
    /* Ordinary technical prose: the singular "signature" must not withhold a whole posting. */
    'Build digital signature APIs and DocuSign integration'
  ];
  for (const line of forwarded) {
    const { harness, profile, normalized, result } = analyze(`Required Skills:\n- Kubernetes\n${line}\n`);
    const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');

    assert.match(
      input.jdText.toLowerCase(),
      new RegExp(line.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `"${line}" should reach the model`
    );
  }

  /* A pasted document can carry a third party's identifiers. Those must never be forwarded,
     whatever else the document says. */
  const withheld = [
    'NRIC verification required',
    'Attach a copy of your MyKad',
    'State your IC number in the application form',
    'Reference 920101-14-5523 on file',
    'Home address must be stated',
    'Date of birth must be stated',
    'Passport number required for travel',
    'Bank account number for payroll setup',
    'Signatures required on the appointment letter',
    'See the confidential contract language attached',
    /* Record-style phrasings name a person's history, not an employer's offer. */
    'Medical history must be declared',
    'Compensation history from your previous employer',
    'Benefits history on file',
    'Leave balance carried forward'
  ];
  for (const line of withheld) {
    const { harness, profile, normalized, result } = analyze(`Required Skills:\n- Kubernetes\n${line}\n`);
    const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');

    assert.equal(
      input.jdText.toLowerCase().includes(line.toLowerCase()),
      false,
      `"${line}" must not reach the model`
    );
    assert.match(input.jdText, /withheld/i, `"${line}" should leave the withheld notice in place of the prose`);
    assert.equal(input.jdText.length > 0, true, 'the Worker rejects a blank jdText, so the notice must be non-empty');
  }
});

/* jd-extractor.js deliberately builds structure into normalizedText (bullets become "\n- ",
   tabs become newlines, blank runs collapse to one). Sending the prose is only worth doing if
   that structure survives: headings and bullet boundaries are how the model sees sections and
   seniority framing. */
test('JDReasoning.buildInput keeps the job description line structure in jdText', () => {
  const { harness, profile, normalized, result } = analyze(
    'Responsibilities:\n• Own    the   Azure platform\n• Mentor engineers\n\n\n\nRequired Skills:\n- Kubernetes\n- Azure DevOps\n'
  );
  const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');

  assert.match(input.jdText, /^Responsibilities:$/m, 'headings should stay on their own line');
  assert.match(input.jdText, /^Required Skills:$/m, 'later headings should stay on their own line');
  assert.match(input.jdText, /^- Own the Azure platform$/m, 'bullets should stay on their own line');
  assert.match(input.jdText, /^- Mentor engineers$/m, 'every bullet should keep its own line');
  assert.doesNotMatch(input.jdText, /Own {2,}the/, 'runs of spaces within a line should collapse');
  assert.doesNotMatch(input.jdText, /\n{3,}/, 'blank runs should cap at one blank line');
  assert.doesNotMatch(input.jdText, / \n|\n /, 'no trailing or leading spaces around line breaks');
  assert.equal(input.jdText.length <= 12000, true, 'the 12,000-character cap still applies');
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

test('JDReasoning.validateModelOutput rejects unknown requirement ids, duplicate ids, unknown evidence refs, unsupported capabilities, invalid match levels, overlong fields, and smuggled per-requirement score fields', () => {
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
      label: 'model numeric scores at the reasoning root',
      mutate(payload) {
        payload.transferableScore = 99;
      },
      pattern: /score/i
    },
    {
      label: 'smuggled per-requirement score fields',
      mutate(payload) {
        payload.requirements[0].score = 99;
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

  // The scoring contract inverted in Task 1: the model is now REQUIRED to report a
  // top-level overall.score (validated 0-100 above), but it must still never be able to
  // report a score on an individual requirement or anywhere outside `overall`.
  const validBaseline = harness.JDReasoning.validateModelOutput(JSON.stringify(valid), input);
  assert.equal(validBaseline.ok, true, 'a legitimate overall.score must still be accepted');
  assert.equal(validBaseline.reasoning.overall.score, valid.overall.score, 'the accepted overall.score should survive validation unchanged (aside from clamping)');
});

/* DELIBERATE CHANGE: an overlong field used to reject the whole response. It is clipped instead.
   Every one of these values is clipped to its limit on the way into the reasoning object, so
   rejecting as well meant a verbose model lost an entire report over text that was about to be
   trimmed. The protection that mattered — bounded text reaching the report — is unchanged, and is
   what this test now pins. The Worker applies the identical rule. */
test('JDReasoning.validateModelOutput clips an overlong field instead of rejecting the response', () => {
  const { harness, profile, normalized, result } = analyze(`Required Skills:
- Kubernetes
- Azure
- Azure DevOps
- Bicep
Preferred Skills:
- CI/CD
`);
  const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');
  const payload = reasoningForFixture(input, {});
  payload.requirements[0].recruiterIntent = 'x'.repeat(700);

  const validation = harness.JDReasoning.validateModelOutput(JSON.stringify(payload), input);

  assert.equal(validation.ok, true, 'an overlong field must not discard the whole report');
  assert.equal(validation.reasoning.requirements[0].recruiterIntent.length, 320,
    'the field must still arrive clipped to its limit');
});

/* A blank per-requirement field is legitimate — a requirement with direct published evidence has
   no limitation to state — and rejecting it was the live `limitation-invalid` failure. The
   narrative is the exception: an empty one means the model produced no headline at all. */
test('JDReasoning.validateModelOutput accepts a blank per-requirement field but not a blank narrative', () => {
  const { harness, profile, normalized, result } = analyze(`Required Skills:
- Kubernetes
- Azure
- Azure DevOps
- Bicep
Preferred Skills:
- CI/CD
`);
  const input = harness.JDReasoning.buildInput(normalized, result, profile, 'en');

  const blankLimitation = reasoningForFixture(input, {});
  blankLimitation.requirements[0].limitation = '';
  const accepted = harness.JDReasoning.validateModelOutput(JSON.stringify(blankLimitation), input);
  assert.equal(accepted.ok, true, 'a blank limitation must not discard the report');
  assert.equal(accepted.reasoning.requirements[0].limitation, '');

  const blankNarrative = reasoningForFixture(input, {});
  blankNarrative.narrative = '   ';
  const rejected = harness.JDReasoning.validateModelOutput(JSON.stringify(blankNarrative), input);
  assert.equal(rejected.ok, false, 'an empty narrative means there is no report to show');
  assert.match(rejected.error, /narrative/i);
});

test('JDReasoning.mergeResult preserves the deterministic score and clamps the AI score into the [det-10, det+35] band', () => {
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
  // deterministicScore for this fixture is 30, so the clamp band is [max(0, 30-10), min(100, 30+35)] = [20, 65].
  // A model score of 90 sits above the band ceiling, so it must be clamped down to 65 (not accepted as-is).
  const validation = harness.JDReasoning.validateModelOutput(JSON.stringify(reasoningForFixture(input, {
    Kubernetes: {
      matchLevel: 'adjacent-professional',
      evidenceRefs: ['professional.azure-delivery', 'professional.production-delivery'],
      transferableCapabilities: ['cloud delivery', 'infrastructure as code'],
      limitation: 'Published Azure delivery is adjacent to Kubernetes operations, but Kubernetes itself is still unproven.',
      verificationQuestion: 'Which Kubernetes clusters or workloads has he operated in production?'
    }
  }, { score: 90, fitBand: 'strong', narrative: 'Strong overall fit driven by adjacent cloud delivery experience.' })), input);
  assert.equal(validation.ok, true, 'the reasoning fixture should validate before merge');

  const merged = harness.JDReasoning.mergeResult(result, validation.reasoning, input);
  const kubernetes = merged.requirementReasoning.find((item) => item.requirementId === requirementByTerm(result, 'Kubernetes').id);

  assert.equal(merged.deterministicScore, 30, 'deterministic score should remain unchanged');
  assert.equal(merged.verifiedScore, 30, 'verified score should reflect only direct deterministic evidence');
  assert.equal(merged.transferableScore, 83, 'transferable score should apply the adjacent-professional factor');
  assert.equal(merged.aiScore, 90, 'aiScore should carry the raw model-reported score, unclamped');
  assert.equal(merged.finalScore, 65, 'finalScore should clamp to the deterministic+35 band ceiling (30 + 35)');
  assert.equal(merged.adjusted, true, 'adjusted should flag that clamping changed the reported AI score');
  assert.equal(merged.fitBand, 'good', 'fitBand must derive from the clamped finalScore (65), not the raw aiScore or the model-reported fitBand');
  assert.equal(merged.compositeScore, merged.finalScore, 'compositeScore should mirror finalScore for legacy consumers (chatbot.js renderer)');
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

test('JDReasoning.mergeResult floors the clamp ceiling at 65 even when the deterministic score is 0', () => {
  // Owner-approved decision (FINAL WHOLE-BRANCH REVIEW, I1): the ceiling is additive
  // (deterministicScore + 35) EXCEPT it never drops below 65, so a well-evidenced
  // adjacent-stack judgment can always reach "Good fit" even against a pure zero-overlap
  // keyword pass (e.g. an AWS/Go JD scored against this Azure/.NET profile) instead of
  // being capped at 35 ("Limited overlap") purely because the keyword engine found nothing.
  const { harness, profile, normalized } = analyze('Required Skills:\n- Kubernetes\n');
  assert.ok(harness.JDReasoning, 'JDReasoning should be loaded');

  const zeroDeterministicResult = {
    score: 0,
    deterministicScore: 0,
    confidence: { label: 'low', reasons: [] },
    categories: {},
    requirements: [],
    strongMatches: [],
    partialMatches: [],
    gaps: [],
    unverified: []
  };
  const input = harness.JDReasoning.buildInput(normalized, zeroDeterministicResult, profile, 'en');
  const reasoning = {
    narrative: 'The keyword pass found no overlap, but the underlying stack is judged adjacent.',
    requirements: [],
    overall: {
      score: 95,
      fitBand: 'strong',
      narrative: 'A high AI-judged score against a zero-keyword deterministic baseline.'
    }
  };

  const merged = harness.JDReasoning.mergeResult(zeroDeterministicResult, reasoning, input);

  assert.equal(merged.deterministicScore, 0, 'deterministic score should remain 0');
  assert.equal(merged.aiScore, 95, 'aiScore should carry the raw model-reported score, unclamped');
  assert.equal(
    merged.finalScore,
    65,
    'the ceiling must floor at 65 (not the additive 0 + 35 = 35), so a well-evidenced adjacent-stack judgment can still reach "Good fit"'
  );
  assert.equal(merged.fitBand, 'good', 'fitBand must derive from the floored ceiling (65), not "limited"');
  assert.equal(merged.adjusted, true, 'adjusted should flag that clamping changed the reported AI score (95 -> 65)');
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
        /* These two once cited `user.agile-context`. That record is `user-provided`, an evidence
           type no matchLevel admits, so offering it to the model was a trap: it was the only
           support either requirement had, the model cited it at a professional level, and the
           Worker refused the ENTIRE report with `evidence-provenance-invalid`. buildInput no
           longer sends uncitable evidence, so these requirements now reach the model with no refs
           — an honest description, since nothing published backs them. The limitation text still
           says where the context came from; it just is not offered as a citation. */
        Agile: {
          matchLevel: 'unverified',
          evidenceRefs: [],
          transferableCapabilities: [],
          limitation: 'Agile context is user-provided rather than independently published by an employer source.',
          verificationQuestion: 'Which Agile ceremonies and delivery ownership does he currently handle directly?'
        },
        'AI-assisted development': {
          matchLevel: 'unverified',
          evidenceRefs: [],
          transferableCapabilities: [],
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
    assert.equal(after.aiScore, expectedAudit.aiScore, `${fixture.name}: aiScore should carry the model's reported overall.score`);
    assert.equal(after.finalScore, expectedAudit.finalScore, `${fixture.name}: finalScore should match the independent clamp-band audit`);
    assert.ok(
      after.finalScore >= Math.max(0, before.score - 10) &&
        after.finalScore <= Math.min(100, Math.max(before.score + 35, 65)),
      `${fixture.name}: finalScore must never leave the [deterministicScore-10, max(deterministicScore+35, 65)] sanity band`
    );
    assert.equal(after.adjusted, expectedAudit.adjusted, `${fixture.name}: adjusted should reflect whether the clamp changed the reported AI score`);
    assert.equal(after.fitBand, expectedAudit.fitBand, `${fixture.name}: fitBand should be derived from the clamped finalScore`);
    assert.equal(after.compositeScore, after.finalScore, `${fixture.name}: composite score should mirror finalScore for legacy consumers`);

    for (const entry of liftedEntries) {
      assert.ok(entry.evidenceRefs.length > 0, `${fixture.name}: every score lift must cite evidence refs`);
      assert.ok(entry.limitation, `${fixture.name}: every score lift must keep a limitation`);
      assert.ok(entry.verificationQuestion, `${fixture.name}: every score lift must keep a verification question`);
    }

    fixture.assertions({ before, after, input, validation });
  }
});

/* The report used to print the AI's score beside the KEYWORD pass's confidence, which read as
   self-contradiction ("82% · Confidence: Low"). The model already returns a per-requirement
   confidence that both validators check; this aggregates it so the headline describes the same
   judgement the score came from. */
test('mergeResult aggregates per-requirement confidence into result.aiConfidence', () => {
  const harness = loadHarness();

  function mergeWithConfidences(confidences) {
    const input = {
      requirements: confidences.map((_, index) => ({
        id: 'req-core-technologies-term-' + index,
        term: 'Term ' + index,
        strength: 'required',
        category: 'coreTechnologies',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'unverified',
        evidenceType: 'unverified',
        evidenceRefs: []
      })),
      evidenceRegistry: []
    };
    const reasoning = {
      narrative: 'Bounded recruiter reasoning.',
      requirements: confidences.map((confidence, index) => ({
        requirementId: 'req-core-technologies-term-' + index,
        recruiterIntent: '',
        expectedOutcome: '',
        matchLevel: 'unverified',
        evidenceRefs: [],
        transferableCapabilities: [],
        limitation: '',
        recruiterFraming: '',
        verificationQuestion: '',
        confidence
      })),
      overall: { score: 70, fitBand: 'good', narrative: 'Overall.' }
    };
    return harness.JDReasoning.mergeResult({ score: 50, categories: {} }, reasoning, input);
  }

  assert.equal(mergeWithConfidences(['high', 'high', 'high']).aiConfidence, 'high');
  assert.equal(mergeWithConfidences(['high', 'low']).aiConfidence, 'medium');
  assert.equal(mergeWithConfidences(['low', 'low', 'low']).aiConfidence, 'low');
  assert.equal(mergeWithConfidences(['medium', 'medium']).aiConfidence, 'medium');

  /* Band edges: 0.833 sits above the 0.67 high threshold, 0.167 below the 0.34 medium one, and
     0.625 is the near-miss that must NOT round up to high. */
  assert.equal(mergeWithConfidences(['high', 'high', 'medium']).aiConfidence, 'high');
  assert.equal(mergeWithConfidences(['medium', 'low', 'low']).aiConfidence, 'low');
  assert.equal(mergeWithConfidences(['high', 'medium', 'medium', 'medium']).aiConfidence, 'medium');

  /* No requirements means nothing to aggregate. Absent, not defaulted — Task 2 falls through to
     the keyword label rather than inventing a confidence the model never expressed. */
  assert.equal('aiConfidence' in mergeWithConfidences([]), false);
});

/* A model-supplied confidence is untrusted input. An object-literal weight map would let
   Object.prototype members through as valid levels — the same trap CONFIDENCE_LEVELS documents. */
test('mergeResult ignores prototype-member confidence values', () => {
  const harness = loadHarness();
  const input = {
    requirements: [{
      id: 'req-core-technologies-term-0',
      term: 'Term 0',
      strength: 'required',
      category: 'coreTechnologies',
      yearsRequired: null,
      specificHandsOn: false,
      classification: 'unverified',
      evidenceType: 'unverified',
      evidenceRefs: []
    }],
    evidenceRegistry: []
  };
  const reasoning = {
    narrative: 'Bounded recruiter reasoning.',
    requirements: [{
      requirementId: 'req-core-technologies-term-0',
      recruiterIntent: '',
      expectedOutcome: '',
      matchLevel: 'unverified',
      evidenceRefs: [],
      transferableCapabilities: [],
      limitation: '',
      recruiterFraming: '',
      verificationQuestion: '',
      confidence: 'constructor'
    }],
    overall: { score: 70, fitBand: 'good', narrative: 'Overall.' }
  };

  const merged = harness.JDReasoning.mergeResult({ score: 50, categories: {} }, reasoning, input);
  assert.equal('aiConfidence' in merged, false);
});
