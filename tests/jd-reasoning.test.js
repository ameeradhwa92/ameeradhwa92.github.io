const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const profilePath = path.join(__dirname, '..', 'assets', 'data', 'aimeer-profile.json');

function loadProfile() {
  return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
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
