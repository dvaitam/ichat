const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
// Directory to store uploaded images
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
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
      const responseObj = { choices: [{ text }] };
      // Save Gemini completion response
      try {
        const id = `gemini-${modelId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const filePath = path.join(responsesDir, `${id}.bin`);
        fs.writeFile(filePath, Buffer.from(JSON.stringify(responseObj)), err => err && console.error('Error saving Gemini response:', err));
      } catch (writeErr) {
        console.error('Error writing Gemini response to file:', writeErr);
      }
      return res.json(responseObj);
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
      const responseObj = { choices: [{ message: { content } }] };
      // Save Gemini chat response
      try {
        const id = `gemini-chat-${modelId}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const filePath = path.join(responsesDir, `${id}.bin`);
        fs.writeFile(filePath, Buffer.from(JSON.stringify(responseObj)), err => err && console.error('Error saving Gemini chat response:', err));
      } catch (writeErr) {
        console.error('Error writing Gemini chat response to file:', writeErr);
      }
      return res.json(responseObj);
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

// Proxy to audio transcription endpoint (Whisper)
app.post("/api/audio/transcriptions",
  express.raw({ type: (req) => req.headers['content-type']?.startsWith('audio/'), limit: '10mb' }),
  async (req, res) => {
    const apiKey = getRawAPIKey(req);
    const provider = (req.header("x-provider") || "openai").toLowerCase();
    if (!apiKey) {
      return res.status(400).json({ error: "Missing Authorization header" });
    }
    if (provider !== 'openai') {
      return res.status(400).json({ error: "Audio transcription supported only for OpenAI" });
    }
    try {
      const model = req.header('x-model') || 'whisper-1';
      const contentType = req.header('content-type');
      const audioBuffer = Buffer.from(req.body);
      const boundary = "----OpenAIAudioBoundary" + Date.now();
      const CRLF = "\r\n";
      const filename = "audio.webm";
      const preamble = Buffer.from(
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
        `Content-Type: ${contentType}${CRLF}${CRLF}`
      );
      const middle = Buffer.from(
        `${CRLF}--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="model"${CRLF}${CRLF}` +
        `${model}${CRLF}` +
        `--${boundary}--${CRLF}`
      );
      const formData = Buffer.concat([preamble, audioBuffer, middle]);
      const transcriptRes = await fetch(
        'https://api.openai.com/v1/audio/transcriptions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body: formData,
        }
      );
      const data = await transcriptRes.json();
      if (!transcriptRes.ok) {
        return res.status(transcriptRes.status).json(data);
      }
      return res.json(data);
    } catch (err) {
      console.error('Error in /api/audio/transcriptions:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);
// Image upload endpoint: saves image and returns URL
app.post("/api/upload",
  express.raw({ type: (req) => req.headers['content-type']?.startsWith('image/'), limit: '20mb' }),
  async (req, res) => {
    try {
      const contentType = req.header('content-type');
      const ext = contentType.split('/')[1] || 'png';
      const filename = `upload-${Date.now()}-${Math.random().toString(36).substr(2,6)}.${ext}`;
      const filePath = path.join(uploadsDir, filename);
      fs.writeFile(filePath, req.body, err => {
        if (err) {
          console.error('Error saving upload:', err);
          return res.status(500).json({ error: 'Failed to save file' });
        }
        // Return public URL path
        const url = `/uploads/${filename}`;
        res.json({ url });
      });
    } catch (err) {
      console.error('Error in /api/upload:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);
// Serve static front-end files
// Image description endpoint using Google Vision API (requires VISION_API_KEY env var)
app.post(
  "/api/image/describe",
  express.raw({ type: (req) => req.headers['content-type']?.startsWith('image/'), limit: '10mb' }),
  async (req, res) => {
    const visionKey = process.env.VISION_API_KEY;
    if (!visionKey) {
      return res.status(500).json({ error: 'Missing VISION_API_KEY env var' });
    }
    try {
      const imgBuffer = Buffer.from(req.body);
      const imgBase64 = imgBuffer.toString('base64');
      const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`;
      const body = {
        requests: [
          {
            image: { content: imgBase64 },
            features: [ { type: 'LABEL_DETECTION', maxResults: 5 } ]
          }
        ]
      };
      const visionRes = await fetch(visionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const vdata = await visionRes.json();
      if (!visionRes.ok) {
        return res.status(visionRes.status).json(vdata);
      }
      const labels = (vdata.responses?.[0]?.labelAnnotations || []).map(a => a.description);
      const description = labels.length ? labels.join(', ') : 'No labels detected';
      return res.json({ description });
    } catch (err) {
      console.error('Error in /api/image/describe:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);
// Serve static front-end files
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Server listening at http://0.0.0.0:${PORT}`);
});
