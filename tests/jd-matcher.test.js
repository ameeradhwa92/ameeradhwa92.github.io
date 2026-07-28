const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const profilePath = path.join(repoRoot, 'assets', 'data', 'aimeer-profile.json');
const extractorPath = path.join(repoRoot, 'assets', 'js', 'jd-extractor.js');
const matcherPath = path.join(repoRoot, 'assets', 'js', 'jd-matcher.js');

function loadProfile() {
  return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
}

function loadMatcherHarness() {
  const context = {
    console,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;
  context.window = context;

  vm.runInNewContext(fs.readFileSync(extractorPath, 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(matcherPath, 'utf8'), context);

  return {
    JDExtractor: context.JDExtractor,
    JDMatcher: context.JDMatcher
  };
}

const profile = loadProfile();
const harness = loadMatcherHarness();
const recruiterEvidenceById = new Map((profile.recruiterEvidence || []).map((record) => [record.id, record]));

function analyze(text) {
  const normalized = harness.JDExtractor.normalize(text);
  const result = harness.JDMatcher.scoreJobDescription(normalized, profile);
  return { normalized, result };
}

function requirementByTerm(result, term) {
  return result.requirements.find((item) => item.term === term);
}

function listTerms(list) {
  return Array.from(list, (item) => item.term);
}

function normalizeTerm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9+#./\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function registrySupportsTerm(record, term) {
  const normalizedTerm = normalizeTerm(term);
  const fields = []
    .concat(record.technologies || [])
    .concat(record.capabilities || [])
    .concat(record.scope || []);

  return fields.some((value) => normalizeTerm(value) === normalizedTerm);
}

const fixtures = [
  {
    name: 'direct ASP.NET Core and C# evidence preserves the baseline score',
    text: `Required Skills:
- ASP.NET Core
- C#
- 5+ years of enterprise web application development
Preferred Skills:
- code reviews
`,
    expectedScore: 100,
    expectedLists: {
      strong: ['5+ years', 'ASP.NET Core', 'C#', 'Enterprise web application development', 'Application quality'],
      partial: [],
      gaps: [],
      unverified: []
    },
    requirementChecks: [
      {
        term: 'ASP.NET Core',
        id: 'req-core-technologies-asp-net-core',
        original: '- ASP.NET Core',
        strength: 'required',
        category: 'coreTechnologies',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'strong',
        evidenceType: 'professional',
        evidenceRefs: ['professional.web-api-architecture']
      },
      {
        term: 'C#',
        id: 'req-core-technologies-c-sharp',
        original: 'C#',
        strength: 'required',
        category: 'coreTechnologies',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'strong',
        evidenceType: 'professional',
        evidenceRefs: []
      },
      {
        term: '5+ years',
        id: 'req-professional-experience-5-plus-years',
        original: '- 5+ years of enterprise web application development',
        strength: 'required',
        category: 'professionalExperience',
        yearsRequired: 5,
        specificHandsOn: false,
        classification: 'strong',
        evidenceType: 'professional',
        evidenceRefs: []
      },
      {
        term: 'Application quality',
        id: 'req-professional-experience-application-quality',
        original: 'code reviews',
        strength: 'preferred',
        category: 'professionalExperience',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'strong',
        evidenceType: 'professional',
        evidenceRefs: ['professional.application-quality']
      }
    ]
  },
  {
    name: 'Kubernetes stays unverified while Azure delivery evidence stays direct',
    text: `Required Skills:
- Kubernetes
- Azure
- Azure DevOps
- Bicep
Preferred Skills:
- CI/CD
`,
    expectedScore: 30,
    expectedLists: {
      strong: ['Azure', 'Azure DevOps', 'Bicep', 'Production delivery'],
      partial: [],
      gaps: [],
      unverified: ['Kubernetes']
    },
    requirementChecks: [
      {
        term: 'Kubernetes',
        id: 'req-core-technologies-kubernetes',
        original: 'Kubernetes',
        strength: 'required',
        category: 'coreTechnologies',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'unverified',
        evidenceType: 'unverified',
        evidenceRefs: []
      },
      {
        term: 'Azure',
        id: 'req-architecture-delivery-cloud-azure',
        original: '- Azure',
        strength: 'required',
        category: 'architectureDeliveryCloud',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'strong',
        evidenceType: 'professional',
        evidenceRefs: []
      },
      {
        term: 'Azure DevOps',
        id: 'req-architecture-delivery-cloud-azure-devops',
        original: 'Azure DevOps',
        strength: 'required',
        category: 'architectureDeliveryCloud',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'strong',
        evidenceType: 'professional',
        evidenceRefs: ['professional.azure-delivery', 'professional.production-delivery']
      },
      {
        term: 'Production delivery',
        id: 'req-architecture-delivery-cloud-production-delivery',
        original: 'CI/CD',
        strength: 'preferred',
        category: 'architectureDeliveryCloud',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'strong',
        evidenceType: 'professional',
        evidenceRefs: ['professional.production-delivery']
      }
    ]
  },
  {
    name: 'Laravel hands-on duration stays partial without changing the score',
    text: `Required Skills:
- Laravel
- 2 years of hands-on experience with Laravel
- 5+ years experience
`,
    expectedScore: 91,
    expectedLists: {
      strong: ['5+ years', 'Laravel'],
      partial: ['2 years'],
      gaps: [],
      unverified: []
    },
    requirementChecks: [
      {
        term: 'Laravel',
        id: 'req-core-technologies-laravel',
        original: 'Laravel',
        strength: 'required',
        category: 'coreTechnologies',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'strong',
        evidenceType: 'professional',
        evidenceRefs: []
      },
      {
        term: '2 years',
        id: 'req-professional-experience-2-years',
        original: '- 2 years of hands-on experience with Laravel',
        strength: 'required',
        category: 'professionalExperience',
        yearsRequired: 2,
        specificHandsOn: true,
        classification: 'partial',
        evidenceType: 'professional',
        evidenceRefs: []
      }
    ]
  },
  {
    name: 'mobile fixtures keep academic OCR evidence distinct',
    text: `Required Skills:
- Android
- Tesseract OCR
`,
    expectedScore: 75,
    expectedLists: {
      strong: ['Android'],
      partial: ['Tesseract OCR'],
      gaps: [],
      unverified: []
    },
    requirementChecks: [
      {
        term: 'Android',
        id: 'req-mobile-android',
        original: 'Android',
        strength: 'required',
        category: 'mobile',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'strong',
        evidenceType: 'professional',
        evidenceRefs: ['professional.mobile-delivery']
      },
      {
        term: 'Tesseract OCR',
        id: 'req-mobile-tesseract-ocr',
        original: 'Tesseract OCR',
        strength: 'required',
        category: 'mobile',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'partial',
        evidenceType: 'academic',
        evidenceRefs: []
      }
    ]
  },
  {
    name: 'user-provided Agile and AI context stays partial',
    text: `Required Skills:
- Agile
- AI tools
`,
    expectedScore: 50,
    expectedLists: {
      strong: [],
      partial: ['Agile', 'AI-assisted development'],
      gaps: [],
      unverified: []
    },
    requirementChecks: [
      {
        term: 'Agile',
        id: 'req-professional-experience-agile',
        original: 'Agile',
        strength: 'required',
        category: 'professionalExperience',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'partial',
        evidenceType: 'user-provided',
        evidenceRefs: ['user.agile-context']
      },
      {
        term: 'AI-assisted development',
        id: 'req-core-technologies-ai-assisted-development',
        original: 'AI tools',
        strength: 'required',
        category: 'coreTechnologies',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'partial',
        evidenceType: 'user-provided',
        evidenceRefs: ['user.agile-context']
      }
    ]
  },
  {
    name: 'administrative salary and location questions stay out of the deterministic score',
    text: `Employer Questions:
- Expected monthly basic salary
- Work location
- Which of the following statements best describes your right to work in Malaysia?
`,
    expectedScore: 0,
    expectedLists: {
      strong: [],
      partial: [],
      gaps: [],
      unverified: []
    },
    requirementChecks: []
  },
  {
    name: 'absent mobile requirements stay inactive',
    text: `Required Skills:
- ASP.NET Core
- Azure
- SQL databases
`,
    expectedScore: 100,
    expectedLists: {
      strong: ['ASP.NET Core', 'Azure', 'SQL databases'],
      partial: [],
      gaps: [],
      unverified: []
    },
    requirementChecks: [
      {
        term: 'SQL databases',
        id: 'req-core-technologies-sql-databases',
        original: 'SQL databases',
        strength: 'required',
        category: 'coreTechnologies',
        yearsRequired: null,
        specificHandsOn: false,
        classification: 'strong',
        evidenceType: 'professional',
        evidenceRefs: []
      }
    ],
    checkMobileInactive: true
  }
];

test('matcher exposes stable deterministic requirement metadata without changing the baseline score', () => {
  for (const fixture of fixtures) {
    const first = analyze(fixture.text);
    const second = analyze(fixture.text);

    assert.equal(first.result.score, fixture.expectedScore, `${fixture.name}: score should preserve the baseline`);
    assert.equal(first.result.deterministicScore, fixture.expectedScore, `${fixture.name}: deterministicScore should preserve the baseline`);
    assert.equal(first.result.score, first.result.deterministicScore, `${fixture.name}: score and deterministicScore should stay equal`);

    assert.deepEqual(listTerms(first.result.strongMatches), fixture.expectedLists.strong, `${fixture.name}: strong match terms should stay unchanged`);
    assert.deepEqual(listTerms(first.result.partialMatches), fixture.expectedLists.partial, `${fixture.name}: partial match terms should stay unchanged`);
    assert.deepEqual(listTerms(first.result.gaps), fixture.expectedLists.gaps, `${fixture.name}: gap terms should stay unchanged`);
    assert.deepEqual(listTerms(first.result.unverified), fixture.expectedLists.unverified, `${fixture.name}: unverified terms should stay unchanged`);

    assert.ok(Array.isArray(first.result.requirements), `${fixture.name}: requirements[] should be returned`);
    assert.deepEqual(
      first.result.requirements.map((item) => item.id),
      second.result.requirements.map((item) => item.id),
      `${fixture.name}: requirement ids should be stable across repeated runs`
    );

    for (const check of fixture.requirementChecks) {
      const requirement = requirementByTerm(first.result, check.term);
      assert.ok(requirement, `${fixture.name}: expected requirement ${check.term}`);
      assert.equal(requirement.id, check.id, `${fixture.name}: ${check.term} should keep a stable id`);
      assert.equal(requirement.original, check.original, `${fixture.name}: ${check.term} should keep its source text`);
      assert.equal(requirement.strength, check.strength, `${fixture.name}: ${check.term} should keep its requirement strength`);
      assert.equal(requirement.category, check.category, `${fixture.name}: ${check.term} should keep its category`);
      assert.equal(requirement.yearsRequired, check.yearsRequired, `${fixture.name}: ${check.term} should keep its duration metadata`);
      assert.equal(requirement.specificHandsOn, check.specificHandsOn, `${fixture.name}: ${check.term} should keep its hands-on metadata`);
      assert.equal(requirement.classification, check.classification, `${fixture.name}: ${check.term} should keep its classification`);
      assert.equal(requirement.evidenceType, check.evidenceType, `${fixture.name}: ${check.term} should keep its evidence type`);
      assert.deepEqual(
        Array.from(requirement.evidenceRefs).sort(),
        check.evidenceRefs.slice().sort(),
        `${fixture.name}: ${check.term} should keep its evidence refs`
      );
    }

    if (fixture.checkMobileInactive) {
      assert.equal(first.result.categories.mobile.active, false, `${fixture.name}: mobile should remain inactive`);
      assert.equal(
        first.result.requirements.some((item) => item.category === 'mobile'),
        false,
        `${fixture.name}: no mobile requirements should be emitted`
      );
    }
  }
});

test('matcher rejects recruiter evidence refs that are not actually published in the authoritative registry fields', () => {
  const csharp = analyze(`Required Skills:
- C#
`).result;
  const laravel = analyze(`Required Skills:
- Laravel
- 2 years of hands-on experience with Laravel
`).result;
  const enterprise = analyze(`Required Skills:
- Enterprise web application development
`).result;

  const csharpRequirement = requirementByTerm(csharp, 'C#');
  const laravelRequirement = requirementByTerm(laravel, 'Laravel');
  const laravelDurationRequirement = requirementByTerm(laravel, '2 years');
  const enterpriseRequirement = requirementByTerm(enterprise, 'Enterprise web application development');

  assert.deepEqual(
    Array.from(csharpRequirement.evidenceRefs),
    [],
    'C# should not cite recruiter evidence refs when no registry record publishes C# in its technologies/capabilities/scope'
  );
  assert.deepEqual(
    Array.from(laravelRequirement.evidenceRefs),
    [],
    'Laravel should not cite recruiter evidence refs when no registry record publishes Laravel in its technologies/capabilities/scope'
  );
  assert.deepEqual(
    Array.from(laravelDurationRequirement.evidenceRefs),
    [],
    'Laravel duration partials should not cite unsupported recruiter evidence refs'
  );
  assert.deepEqual(
    Array.from(enterpriseRequirement.evidenceRefs),
    [],
    'Enterprise web application development should not cite a registry record that only publishes enterprise web applications as scope'
  );

  for (const [term, refs] of [
    ['C#', Array.from(csharpRequirement.evidenceRefs)],
    ['Laravel', Array.from(laravelRequirement.evidenceRefs)],
    ['Laravel', Array.from(laravelDurationRequirement.evidenceRefs)],
    ['Enterprise web application development', Array.from(enterpriseRequirement.evidenceRefs)]
  ]) {
    for (const ref of refs) {
      const record = recruiterEvidenceById.get(ref);
      assert.ok(record, `${term}: recruiter evidence ref ${ref} should exist in the profile registry`);
      assert.equal(
        registrySupportsTerm(record, term),
        true,
        `${term}: recruiter evidence ref ${ref} should be supported by registry technologies/capabilities/scope`
      );
    }
  }
});
