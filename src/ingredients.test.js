import test from 'node:test';
import assert from 'node:assert/strict';
import { makeIngredientRow, parseIngredientString, serializeIngredient, serializeIngredients } from './ingredients.js';

test('common units give natural recipe measurements', () => {
  assert.equal(serializeIngredient(makeIngredientRow({ amount: '2', unit: 'cup', name: 'flour' })), '2 cups flour');
  assert.equal(serializeIngredient(makeIngredientRow({ amount: '1', unit: 'cup', name: 'sugar' })), '1 cup sugar');
  assert.equal(serializeIngredient(makeIngredientRow({ amount: '1/2', unit: 'cup', name: 'milk' })), '1/2 cup milk');
  assert.equal(serializeIngredient(makeIngredientRow({ amount: '3', unit: 'clove', name: 'garlic' })), '3 cloves garlic');
  assert.equal(serializeIngredient(makeIngredientRow({ amount: '2', unit: 'tbsp', name: 'olive oil' })), '2 tbsp olive oil');
});

test('custom units and ingredients without measurements remain supported', () => {
  assert.equal(serializeIngredient(makeIngredientRow({ amount: '2', unit: 'custom', customUnit: 'bunches', name: 'parsley' })), '2 bunches parsley');
  assert.equal(serializeIngredient(makeIngredientRow({ name: 'Salt and pepper, to taste' })), 'Salt and pepper, to taste');
  assert.throws(() => serializeIngredient(makeIngredientRow({ name: 'parsley', unit: 'custom' })), /custom measurement/);
});

test('legacy strings can be loaded and saved without losing ingredient wording', () => {
  const examples = [
    '2 tbsp olive oil',
    '1 small onion, diced',
    '3 cloves garlic, minced',
    '1 can (28 oz) crushed tomatoes',
    '1 tsp dried oregano',
    'Salt and pepper, to taste',
    'A handful of fresh basil',
  ];
  assert.deepEqual(serializeIngredients(examples.map(parseIngredientString)), examples);
});

test('fractional amounts roundtrip for existing recipes', () => {
  for (const text of ['1/2 cup cream', '1 1/2 cups flour', '½ cup milk']) {
    assert.equal(serializeIngredient(parseIngredientString(text)), text);
  }
});

test('empty rows are rejected instead of silently omitted', () => {
  assert.throws(() => serializeIngredients([makeIngredientRow()]), /name/);
});
