# Unsent

Anonymous voice confessions. You get a generated identity (no account), record a short story,
and your **voice is disguised on your own device before it ever leaves** — the raw recording
never travels. Everyone browses strangers' stories one at a time and leaves a single soft
reaction, "I feel this."

- **Frontend** — one static page (`public/index.html`): identity, recording (MediaRecorder),
  on-device pitch-shift masking (Web Audio), playback feed.
- **Backend** — `server.js` (Node + Express): serves the app and a small JSON API.
- **Storage** — Supabase Postgres (metadata) + Supabase Storage (the disguised `.wav` clips).

---

## Run it live (GitHub → Render), ~15 minutes

### 1. Supabase (the vault)
1. Create a free project at https://supabase.com.
2. Open **SQL Editor → New query**, paste all of `db.sql`, and **Run**. That makes the table,
   the counters, and a public `voices` storage bucket.
3. **Settings → API**. Copy two things:
   - **Project URL** → this is `SUPABASE_URL`
   - **service_role** secret key → this is `SUPABASE_SERVICE_KEY` (keep it private — it bypasses
     security rules; it only ever lives on the server, never in the browser).

### 2. GitHub (the code)
```bash
cd unsent
git init
git add .
git commit -m "Unsent: anonymous voice confessions"
# make an empty repo on github.com first, then:
git remote add origin https://github.com/<you>/unsent.git
git branch -M main
git push -u origin main
```

### 3. Render (the host)
1. At https://render.com: **New + → Web Service**, connect your GitHub, pick the `unsent` repo.
2. Settings (Render usually reads these from `render.yaml` automatically):
   - Runtime **Node**, Build `npm install`, Start `npm start`.
3. **Environment** → add:
   - `SUPABASE_URL` = your Project URL
   - `SUPABASE_SERVICE_KEY` = your service_role key
4. **Create Web Service.** When the build finishes you get a public `https://unsent-xxxx.onrender.com`
   link anyone can open.

> Free tier notes: the service sleeps after idle time, so the first visit after a quiet spell is
> slow (a cold start). Free-tier terms change — check Render's current limits.

### Local dev
```bash
npm install
cp .env.example .env     # fill in your Supabase URL + service key
npm start                # http://localhost:3000
```

---

## What's deliberately minimal (and what to add next)
- **Moderation** is v1-grade: a flag button that auto-hides a clip past a threshold, plus rate
  limiting and a length cap. For a public app, add transcription (Whisper) + text moderation on
  the transcript before a clip goes public, and a proper review queue. This is the first thing to
  harden — anonymous public audio needs it.
- **Reaction de-duplication** is per-browser (localStorage), not per-account.
- **Audio** is uploaded as WAV. Fine for short clips; add Opus/MP3 compression to cut storage.

## Environment variables
| var | required | what |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | yes | service_role key (server only) |
| `SUPABASE_BUCKET` | no | storage bucket, default `voices` |
| `FLAG_HIDE_THRESHOLD` | no | flags before auto-hide, default `3` |
| `PORT` | no | Render sets this automatically |
