# Mom's Cookbook

A small, public recipe website hosted on **GitHub Pages**. It uses React/Vite for the static frontend and a **Cloudflare Worker** for a password-protected recipe editor. The Worker commits new JSON recipes and optional images back to GitHub; GitHub Actions rebuilds the site automatically.

## How it works

1. Visitors read recipes at `https://jaruso.github.io/moms-cookbook/` — no backend needed for reading.
2. Mom opens `https://jaruso.github.io/moms-cookbook/#/admin` and enters her one shared admin password.
3. The editor sends a recipe and optional photo to the Cloudflare Worker.
4. The Worker validates the login, commits a JSON file under `recipes/` and a JPEG under `public/images/` (if included).
5. A push to `main` triggers GitHub Actions to rebuild and redeploy GitHub Pages. The new recipe appears after deployment completes.

There is **one admin password**, no registration and no automated password reset. Anyone can view recipes; only the password-holder can add them. As the GitHub repository is public, **all recipes and photos are public**. Do not put private information in them.

## Initial deployment

### 1. GitHub Pages

Open **Settings → Pages → Build and deployment**, choose **GitHub Actions** as the source. The workflow in `.github/workflows/pages.yml` builds and publishes the site on pushes to `main`.

### 2. Cloudflare Worker

Install Node.js 22+, then from the repository root:

```bash
cd worker
npx wrangler login
npx wrangler deploy
```

The Worker is configured in `worker/wrangler.toml` to write to `Jaruso/moms-cookbook` and accept requests from `https://jaruso.github.io` only. Deployment will print a `https://...workers.dev` URL. No Cloudflare account ID belongs in the repository.

Create a GitHub **fine-grained personal access token** scoped **only** to `Jaruso/moms-cookbook` with **Contents: Read and write**. The token is used only by the Worker to create recipe and image files. It does not need Actions, Pages, or Workflows permission. Use a token expiration/renewal plan.

Generate two long independent random secrets locally (example):

```bash
openssl rand -base64 32   # choose this as the admin password; give it to Mom privately
openssl rand -base64 32   # SESSION_SECRET; keep private
```

In the `worker/` directory, set all three Cloudflare Worker secrets (commands prompt for values and **do not** put secrets in git):

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put GITHUB_TOKEN
```

The admin password has no reset-email flow. To rotate it, run `npx wrangler secret put ADMIN_PASSWORD` again. To sign out all existing sessions immediately, also rotate `SESSION_SECRET`. Worker login sessions expire after 4 hours; the browser stores the token only for the current tab session.

### 3. Connect the frontend to the Worker

In the GitHub repository, go to **Settings → Secrets and variables → Actions → Variables → New repository variable** and add:

- Name: `VITE_API_URL`
- Value: the Worker URL printed by `wrangler deploy`, for example `https://moms-cookbook-api.YOUR-SUBDOMAIN.workers.dev` (no trailing `/`).

Then go to **Actions → Deploy GitHub Pages → Run workflow** to rebuild the frontend with the Worker URL. The API URL is public configuration, **not a secret**.

## Local development

```bash
npm install
npm run dev
```

For the admin editor to work locally, run the Worker with `cd worker && npx wrangler dev`, then create `.env.local` in the repo root with `VITE_API_URL=http://127.0.0.1:8787`. For local Worker testing, add a **gitignored** `worker/.dev.vars` containing `ADMIN_PASSWORD`, `SESSION_SECRET`, and `GITHUB_TOKEN`. Avoid testing writes with the real production token unless you intend to commit recipes.

The Worker accepts both `https://jaruso.github.io` and `http://localhost:5173` (only for local development). API CORS is not the authentication mechanism; every write requires a short-lived signed bearer token.

## Repository layout

```text
recipes/                 One JSON file per recipe (source of truth)
public/images/            Optional recipe photos, added through the editor
src/                      React site and admin UI
worker/src/index.js       Cloudflare Worker API (password login, GitHub writes)
worker/wrangler.toml      Nonsecret Worker config
.github/workflows/        GitHub Pages deployment
```

Recipe fields: `id`, `title`, `description`, `category`, `prepMinutes`, `cookMinutes`, `servings`, `ingredients` (array of strings), `steps` (array of strings), `image` (relative path or null), and `createdAt` (UTC ISO timestamp). The sample is demonstration content, not an actual family recipe.

## Security and limitations

- Only one admin; access depends on keeping the admin password private. Use a long random password.
- No password recovery; rotate the Cloudflare secret if forgotten.
- The Worker accepts only JPEG photos from the editor, with a server-side maximum of 1 MB of base64 image content. The editor resizes uploaded images before sending them.
- Publishing creates one GitHub commit for the image (when present) and one for the recipe. If the second write fails, an unused image may remain; the editor reports the failure rather than claiming success.
- New posts become public when GitHub Actions completes the next Pages deployment, **not immediately** when the API responds.
- To add editing/deleting later, implement authenticated `PUT`/`DELETE` endpoints and GitHub's current file-SHA checks. This starter deliberately supports adding only.
