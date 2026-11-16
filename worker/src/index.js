const encoder = new TextEncoder();
const SESSION_MS = 4 * 60 * 60 * 1000;
const MAX_BODY_CHARS = 1_500_000;
const ALLOWED_ORIGINS = new Set(['https://jaruso.github.io', 'http://localhost:5173']);

function cors(origin) {
  return origin && ALLOWED_ORIGINS.has(origin) ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    throw new Error(`${name} must be ${required ? 'a nonempty' : 'a'} text value up to ${max} characters.`);
  }
  return value.trim();
}

function list(value, name, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems ||
      value.some(item => typeof item !== 'string' || !item.trim() || item.length > maxLength)) {
    throw new Error(`${name} must have 1–${maxItems} nonempty lines.`);
  }
  return value.map(item => item.trim());
}

function minutes(value, name) {
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isInteger(value) || value < 0 || value > 999) throw new Error(`${name} must be 0–999 minutes.`);
  return value;
}

function imageData(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 1_300_000 || value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || !value.startsWith('/9j/')) {
    throw new Error('Photo must be a JPEG under 1 MB.');
  }
  const bytes = Math.floor(value.length * 3 / 4) - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
  if (bytes > 1_000_000) throw new Error('Photo must be under 1 MB.');
  return value;
}

function validate(body) {
  const title = str(body.title, 'Recipe name', 120, true);
  const slug = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50).replace(/-$/, '') || 'recipe';
  const id = `${slug}-${crypto.randomUUID().slice(0, 8)}`;
  const imageBase64 = imageData(body.imageBase64);
  const recipe = {
    id,
    title,
    description: str(body.description, 'Description', 800),
    category: str(body.category, 'Category', 60),
    prepMinutes: minutes(body.prepMinutes, 'Prep time'),
    cookMinutes: minutes(body.cookMinutes, 'Cook time'),
    servings: str(body.servings, 'Servings', 40),
    ingredients: list(body.ingredients, 'Ingredients', 60, 250),
    steps: list(body.steps, 'Directions', 35, 1000),
    image: imageBase64 ? `images/${id}.jpg` : null,
    createdAt: new Date().toISOString(),
  };
  return { recipe, imageBase64 };
}

async function commitFile(env, path, base64, message) {
  const owner = encodeURIComponent(env.REPO_OWNER);
  const repo = encodeURIComponent(env.REPO_NAME);
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'moms-cookbook-api',
    },
    body: JSON.stringify({ message, content: base64, branch: 'main' }),
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}. Check the repository token and permissions.`);
}

function encodeText(content) {
  const bytes = encoder.encode(content);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: 'Origin not allowed.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const { pathname } = new URL(request.url);
    if (pathname === '/api/health' && request.method === 'GET') return json({ ok: true }, 200, origin);
    if (pathname !== '/api/login' && pathname !== '/api/recipes') return json({ error: 'Not found.' }, 404, origin);
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin);
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || !env.GITHUB_TOKEN) {
      return json({ error: 'Server secrets are not configured.' }, 503, origin);
    }
    try {
      if (pathname === '/api/login') {
        const body = await request.text();
        if (body.length > 8192) return json({ error: 'Invalid request.' }, 400, origin);
        const parsed = JSON.parse(body);
        if (typeof parsed?.password !== 'string' || parsed.password.length > 256 ||
            !(await samePassword(parsed.password, env.ADMIN_PASSWORD))) {
          return json({ error: 'Incorrect password.' }, 401, origin);
        }
        return json({ token: await issueToken(env.SESSION_SECRET) }, 200, origin);
      }
      if (!(await validToken(request.headers.get('Authorization'), env.SESSION_SECRET))) {
        return json({ error: 'Not authorized.' }, 401, origin);
      }
      const raw = await request.text();
      if (raw.length > MAX_BODY_CHARS) return json({ error: 'Recipe or photo is too large.' }, 413, origin);
      const { recipe, imageBase64 } = validate(JSON.parse(raw));
      if (imageBase64) await commitFile(env, `public/${recipe.image}`, imageBase64, `Add photo for ${recipe.title}`);
      await commitFile(env, `recipes/${recipe.id}.json`, encodeText(`${JSON.stringify(recipe, null, 2)}\n`), `Add recipe: ${recipe.title}`);
      return json({ id: recipe.id, title: recipe.title }, 201, origin);
    } catch (error) {
      const validation = error instanceof SyntaxError || !String(error.message).startsWith('GitHub returned');
      return json({ error: validation ? error.message : `Could not publish: ${error.message}` }, validation ? 400 : 502, origin);
    }
  },
};
