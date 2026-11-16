import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECOVERY_PREFIX, recoveryKey, cleanForm, formSignature, createRecovery,
  readRecovery, writeRecovery, removeRecovery, listRecoveries,
} from './recovery.js';

function storage() {
  const entries = new Map();
  return {
    get length() { return entries.size; },
    key(index) { return [...entries.keys()][index] ?? null; },
    getItem(key) { return entries.get(key) ?? null; },
    setItem(key, value) { entries.set(key, String(value)); },
    removeItem(key) { entries.delete(key); },
  };
}

const form = {
  title: 'Grandma\'s Sauce',
  description: 'Her recipe.\n\nIt is delicious.',
  category: 'Dinner', prepMinutes: '10', cookMinutes: '20', servings: '4',
  ingredients: [{ rowId: 99, amount: '1 1/2', unit: 'cup', customUnit: '', name: 'tomatoes' }],
  steps: 'Simmer.\nServe.',
};

test('separate recovery keys for new recipes and edits', () => {
  assert.equal(recoveryKey('new'), RECOVERY_PREFIX + 'new');
  assert.equal(recoveryKey({ id: 'family-pie' }), RECOVERY_PREFIX + 'recipe:family-pie');
});

test('recovery saves all text and partial ingredient rows, never credentials or photo data', () => {
  const cached = createRecovery('new', { ...form, password: 'secret', token: 'private' }, false, true, 1234);
  assert.equal(cached.savedAt, 1234);
  assert.equal(cached.hadPhoto, true);
  assert.equal(cached.form.ingredients[0].name, 'tomatoes');
  assert.equal(cached.form.ingredients[0].amount, '1 1/2');
  assert.equal(cached.form.ingredients[0].rowId, undefined);
  assert.equal(JSON.stringify(cached).includes('private'), false);
  assert.equal(JSON.stringify(cached).includes('secret'), false);
  assert.equal(cached.form.description, 'Her recipe.\n\nIt is delicious.');
});

test('read, list, discard and keep individual recipes isolated', () => {
  const s = storage();
  const keyNew = recoveryKey('new');
  const keyEdit = recoveryKey({ id: 'family-pie' });
  const a = createRecovery('new', form, false, false, 1);
  const b = createRecovery({ id: 'family-pie', sha: 'abc' }, { ...form, title: 'Pie' }, true, false, 2);
  assert.equal(writeRecovery(s, keyNew, a), true);
  assert.equal(writeRecovery(s, keyEdit, b), true);
  assert.deepEqual(listRecoveries(s).map(value => value.key), [keyEdit, keyNew]);
  assert.equal(readRecovery(s, keyEdit).sha, 'abc');
  removeRecovery(s, keyNew);
  assert.equal(readRecovery(s, keyNew), null);
  assert.ok(readRecovery(s, keyEdit));
});

test('detect changes without treating ingredient row IDs as content', () => {
  assert.equal(formSignature(form), formSignature({
    ...form, ingredients: [{ ...form.ingredients[0], rowId: 1000 }],
  }));
  assert.notEqual(formSignature(form), formSignature({ ...form, steps: 'Changed!' }));
  assert.notEqual(formSignature(form, false), formSignature(form, true));
  assert.equal(cleanForm(form).title, 'Grandma\'s Sauce');
});

test('corrupt data and storage failures never throw', () => {
  const s = storage();
  s.setItem(recoveryKey('new'), '{bad');
  assert.equal(readRecovery(s, recoveryKey('new')), null);
  assert.deepEqual(listRecoveries(s), []);
  const blocked = { setItem() { throw new Error('blocked'); }, getItem() { throw new Error('blocked'); } };
  assert.equal(writeRecovery(blocked, recoveryKey('new'), {}), false);
  assert.equal(readRecovery(blocked, recoveryKey('new')), null);
});
