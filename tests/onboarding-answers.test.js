const test = require('node:test');
const assert = require('node:assert/strict');
const {
  serializeOnboardingAnswers,
  parseOnboardingAnswers,
} = require('../routes/lib/onboardingAnswers');

test('returns null when there is nothing to store', () => {
  assert.equal(serializeOnboardingAnswers({}), null);
  assert.equal(serializeOnboardingAnswers(null), null);
});

test('keeps valid answers and drops junk', () => {
  const json = serializeOnboardingAnswers({
    aiPartnerExpectation: 'connection',
    onboardingAnswers: {
      companionGender: 'female',
      companionName: '  Lara  ',
      shareTopics: ['feelings', 'feelings', 'Bad Slug!', 3, 'goals'],
      chatStyle: 'not-a-list',
      statements: { meaningful_bonds: 'yes', open_friendships: 'maybe', motivated: 'skip' },
      evil: 'DROP TABLE',
    },
  });
  assert.deepEqual(JSON.parse(json), {
    aiPartnerExpectation: 'connection',
    companionGender: 'female',
    companionName: 'Lara',
    shareTopics: ['feelings', 'goals'],
    statements: { meaningful_bonds: 'yes', motivated: 'skip' },
  });
});

test('rejects unknown companion gender and trims long names', () => {
  const out = JSON.parse(
    serializeOnboardingAnswers({
      onboardingAnswers: { companionGender: 'robot', companionName: 'x'.repeat(40) },
    })
  );
  assert.equal(out.companionGender, undefined);
  assert.equal(out.companionName.length, 25);
});

test('parse handles strings, objects and bad input', () => {
  assert.deepEqual(parseOnboardingAnswers('{"a":1}'), { a: 1 });
  assert.deepEqual(parseOnboardingAnswers({ a: 1 }), { a: 1 });
  assert.equal(parseOnboardingAnswers('nope'), null);
  assert.equal(parseOnboardingAnswers('[1]'), null);
  assert.equal(parseOnboardingAnswers(null), null);
});
