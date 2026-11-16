// The editor uses structured rows, while recipes remain compatible with string arrays in JSON.
export const UNITS = [
  { value: 'tsp', label: 'Teaspoon (tsp)', singular: 'tsp', plural: 'tsp', aliases: ['teaspoon', 'teaspoons'] },
  { value: 'tbsp', label: 'Tablespoon (tbsp)', singular: 'tbsp', plural: 'tbsp', aliases: ['tablespoon', 'tablespoons', 'tbs'] },
  { value: 'cup', label: 'Cup', singular: 'cup', plural: 'cups', aliases: ['cups'] },
  { value: 'oz', label: 'Ounce (oz)', singular: 'oz', plural: 'oz', aliases: ['ounce', 'ounces'] },
  { value: 'lb', label: 'Pound (lb)', singular: 'lb', plural: 'lb', aliases: ['lbs', 'pound', 'pounds'] },
  { value: 'g', label: 'Gram (g)', singular: 'g', plural: 'g', aliases: ['gram', 'grams'] },
  { value: 'ml', label: 'Milliliter (ml)', singular: 'ml', plural: 'ml', aliases: ['milliliter', 'milliliters'] },
  { value: 'clove', label: 'Clove', singular: 'clove', plural: 'cloves', aliases: ['cloves'] },
  { value: 'can', label: 'Can', singular: 'can', plural: 'cans', aliases: ['cans'] },
  { value: 'pinch', label: 'Pinch', singular: 'pinch', plural: 'pinches', aliases: ['pinches'] },
  { value: 'piece', label: 'Piece', singular: 'piece', plural: 'pieces', aliases: ['pieces'] },
];

const byValue = new Map(UNITS.map(unit => [unit.value, unit]));
const byAlias = new Map(UNITS.flatMap(unit =>
  [unit.value, unit.singular, unit.plural, ...unit.aliases].map(alias => [alias.toLowerCase(), unit.value])));
let rowCounter = 0;

export function makeIngredientRow(fields = {}) {
  return { rowId: ++rowCounter, amount: '', unit: '', customUnit: '', name: '', ...fields };
}

// Parsing is intentionally conservative. Unrecognized wording is kept intact,
// so an old handwritten entry like "a handful of basil" won't be lost on edit.
export function parseIngredientString(text) {
  const input = String(text ?? '').trim();
  const match = input.match(/^((?:\d+\/\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s+(?:\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞]))?)\s+(.+)$/u);
  if (!match) return makeIngredientRow({ name: input });

  const [, amount, remainder] = match;
  const firstSpace = remainder.indexOf(' ');
  if (firstSpace < 0) return makeIngredientRow({ amount, name: remainder });

  const firstWord = remainder.slice(0, firstSpace).toLowerCase();
  const unit = byAlias.get(firstWord);
  return unit
    ? makeIngredientRow({ amount, unit, name: remainder.slice(firstSpace + 1) })
    : makeIngredientRow({ amount, name: remainder });
}

function isSingularAmount(amount) {
  if (!amount) return true;
  if (/^1(?:\.0+)?$/.test(amount)) return true;
  if (/^\d+\/\d+$/.test(amount)) {
    const [numerator, denominator] = amount.split('/').map(Number);
    return denominator !== 0 && numerator <= denominator;
  }
  if (/^[¼½¾⅓⅔⅛⅜⅝⅞]$/u.test(amount)) return true;
  const numeric = Number(amount);
  return Number.isFinite(numeric) && numeric > 0 && numeric < 1;
}

export function serializeIngredient(row) {
  const amount = String(row.amount ?? '').trim();
  const name = String(row.name ?? '').trim();
  if (!name) throw new Error('Each ingredient needs a name.');

  let unitText = '';
  if (row.unit === 'custom') {
    unitText = String(row.customUnit ?? '').trim();
    if (!unitText) throw new Error('Enter the custom measurement unit.');
  } else if (row.unit) {
    const definition = byValue.get(row.unit);
    if (!definition) throw new Error('Choose a valid measurement unit.');
    unitText = isSingularAmount(amount) ? definition.singular : definition.plural;
  }

  const result = [amount, unitText, name].filter(Boolean).join(' ');
  if (result.length > 250) throw new Error('Each ingredient must be 250 characters or fewer.');
  return result;
}

export function serializeIngredients(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 60)
    throw new Error('Add between 1 and 60 ingredients.');
  return rows.map(serializeIngredient);
}
