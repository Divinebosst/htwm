# Frontend (Next.js)

The public website. See the main [README](../README.md) for setup.

```bash
npm install
cp .env.example .env.local
npm run dev        # http://localhost:3000 (the Django backend must be running)
```

- `src/app` — pages: home (`page.tsx`), `give/`, `events/`, `events/[slug]/`
- `src/components` — header, footer, events, prayer form, giving form
- `src/lib/api.ts` — reads data from the Django API (cached for about a minute)
- `next.config.ts` — passes `/api/*` and `/media/*` through to Django
