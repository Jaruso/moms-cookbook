import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicRecipe, recipeStatus } from './recipe-status.js';

test('drafts and hidden recipes are excluded from public website', () => {
  assert.equal(isPublicRecipe({}), true);
  assert.equal(isPublicRecipe({ draft: false, hidden: false }), true);
  assert.equal(isPublicRecipe({ draft: true, hidden: false }), false);
  assert.equal(isPublicRecipe({ draft: false, hidden: true }), false);
  assert.equal(isPublicRecipe({ draft: true, hidden: true }), false);
});

test('draft is a distinct admin status from hidden', () => {
  assert.equal(recipeStatus({ draft: true, hidden: false }), 'Draft');
  assert.equal(recipeStatus({ draft: false, hidden: true }), 'Hidden');
  assert.equal(recipeStatus({}), 'Visible');
});
