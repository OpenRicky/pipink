# pipink

English | [中文](./README.zh.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OpenRicky/pipink)

## Project Introduction

pipink is a Cloudflare Workers project that exposes one stable public entrypoint and proxies traffic to a target URL stored in Workers KV. Clients keep calling the same Worker URL, while operators can update the upstream target at runtime through the admin API or admin UI.

The current scope is intentionally narrow: pipink currently focuses on proxying a target link. The next phase will add content processing and conversion on top of the upstream response instead of only forwarding it.

## Project Features

Roadmap:

- [x] Stable Worker endpoint for a configurable target URL
- [x] Query-token protection for public proxy access
- [x] Workers KV storage for runtime target URL and access token updates
- [x] Admin UI with login, logout, and settings management
- [x] Direct proxy forwarding instead of 302 redirects
- [ ] Response transformation for upstream content
- [ ] Content conversion rules for target link outputs
- [ ] More advanced rewrite and processing workflows

## Quick Deploy

### Option A. Deploy with the Cloudflare button

Use the button at the top of this README to deploy directly from GitHub.

Cloudflare will create a new repository from this deploy template, provision the `LINK_STORE` KV namespace during setup, and prompt you for `ADMIN_KEY` plus `INITIAL_ACCESS_TOKEN` based on `.dev.vars.example`.

The committed `wrangler.jsonc` is the public template that makes this possible.

### Option B. Manual deployment

### 1. Install dependencies

```bash
pnpm install
```

### 2. Log in to Cloudflare

After cloning the project and installing dependencies, log in to Cloudflare in your terminal:

```bash
pnpm wrangler login
```

### 3. Update the Wrangler config

The repository now includes a public `wrangler.jsonc` for Deploy to Cloudflare and manual deployment.

If you want private local or production overrides, copy it first and edit the ignored `wrangler.local.jsonc` instead:

```bash
cp wrangler.jsonc wrangler.local.jsonc
```

`pnpm dev` and `pnpm deploy:worker` automatically prefer `wrangler.local.jsonc` when it exists. If it does not exist, they fall back to the committed `wrangler.jsonc`.

Update these fields in whichever config file you use:

- `name`: choose a unique Worker name
- `kv_namespaces[0].id`: run `pnpm wrangler kv namespace create LINK_STORE` and paste the returned production ID
- `observability.enabled`: keep it on if you want Cloudflare logs and traces

If you want to bind a custom domain, add this block to `wrangler.jsonc`. A normal `workers.dev` deployment does not need it:

```json
"routes": [
  {
    "pattern": "pipink.example.com",
    "custom_domain": true
  }
]
```

### 4. Set production secrets

```bash
pnpm wrangler secret put ADMIN_KEY
pnpm wrangler secret put INITIAL_ACCESS_TOKEN
```

`INITIAL_ACCESS_TOKEN` seeds the first public token. If you leave it unset during a manual deployment, pipink generates the first token after the first successful admin login.

If you deploy with the Cloudflare button, Cloudflare will ask for these secret values during setup and you do not need to create the KV namespace manually.

To rotate `ADMIN_KEY` later, run `pnpm wrangler secret put ADMIN_KEY` again and redeploy with `pnpm deploy:worker`.
If an access token is already stored in Workers KV, changing `INITIAL_ACCESS_TOKEN` later will not overwrite that existing token.

### 5. Deploy to Cloudflare

```bash
pnpm deploy:worker
```

After deployment, the URLs usually look like this:

```text
https://pipink.<your-subdomain>.workers.dev
https://pipink.<your-subdomain>.workers.dev/admin
```

## Usage

### 1. Configure the target URL and access token

Open `/admin` in the browser, sign in with `ADMIN_KEY`, then configure:

- the upstream target URL
- the public access token

You can also update the target directly through the admin API:

```bash
curl -X PUT "https://pipink.<your-subdomain>.workers.dev/admin/target" \
  -H "Authorization: Bearer your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"https://example.com/your-real-link"}'
```

### 2. Call the stable public URL

Use the Worker URL with `?token=`:

```text
https://pipink.<your-subdomain>.workers.dev/?token=your-access-token
```

The same tokenized URL can be shared with clients, and `/admin` stays available for future target or token updates.

## Local Run and Smoke Test

If you want to test locally before deployment, create a local env file:

```bash
cp .dev.vars.example .dev.vars
```

If you want local `wrangler dev` to use a preview KV namespace, create one and add `preview_id` under `kv_namespaces[0]` in the config file you actually use:

```bash
pnpm wrangler kv namespace create LINK_STORE --preview
```

Then start the local server:

```bash
pnpm dev
```

Useful local URLs:

- `http://127.0.0.1:8787/admin`
- `http://127.0.0.1:8787/?token=your-access-token`

## Development Notes

Install the following before working on the project:

- Node.js 20 or newer
- pnpm 10 or newer
- a Cloudflare account

Useful commands:

```bash
pnpm build
pnpm check
pnpm dev
pnpm deploy:worker
```

The admin UI is built with Vue 3 and Vite. Static assets are emitted into `dist` and served by Cloudflare Workers Static Assets.

## API Documentation

The OpenAPI description is available at [docs/openapi.yaml](./docs/openapi.yaml).

## License

This project is released under the MIT License. Anyone can use, modify, distribute, and sublicense it with minimal restrictions. See [LICENSE](./LICENSE).
