const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || process.argv[2] || 3000;
// Directory to store uploaded images
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
// Configure multer for file uploads
const multerStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = file.mimetype.split('/')[1] || 'bin';
    const filename = `upload-${Date.now()}-${Math.random().toString(36).substr(2,6)}.${ext}`;
    cb(null, filename);
  }
});
const upload = multer({ storage: multerStorage });
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

// Parse JSON bodies (increase limit to allow for base64 audio)
app.use(express.json({ limit: '50mb' }));

// Proxy to list models
app.get("/api/models", async (req, res) => {
  const apiKey = getRawAPIKey(req);
  const provider = (req.header("x-provider") || "openai").toLowerCase();
  if (!apiKey) {
    return res.status(400).json({ error: "Missing Authorization header" });
  }
  try {
    // List models for each provider
    if (provider === 'claude') {
      // Fetch list of Claude models from Anthropic API
      const url = 'https://api.anthropic.com/v1/models';
      console.log(`[Claude] Fetch models URL: ${url}`);
      const clRes = await fetch(url, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        }
      });
      const clData = await clRes.json();
      console.log(`[Claude] Response status: ${clRes.status}`, clData);
      if (!clRes.ok) {
        return res.status(clRes.status).json(clData);
      }
      const models = Array.isArray(clData.models)
        ? clData.models
        : Array.isArray(clData.data)
        ? clData.data
        : [];
      return res.json({ data: models.map(m => ({ id: m.id })) });
    }
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
        data: models.map(m => ({ id: m.name.replace(/^models// '') }))
      };
transformed.data.push({ id: "gemini-2.5-pro-preview-05-06" });
transformed.data.push({ id: "gemini-2.5-flash-preview-05-20" });
      return res.json(transformed);
    } else if (provider === 'grok') {
      // Fetch list of Grok models from xAI API
      const url = 'https://api.x.ai/v1/models';
      console.log(`[Grok] Fetch models URL: ${url}`);
      const grokRes = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      const grokData = await grokRes.json();
      console.log(`[Grok] Response status: ${grokRes.status}`, grokData);
      if (!grokRes.ok) {
        return res.status(grokRes.status).json(grokData);
      }
      // Normalize to OpenAI-like format { data: [{ id }] }
      const models = Array.isArray(grokData.data)
        ? grokData.data
        : Array.isArray(grokData.models)
        ? grokData.models
        : [];
      return res.json({ data: models.map(m => ({ id: m.id || m.name })) });
    }
    if (provider === 'deepseek') {
      const url = 'https://api.deepseek.com/v1/models';
      console.log(`[DeepSeek] Fetch models URL: ${url}`);
      const dsRes = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      const dsData = await dsRes.json();
      console.log(`[DeepSeek] Response status: ${dsRes.status}`, dsData);
      if (!dsRes.ok) {
        return res.status(dsRes.status).json(dsData);
      }
      const models = Array.isArray(dsData.data)
        ? dsData.data
        : Array.isArray(dsData.models)
        ? dsData.models
        : [];
      return res.json({ data: models.map(m => ({ id: m.id })) });
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
    if (provider === 'claude') {
      // Claude completions using Messages API
      const { model, prompt, max_tokens, temperature } = req.body;
      const claudeBody = {
        model: model || 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: max_tokens || 2048,
        temperature: temperature || 0.9
      };
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(claudeBody)
      });
      const claudeData = await claudeRes.json();
      console.log(`[Claude] completions response (${claudeRes.status}):`, JSON.stringify(claudeData).slice(0, 2000));
      if (!claudeRes.ok) {
        return res.status(claudeRes.status).json(claudeData);
      }
      // Transform to OpenAI format
      const text = claudeData.content?.[0]?.text || '';
      const responseObj = { choices: [{ text }] };
      // Save Claude completion response
      try {
        const id = `claude-${model}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const filePath = path.join(responsesDir, `${id}.bin`);
        fs.writeFile(filePath, Buffer.from(JSON.stringify(responseObj)), err => err && console.error('Error saving Claude response:', err));
      } catch (writeErr) {
        console.error('Error writing Claude response to file:', writeErr);
      }
      return res.json(responseObj);
    }
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
    } else if (provider === 'grok') {
      try {
        const { model, prompt, max_tokens, temperature } = req.body;

        const grokBody = {
          model: model || 'grok-1-placeholder',
          prompt: prompt || '',
          max_tokens: max_tokens || 2048,
          temperature: temperature || 0.9
        };

        const grokRes = await fetch('https://api.x.ai/v1/completions', { // Assumed endpoint
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(grokBody)
        });

        const grokData = await grokRes.json();
        console.log(`[Grok] completions response (${grokRes.status}):`, JSON.stringify(grokData).slice(0, 500));

        if (!grokRes.ok) {
          return res.status(grokRes.status).json(grokData);
        }

        const text = grokData.choices?.[0]?.text || ''; // Major assumption
        const responseObj = {
          choices: [{ text }],
          id: grokData.id, // Optional, if Grok provides it
          usage: grokData.usage // Optional, if Grok provides it
        };

        // Save Grok completion response
        try {
          const id = `grok-completion-${model || 'unknown_model'}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
          const filePath = path.join(responsesDir, `${id}.bin`);
          fs.writeFile(filePath, Buffer.from(JSON.stringify(responseObj)), err => {
            if (err) console.error('Error saving Grok completion response:', err);
          });
        } catch (writeErr) {
          console.error('Error writing Grok completion response to file:', writeErr);
        }

        return res.json(responseObj);

      } catch (err) {
        console.error('[Grok] Error in /api/completions:', err);
        res.status(500).json({ error: 'Internal server error with Grok provider for completions' });
      }
    } else if (provider === 'deepseek') {
      try {
        const { model, prompt, max_tokens, temperature } = req.body;
        const deepSeekBody = {
          model: model || "deepseek-coder",
          prompt: prompt || "",
          max_tokens: max_tokens || 2048,
          temperature: temperature || 0.7
        };
        const url = 'https://api.deepseek.com/v1/completions';
        console.log(`[DeepSeek] completions request:`, JSON.stringify(deepSeekBody).slice(0, 500));
        const deepSeekRes = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(deepSeekBody)
        });
        const deepSeekData = await deepSeekRes.json();
        console.log(`[DeepSeek] completions response (${deepSeekRes.status}):`, JSON.stringify(deepSeekData).slice(0, 2000));
        if (!deepSeekRes.ok) {
          return res.status(deepSeekRes.status).json(deepSeekData);
        }
        const text = deepSeekData.choices?.[0]?.text || '';
        const responseObj = {
          choices: [{ text }],
          id: deepSeekData.id,
          usage: deepSeekData.usage
        };
        try {
          const id = `deepseek-completion-${model || 'unknown_model'}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
          const filePath = path.join(responsesDir, `${id}.bin`);
          fs.writeFile(filePath, Buffer.from(JSON.stringify(responseObj)), err => {
            if (err) console.error('Error saving DeepSeek completion response:', err);
          });
        } catch (writeErr) {
          console.error('Error writing DeepSeek completion response to file:', writeErr);
        }
        return res.json(responseObj);
      } catch (err) {
        console.error('[DeepSeek] Error in /api/completions:', err);
        res.status(500).json({ error: 'Internal server error with DeepSeek provider for completions' });
      }
    } else if (provider === 'grok') {
      // Placeholder for Grok chat completions
      return res.status(501).json({ error: "Grok chat completions not yet implemented" });
    }
    // OpenAI API
    const baseUrl = 'https://api.openai.com/v1';
    const compHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    const openaiRes = await fetch(`${baseUrl}/completions`, {
      method: 'POST',
      headers: compHeaders,
      body: JSON.stringify(req.body),
    });
    const rawText = await openaiRes.text();
    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (e) {
      console.error('[OpenAI] Failed to parse JSON:', e);
      data = { raw: rawText };
    }
    console.log(`[OpenAI] chat/completions response (${openaiRes.status}):`, JSON.stringify(data).slice(0, 2000));
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
    if (provider === 'claude') {
      // Claude chat completions using Messages API
      const { model, messages, max_tokens, temperature } = req.body;
      const claudeBody = {
        model: model || 'claude-3-5-sonnet-20241022',
        messages: messages || [],
        max_tokens: max_tokens || 2048,
        temperature: temperature || 0.9
      };
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(claudeBody)
      });
      const claudeData = await claudeRes.json();
      console.log(`[Claude] chat/completions response (${claudeRes.status}):`, JSON.stringify(claudeData).slice(0, 2000));
      if (!claudeRes.ok) {
        return res.status(claudeRes.status).json(claudeData);
      }
      // Transform to OpenAI format
      const content = claudeData.content?.[0]?.text || '';
      const responseObj = { 
        choices: [{ message: { content } }],
        id: claudeData.id,
        usage: claudeData.usage
      };
      // Save Claude chat response
      try {
        const id = `claude-chat-${model}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        const filePath = path.join(responsesDir, `${id}.bin`);
        fs.writeFile(filePath, Buffer.from(JSON.stringify(responseObj)), err => err && console.error('Error saving Claude chat response:', err));
      } catch (writeErr) {
        console.error('Error writing Claude chat response to file:', writeErr);
      }
      return res.json(responseObj);
    }
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
    } else if (provider === 'grok') {
      try {
        const { model, messages, max_tokens, temperature } = req.body;

        const grokBody = {
          model: model || 'grok-1-placeholder', // Use the placeholder from /api/models
          messages: messages || [],
          max_tokens: max_tokens || 2048,
          temperature: temperature || 0.9
          // Add other parameters if Grok supports them (e.g., top_p, stop)
        };

        const grokRes = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(grokBody)
        });

        const grokData = await grokRes.json();
        console.log(`[Grok] chat/completions response (${grokRes.status}):`, JSON.stringify(grokData).slice(0, 500));

        if (!grokRes.ok) {
          return res.status(grokRes.status).json(grokData);
        }

        const content = grokData.choices?.[0]?.message?.content || ''; // Major assumption
        const responseObj = {
          choices: [{ message: { content } }],
          id: grokData.id || `grok-${model}-${Date.now()}`,
          usage: grokData.usage // Assuming Grok provides usage data in this format
        };

        // Save Grok chat response (similar to Claude/Gemini)
        try {
          const id = `grok-chat-${model || 'unknown_model'}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
          const filePath = path.join(responsesDir, `${id}.bin`); // .bin to match others
          fs.writeFile(filePath, Buffer.from(JSON.stringify(responseObj)), err => {
            if (err) console.error('Error saving Grok chat response:', err);
          });
        } catch (writeErr) {
          console.error('Error writing Grok chat response to file:', writeErr);
        }

        return res.json(responseObj);

      } catch (err) {
        console.error('[Grok] Error in /api/chat/completions:', err);
        res.status(500).json({ error: 'Internal server error with Grok provider' });
      }
    } else if (provider === 'deepseek') {
      try {
        const { model, messages, max_tokens, temperature } = req.body;
        const deepSeekBody = {
          model: model || "deepseek-chat",
          messages: messages || [],
          max_tokens: max_tokens || 2048,
          temperature: temperature || 0.7
        };
        const url = 'https://api.deepseek.com/v1/chat/completions';
        console.log(`[DeepSeek] chat/completions request:`, JSON.stringify(deepSeekBody).slice(0, 500));
        const deepSeekRes = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(deepSeekBody)
        });
        const deepSeekData = await deepSeekRes.json();
        console.log(`[DeepSeek] chat/completions response (${deepSeekRes.status}):`, JSON.stringify(deepSeekData).slice(0, 2000));
        if (!deepSeekRes.ok) {
          return res.status(deepSeekRes.status).json(deepSeekData);
        }
        const content = deepSeekData.choices?.[0]?.message?.content || '';
        const responseObj = {
          choices: [{ message: { content } }],
          id: deepSeekData.id,
          usage: deepSeekData.usage
        };
        try {
          const id = `deepseek-chat-${model || 'unknown_model'}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
          const filePath = path.join(responsesDir, `${id}.bin`);
          fs.writeFile(filePath, Buffer.from(JSON.stringify(responseObj)), err => {
            if (err) console.error('Error saving DeepSeek chat response:', err);
          });
        } catch (writeErr) {
          console.error('Error writing DeepSeek chat response to file:', writeErr);
        }
        return res.json(responseObj);
      } catch (err) {
        console.error('[DeepSeek] Error in /api/chat/completions:', err);
        res.status(500).json({ error: 'Internal server error with DeepSeek provider' });
      }
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
    // If the response contains audio parts, decode and persist to /uploads
    try {
      if (Array.isArray(data.choices)) {
        data.choices.forEach(choice => {
          const content = choice?.message?.content;
          if (Array.isArray(content)) {
            content.forEach(part => {
              let dataUri = null;
              let base64Data = null;
              let inferredFormat = null;
              if (part && part.type === 'audio') {
                if (typeof part.audio?.url === 'string' && part.audio.url.startsWith('data:audio')) {
                  dataUri = part.audio.url;
                } else if (typeof part.audio_url?.url === 'string' && part.audio_url.url.startsWith('data:audio')) {
                  dataUri = part.audio_url.url;
                } else if (typeof part.audio_url === 'string' && part.audio_url.startsWith('data:audio')) {
                  dataUri = part.audio_url;
                } else if (typeof part.input_audio?.url === 'string' && part.input_audio.url.startsWith('data:audio')) {
                  dataUri = part.input_audio.url;
                } else if (typeof part.input_audio === 'string' && part.input_audio.startsWith('data:audio')) {
                  dataUri = part.input_audio;
                } else if (typeof part.source === 'string' && part.source.startsWith('data:audio')) {
                  dataUri = part.source;
                } else if (typeof part.audio?.data === 'string' && part.audio.data.length) {
                  base64Data = part.audio.data;
                  inferredFormat = part.audio.format || 'wav';
                }
              }
              if (dataUri) {
                // Extract mime and base64 payload
                const match = dataUri.match(/^data:(audio\/[^;]+);base64,(.*)$/);
                if (match) {
                  const mimeType = match[1];
                  const b64 = match[2];
                  // Determine extension from mime
                  let ext = mimeType.split('/')[1] || 'bin';
                  if (ext === 'mpeg') ext = 'mp3';
                  if (ext === 'x-wav') ext = 'wav';
                  const filename = `assistant-audio-${Date.now()}-${Math.random().toString(36).substr(2,6)}.${ext}`;
                  const filePath = path.join(uploadsDir, filename);
                  try {
                    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
                    // Replace the appropriate field with served URL for client
                    const url = `/uploads/${filename}`;
                    console.log('[OpenAI] Saved assistant audio file:', filePath);
                    if (part.audio && part.audio.url) {
                      part.audio.url = url;
                    } else if (part.audio_url && typeof part.audio_url === 'object' && part.audio_url.url) {
                      part.audio_url.url = url;
                    } else if (typeof part.audio_url === 'string') {
                      part.audio_url = url;
                    } else if (part.input_audio && typeof part.input_audio === 'object' && part.input_audio.url) {
                      part.input_audio.url = url;
                    } else if (typeof part.input_audio === 'string') {
                      part.input_audio = url;
                    } else {
                      part.source = url;
                    }
                  } catch (writeErr) {
                    console.error('Error saving assistant audio:', writeErr);
                  }
                }
              }
              else if (base64Data) {
                try {
                  let ext = inferredFormat.toLowerCase();
                  if (ext === 'mpeg') ext = 'mp3';
                  if (ext === 'x-wav') ext = 'wav';
                  if (ext !== 'wav' && ext !== 'mp3') ext = 'wav';
                  const filename = `assistant-audio-${Date.now()}-${Math.random().toString(36).substr(2,6)}.${ext}`;
                  const filePath = path.join(uploadsDir, filename);
                  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
                  const url = `/uploads/${filename}`;
                  console.log('[OpenAI] Saved assistant audio (data field):', filePath);
                  // Replace / augment
                  if (part.audio) {
                    part.audio.url = url;
                    delete part.audio.data;
                  }
                } catch (e) {
                  console.error('Error saving assistant audio (from data field):', e);
                }
              }
            });
          }
        });

        // Also check for top-level audio in each choice (new gpt-4o preview schema)
        data.choices.forEach(choice => {
          const audioObj = choice.audio || choice.message?.audio;
          if (audioObj && typeof audioObj.data === 'string' && audioObj.data.length) {
            try {
              let ext = (audioObj.format || 'wav').toLowerCase();
              if (ext === 'mpeg') ext = 'mp3';
              if (!['wav','mp3'].includes(ext)) ext = 'wav';
              const filename = `assistant-audio-${Date.now()}-${Math.random().toString(36).substr(2,6)}.${ext}`;
              const filePath = path.join(uploadsDir, filename);
              fs.writeFileSync(filePath, Buffer.from(audioObj.data, 'base64'));
              const url = `/uploads/${filename}`;
              console.log('[OpenAI] Saved assistant audio (top level):', filePath);
              // Replace data with url to keep payload small
              delete audioObj.data;
              audioObj.url = url;
            } catch (e) {
              console.error('Error saving top-level assistant audio:', e);
            }
          }
        });
        // Fetch any external audio URLs (e.g. for gpt-4o-audio-preview) and download full audio locally
        for (const choice of data.choices) {
          const audioObj = choice.audio || choice.message?.audio;
          if (audioObj && typeof audioObj.url === 'string' && audioObj.url.startsWith('http')) {
            try {
              // Determine file extension
              let ext = (audioObj.format || 'wav').toLowerCase();
              if (ext === 'mpeg') ext = 'mp3';
              if (!['wav','mp3'].includes(ext)) ext = 'wav';
              const externalUrl = audioObj.url;
              const audioResp = await fetch(externalUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
              if (!audioResp.ok) {
                console.error('[OpenAI] Failed to fetch external audio', audioResp.status, externalUrl);
              } else {
                const buffer = await audioResp.buffer();
                const filename = `assistant-audio-${Date.now()}-${Math.random().toString(36).substr(2,6)}.${ext}`;
                const filePath = path.join(uploadsDir, filename);
                fs.writeFileSync(filePath, buffer);
                console.log('[OpenAI] Downloaded and saved external audio to', filePath);
                // Point client at our local file instead
                audioObj.url = `/uploads/${filename}`;
              }
            } catch (err) {
              console.error('[OpenAI] Error downloading external audio:', err);
            }
          }
        }
      }
    } catch (audioErr) {
      console.error('Error processing assistant audio content:', audioErr);
    }
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
// Image generation endpoint: proxies to OpenAI Images API
app.post("/api/images/generations", async (req, res) => {
  const apiKey = getRawAPIKey(req);
  const provider = (req.header("x-provider") || "openai").toLowerCase();
  if (!apiKey) {
    return res.status(400).json({ error: "Missing Authorization header" });
  }
  if (provider !== 'openai') {
    return res.status(400).json({ error: "Image generations only supported for OpenAI" });
  }
  const { model, prompt, n, size } = req.body;
  if (!model || !prompt) {
    return res.status(400).json({ error: "Missing model or prompt" });
  }
  try {
    const url = 'https://api.openai.com/v1/images/generations';
    // Default to a supported size (1024x1024) if none provided
    const body = {
      model,
      prompt,
      n: typeof n === 'number' ? n : 1,
      size: typeof size === 'string' ? size : '1024x1024'
    };
    const openaiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const data = await openaiRes.json();
    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json(data);
    }
    return res.json(data);
  } catch (err) {
    console.error('Error in /api/images/generations:', err);
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
      // Extract content type header and default if missing
      const contentTypeRaw = req.header('content-type') || '';
      // Normalize MIME type (strip parameters)
      const mimeType = contentTypeRaw.split(';')[0] || 'audio/webm';
      // Determine file extension from normalized MIME type
      let ext = mimeType.split('/')[1] || 'webm';
      // Map Safari's 'x-m4a' or generic 'aac' to supported 'm4a'
      if (ext === 'x-m4a' || ext === 'aac') ext = 'm4a';
      // Construct normalized content-type for multipart
      const contentType = `audio/${ext}`;
      const audioBuffer = Buffer.from(req.body);
      const boundary = "----OpenAIAudioBoundary" + Date.now();
      const CRLF = "\r\n";
      const filename = `audio.${ext}`;
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
// File upload endpoint: saves image or video and returns URL using multer
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file provided" });
  }
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});
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
