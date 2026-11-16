import React, { useEffect, useState } from 'react';
import publicRecipes from './public-recipes.json';
import { UNITS, makeIngredientRow, parseIngredientString, serializeIngredients } from './ingredients.js';
import { descriptionParagraphs, descriptionEditorText, descriptionPreview } from './description.js';

const recipes = publicRecipes.slice().sort((a, b) => a.title.localeCompare(b.title));
const BASE = import.meta.env.BASE_URL;
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function picture(recipe) {
  return recipe.image ? `${BASE}${recipe.image.replace(/^\//, '')}` : null;
}

// Each paragraph is its own content section. Empty insertion nodes are reserved
// for future ads and do not display anything until content is inserted into them.
function RecipeDescription({ value }) {
  const paragraphs = descriptionParagraphs(value);
  if (!paragraphs.length) return null;
  return (
    <div className="recipe-description-flow">
      {paragraphs.map((paragraph, index) => (
        <React.Fragment key={index}>
          <section className="recipe-description-section" data-paragraph={index + 1}>
            <p>{paragraph}</p>
          </section>
          {index < paragraphs.length - 1 && (
            <div className="recipe-description-insertion" data-after-paragraph={index + 1} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

function RecipeDetail({ recipe, onBack }) {
  return (
    <article className="recipe-detail">
      <div className="recipe-intro">
        <button type="button" className="text-button" onClick={onBack}>← All recipes</button>
        <h1>{recipe.title}</h1>
        <p className="recipe-meta">
          {[recipe.category, recipe.prepMinutes != null && `Prep ${recipe.prepMinutes} min`,
            recipe.cookMinutes != null && `Cook ${recipe.cookMinutes} min`,
            recipe.servings && `Serves ${recipe.servings}`].filter(Boolean).join(' · ')}
        </p>
      </div>
      <RecipeDescription value={recipe.description} />
      {picture(recipe) && <img className="recipe-photo" src={picture(recipe)} alt={recipe.title} />}
      <div className="recipe-body">
        <section className="ingredients">
          <h2>Ingredients</h2>
          <ul>{recipe.ingredients.map((item, i) => <li key={i}>{item}</li>)}</ul>
        </section>
        <section className="directions">
          <h2>Directions</h2>
          <ol>{recipe.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
        </section>
      </div>
    </article>
  );
}

function RecipeIndex({ onChoose, notice, onDismissNotice }) {
  const [query, setQuery] = useState('');
  const shown = recipes.filter(r => [r.title, r.category, descriptionParagraphs(r.description).join(' ')].join(' ').toLowerCase().includes(query.toLowerCase()));
  return (
    <main className="library-page">
      {notice && (
        <div className="publish-notice" role="status">
          <span className="notice-check" aria-hidden="true">✓</span>
          <p>{notice}</p>
          <button type="button" onClick={onDismissNotice} aria-label="Dismiss confirmation">×</button>
        </div>
      )}
      <div className="library-heading">
        <div>
          <p className="eyebrow">The family collection</p>
          <h1>Recipes</h1>
        </div>
        <div className="search-wrap">
          <label className="sr-only" htmlFor="recipe-search">Search recipes</label>
          <input id="recipe-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search recipes..." />
        </div>
      </div>
      <div className="recipe-list">
        {shown.map(recipe => (
          <button type="button" className={picture(recipe) ? 'recipe-entry' : 'recipe-entry recipe-entry-no-photo'} key={recipe.id} onClick={() => onChoose(recipe.id)}>
            {picture(recipe) && <img className="recipe-card-photo" src={picture(recipe)} alt="" loading="lazy" />}
            <span className="recipe-card-body">
              <span className="card-category">{recipe.category || 'Recipe'}</span>
              <strong>{recipe.title}</strong>
              {descriptionPreview(recipe.description) && <span className="card-description">{descriptionPreview(recipe.description)}</span>}
              <span className="card-bottom">
                <span>{[
                  recipe.prepMinutes != null && ('Prep ' + recipe.prepMinutes + ' min'),
                  recipe.cookMinutes != null && ('Cook ' + recipe.cookMinutes + ' min'),
                ].filter(Boolean).join(' · ')}</span>
                <span className="card-arrow" aria-hidden="true">↗</span>
              </span>
            </span>
          </button>
        ))}
        {!shown.length && <p className="empty-state">No recipes found.</p>}
      </div>
    </main>
  );
}

async function resizePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Cannot process photo in this browser.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL('image/jpeg', 0.78).split(',')[1];
    if (!encoded || encoded.length > 1_300_000) throw new Error('Photo is too large after resizing. Choose a smaller photo.');
    return encoded;
  } finally { bitmap.close(); }
}

const categories = [
  'Breakfast', 'Lunch', 'Dinner', 'Appetizers', 'Side Dishes',
  'Soups', 'Salads', 'Breads', 'Desserts', 'Snacks',
  'Sauces & Condiments', 'Drinks', 'Other',
];

function blankForm() {
  return {
    title: '', description: '', category: '', prepMinutes: '', cookMinutes: '',
    servings: '', ingredients: [makeIngredientRow()], steps: '',
  };
}

async function requestApi(path, method, token, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function Admin({ onPublished }) {
  const [token, setToken] = useState(() => sessionStorage.getItem('cookbook_admin_token') || '');
  const [password, setPassword] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // null = list, 'new' = add, or { id, sha }
  const [form, setForm] = useState(blankForm);
  const [photo, setPhoto] = useState(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function change(name, value) { setForm(previous => ({ ...previous, [name]: value })); }
  function changeIngredient(rowId, field, value) {
    setForm(previous => ({
      ...previous,
      ingredients: previous.ingredients.map(row => row.rowId === rowId ? { ...row, [field]: value } : row),
    }));
  }
  function addIngredient() {
    setForm(previous => previous.ingredients.length >= 60 ? previous : {
      ...previous, ingredients: [...previous.ingredients, makeIngredientRow()],
    });
  }
  function removeIngredient(rowId) {
    setForm(previous => ({
      ...previous,
      ingredients: previous.ingredients.length > 1
        ? previous.ingredients.filter(row => row.rowId !== rowId) : previous.ingredients,
    }));
  }
  function logout() {
    sessionStorage.removeItem('cookbook_admin_token');
    setToken(''); setPassword(''); setItems([]); setEditing(null);
  }
  function handleError(err) {
    if (err.status === 401) {
      logout();
      setError('Your session expired. Log in again.');
    } else setError(err.message);
  }
  async function refresh(authToken = token) {
    setLoading(true);
    try {
      const result = await requestApi('/api/recipes', 'GET', authToken);
      setItems(result.recipes);
    } catch (err) { handleError(err); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (token) refresh(token);
    // Refresh the saved session when the admin page first opens or a new login succeeds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function login(event) {
    event.preventDefault();
    setPending(true); setError(''); setMessage('');
    try {
      const result = await requestApi('/api/login', 'POST', null, { password });
      sessionStorage.setItem('cookbook_admin_token', result.token);
      setToken(result.token);
      setPassword('');
    } catch (err) { setError(err.message); }
    finally { setPending(false); }
  }

  function addRecipe() {
    setForm(blankForm()); setEditing('new'); setPhoto(null); setRemovePhoto(false);
    setMessage(''); setError('');
  }
  function editRecipe(recipe) {
    setForm({
      title: recipe.title || '', description: descriptionEditorText(recipe.description), category: recipe.category || '',
      prepMinutes: recipe.prepMinutes ?? '', cookMinutes: recipe.cookMinutes ?? '',
      servings: recipe.servings || '', ingredients: recipe.ingredients.map(parseIngredientString),
      steps: recipe.steps.join('\n'),
    });
    setEditing({ id: recipe.id, sha: recipe.sha, image: recipe.image });
    setPhoto(null); setRemovePhoto(false); setMessage(''); setError('');
  }

  async function saveRecipe(event) {
    event.preventDefault();
    setPending(true); setError(''); setMessage('');
    try {
      const imageBase64 = photo ? await resizePhoto(photo) : null;
      const payload = {
        ...form,
        // Send the textarea text; the Worker splits it into ordered paragraphs.
        description: form.description,
        prepMinutes: form.prepMinutes === '' ? null : Number(form.prepMinutes),
        cookMinutes: form.cookMinutes === '' ? null : Number(form.cookMinutes),
        ingredients: serializeIngredients(form.ingredients),
        steps: form.steps.split('\n').map(line => line.trim()).filter(Boolean),
        imageBase64,
        removePhoto,
      };
      const isNew = editing === 'new';
      const result = isNew
        ? await requestApi('/api/recipes', 'POST', token, payload)
        : await requestApi(`/api/recipes/${editing.id}`, 'PUT', token, { ...payload, sha: editing.sha });
      setEditing(null); setPhoto(null); setRemovePhoto(false);
      if (isNew) {
        onPublished('“' + result.title + '” was published. The website should update within a couple minutes.');
      } else {
        setMessage('“' + result.title + '” was updated. The website should update within a couple minutes.');
        await refresh();
      }
    } catch (err) { handleError(err); }
    finally { setPending(false); }
  }

  async function toggleHidden(recipe) {
    setBusyId(recipe.id); setError(''); setMessage('');
    try {
      const result = await requestApi(`/api/recipes/${recipe.id}/visibility`, 'PATCH', token,
        { hidden: recipe.hidden !== true, sha: recipe.sha });
      setItems(previous => previous.map(item => item.id === result.id ? result : item));
      setMessage(`“${result.title}” is now ${result.hidden ? 'hidden' : 'visible'}. The website should update within a couple minutes.`);
    } catch (err) {
      handleError(err);
      if (err.status === 409) await refresh();
    } finally { setBusyId(''); }
  }

  return (
    <main className="admin-page">
      <h1>Admin</h1>
      {!API_URL ? <p className="error">The backend URL is not configured. See the repository README.</p>
        : !token ? (
          <form onSubmit={login} className="editor login-form">
            <label>Admin password
              <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
            </label>
            <button disabled={pending} type="submit">{pending ? 'Logging in…' : 'Log in'}</button>
          </form>
        ) : (
          <>
            <div className="admin-session"><span className="muted">Signed in</span><button className="text-button" type="button" onClick={logout}>Log out</button></div>
            {editing === null ? (
              <>
                <div className="admin-toolbar">
                  <h2>Manage recipes</h2>
                  <button type="button" className="primary-button" onClick={addRecipe}>Add recipe</button>
                </div>
                {loading ? <p>Loading recipes…</p> : (
                  <div className="admin-list">
                    {items.map(recipe => (
                      <div className="admin-recipe" key={recipe.id}>
                        <div className="admin-recipe-info">
                          <strong>{recipe.title}</strong>
                          <span className="muted">{recipe.category}{recipe.hidden ? ' · Hidden' : ' · Visible'}</span>
                        </div>
                        <div className="admin-actions">
                          <button type="button" className="outline-button" disabled={busyId === recipe.id} onClick={() => editRecipe(recipe)}>Edit</button>
                          <button type="button" className="outline-button" disabled={!!busyId} onClick={() => toggleHidden(recipe)}>
                            {busyId === recipe.id ? 'Saving…' : recipe.hidden ? 'Unhide' : 'Hide'}
                          </button>
                        </div>
                      </div>
                    ))}
                    {!items.length && <p>No recipes yet.</p>}
                  </div>
                )}
              </>
            ) : (
              <>
                <button type="button" className="text-button back-to-admin" onClick={() => setEditing(null)}>← Manage recipes</button>
                <h2>{editing === 'new' ? 'Add recipe' : 'Edit recipe'}</h2>
                <form onSubmit={saveRecipe} className="editor">
                  <label>Recipe name *<input value={form.title} onChange={e => change('title', e.target.value)} maxLength={120} required /></label>
                  <label>Description <span className="hint">(optional — separate paragraphs with a blank line)</span><textarea rows={8} value={form.description} onChange={e => change('description', e.target.value)} maxLength={12000} placeholder={"Tell the story behind this recipe.\n\nStart a new paragraph by leaving a blank line."} /></label>
                  <label>Category
                    <select value={form.category} onChange={e => change('category', e.target.value)} required>
                      <option value="">Select a category</option>
                      {categories.concat(form.category && !categories.includes(form.category) ? [form.category] : []).map(category => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </label>
                  <div className="fields-row">
                    <label>Prep minutes<input type="number" min="0" max="999" value={form.prepMinutes} onChange={e => change('prepMinutes', e.target.value)} /></label>
                    <label>Cook minutes<input type="number" min="0" max="999" value={form.cookMinutes} onChange={e => change('cookMinutes', e.target.value)} /></label>
                    <label>Servings<input value={form.servings} placeholder="4–6" onChange={e => change('servings', e.target.value)} maxLength={40} /></label>
                  </div>
                  <div className="ingredient-editor">
                    <div className="ingredient-heading">
                      <h3>Ingredients</h3>
                      <p className="hint">Enter an amount, choose a unit, and name the ingredient. Use Custom for anything else.</p>
                    </div>
                    <div className="ingredient-rows">
                      {form.ingredients.map((row, index) => (
                        <div className={row.unit === 'custom' ? 'ingredient-row ingredient-row-custom' : 'ingredient-row'} key={row.rowId}>
                          <label className="amount-field">Amount
                            <input value={row.amount} onChange={e => changeIngredient(row.rowId, 'amount', e.target.value)} maxLength={24} placeholder="2 or 1 ½" />
                          </label>
                          <label className="unit-field">Unit
                            <select value={row.unit} onChange={e => changeIngredient(row.rowId, 'unit', e.target.value)}>
                              <option value="">No unit</option>
                              {UNITS.map(unit => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                              <option value="custom">Custom…</option>
                            </select>
                          </label>
                          {row.unit === 'custom' && (
                            <label className="custom-unit-field">Custom unit
                              <input value={row.customUnit} onChange={e => changeIngredient(row.rowId, 'customUnit', e.target.value)} maxLength={40} placeholder="bunch, sprig…" required />
                            </label>
                          )}
                          <label className="ingredient-name-field">Ingredient
                            <input value={row.name} onChange={e => changeIngredient(row.rowId, 'name', e.target.value)} maxLength={240} placeholder="Olive oil" required />
                          </label>
                          <button type="button" className="remove-ingredient" aria-label={'Remove ingredient ' + (index + 1)} title="Remove ingredient" onClick={() => removeIngredient(row.rowId)} disabled={form.ingredients.length === 1}>×</button>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="outline-button add-ingredient" onClick={addIngredient} disabled={form.ingredients.length >= 60}>+ Add ingredient</button>
                  </div>
                  <label>Directions * <span className="hint">(one step per line)</span>
                    <textarea rows={8} value={form.steps} onChange={e => change('steps', e.target.value)} placeholder={'Preheat the oven.\nCombine the ingredients.'} required />
                  </label>
                  <label>Photo <span className="hint">(optional, resized before uploading)</span>
                    <input id="recipe-photo-input" type="file" accept="image/*" onChange={e => { const selected = e.target.files?.[0] || null; setPhoto(selected); if (selected) setRemovePhoto(false); }} />
                  </label>
                  {editing !== 'new' && editing.image && !photo && (
                    <label className="remove-photo"><input type="checkbox" checked={removePhoto} onChange={e => setRemovePhoto(e.target.checked)} /> Remove existing photo</label>
                  )}
                  <div className="form-actions">
                    <button type="submit" disabled={pending}>{pending ? 'Saving…' : editing === 'new' ? 'Publish recipe' : 'Save changes'}</button>
                    <button type="button" className="outline-button" disabled={pending} onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </form>
              </>
            )}
          </>
        )}
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p className="success" role="status">{message}</p>}
    </main>
  );
}

export default function App() {
  const [admin, setAdmin] = useState(() => window.location.hash.startsWith('#/admin'));
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const onHashChange = () => { setAdmin(window.location.hash.startsWith('#/admin')); setSelected(null); };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function handlePublished(message) {
    setNotice(message);
    setSelected(null);
    setAdmin(false);
    window.location.hash = '#/';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const chosen = recipes.find(recipe => recipe.id === selected);
  return (
    <div className="shell">
      <header className="site-header">
        <a className="brand" href={BASE}>Mom's Cookbook</a>
        <nav aria-label="Main navigation">
          <a href={BASE} aria-current={admin ? undefined : 'page'}>Recipes</a>
          <a href="#/admin" aria-current={admin ? 'page' : undefined}>Admin</a>
        </nav>
      </header>
      {admin ? <Admin onPublished={handlePublished} /> : chosen ? <RecipeDetail recipe={chosen} onBack={() => setSelected(null)} /> : <RecipeIndex onChoose={setSelected} notice={notice} onDismissNotice={() => setNotice('')} />}
    </div>
  );
}
