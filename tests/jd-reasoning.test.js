const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const profilePath = path.join(__dirname, '..', 'assets', 'data', 'aimeer-profile.json');
const privacyExclusions = [
  'salary',
  'nric',
  'home address',
  'date of birth',
  'benefits',
  'leave',
  'medical',
  'signatures',
  'confidential contract language'
];

function loadProfile() {
  return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
}

test('profile exposes the recruiter evidence registry', () => {
  const profile = loadProfile();
  assert.ok(Array.isArray(profile.recruiterEvidence), 'profile.recruiterEvidence should exist');

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

  for (const [id, evidenceType] of expectedRecords) {
    const record = registryById.get(id);
    assert.ok(record, `expected recruiterEvidence record ${id}`);
    assert.equal(record.evidenceType, evidenceType, `${id} should keep its evidence type`);
    assert.equal(typeof record.claim, 'string', `${id} should have a claim`);
    assert.equal(record.claim.trim().length > 0, true, `${id} should have a non-empty claim`);
    assert.ok(Array.isArray(record.technologies), `${id} should expose technologies[]`);
    assert.ok(Array.isArray(record.capabilities), `${id} should expose capabilities[]`);
    assert.ok(Array.isArray(record.scope), `${id} should expose scope[]`);
    assert.equal(typeof record.sourceLabel, 'string', `${id} should expose sourceLabel`);
    assert.equal(record.sourceLabel.trim().length > 0, true, `${id} should have a non-empty sourceLabel`);

    for (const exclusion of privacyExclusions) {
      assert.equal(
        record.claim.toLowerCase().includes(exclusion),
        false,
        `${id} claim should not include privacy exclusion ${exclusion}`
      );
    }
  }

  for (const record of profile.recruiterEvidence) {
    assert.ok(
      ['professional', 'academic', 'user-provided'].includes(record.evidenceType),
      `unexpected evidence type for ${record.id || '(missing id)'}`
    );
  }
});
