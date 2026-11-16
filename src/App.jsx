import React, { useEffect, useState } from 'react';
import publicRecipes from './public-recipes.json';

const recipes = publicRecipes.slice().sort((a, b) => a.title.localeCompare(b.title));
const BASE = import.meta.env.BASE_URL;
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function picture(recipe) {
  return recipe.image ? `${BASE}${recipe.image.replace(/^\//, '')}` : null;
}

function RecipeDetail({ recipe, onBack }) {
  return (
    <article className="recipe-detail">
      <div className="recipe-intro">
        <button type="button" className="text-button" onClick={onBack}>← All recipes</button>
        <h1>{recipe.title}</h1>
        {recipe.description && <p className="recipe-description">{recipe.description}</p>}
        <p className="recipe-meta">
          {[recipe.category, recipe.prepMinutes != null && `Prep ${recipe.prepMinutes} min`,
            recipe.cookMinutes != null && `Cook ${recipe.cookMinutes} min`,
            recipe.servings && `Serves ${recipe.servings}`].filter(Boolean).join(' · ')}
        </p>
      </div>
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

function RecipeIndex({ onChoose }) {
  const [query, setQuery] = useState('');
  const shown = recipes.filter(r => `${r.title} ${r.category} ${r.description}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <main>
      <h1>Recipes</h1>
      <label className="sr-only" htmlFor="recipe-search">Search recipes</label>
      <input id="recipe-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search recipes" />
      <div className="recipe-list">
        {shown.map(recipe => (
          <button className="recipe-entry" key={recipe.id} onClick={() => onChoose(recipe.id)}>
            {picture(recipe) && <img src={picture(recipe)} alt="" loading="lazy" />}
            <span><strong>{recipe.title}</strong><small>{recipe.category}</small></span>
            <span className="arrow" aria-hidden="true">→</span>
          </button>
        ))}
        {!shown.length && <p>No recipes found.</p>}
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

const blank = {
  title: '', description: '', category: '', prepMinutes: '', cookMinutes: '',
  servings: '', ingredients: '', steps: '',
};

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

function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem('cookbook_admin_token') || '');
  const [password, setPassword] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // null = list, 'new' = add, or { id, sha }
  const [form, setForm] = useState(blank);
  const [photo, setPhoto] = useState(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [pending, setPending] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function change(name, value) { setForm(previous => ({ ...previous, [name]: value })); }
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
    setForm({ ...blank }); setEditing('new'); setPhoto(null); setRemovePhoto(false);
    setMessage(''); setError('');
  }
  function editRecipe(recipe) {
    setForm({
      title: recipe.title || '', description: recipe.description || '', category: recipe.category || '',
      prepMinutes: recipe.prepMinutes ?? '', cookMinutes: recipe.cookMinutes ?? '',
      servings: recipe.servings || '', ingredients: recipe.ingredients.join('\n'),
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
        prepMinutes: form.prepMinutes === '' ? null : Number(form.prepMinutes),
        cookMinutes: form.cookMinutes === '' ? null : Number(form.cookMinutes),
        ingredients: form.ingredients.split('\n').map(line => line.trim()).filter(Boolean),
        steps: form.steps.split('\n').map(line => line.trim()).filter(Boolean),
        imageBase64,
        removePhoto,
      };
      const isNew = editing === 'new';
      const result = isNew
        ? await requestApi('/api/recipes', 'POST', token, payload)
        : await requestApi(`/api/recipes/${editing.id}`, 'PUT', token, { ...payload, sha: editing.sha });
      setEditing(null); setPhoto(null); setRemovePhoto(false);
      setMessage(`“${result.title}” was ${isNew ? 'added' : 'updated'}. The public site will reflect it after GitHub Pages rebuilds.`);
      await refresh();
    } catch (err) { handleError(err); }
    finally { setPending(false); }
  }

  async function toggleHidden(recipe) {
    setBusyId(recipe.id); setError(''); setMessage('');
    try {
      const result = await requestApi(`/api/recipes/${recipe.id}/visibility`, 'PATCH', token,
        { hidden: recipe.hidden !== true, sha: recipe.sha });
      setItems(previous => previous.map(item => item.id === result.id ? result : item));
      setMessage(`“${result.title}” is now ${result.hidden ? 'hidden' : 'visible'}. GitHub Pages will update after rebuilding.`);
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
                  <label>Short description<textarea rows={2} value={form.description} onChange={e => change('description', e.target.value)} maxLength={800} /></label>
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
                  <label>Ingredients * <span className="hint">(one per line)</span>
                    <textarea rows={7} value={form.ingredients} onChange={e => change('ingredients', e.target.value)} placeholder={'2 cups flour\n1 tsp salt'} required />
                  </label>
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
  useEffect(() => {
    const onHashChange = () => { setAdmin(window.location.hash.startsWith('#/admin')); setSelected(null); };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const chosen = recipes.find(recipe => recipe.id === selected);
  return (
    <div className="shell">
      <header className="site-header">
        <a className="brand" href={BASE}>Mom's Cookbook</a>
        <nav><a href={BASE}>Recipes</a><a href="#/admin">Admin</a></nav>
      </header>
      {admin ? <Admin /> : chosen ? <RecipeDetail recipe={chosen} onBack={() => setSelected(null)} /> : <RecipeIndex onChoose={setSelected} />}
    </div>
  );
}
