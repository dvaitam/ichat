const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8000;

// Directory to save binary responses
const responsesDir = path.join(__dirname, "responses");
if (!fs.existsSync(responsesDir)) {
  fs.mkdirSync(responsesDir, { recursive: true });
}

// Parse JSON bodies
app.use(express.json());

// Proxy to list models
app.get("/api/models", async (req, res) => {
  const apiKey = req.header("authorization");
  if (!apiKey) {
    return res.status(400).json({ error: "Missing Authorization header" });
  }
  try {
    const openaiRes = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: apiKey },
    });
    const data = await openaiRes.json();
    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json(data);
    }
    res.json(data);
  } catch (err) {
    console.error("Error fetching models:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Proxy to completion endpoint and save response
app.post("/api/completions", async (req, res) => {
  const apiKey = req.header("authorization");
  if (!apiKey) {
    return res.status(400).json({ error: "Missing Authorization header" });
  }
  try {
    const openaiRes = await fetch("https://api.openai.com/v1/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify(req.body),
    });
    const data = await openaiRes.json();
    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json(data);
    }
    // Save the full JSON response as binary file named by response id
    if (data.id) {
      const filePath = path.join(responsesDir, `${data.id}.bin`);
      fs.writeFile(filePath, Buffer.from(JSON.stringify(data)), (err) => {
        if (err) console.error("Error saving response:", err);
      });
    }
    res.json(data);
  } catch (err) {
    console.error("Error in /api/completions:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Proxy to chat completion endpoint and save response
app.post("/api/chat/completions", async (req, res) => {
  const apiKey = req.header("authorization");
  if (!apiKey) {
    return res.status(400).json({ error: "Missing Authorization header" });
  }
  try {
    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: apiKey,
        },
        body: JSON.stringify(req.body),
      }
    );
    const data = await openaiRes.json();
    if (!openaiRes.ok) {
      return res.status(openaiRes.status).json(data);
    }
    if (data.id) {
      const filePath = path.join(responsesDir, `${data.id}.bin`);
      fs.writeFile(filePath, Buffer.from(JSON.stringify(data)), (err) => {
        if (err) console.error("Error saving response:", err);
      });
    }
    res.json(data);
  } catch (err) {
    console.error("Error in /api/chat/completions:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Serve static front-end files
app.use(express.static(path.join(__dirname)));

app.listen(PORT,'0.0.0.0', () => {
  console.log(`Server listening at http://0.0.0.0:${PORT}`);
});
