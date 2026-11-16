const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SESSION_MS = 4 * 60 * 60 * 1000;
const MAX_BODY_CHARS = 1_500_000;
const ALLOWED_ORIGINS = new Set(['https://jaruso.github.io', 'http://localhost:5173']);

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function cors(origin) {
  return origin && ALLOWED_ORIGINS.has(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  } : {};
}

function json(data, status = 200, origin = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(origin) },
  });
}

async function digest(input) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(input)));
}

async function samePassword(provided, expected) {
  const [a, b] = await Promise.all([digest(provided), digest(expected)]);
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

async function signingKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value) {
  if (!/^[0-9a-f]{64}$/.test(value)) return null;
  return new Uint8Array(value.match(/../g).map(pair => parseInt(pair, 16)));
}

async function issueToken(secret) {
  const payload = btoa(`${Date.now() + SESSION_MS}:${crypto.randomUUID()}`)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload));
  return `${payload}.${hex(signature)}`;
}

async function validToken(bearer, secret) {
  if (!bearer?.startsWith('Bearer ') || bearer.length > 350) return false;
  const [payload, signature, extra] = bearer.slice(7).split('.');
  const bytes = fromHex(signature || '');
  if (!payload || !bytes || extra) return false;
  const valid = await crypto.subtle.verify('HMAC', await signingKey(secret), bytes, encoder.encode(payload));
  if (!valid) return false;
  try {
    const text = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const [expiry] = text.split(':');
    return /^\d{13}$/.test(expiry) && Number(expiry) > Date.now();
  } catch { return false; }
}

function str(value, name, max = 120, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
    throw new ApiError(`${name} must be ${required ? 'a nonempty' : 'a'} text value up to ${max} characters.`);
  }
  return value.trim();
}

function list(value, name, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems ||
      value.some(item => typeof item !== 'string' || !item.trim() || item.length > maxLength)) {
    throw new ApiError(`${name} must have 1–${maxItems} nonempty lines.`);
  }
  return value.map(item => item.trim());
}

// Description is stored as ordered paragraphs. Legacy single-string recipes
// are accepted and normalized when read or edited.
function descriptionParagraphs(value) {
  if (value == null || value === '') return [];
  if (typeof value !== 'string' && !Array.isArray(value)) {
    throw new ApiError('Description must be text or an array of paragraphs.');
  }
  const parts = Array.isArray(value) ? value : [value];
  if (parts.length > 30 || parts.some(part => typeof part !== 'string') ||
      parts.reduce((length, part) => length + part.length, 0) > 12000) {
    throw new ApiError('Description must be at most 30 paragraphs and 12,000 characters.');
  }
  const paragraphs = parts.flatMap(part =>
    part.replace(/\r\n?/g, '\n').split(/\n\s*\n+/)
      .map(text => text.replace(/[ \t]*\n[ \t]*/g, ' ').trim())
      .filter(Boolean)
  );
  if (paragraphs.length > 30 || paragraphs.some(text => text.length > 2000)) {
    throw new ApiError('Description must be at most 30 paragraphs, each at most 2,000 characters.');
  }
  return paragraphs;
}

function minutes(value, name) {
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isInteger(value) || value < 0 || value > 999) throw new ApiError(`${name} must be 0–999 minutes.`);
  return value;
}

function imageData(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 1_300_000 || value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || !value.startsWith('/9j/')) {
    throw new ApiError('Photo must be a JPEG under 1 MB.');
  }
  const bytes = Math.floor(value.length * 3 / 4) - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  if (bytes > 1_000_000) throw new ApiError('Photo must be under 1 MB.');
  return value;
}

// Drafts can be incomplete. Keep their structured ingredient fields so an
// unfinished measurement survives saving and reopening the editor.
function optionalLines(value, name, limit, maxLength) {
  if (!Array.isArray(value) || value.length > limit ||
      value.some(item => typeof item !== 'string' || !item.trim() || item.length > maxLength)) {
    throw new ApiError(`${name} must have at most ${limit} nonempty lines.`);
  }
  return value.map(item => item.trim());
}

function draftIngredientRows(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 60) {
    throw new ApiError('Draft ingredients must contain 1–60 rows.');
  }
  return value.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new ApiError('Invalid draft ingredient row.');
    }
    return {
      amount: str(row.amount, 'Amount', 24),
      unit: str(row.unit, 'Unit', 40),
      customUnit: str(row.customUnit, 'Custom unit', 40),
      name: str(row.name, 'Ingredient', 240),
    };
  });
}

function validateRecipe(body, previous = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('Invalid recipe.');
  if (body.draft !== undefined && typeof body.draft !== 'boolean') throw new ApiError('Draft must be true or false.');
  const draft = body.draft === true;
  const title = str(body.title, 'Recipe name', 120, !draft) || 'Untitled recipe';
  const slug = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50).replace(/-$/, '') || 'recipe';
  const id = previous?.id || `${slug}-${crypto.randomUUID().slice(0, 8)}`;
  const base64 = imageData(body.imageBase64);
  const removePhoto = body.removePhoto === true;
  if (base64 && removePhoto) throw new ApiError('Choose either a new photo or remove the current photo.');
  const image = base64 ? `images/${id}-${crypto.randomUUID().slice(0, 8)}.jpg`
    : removePhoto ? null : previous?.image || null;
  const recipe = {
    ...(previous || {}),
    id,
    title,
    description: descriptionParagraphs(body.description),
    category: str(body.category, 'Category', 60, !draft),
    prepMinutes: minutes(body.prepMinutes, 'Prep time'),
    cookMinutes: minutes(body.cookMinutes, 'Cook time'),
    servings: str(body.servings, 'Servings', 40),
    ingredients: draft ? optionalLines(body.ingredients, 'Ingredients', 60, 250) : list(body.ingredients, 'Ingredients', 60, 250),
    steps: draft ? optionalLines(body.steps, 'Directions', 35, 1000) : list(body.steps, 'Directions', 35, 1000),
    image,
    draft,
    hidden: previous?.draft === true && !draft ? false : previous?.hidden === true,
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (draft) recipe.ingredientDraftRows = draftIngredientRows(body.ingredientDraftRows);
  else delete recipe.ingredientDraftRows;
  return { recipe, imageBase64: base64 };
}

function pathFor(id) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw new ApiError('Invalid recipe ID.');
  return `recipes/${id}.json`;
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'moms-cookbook-api',
  };
}

async function github(env, path, options = {}) {
  const root = `https://api.github.com/repos/${encodeURIComponent(env.REPO_OWNER)}/${encodeURIComponent(env.REPO_NAME)}`;
  const response = await fetch(root + path, { ...options, headers: githubHeaders(env), cache: 'no-store' });
  if (!response.ok) {
    if (response.status === 404) throw new ApiError('Recipe not found.', 404);
    if ([409, 422].includes(response.status)) throw new ApiError('Recipe changed on GitHub. Refresh the list and try again.', 409);
    throw new ApiError(`GitHub returned HTTP ${response.status}. Check the GitHub token and repository permissions.`, 502);
  }
  return response.json();
}

function encodeText(content) {
  const bytes = encoder.encode(content);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

function decodeText(content) {
  const binary = atob(content.replace(/\s/g, ''));
  return decoder.decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}

async function getRecipe(env, id) {
  const item = await github(env, `/contents/${pathFor(id)}?ref=main`);
  if (item.type !== 'file' || item.encoding !== 'base64' || !item.content) throw new ApiError('Cannot read recipe.', 502);
  const recipe = JSON.parse(decodeText(item.content));
  recipe.description = descriptionParagraphs(recipe.description);
  if (recipe.id !== id) throw new ApiError('Recipe ID does not match its file.', 502);
  return { recipe, sha: item.sha };
}

async function getRecipes(env) {
  const files = await github(env, '/contents/recipes?ref=main');
  if (!Array.isArray(files)) throw new ApiError('Cannot list recipes.', 502);
  const names = files.filter(f => f.type === 'file' && /^[a-z0-9][a-z0-9-]{0,79}\.json$/.test(f.name));
  // GitHub's Contents API lists up to 1,000 files per directory.
  const results = [];
  for (let offset = 0; offset < names.length; offset += 6) {
    const batch = await Promise.all(names.slice(offset, offset + 6).map(f => getRecipe(env, f.name.slice(0, -5))));
    results.push(...batch.map(({ recipe, sha }) => ({ ...recipe, sha })));
  }
  return results.sort((a, b) => a.title.localeCompare(b.title));
}

async function writeFile(env, path, base64, message, sha = null) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const body = { message, content: base64, branch: 'main' };
  if (sha) body.sha = sha;
  return github(env, `/contents/${encodedPath}`, { method: 'PUT', body: JSON.stringify(body) });
}

async function savePhoto(env, recipe, imageBase64) {
  if (imageBase64) {
    await writeFile(env, `public/${recipe.image}`, imageBase64, `Add photo for ${recipe.title}`);
  }
}

async function readBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) throw new ApiError('Recipe or photo is too large.', 413);
  try { return JSON.parse(raw); }
  catch { throw new ApiError('Invalid JSON request.'); }
}

function requiredSha(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) throw new ApiError('A recipe version is required. Refresh the list.');
  return value;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'Origin not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const { pathname } = new URL(request.url);
    if (pathname === '/api/health' && request.method === 'GET') return json({ ok: true }, 200, origin);
    const isLogin = pathname === '/api/login' && request.method === 'POST';
    const isCollection = pathname === '/api/recipes';
    const match = pathname.match(/^\/api\/recipes\/([a-z0-9-]+)(?:\/visibility)?$/);
    if (!isLogin && !isCollection && !match) return json({ error: 'Not found.' }, 404, origin);
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || !env.GITHUB_TOKEN) {
      return json({ error: 'Server secrets are not configured.' }, 503, origin);
    }
    try {
      if (isLogin) {
        const raw = await request.text();
        if (raw.length > 8192) throw new ApiError('Invalid request.');
        const parsed = JSON.parse(raw);
        if (typeof parsed?.password !== 'string' || parsed.password.length > 256 ||
            !(await samePassword(parsed.password, env.ADMIN_PASSWORD))) {
          throw new ApiError('Incorrect password.', 401);
        }
        return json({ token: await issueToken(env.SESSION_SECRET) }, 200, origin);
      }
      if (!(await validToken(request.headers.get('Authorization'), env.SESSION_SECRET))) {
        throw new ApiError('Not authorized.', 401);
      }
      if (isCollection && request.method === 'GET') {
        return json({ recipes: await getRecipes(env) }, 200, origin);
      }
      if (isCollection && request.method === 'POST') {
        const { recipe, imageBase64 } = validateRecipe(await readBody(request));
        await savePhoto(env, recipe, imageBase64);
        await writeFile(env, pathFor(recipe.id), encodeText(`${JSON.stringify(recipe, null, 2)}\n`), `${recipe.draft ? 'Save draft' : 'Add recipe'}: ${recipe.title}`);
        return json({ ...recipe }, 201, origin);
      }
      if (match) {
        const id = match[1];
        const isVisibility = pathname.endsWith('/visibility');
        if ((isVisibility && request.method !== 'PATCH') || (!isVisibility && request.method !== 'PUT')) {
          return json({ error: 'Method not allowed.' }, 405, origin);
        }
        const body = await readBody(request);
        const suppliedSha = requiredSha(body?.sha);
        const { recipe: previous, sha } = await getRecipe(env, id);
        if (sha !== suppliedSha) throw new ApiError('Recipe changed on GitHub. Refresh and try again.', 409);
        let recipe;
        let imageBase64 = null;
        if (isVisibility) {
          if (typeof body.hidden !== 'boolean') throw new ApiError('Hidden must be true or false.');
          recipe = { ...previous, hidden: body.hidden, updatedAt: new Date().toISOString() };
        } else {
          ({ recipe, imageBase64 } = validateRecipe(body, previous));
        }
        await savePhoto(env, recipe, imageBase64);
        const result = await writeFile(env, pathFor(id), encodeText(`${JSON.stringify(recipe, null, 2)}\n`), `${isVisibility ? (recipe.hidden ? 'Hide' : 'Unhide') : recipe.draft ? 'Save draft' : 'Edit'} recipe: ${recipe.title}`, sha);
        return json({ ...recipe, sha: result.content.sha }, 200, origin);
      }
      return json({ error: 'Method not allowed.' }, 405, origin);
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status, origin);
      if (error instanceof SyntaxError) return json({ error: 'Invalid JSON request.' }, 400, origin);
      return json({ error: 'Could not complete request. Check Worker logs.' }, 500, origin);
    }
  },
};
