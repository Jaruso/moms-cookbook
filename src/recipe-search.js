import { isPublicRecipe } from './recipe-status.js';

// Normalize text so searches ignore capitalization, accents and punctuation.
export function normalizeSearch(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const CATEGORY_ALIASES = {
  appetizer: 'Appetizers', appetizers: 'Appetizers',
  bread: 'Breads', breads: 'Breads',
  dessert: 'Desserts', desserts: 'Desserts',
  drink: 'Drinks', drinks: 'Drinks',
  salad: 'Salads', salads: 'Salads',
  'side dish': 'Side Dishes', 'side dishes': 'Side Dishes',
  snack: 'Snacks', snacks: 'Snacks',
  soup: 'Soups', soups: 'Soups',
  sauce: 'Sauces & Condiments', sauces: 'Sauces & Condiments',
  'sauce condiment': 'Sauces & Condiments', 'sauces condiments': 'Sauces & Condiments',
};

export function canonicalCategory(value) {
  const label = String(value ?? '').trim();
  return CATEGORY_ALIASES[normalizeSearch(label)] || label;
}

export function availableCategories(recipes) {
  const categories = new Map();
  for (const recipe of recipes) {
    if (!isPublicRecipe(recipe)) continue;
    const label = canonicalCategory(recipe.category);
    if (label) categories.set(normalizeSearch(label), label);
  }
  return [...categories.values()].sort((a, b) => a.localeCompare(b));
}

export function totalRecipeMinutes(recipe) {
  const prep = recipe.prepMinutes;
  const cook = recipe.cookMinutes;
  if (typeof prep !== 'number' || typeof cook !== 'number' ||
      !Number.isFinite(prep) || !Number.isFinite(cook) || prep < 0 || cook < 0) {
    return null;
  }
  return prep + cook;
}

function terms(value) {
  return normalizeSearch(value).split(' ').filter(Boolean);
}

function paragraphText(value) {
  if (Array.isArray(value)) return value.filter(part => typeof part === 'string').join(' ');
  return typeof value === 'string' ? value : '';
}

function matchScore(recipe, queryTerms, normalizedQuery) {
  if (!queryTerms.length) return 0;
  const fields = {
    title: normalizeSearch(recipe.title),
    category: normalizeSearch(canonicalCategory(recipe.category)),
    ingredients: normalizeSearch(Array.isArray(recipe.ingredients) ? recipe.ingredients.join(' ') : ''),
    description: normalizeSearch(paragraphText(recipe.description)),
    steps: normalizeSearch(Array.isArray(recipe.steps) ? recipe.steps.join(' ') : ''),
  };
  let score = fields.title === normalizedQuery ? 20 : 0;
  for (const term of queryTerms) {
    if (!Object.values(fields).some(field => field.includes(term))) return -1;
    if (fields.title.includes(term)) score += 8;
    if (fields.ingredients.includes(term)) score += 4;
    if (fields.category.includes(term)) score += 2;
    if (fields.description.includes(term)) score += 1;
    if (fields.steps.includes(term)) score += 1;
  }
  return score;
}

export function searchRecipes(recipes, filters = {}) {
  const normalizedQuery = normalizeSearch(filters.query);
  const queryTerms = terms(filters.query);
  const ingredientTerms = terms(filters.ingredient);
  const category = normalizeSearch(canonicalCategory(filters.category));
  const limit = Number(filters.maxMinutes) || 0;

  return recipes
    .filter(isPublicRecipe)
    .map(recipe => {
      if (category && normalizeSearch(canonicalCategory(recipe.category)) !== category) return null;
      if (limit > 0) {
        const total = totalRecipeMinutes(recipe);
        if (total === null || total > limit) return null;
      }
      const ingredients = normalizeSearch(Array.isArray(recipe.ingredients) ? recipe.ingredients.join(' ') : '');
      if (!ingredientTerms.every(term => ingredients.includes(term))) return null;
      const score = matchScore(recipe, queryTerms, normalizedQuery);
      return score < 0 ? null : { recipe, score };
    })
    .filter(Boolean)
    .sort((a, b) =>
      b.score - a.score || String(a.recipe.title).localeCompare(String(b.recipe.title)))
    .map(({ recipe }) => recipe);
}
