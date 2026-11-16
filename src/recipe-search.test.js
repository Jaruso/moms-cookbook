import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearch, canonicalCategory, availableCategories, totalRecipeMinutes, searchRecipes, addIngredientFilter, removeIngredientFilter } from './recipe-search.js';

const recipes = [
  {
    id: 'tomato-sauce', title: 'Sunday Tomato Sauce', category: 'Dinner',
    description: ['An old family favorite.'], ingredients: ['2 tbsp olive oil', '3 cloves garlic', '28 oz tomatoes'],
    steps: ['Simmer for thirty minutes.'], prepMinutes: 10, cookMinutes: 40,
  },
  {
    id: 'toast', title: 'Sungold Toast', category: 'Appetizer',
    description: ['Fresh garden tomatoes'], ingredients: ['2 cups sun-gold tomatoes', 'Sourdough bread'],
    steps: ['Toast the bread.'], prepMinutes: 5, cookMinutes: 2,
  },
  {
    id: 'chicken', title: 'Chicken in Garlic Sauce', category: 'Dinner',
    description: ['Weeknight dinner'], ingredients: ['Chicken breast', '2 cloves garlic'],
    steps: ['Roast in the oven.'], prepMinutes: 10, cookMinutes: 20,
  },
  {
    id: 'missing-time', title: 'Family Pie', category: 'Desserts',
    description: ['Mom’s special occasion treat'], ingredients: ['Apples'],
    steps: ['Bake until golden.'], prepMinutes: null, cookMinutes: 40,
  },
  {
    id: 'hidden', title: 'Secret Chicken', category: 'Dinner',
    ingredients: ['Chicken'], steps: ['Bake'], prepMinutes: 5, cookMinutes: 15,
    hidden: true,
  },
  {
    id: 'draft', title: 'Draft Cake', category: 'Desserts',
    ingredients: ['Flour'], steps: ['Mix'], prepMinutes: 5, cookMinutes: 15,
    draft: true,
  },
];

test('normalization is case, accent, and punctuation insensitive', () => {
  assert.equal(normalizeSearch('  Crème-Brûlée! '), 'creme brulee');
  assert.equal(normalizeSearch('Mom’s  Sauce'), 'moms sauce');
  assert.equal(normalizeSearch(null), '');
});

test('category dropdown shows only published categories and merges older singular labels', () => {
  assert.deepEqual(availableCategories(recipes), ['Appetizers', 'Desserts', 'Dinner']);
  assert.equal(canonicalCategory('Appetizer'), 'Appetizers');
  assert.equal(canonicalCategory('side dish'), 'Side Dishes');
  assert.equal(canonicalCategory('Sauces & Condiments'), 'Sauces & Condiments');
});

test('search covers titles, ingredients, descriptions, directions and multiple terms', () => {
  assert.deepEqual(searchRecipes(recipes, { query: 'tomato' }).map(r => r.id), ['tomato-sauce', 'toast']);
  assert.deepEqual(searchRecipes(recipes, { query: 'chicken roast' }).map(r => r.id), ['chicken']);
  assert.deepEqual(searchRecipes(recipes, { query: 'special occasion' }).map(r => r.id), ['missing-time']);
  assert.deepEqual(searchRecipes(recipes, { query: 'simmer' }).map(r => r.id), ['tomato-sauce']);
  assert.deepEqual(searchRecipes(recipes, { query: 'appetizer' }).map(r => r.id), ['toast']);
  assert.deepEqual(searchRecipes(recipes, { query: 'fudge' }), []);
});

test('category restricts to one normalized category', () => {
  assert.deepEqual(searchRecipes(recipes, { category: 'Appetizers' }).map(r => r.id), ['toast']);
  assert.deepEqual(searchRecipes(recipes, { query: 'tomato', category: 'Dinner' }).map(r => r.id), ['tomato-sauce']);
  assert.deepEqual(searchRecipes(recipes, { category: 'Desserts' }).map(r => r.id), ['missing-time']);
});

test('ingredient filter only checks ingredients, combining with main search', () => {
  assert.deepEqual(searchRecipes(recipes, { ingredient: 'garlic' }).map(r => r.id), ['chicken', 'tomato-sauce']);
  assert.deepEqual(searchRecipes(recipes, { query: 'simmer', ingredient: 'garlic' }).map(r => r.id), ['tomato-sauce']);
  assert.deepEqual(searchRecipes(recipes, { ingredient: 'roast' }), []);
  assert.deepEqual(searchRecipes(recipes, { ingredient: 'chicken garlic' }).map(r => r.id), ['chicken']);
});

test('time uses prep plus cook, includes boundary, and excludes missing times only if filtered', () => {
  assert.equal(totalRecipeMinutes(recipes[0]), 50);
  assert.equal(totalRecipeMinutes(recipes[3]), null);
  assert.deepEqual(searchRecipes(recipes, { maxMinutes: 30 }).map(r => r.id), ['chicken', 'toast']);
  assert.deepEqual(searchRecipes(recipes, { maxMinutes: 60 }).map(r => r.id), ['chicken', 'tomato-sauce', 'toast']);
  assert.ok(searchRecipes(recipes).some(r => r.id === 'missing-time'));
});

test('hidden and draft recipes never enter results, even if passed in by mistake', () => {
  const result = searchRecipes(recipes);
  assert.equal(result.length, 4);
  assert.equal(result.some(recipe => recipe.hidden || recipe.draft), false);
  assert.deepEqual(searchRecipes(recipes, { query: 'secret' }), []);
});

test('relevance puts full title match ahead of weaker ingredient matches', () => {
  const titles = [
    { title: 'Garlic', ingredients: ['salt'], steps: [], category: 'Dinner' },
    { title: 'Soup', ingredients: ['garlic cloves'], steps: [], category: 'Dinner' },
  ];
  assert.equal(searchRecipes(titles, { query: 'garlic' })[0].title, 'Garlic');
});

test('ingredient pills add on Enter, trim whitespace and reject case-insensitive duplicates', () => {
  const one = addIngredientFilter([], '  garlic  ');
  assert.deepEqual(one, ['garlic']);
  assert.equal(addIngredientFilter(one, 'GARLIC'), one);
  assert.equal(addIngredientFilter(one, '   '), one);
  const two = addIngredientFilter(one, '  olive   oil  ');
  assert.deepEqual(two, ['garlic', 'olive oil']);
  const afterRemovingGarlic = removeIngredientFilter(two, 'GARLIC');
  assert.deepEqual(afterRemovingGarlic, ['olive oil']);
  assert.deepEqual(removeIngredientFilter(afterRemovingGarlic, 'olive oil'), []);
  assert.deepEqual(removeIngredientFilter(two, 'not-selected'), two);
  const accented = addIngredientFilter([], 'Crème');
  assert.equal(addIngredientFilter(accented, 'creme'), accented);
});

test('ingredient pills require every selection to match an actual ingredient entry', () => {
  assert.deepEqual(searchRecipes(recipes, { ingredients: ['garlic'] }).map(r => r.id),
    ['chicken', 'tomato-sauce']);
  assert.deepEqual(searchRecipes(recipes, { ingredients: ['garlic', 'chicken'] }).map(r => r.id),
    ['chicken']);
  assert.deepEqual(searchRecipes(recipes, { ingredients: ['garlic', 'tomato'] }).map(r => r.id),
    ['tomato-sauce']);
  assert.deepEqual(searchRecipes(recipes, { ingredients: ['garlic', 'sourdough'] }), []);
  assert.deepEqual(searchRecipes(recipes, { ingredients: ['olive oil', 'garlic'] }).map(r => r.id),
    ['tomato-sauce']);
  assert.deepEqual(searchRecipes(recipes, { ingredients: ['chicken garlic'] }), [],
    'A multiword pill should belong to one ingredient line, not be split between lines');
});

test('multiple ingredient pills combine with category, time and text search', () => {
  const filters = { query: 'chicken', category: 'Dinner', maxMinutes: '30', ingredients: ['garlic', 'chicken'] };
  assert.deepEqual(searchRecipes(recipes, filters).map(r => r.id), ['chicken']);
  assert.deepEqual(searchRecipes(recipes, { ...filters, maxMinutes: '10' }), []);
  assert.deepEqual(searchRecipes(recipes, { ...filters, category: 'Appetizers' }), []);
  assert.deepEqual(searchRecipes(recipes, { ingredients: ['sourdough', 'tomatoes'] }).map(r => r.id),
    ['toast']);
  assert.deepEqual(searchRecipes(recipes, { ingredients: [] }).map(r => r.id),
    ['chicken', 'missing-time', 'tomato-sauce', 'toast']);
});

test('ingredient pills are case-insensitive and allow partial ingredient names', () => {
  const slicedTomatoes = [
    {
      id: 'tomato-slices', title: 'Tomato Crostini', category: 'Appetizers',
      ingredients: ['2 cups Tomato Slices', 'Fresh BASIL leaves'], steps: ['Arrange and serve.'],
    },
    {
      id: 'tomato-puree', title: 'Quick Sauce', category: 'Dinner',
      ingredients: ['1 can TOMATO purée', '2 cloves garlic'], steps: ['Simmer.'],
    },
    {
      id: 'unrelated', title: 'Basil Chicken', category: 'Dinner',
      ingredients: ['Fresh basil leaves', 'Chicken'], steps: ['Bake.'],
      description: ['Serve with sliced tomatoes.'],
    },
  ];
  const ids = filters => searchRecipes(slicedTomatoes, filters).map(r => r.id);

  assert.deepEqual(ids({ ingredients: ['tomato'] }), ['tomato-slices', 'tomato-puree']);
  assert.deepEqual(ids({ ingredients: ['TOMATO'] }), ['tomato-slices', 'tomato-puree']);
  assert.deepEqual(ids({ ingredients: ['ToMaTo sLi'] }), ['tomato-slices']);
  assert.deepEqual(ids({ ingredients: ['tomato', 'basil'] }), ['tomato-slices']);
  assert.deepEqual(ids({ ingredients: ['TOMATO', 'BASIL'] }), ['tomato-slices']);
  assert.deepEqual(ids({ ingredients: ['tomato', 'garlic'] }), ['tomato-puree']);
  assert.deepEqual(ids({ ingredients: ['tomato', 'chicken'] }), []);
});
