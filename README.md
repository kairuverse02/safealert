SAFEAlert is a small Next.js application that demonstrates simple WebRTC pairing and monitoring between a guardian and a dependent using Supabase for signaling and persistence.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

---

## Quick start (local) ⚙️

1. Copy environment variables:

```bash
cp .env.example .env.local
```

2. Fill in the Supabase values in `.env.local` (see `.env.example`).

3. Create the `pairing_rooms` table in your Postgres instance (see `db/create_pairing_rooms.sql`).

4. Install and run locally:

```bash
npm install
npm run dev
```

---

## Project overview 🔧

- **Stack:** Next.js (app router), React, TypeScript, Tailwind CSS.
- **Signaling:** Supabase JSONB `pairing_rooms` table used to persist `offer_signal` and `answer_signal` (supports trickle ICE).

---

## Debugging tips & notes 🐞

- If pairing fails with `InvalidAccessError` about m-line ordering or `InvalidStateError` when setting the remote description, look for these in the browser console and server logs:
  - On the dependent (patient), we now publish answers with `audio: false` initially to avoid m-line reorder issues.
  - The server PATCH merges candidate-only updates into the existing `answer_signal` and preserves `sdp` to avoid overwriting the answer with candidate-only payloads.
  - The guardian applies polled answers only when `sdp` is present and avoids re-applying an identical SDP (idempotent application).

---

## License

MIT — see `LICENSE` if present.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
