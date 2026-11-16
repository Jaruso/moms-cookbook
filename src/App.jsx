import { useEffect, useState } from 'react';

const recipeFiles = import.meta.glob('../recipes/*.json', { eager: true, import: 'default' });
const recipes = Object.values(recipeFiles).sort((a, b) => a.title.localeCompare(b.title));
const BASE = import.meta.env.BASE_URL;
const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function picture(recipe) {
  return recipe.image ? `${BASE}${recipe.image.replace(/^\//, '')}` : null;
}

function RecipeDetail({ recipe, onBack }) {
  return (
    <article>
      <button type="button" className="text-button" onClick={onBack}>← All recipes</button>
      <h1>{recipe.title}</h1>
      {recipe.description && <p>{recipe.description}</p>}
      <p className="muted">
        {[recipe.category, recipe.prepMinutes != null && `Prep ${recipe.prepMinutes} min`,
          recipe.cookMinutes != null && `Cook ${recipe.cookMinutes} min`,
          recipe.servings && `Serves ${recipe.servings}`].filter(Boolean).join(' · ')}
      </p>
      {picture(recipe) && <img className="recipe-photo" src={picture(recipe)} alt={recipe.title} />}
      <h2>Ingredients</h2>
      <ul>{recipe.ingredients.map((item, i) => <li key={i}>{item}</li>)}</ul>
      <h2>Directions</h2>
      <ol>{recipe.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
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

function resizePhoto(file) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const encoded = canvas.toDataURL('image/jpeg', 0.78).split(',')[1];
      if (!encoded || encoded.length > 1_300_000) throw new Error('Photo is too large after resizing. Choose a smaller photo.');
      resolve(encoded);
    } catch (error) { reject(error); }
  });
}

const blank = {
  title: '', description: '', category: '', prepMinutes: '', cookMinutes: '',
  servings: '', ingredients: '', steps: '',
};

function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem('cookbook_admin_token') || '');
  const [password, setPassword] = useState('');
  const [form, setForm] = useState(blank);
  const [photo, setPhoto] = useState(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function change(name, value) { setForm(previous => ({ ...previous, [name]: value })); }
  function logout() { sessionStorage.removeItem('cookbook_admin_token'); setToken(''); setPassword(''); }

  async function login(event) {
    event.preventDefault();
    setPending(true); setError(''); setMessage('');
    try {
      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not log in.');
      sessionStorage.setItem('cookbook_admin_token', data.token);
      setToken(data.token);
      setPassword('');
    } catch (err) { setError(err.message); }
    finally { setPending(false); }
  }

  async function publish(event) {
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
      };
      const response = await fetch(`${API_URL}/api/recipes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (response.status === 401) { logout(); throw new Error('Session expired. Please log in again.'); }
      if (!response.ok) throw new Error(data.error || 'Could not publish recipe.');
      setForm(blank); setPhoto(null);
      const fileInput = document.getElementById('recipe-photo-input');
      if (fileInput) fileInput.value = '';
      setMessage(`“${data.title}” was saved. It will appear on the site after GitHub Pages finishes rebuilding.`);
    } catch (err) { setError(err.message); }
    finally { setPending(false); }
  }

  return (
    <main>
      <h1>Add a recipe</h1>
      {!API_URL ? <p className="error">The backend URL is not configured. See the repository README.</p>
        : !token ? (
          <form onSubmit={login} className="editor">
            <label>Admin password
              <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
            </label>
            <button disabled={pending} type="submit">{pending ? 'Logging in…' : 'Log in'}</button>
          </form>
        ) : (
          <>
            <p className="muted">Signed in. <button className="text-button" type="button" onClick={logout}>Log out</button></p>
            <form onSubmit={publish} className="editor">
              <label>Recipe name *<input value={form.title} onChange={e => change('title', e.target.value)} maxLength={120} required /></label>
              <label>Short description<textarea rows={2} value={form.description} onChange={e => change('description', e.target.value)} maxLength={800} /></label>
              <label>Category<input placeholder="Dinner, Dessert, Bread…" value={form.category} onChange={e => change('category', e.target.value)} maxLength={60} /></label>
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
                <input id="recipe-photo-input" type="file" accept="image/*" onChange={e => setPhoto(e.target.files?.[0] || null)} />
              </label>
              <button type="submit" disabled={pending}>{pending ? 'Publishing…' : 'Publish recipe'}</button>
            </form>
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
        <nav><a href={BASE}>Recipes</a><a href="#/admin">Add recipe</a></nav>
      </header>
      {admin ? <Admin /> : chosen ? <RecipeDetail recipe={chosen} onBack={() => setSelected(null)} /> : <RecipeIndex onChoose={setSelected} />}
    </div>
  );
}
