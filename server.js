const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8000;
// Helper to extract raw API key from Authorization header (strip 'Bearer ' if present)
function getRawAPIKey(req) {
  const authHeader = req.header('authorization') || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
}

// Directory to save binary responses
const responsesDir = path.join(__dirname, "responses");
if (!fs.existsSync(responsesDir)) {
  fs.mkdirSync(responsesDir, { recursive: true });
}

// Parse JSON bodies
app.use(express.json());

// Proxy to list models
app.get("/api/models", async (req, res) => {
  const apiKey = getRawAPIKey(req);
  const provider = (req.header("x-provider") || "openai").toLowerCase();
  if (!apiKey) {
    return res.status(400).json({ error: "Missing Authorization header" });
  }
  try {
    // List models for each provider
    if (provider === 'gemini') {
      // Google Generative Language API: use API key as query param (stable v1 endpoint)
      const url = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
      console.log(`[Gemini] Fetch models URL: ${url}`);
      const glRes = await fetch(url);
      const glData = await glRes.json();
      console.log(`[Gemini] Response status: ${glRes.status}`, glData);
      if (!glRes.ok) {
        // Forward error details
        return res.status(glRes.status).json(glData.error || glData);
      }
      // Transform to OpenAI-like { data: [{ id: name }, ...] }
      const models = Array.isArray(glData.models) ? glData.models : [];
      const transformed = {
        data: models.map(m => ({ id: m.name }))
      };
      return res.json(transformed);
    }
    // OpenAI API
    const oaHeaders = { Authorization: `Bearer ${apiKey}` };
    const oaRes = await fetch('https://api.openai.com/v1/models', { headers: oaHeaders });
    const oaData = await oaRes.json();
    if (!oaRes.ok) {
      return res.status(oaRes.status).json(oaData);
    }
    return res.json(oaData);
  } catch (err) {
    console.error("Error fetching models:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Proxy to completion endpoint and save response
app.post("/api/completions", async (req, res) => {
  const apiKey = getRawAPIKey(req);
  const provider = (req.header("x-provider") || "openai").toLowerCase();
  if (!apiKey) {
    return res.status(400).json({ error: "Missing Authorization header" });
  }
  try {
    if (provider === 'gemini') {
      // Use Gemini v1beta generateContent for text completions
      const { model, prompt } = req.body;
      // Build contents payload
      const contents = [ { role: 'user', parts: [ { text: prompt } ] } ];
      // Generation and safety settings (allow override via request or use defaults)
      const generationConfig = {
        temperature: typeof req.body.temperature === 'number' ? req.body.temperature : 0.9,
        topP:       typeof req.body.top_p === 'number'       ? req.body.top_p       : 0.8,
        topK:       typeof req.body.top_k === 'number'       ? req.body.top_k       : 40,
        maxOutputTokens: typeof req.body.max_tokens === 'number' ? req.body.max_tokens : 2048,
        stopSequences: Array.isArray(req.body.stop) ? req.body.stop
                         : req.body.stop ? [req.body.stop]
                         : ['EOM'],
      };
      const safetySettings = [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
      ];
      const glBody = { contents, generationConfig, safetySettings };
      // Normalize model name: strip leading 'models/' if present
      const modelId = model.startsWith('models/') ? model.replace(/^models\//, '') : model;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
      console.log('[Gemini] generateContent URL:', url, 'Body:', glBody);
      const glRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(glBody) });
      const raw = await glRes.text(); console.log(`[Gemini] generateContent raw response (status ${glRes.status}):`, raw);
      let glData;
      try { glData = raw ? JSON.parse(raw) : {}; } catch (e) {
        console.error('[Gemini] generateContent JSON parse error:', e);
        return res.status(500).json({ error: 'Invalid JSON from Gemini', raw });
      }
      if (!glRes.ok) {
        return res.status(glRes.status).json(glData.error || glData);
      }
      const candidate = Array.isArray(glData.candidates) && glData.candidates[0] ? glData.candidates[0] : {};
      const text = candidate.content?.parts?.[0]?.text || candidate.output || candidate.message?.content || '';
      return res.json({ choices: [{ text }] });
    }
    // OpenAI API
    const baseUrl = 'https://api.openai.com/v1';
    const compHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    const openaiRes = await fetch(`${baseUrl}/completions`, {
      method: 'POST',
      headers: compHeaders,
      body: JSON.stringify(req.body),
    });
    const data = await openaiRes.json();
    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json(data);
    }
    if (data.id) {
      const filePath = path.join(responsesDir, `${data.id}.bin`);
      fs.writeFile(filePath, Buffer.from(JSON.stringify(data)), (err) => err && console.error('Error saving response:', err));
    }
    return res.json(data);
  } catch (err) {
    console.error('Error in /api/completions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Proxy to chat completion endpoint and save response
app.post("/api/chat/completions", async (req, res) => {
  const apiKey = getRawAPIKey(req);
  const provider = (req.header("x-provider") || "openai").toLowerCase();
  if (!apiKey) {
    return res.status(400).json({ error: "Missing Authorization header" });
  }
  try {
    if (provider === 'gemini') {
      // Google Generative Language API: chat via generateMessage (beta endpoint)
      const { model, messages } = req.body;
      // Build contents array as per Gemini spec
      const contents = Array.isArray(messages)
        ? messages.map(m => ({
            role: m.role === 'assistant' ? 'model' : m.role,
            parts: [{ text: m.content }]
          }))
        : [];
      // Generation and safety settings (allow override via request or use defaults)
      const generationConfig = {
        temperature: typeof req.body.temperature === 'number' ? req.body.temperature : 0.9,
        topP:       typeof req.body.top_p === 'number'       ? req.body.top_p       : 0.8,
        topK:       typeof req.body.top_k === 'number'       ? req.body.top_k       : 40,
        maxOutputTokens: typeof req.body.max_tokens === 'number' ? req.body.max_tokens : 2048,
        stopSequences: Array.isArray(req.body.stop) ? req.body.stop
                         : req.body.stop ? [req.body.stop]
                         : ['EOM'],
      };
      const safetySettings = [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
      ];
      const glBody = { contents, generationConfig, safetySettings };
      // Use unified generateContent endpoint for chat
      // Normalize model name: strip leading 'models/' if present
      const modelId = model.startsWith('models/') ? model.replace(/^models\//, '') : model;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
      console.log('[Gemini] generateMessage URL:', url, 'Body:', glBody);
      const glRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(glBody)
      });
      const raw = await glRes.text();
      console.log(`[Gemini] generateMessage raw response (status ${glRes.status}):`, raw);
      let glData;
      try { glData = raw ? JSON.parse(raw) : {}; }
      catch (e) {
        console.error('[Gemini] generateMessage JSON parse error:', e);
        return res.status(500).json({ error: 'Invalid JSON from Gemini', raw });
      }
      if (!glRes.ok) {
        return res.status(glRes.status).json(glData.error || glData);
      }
      // Extract assistant content and wrap into OpenAI-like response
      const candidate = Array.isArray(glData.candidates) && glData.candidates[0] ? glData.candidates[0] : {};
      // Extract text from content.parts
      const content = candidate.content?.parts?.[0]?.text || '';
      return res.json({ choices: [{ message: { content } }] });
    }
    // OpenAI API
    const baseUrl = 'https://api.openai.com/v1';
    const chatHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    const openaiRes = await fetch(
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: chatHeaders,
        body: JSON.stringify(req.body),
      }
    );
    const data = await openaiRes.json();
    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json(data);
    }
    if (data.id) {
      const filePath = path.join(responsesDir, `${data.id}.bin`);
      fs.writeFile(filePath, Buffer.from(JSON.stringify(data)), err => err && console.error('Error saving response:', err));
    }
    return res.json(data);
  } catch (err) {
    console.error('Error in /api/chat/completions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve static front-end files
app.use(express.static(path.join(__dirname)));

app.listen(PORT,'0.0.0.0', () => {
  console.log(`Server listening at http://0.0.0.0:${PORT}`);
});
