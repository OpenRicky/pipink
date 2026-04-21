# pipink

English | [中文](./README.zh.md)

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

### 1. Log in to Cloudflare

After cloning the project, log in to Cloudflare in your terminal:

```bash
pnpm wrangler login
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Create your Wrangler config

Copy the public template first:

```bash
cp wrangler.jsonc.example wrangler.jsonc
```

Then update these fields in `wrangler.jsonc`:

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

`INITIAL_ACCESS_TOKEN` is optional. If you skip it, pipink generates the first token after the first successful admin login.

To rotate `ADMIN_KEY` later, run `pnpm wrangler secret put ADMIN_KEY` again and redeploy with `pnpm deploy`.
If an access token is already stored in Workers KV, changing `INITIAL_ACCESS_TOKEN` later will not overwrite that existing token.

### 5. Deploy to Cloudflare

```bash
pnpm deploy
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

If you want local `wrangler dev` to use a preview KV namespace, create one and add `preview_id` under `kv_namespaces[0]` in `wrangler.jsonc`:

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
pnpm deploy
```

The admin UI is built with Vue 3 and Vite. Static assets are emitted into `dist` and served by Cloudflare Workers Static Assets.

## API Documentation

The OpenAPI description is available at [docs/openapi.yaml](./docs/openapi.yaml).

## License

This project is released under the MIT License. Anyone can use, modify, distribute, and sublicense it with minimal restrictions. See [LICENSE](./LICENSE).
