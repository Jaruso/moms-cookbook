# Mom's Cookbook

A small, public recipe website hosted on **GitHub Pages**. It uses React/Vite for the static frontend and a **Cloudflare Worker** for a password-protected admin area. The Worker adds or edits JSON recipes, changes their visibility, and uploads optional images to GitHub; GitHub Actions rebuilds the site automatically.

## How it works

1. Visitors read recipes at `https://jaruso.github.io/moms-cookbook/` — no backend needed for reading.
2. Mom opens `https://jaruso.github.io/moms-cookbook/#/admin` and enters her one shared admin password.
3. After signing in, Mom can add a recipe, edit an existing one, or hide/unhide a recipe in the **Manage recipes** list. Publishing a new recipe returns her to the public home page with a confirmation; new content appears after the Pages rebuild.
4. The Worker verifies the signed session and commits recipe JSON under `recipes/` and optional images under `public/images/`.
5. A push to `main` triggers GitHub Actions to rebuild and redeploy GitHub Pages. The build excludes recipes with `"hidden": true` from the public JavaScript bundle.

There is **one admin password**, no registration and no automated password reset. Anyone can view recipes; only the password-holder can create or modify them. **Hiding is not privacy:** the GitHub repository is public, so hidden recipe JSON and images remain accessible through GitHub (and previously published image URLs may still work). Never store confidential content.

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

Create a GitHub **fine-grained personal access token** scoped **only** to `Jaruso/moms-cookbook` with **Contents: Read and write**. The token is used only by the Worker to list, create, and update recipe JSON and image files. It does not need Actions, Pages, or Workflows permission. Use a token expiration/renewal plan.

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

## Automatic Cloudflare Worker deployment

The GitHub Actions workflow in `.github/workflows/deploy-worker.yml` runs the Worker tests and deploys the existing `moms-cookbook-api` Worker when files inside `worker/` change on `main`. You can also run it manually under **Actions → Deploy Cloudflare Worker → Run workflow**. Changes only to recipes or the frontend do not trigger a Worker deployment.

Set these **repository Actions secrets** once under **Settings → Secrets and variables → Actions → New repository secret**:

- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID (shown in the Cloudflare dashboard).
- `CLOUDFLARE_API_TOKEN` — a dedicated Cloudflare API token with **Workers Editor** access scoped to the existing Worker `moms-cookbook-api`, or the **Edit Cloudflare Workers** permission scoped to its account if using the standard token template. No GitHub personal access token should be used here.

The workflow uses Cloudflare's `wrangler-action@v4` from the `worker/` directory and does **not** recreate or upload the app's runtime secrets (`ADMIN_PASSWORD`, `SESSION_SECRET`, `GITHUB_TOKEN`). Those remain configured directly in Cloudflare.

**Important:** The initial workflow run fails until both GitHub secrets are configured. To deploy manually instead, run:

```bash
git pull
cd worker
npx wrangler deploy
```

The Worker exposes authenticated `GET /api/recipes` (manage list), `PUT /api/recipes/:id` (edit), and `PATCH /api/recipes/:id/visibility` (hide/unhide). Recipe updates use GitHub file SHA checks to reject stale writes.

Changes to `worker/src/index.js` (including description validation) need to reach Cloudflare through the Worker deployment workflow. If its GitHub secrets are not configured, run `cd worker && npx wrangler deploy` locally after pulling the latest changes.


## Local development

```bash
npm install
npm run dev
```

The `predev` and `prebuild` scripts generate `src/public-recipes.json` from only visible JSON recipes. The generated file is ignored by Git; each Pages build recomputes it. You can test the backend locally with `node --test worker/src/index.test.js`.

For the admin editor to work locally, run the Worker with `cd worker && npx wrangler dev`, then create `.env.local` in the repo root with `VITE_API_URL=http://127.0.0.1:8787`. For local Worker testing, add a **gitignored** `worker/.dev.vars` containing `ADMIN_PASSWORD`, `SESSION_SECRET`, and `GITHUB_TOKEN`. Avoid testing writes with the real production token unless you intend to commit recipes.

The Worker accepts both `https://jaruso.github.io` and `http://localhost:5173` (only for local development). API CORS is not the authentication mechanism; every write requires a short-lived signed bearer token.

## Repository layout

```text
recipes/                 One JSON file per recipe (source of truth)
public/images/            Optional recipe photos, added through the editor
src/                      React site and admin UI
scripts/build-recipes.mjs  Generates the visible-only recipe list for Vite
worker/src/index.js       Cloudflare Worker API (password login, GitHub writes)
worker/wrangler.toml      Nonsecret Worker config
.github/workflows/        GitHub Pages deployment
```

Recipe fields: `id`, `title`, `description` (ordered array of paragraphs), `category`, `prepMinutes`, `cookMinutes`, `servings`, `ingredients` (array of strings), `steps` (array of strings), `image` (relative path or null), `hidden` (optional boolean, defaults to visible), `createdAt`, and `updatedAt` (UTC ISO timestamps). The sample is demonstration content, not an actual family recipe.

### Optional description and paragraph sections

The admin form has an optional **Description** textarea. Separate paragraphs with **one blank line**. The Worker validates the text (up to 30 paragraphs, 2,000 characters each, 12,000 characters total) and saves `description` as an ordered array of strings in each recipe JSON:

```json
"description": [
  "The first paragraph of the recipe story.",
  "The next paragraph, still in the original order."
]
```

Existing recipes that used a single description string are accepted by the API and frontend; legacy records are normalized when read or edited. Each paragraph appears as its own `<section class="recipe-description-section">` on the public page. An **empty `recipe-description-insertion` element** is rendered between consecutive sections with `data-after-paragraph` showing its position. This reserves a stable insertion point for future ad components without displaying placeholder ads or injecting scripts today. Recipe cards use the first paragraph as a short preview; search includes all paragraphs.

### Ingredient entry

The admin editor uses ingredient rows with **Amount** (free-form, including fractions like `1 1/2`), a short **Unit** dropdown (`tsp`, `tbsp`, `cup`, `oz`, `lb`, `g`, `ml`, `clove`, `can`, `pinch`, `piece`, or no unit), and **Ingredient**. Selecting **Custom…** reveals a text field for measurements like `bunch` or `sprigs`. The editor converts rows back into the existing string-array format (e.g. `2 cups flour`) when saving, so **the JSON format and Cloudflare Worker API do not change**. Older ingredient strings are read back into the editor conservatively; unknown wording is retained instead of discarded.


## Security and limitations

- Only one admin; access depends on keeping the admin password private. Use a long random password.
- No password recovery; rotate the Cloudflare secret if forgotten.
- The Worker accepts only JPEG photos from the editor, with a server-side maximum of 1 MB of base64 image content. The editor resizes uploaded images before sending them.
- Uploading or replacing a photo creates one commit for the image and one for the recipe. If the second write fails, an unused image may remain; the editor reports the failure. Removed/replaced images are not automatically deleted from GitHub.
- New posts become public when GitHub Actions completes the next Pages deployment, **not immediately** when the API responds.
- Editing and hiding use authenticated API endpoints and current GitHub file SHA checks. Recipes are not deleted when hidden; public visibility changes after the next Pages build.
- The admin list currently uses GitHub's Contents API, which returns at most 1,000 entries in a directory; split or index recipes if the collection ever grows beyond that.
