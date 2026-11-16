// Missing flags on older recipes mean "published and visible".
export function isPublicRecipe(recipe) {
  return recipe && recipe.hidden !== true && recipe.draft !== true;
}

export function recipeStatus(recipe) {
  if (recipe.draft === true) return 'Draft';
  return recipe.hidden === true ? 'Hidden' : 'Visible';
}
