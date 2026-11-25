import express from "express";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'", "data:"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"]
    }
  }
}));
app.use(express.json({ limit: "32kb" }));
const FILES = ["index.html","app.js","sw.js","manifest.json","icon-192.png","icon-512.png","icon-maskable-512.png"];
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "index.html")));
for (const f of FILES) {
  app.get("/" + f, (_req, res) => res.sendFile(path.join(__dirname, f)));
}

// Simple per-IP limit so strangers can't drain the free key
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 20;
}
setInterval(() => hits.clear(), 10 * 60_000).unref();

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, configured: Boolean(API_KEY), model: MODEL });
});

app.post("/api/chat", async (req, res) => {
  if (!API_KEY) {
    return res.status(503).json({ error: "AI abhi connect nahi hai. Server par GEMINI_API_KEY set karni hogi." });
  }
  if (limited(req.ip)) {
    return res.status(429).json({ error: "Bahut zyada messages. Thodi der ruk kar try karein." });
  }

  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 30) {
    return res.status(400).json({ error: "Chat messages sahi format mein bhejein." });
  }

  const contents = [];
  for (const item of messages) {
    if (!item || !["user", "assistant"].includes(item.role) ||
        typeof item.content !== "string" || !item.content.trim()) {
      return res.status(400).json({ error: "Message format sahi nahi hai." });
    }
    contents.push({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content.slice(0, 6000) }]
    });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: "You are ZANKAI AI, a helpful and professional AI assistant. Reply in the same language the user uses (Hindi, Hinglish, or English). Keep answers short and clear unless the user asks for detail. CRITICAL RULE: NEVER say or use the word 'Namaste' in any greeting or response. If unsure, say so honestly." }]
        },
        contents,
        generationConfig: { maxOutputTokens: 1200 }
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || "AI se jawab nahi mil saka.";
      return res.status(response.status === 429 ? 429 : 502).json({ error: message });
    }

    const answer = (data.candidates?.[0]?.content?.parts || [])
      .map(p => p.text || "")
      .join("\n")
      .trim();

    if (!answer) {
      return res.status(502).json({ error: "AI ka jawab khaali aaya. Dobara koshish karein." });
    }
    return res.json({ reply: answer });
  } catch (error) {
    console.error("ZANKAI AI chat request failed:", error);
    return res.status(500).json({ error: "Server mein dikkat aayi. Thodi der baad try karein." });
  }
});

app.listen(PORT, () => console.log(`ZANKAI AI is running on port ${PORT}`));
