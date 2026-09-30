# Deployment — Cloudflare Pages

Static site: `pnpm build` → `dist/` (`index.html`, `assets/`, `favicon.svg`, `_headers`). No server code.

## One-time setup (done by the repo owner)

1. Push the branch you want to deploy to the GitHub remote (`blockora` → `github.com/LocNVT/blockora`).
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the GitHub repo.
3. Build settings:
   - Production branch: `master` (other branches get preview deploys)
   - Build command: `pnpm build` (runs `tsc --noEmit && vite build`; pnpm is detected from `pnpm-lock.yaml`)
   - Build output directory: `dist`
   - Root directory: `/`
   - Environment variables: `NODE_VERSION=22` (optionally `PNPM_VERSION=9`)
4. Save and deploy. Optional: add a custom domain.

## Cache and security headers

Defined in `public/_headers` (copied into `dist/`; only Cloudflare Pages applies it — `vite dev` / `vite preview` ignore it):

- `/assets/*` — `public, max-age=31536000, immutable` (hashed file names)
- `/`, `/index.html` — `no-cache` (always revalidated, so new deploys load immediately)
- `/favicon.svg` — `max-age=86400`
- All paths — `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a Content-Security-Policy (`script-src 'self'`, no `unsafe-eval`; `style-src` needs `'unsafe-inline'` because the UI injects `<style>` elements and sets inline styles; `img-src` allows `data:` / `blob:` for the procedural atlas and icon data URLs).

Compression (gzip / brotli) is automatic on Pages — no pre-compressed files. Bundle (raw / gzip / brotli): game `index-*.js` 247 / 77 / 65 kB, `vendor-three-*.js` 895 / 241 / 193 kB, `chunkGen.worker-*.js` 22 / 8 / 7 kB.

## Verify after the first deploy

```sh
curl -I https://<project>.pages.dev/                              # cache-control: no-cache + CSP + nosniff
curl -I https://<project>.pages.dev/assets/<vendor-three file>.js # immutable, max-age=31536000
curl -I https://<project>.pages.dev/favicon.svg                   # max-age=86400
```

Then open the site with DevTools: no CSP errors in the console, no 404s, F3 shows `gen on worker`, and a save survives a reload.

## Not set up

COOP / COEP headers (only needed if SharedArrayBuffer is ever used), error / performance monitoring services.
