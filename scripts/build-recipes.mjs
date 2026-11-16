import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'recipes');
const names = (await readdir(dir)).filter(name => name.endsWith('.json')).sort();
const recipes = await Promise.all(names.map(async name => {
  const recipe = JSON.parse(await readFile(join(dir, name), 'utf8'));
  if (!recipe.id || !recipe.title || !Array.isArray(recipe.ingredients) || !Array.isArray(recipe.steps)) {
    throw new Error(`Invalid recipe: ${name}`);
  }
  return recipe;
}));

// Hidden recipes remain editable in GitHub but do not enter the public JavaScript bundle.
const visible = recipes.filter(recipe => recipe.hidden !== true);
await writeFile(join(root, 'src', 'public-recipes.json'), JSON.stringify(visible, null, 2) + '\n');
console.log(`Prepared ${visible.length} public recipe(s); ${recipes.length - visible.length} hidden.`);
