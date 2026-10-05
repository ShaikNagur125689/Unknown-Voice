// Unsent — anonymous voice-confession backend
// Serves the static app and a tiny JSON API backed by Supabase (DB + Storage).
"use strict";

const path = require("path");
const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || "voices";
const FLAG_HIDE_THRESHOLD = Number(process.env.FLAG_HIDE_THRESHOLD || 3);
const MAX_AUDIO_BYTES = Number(process.env.MAX_AUDIO_BYTES || 7 * 1024 * 1024); // 7 MB

const configured = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY);
const supabase = configured
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  : null;

if (!configured) {
  console.warn(
    "\n[unsent] SUPABASE_URL / SUPABASE_SERVICE_KEY are not set.\n" +
    "         The app will boot and serve the UI, but posting and the feed\n" +
    "         will return an error until you add those environment variables.\n"
  );
}

const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy; needed for rate-limit IPs
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES },
});

// --- rate limits (in-memory; resets on restart — fine for v1) ---
const postLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 12,                  // 12 confessions / hour / IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You've shared a lot in a short time. Come back in a little while." },
});
const actionLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

function need(res) {
  res.status(503).json({ error: "The vault isn't connected yet. (Server is missing its Supabase keys.)" });
}

function publicUrl(storedPath) {
  return supabase.storage.from(BUCKET).getPublicUrl(storedPath).data.publicUrl;
}

function shape(row) {
  return {
    id: row.id,
    handle: row.handle,
    mood: row.mood,
    title: row.title || "",
    cw: row.cw,
    duration: row.duration,
    feels: row.feels,
    url: publicUrl(row.audio_path),
    createdAt: row.created_at,
  };
}

// --- feed ---
app.get("/api/stories", async (req, res) => {
  if (!configured) return need(res);
  const { data, error } = await supabase
    .from("stories")
    .select("*")
    .eq("hidden", false)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: "Couldn't load the feed." });
  res.json({ stories: (data || []).map(shape) });
});

// --- post a confession ---
app.post("/api/stories", postLimiter, upload.single("audio"), async (req, res) => {
  if (!configured) return need(res);
  try {
    if (!req.file) return res.status(400).json({ error: "No audio came through." });

    const handle = String(req.body.handle || "someone").slice(0, 60);
    const mood = String(req.body.mood || "unspoken").slice(0, 24);
    const title = String(req.body.title || "").slice(0, 120);
    const cw = String(req.body.cw) === "true";
    const duration = Math.min(120, Math.max(0, Number(req.body.duration) || 0));

    const id = (global.crypto || require("crypto")).randomUUID();
    const audioPath = `${id}.wav`;

    const up = await supabase.storage
      .from(BUCKET)
      .upload(audioPath, req.file.buffer, {
        contentType: req.file.mimetype || "audio/wav",
        upsert: false,
      });
    if (up.error) {
      console.error("storage upload failed:", up.error);
      return res.status(500).json({ error: "The recording couldn't be stored." });
    }

    const ins = await supabase
      .from("stories")
      .insert({ id, handle, mood, title, cw, duration, audio_path: audioPath })
      .select()
      .single();
    if (ins.error) {
      console.error("insert failed:", ins.error);
      return res.status(500).json({ error: "The recording couldn't be saved." });
    }

    res.status(201).json({ story: shape(ins.data) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Something went wrong releasing that." });
  }
});

// --- react ("I feel this"): delta is +1 or -1 ---
app.post("/api/stories/:id/feel", actionLimiter, async (req, res) => {
  if (!configured) return need(res);
  const delta = Number(req.body && req.body.delta) === -1 ? -1 : 1;
  const { data, error } = await supabase.rpc("increment_feels", { story_id: req.params.id, delta });
  if (error) return res.status(500).json({ error: "Couldn't register that." });
  res.json({ feels: data });
});

// --- flag: auto-hides past a threshold ---
app.post("/api/stories/:id/flag", actionLimiter, async (req, res) => {
  if (!configured) return need(res);
  const { error } = await supabase.rpc("flag_story", {
    story_id: req.params.id,
    hide_at: FLAG_HIDE_THRESHOLD,
  });
  if (error) return res.status(500).json({ error: "Couldn't flag that." });
  res.json({ ok: true });
});

// --- static app ---
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// multer / body errors
app.use((err, req, res, next) => {
  if (err && err.code === "LIMIT_FILE_SIZE")
    return res.status(413).json({ error: "That recording is too large. Keep it under ~90 seconds." });
  console.error(err);
  res.status(500).json({ error: "Unexpected error." });
});

app.listen(PORT, () => console.log(`[unsent] listening on :${PORT}`));
