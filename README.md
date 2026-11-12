# Cuts & Style — Barber Shop Website

Barber shop website with online booking and an admin control panel.

- Website: `/`
- Admin panel: `/admin/` (first login: `admin` / `admin123`, or the `ADMIN_PASSWORD` you set. Change it in Settings.)

## Run on your computer
1. Install Node.js (LTS) from https://nodejs.org
2. In this folder run `npm install` (first time only)
3. Run `npm start` and open http://localhost:3000

Data is saved in `data/db.json` and photos in `data/uploads/`.

## Run on Vercel
Vercel cannot save files, so connect two free storage services once:

1. Vercel project → **Storage** → **Upstash for Redis** (Marketplace) → create → connect it to this project.
2. Vercel project → **Storage** → **Blob** → create → connect it to this project.
3. **Settings → Environment Variables** → add `ADMIN_PASSWORD`. While it is set, it is always the admin password (username `admin`); change it there and redeploy to reset the login.
4. **Deployments** → latest deployment → ⋯ → **Redeploy**.

The Redis integration adds `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`)
and the Blob store adds `BLOB_READ_WRITE_TOKEN`. The app detects them automatically.

## Files
- `server.js` — web server and API (booking rules, admin login, everything the admin panel does)
- `db.js` — storage: JSON file locally, Redis + Blob on Vercel
- `public/` — the website (`index.html`, `css/`, `js/`) and the admin panel (`public/admin/`)
