---
type: Reference
title: Home Diary
description: Where the Home Diary (Next.js + Supabase) design, code, migrations and tests live, how to run it, and which milestone it is on.
---

# Home Diary

A social web service: decorate an isometric room, write a diary entry per furniture kind, share the house with neighbors. Next.js (App Router) + Supabase (Postgres, Auth, Storage) + Vercel, room drawn with Canvas 2D.

| Document | What it holds |
|---|---|
| [home-diary/README.md](../home-diary/README.md) | The design and the progress log: rules, data model, milestones M0–M6, test policy, code structure, dated log (§11) |
| [home-diary/GLOSSARY.md](../home-diary/GLOSSARY.md) | Domain terms and words to avoid (집, 방, 넓히기, 종류 …) |
| [home-diary/AGENTS.md](../home-diary/AGENTS.md) | Next.js warning: this version differs from training data; read `node_modules/next/dist/docs/` first |

## Running

From `home-diary/`, Node via nvm ([package.json](../home-diary/package.json)):

```bash
npm run dev     # local server
npm test        # vitest: room math + PGlite DB tests
npm run lint
```

Environment: copy [.env.example](../home-diary/.env.example) to `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Migrations are applied by pasting them into the Supabase dashboard SQL Editor; no Supabase CLI or Docker ([README.md](../home-diary/README.md), 0단계).

## Where things are

- **Room math and drawing:** `lib/room/` (`geometry.ts` with tests, `draw.ts`, `kinds.ts` for furniture names, icons and heights). Pure functions, no DB.
- **Auth:** `lib/auth/nickname.ts` maps a nickname to an internal email (SHA-256); `app/actions.ts` has the signup, login and logout server actions; `proxy.ts` refreshes the session.
- **Supabase client:** `lib/supabase/server.ts` (server only; a browser client comes with photo upload in M2).
- **Pages:** `app/page.tsx` + `app/room-canvas.tsx` (my house), `app/login/`, `app/signup/`.
- **Database:** `supabase/migrations/` (one file per milestone); tests in `supabase/tests/`, with `db.ts` emulating Supabase's auth schema and roles in PGlite so RLS really applies.
- **Prototype:** `prototype/house-proto.html`, throwaway reference.

## Rules worth remembering

- Money and permission rules live in the database (Postgres functions, unique constraints, RLS). The client never writes `points` ([README.md](../home-diary/README.md), §7).
- A "day" is cut at KST midnight on the server.
- Test first only when the right answer can be written now and a mistake would hurt: room math, points, purchases, mail, RLS. Canvas and pages are checked by hand ([README.md](../home-diary/README.md), 테스트 방침).
- Per-step routine ends with: README log entry → commit → check the deploy.

## State and gaps (2026-11-14)

- M0 done and deployed; M1 (room, catalog, placement) committed as `b4651d6`. Next is M2 (records and points).
- `lib/db/` is in the README's planned code structure but does not exist yet.
