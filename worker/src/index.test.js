import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';

const env = {
  ADMIN_PASSWORD: 'test-password',
  SESSION_SECRET: 'long-test-secret-for-signing-tokens-123',
  GITHUB_TOKEN: 'not-a-real-token',
  REPO_OWNER: 'Jaruso',
  REPO_NAME: 'moms-cookbook',
};
const sha1 = 'a'.repeat(40);
const sha2 = 'b'.repeat(40);
const sha3 = 'c'.repeat(40);
const record = {
  id: 'sample-recipe', title: 'Sample recipe', category: 'Dinner',
  description: '', prepMinutes: 5, cookMinutes: 10, servings: '2',
  ingredients: ['1 cup water'], steps: ['Boil water.'],
  image: null, hidden: false, createdAt: '2026-11-16T00:00:00.000Z',
};

function api(path, method, token, body) {
  return worker.fetch(new Request(`https://example.workers.dev${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
}

async function read(response, expectedStatus) {
  assert.equal(response.status, expectedStatus);
  return response.json();
}

test('Admin can list, edit, hide and unhide recipes; the public cannot', async t => {
  const previousFetch = globalThis.fetch;
  let stored = { ...record };
  let currentSha = sha1;
  const writes = [];
  globalThis.fetch = async (rawUrl, options) => {
    const url = new URL(rawUrl);
    assert.equal(url.hostname, 'api.github.com');
    assert.equal(options.headers.Authorization, 'Bearer not-a-real-token');
    if (options.method === 'PUT') {
      const put = JSON.parse(options.body);
      assert.equal(put.sha, currentSha);
      stored = JSON.parse(Buffer.from(put.content, 'base64').toString('utf8'));
      writes.push(stored);
      currentSha = currentSha === sha1 ? sha2 : sha3;
      return Response.json({ content: { sha: currentSha } });
    }
    if (url.pathname.endsWith('/contents/recipes')) {
      return Response.json([{ name: 'sample-recipe.json', type: 'file' }]);
    }
    if (url.pathname.endsWith('/contents/recipes/sample-recipe.json')) {
      return Response.json({ type: 'file', encoding: 'base64', sha: currentSha, content: Buffer.from(JSON.stringify(stored)).toString('base64') });
    }
    return Response.json({ message: 'Not found' }, { status: 404 });
  };
  t.after(() => { globalThis.fetch = previousFetch; });

  assert.equal((await api('/api/recipes', 'GET')).status, 401);
  const badLogin = await api('/api/login', 'POST', null, { password: 'incorrect' });
  assert.equal(badLogin.status, 401);
  const { token } = await read(await api('/api/login', 'POST', null, { password: 'test-password' }), 200);
  assert.ok(token);

  const listing = await read(await api('/api/recipes', 'GET', token), 200);
  assert.equal(listing.recipes.length, 1);
  assert.equal(listing.recipes[0].sha, sha1);

  const edit = await read(await api('/api/recipes/sample-recipe', 'PUT', token, {
    ...stored, title: 'Edited recipe', sha: sha1,
  }), 200);
  assert.equal(edit.title, 'Edited recipe');
  assert.equal(edit.id, 'sample-recipe');
  assert.equal(edit.sha, sha2);

  const hidden = await read(await api('/api/recipes/sample-recipe/visibility', 'PATCH', token, {
    sha: sha2, hidden: true,
  }), 200);
  assert.equal(hidden.hidden, true);
  assert.equal(hidden.sha, sha3);
  assert.equal(stored.hidden, true);
  assert.equal(writes.length, 2);

  const conflict = await api('/api/recipes/sample-recipe/visibility', 'PATCH', token, { sha: sha1, hidden: false });
  assert.equal(conflict.status, 409);
  const unhidden = await read(await api('/api/recipes/sample-recipe/visibility', 'PATCH', token, { sha: sha3, hidden: false }), 200);
  assert.equal(unhidden.hidden, false);
});
