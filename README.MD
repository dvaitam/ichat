# MyOwnAI

A web-based chat UI and proxy server to interact with multiple large language model providers:
OpenAI, Anthropic Claude, Google Gemini, and xAI Grok.

## Features

- Unified web interface for chat and completions
- Provider selection (OpenAI, Claude, Gemini, Grok)
- Model browsing (fetched dynamically from each provider)
- Conversation history in browser localStorage
- File uploads (images, video) and audio recording
- Real-time audio recording and playback
- Jenkins CI/CD integration

## Prerequisites

- Node.js v14 or later
- npm (bundled with Node.js)
- (Optional) Python 3.7+ with `requests` (for CLI examples)

## Installation

```bash
git clone <repository-url>
cd <project-directory>
npm install
```

## Running the server

```bash
npm start
```

By default, the server listens on port 3000. Open your browser at `http://localhost:3000`.

## Web UI Usage

1. Choose a provider from the dropdown (OpenAI, Gemini, Claude, Grok).
2. Enter your API key when prompted (saved in browser localStorage).
3. Select a model from the loaded models list.
4. Enter your prompt and click **Send**.
5. Manage conversations and settings using the UI controls.

### Supported Providers

- **OpenAI**: Uses the OpenAI REST API (Bearer token).
- **Anthropic Claude**: Uses Anthropic v1 Messages API (`x-api-key` header).
- **Google Gemini**: Uses the Google Generative Language v1beta API (`key` query param).
- **xAI Grok**: Uses the xAI `/v1/models` endpoint to list and proxy Grok models.

## Python CLI Examples (Gemini)

*These scripts demonstrate direct command-line interaction with Google Gemini.*

1. Activate the included virtual environment:
   ```bash
   source gem/bin/activate
   ```
2. Set your Gemini API key:
   ```bash
   export GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
   ```
3. List available models:
   ```bash
   python get_models.py
   ```
4. Start an interactive chat session:
   ```bash
   python gen_res.py
   ```
