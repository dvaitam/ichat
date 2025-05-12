document.addEventListener('DOMContentLoaded', () => {
  // Helper to copy text to clipboard with fallback for insecure contexts
  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (successful) {
        return Promise.resolve();
      } else {
        return Promise.reject(new Error('Copy command was unsuccessful'));
      }
    } catch (err) {
      document.body.removeChild(textarea);
      return Promise.reject(err);
    }
  }

  // Helper: convert arbitrary audio Blob (e.g., webm/opus) to WAV (PCM 16-bit) base64
  async function convertBlobToWav(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioCtx.decodeAudioData(arrayBuffer);
    const numChannels = decoded.numberOfChannels;
    const sampleRate = decoded.sampleRate;
    const samples = decoded.length;

    // Interleave channels
    const interleaved = new Int16Array(samples * numChannels);
    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = decoded.getChannelData(ch);
      for (let i = 0; i < samples; i++) {
        let sample = channelData[i];
        sample = Math.max(-1, Math.min(1, sample));
        interleaved[i * numChannels + ch] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      }
    }

    const wavBuffer = new ArrayBuffer(44 + interleaved.length * 2);
    const view = new DataView(wavBuffer);

    function writeString(view, offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }

    let offset = 0;
    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, 36 + interleaved.length * 2, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4; // Subchunk1Size (16 for PCM)
    view.setUint16(offset, 1, true); offset += 2;  // AudioFormat (1 = PCM)
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, sampleRate * numChannels * 2, true); offset += 4; // ByteRate
    view.setUint16(offset, numChannels * 2, true); offset += 2; // BlockAlign
    view.setUint16(offset, 16, true); offset += 2; // BitsPerSample
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, interleaved.length * 2, true); offset += 4;

    // PCM samples
    for (let i = 0; i < interleaved.length; i++, offset += 2) {
      view.setInt16(offset, interleaved[i], true);
    }

    const wavBlob = new Blob([view], { type: 'audio/wav' });
    const base64 = await new Promise(res => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result;
        res(dataUrl.split(',')[1]);
      };
      reader.readAsDataURL(wavBlob);
    });
    return { base64, fmt: 'wav' };
  }
  // Icon definitions for copy button
  const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M16 1H4C2.897 1 2 1.897 2 3v12h2V3h12V1z"/><path d="M20 5H8C6.897 5 6 5.897 6 7v14c0 1.103.897 2 2 2h12c1.103 0 2-.897 2-2V7c0-1.103-.897-2-2-2zM20 21H8V7h12v14z"/></svg>`;
  const CHECK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M20.285 6.707l-11.025 11.025-5.545-5.545 1.414-1.414 4.131 4.131 9.611-9.611z"/></svg>`;
  // Sections and controls
  const apiKeySection = document.getElementById('api-key-section');
  const mainUI = document.getElementById('main-ui');
  const providerSelect = document.getElementById('provider-select');
  const apiKeyInput = document.getElementById('api-key');
  const loginProviderSelect = document.getElementById('provider-login-select');
  const headerProviderSelect = document.getElementById('provider-select');
  const logoutButton = document.getElementById('logout-button');
  const modelSelect = document.getElementById('model');
  const responseDiv = document.getElementById('response');
  // Initialize UI based on stored provider and its API key
  const savedProvider = localStorage.getItem('provider') || 'openai';
  loginProviderSelect.value = savedProvider;
  headerProviderSelect.value = savedProvider;
  const savedKey = localStorage.getItem(`apiKey_${savedProvider}`) || '';
  apiKeyInput.value = savedKey;
  if (savedKey) {
    apiKeySection.style.display = 'none';
    mainUI.style.display = 'flex';
    fetchModels();
  } else {
    apiKeySection.style.display = 'block';
    mainUI.style.display = 'none';
  }
  // Store provider/key and show main UI on entry
  apiKeyInput.addEventListener('blur', () => {
    const apiKey = apiKeyInput.value.trim();
    const provider = loginProviderSelect.value;
    if (!apiKey) return;
    // Save key per provider
    localStorage.setItem(`apiKey_${provider}`, apiKey);
    localStorage.setItem('provider', provider);
    // Sync header select and show main UI
    headerProviderSelect.value = provider;
    apiKeySection.style.display = 'none';
    mainUI.style.display = 'flex';
    fetchModels();
  });
  // When changing provider in login, preload saved key if any
  loginProviderSelect.addEventListener('change', () => {
    const provider = loginProviderSelect.value;
    const key = localStorage.getItem(`apiKey_${provider}`) || '';
    apiKeyInput.value = key;
  });
  // Allow provider switch in header
  headerProviderSelect.addEventListener('change', () => {
    const provider = headerProviderSelect.value;
    localStorage.setItem('provider', provider);
    // Sync login select
    loginProviderSelect.value = provider;
    // Check if key exists for this provider
    const key = localStorage.getItem(`apiKey_${provider}`);
    if (!key) {
      // No key: redirect to login
      apiKeyInput.value = '';
      apiKeySection.style.display = 'block';
      mainUI.style.display = 'none';
    } else {
      // Key present: update UI
      apiKeyInput.value = key;
      apiKeySection.style.display = 'none';
      mainUI.style.display = 'flex';
      fetchModels();
    }
  });
  // Logout: clear current provider key and return to login
  logoutButton.addEventListener('click', () => {
    const provider = localStorage.getItem('provider') || loginProviderSelect.value;
    localStorage.removeItem(`apiKey_${provider}`);
    apiKeyInput.value = '';
    loginProviderSelect.value = provider;
    apiKeySection.style.display = 'block';
    mainUI.style.display = 'none';
  });
  // Conversation management: load/store chats
  const convSelect = document.getElementById('conversation-select');
  const newChatButton = document.getElementById('new-chat-button');
  let conversations = JSON.parse(localStorage.getItem('conversations') || '[]');
  let currentConversationId = null;
  function saveConversations() {
    localStorage.setItem('conversations', JSON.stringify(conversations));
  }
  function populateConversationSelect() {
    convSelect.innerHTML = '';
    conversations.forEach(conv => {
      const opt = document.createElement('option');
      opt.value = conv.id;
      opt.textContent = conv.name;
      if (conv.id === currentConversationId) opt.selected = true;
      convSelect.appendChild(opt);
    });
  }
  function renderMessage(container, fullText) {
    const codeFenceRE = /```([\s\S]*?)```/g;
    let lastIndex = 0, match;
    while ((match = codeFenceRE.exec(fullText)) !== null) {
      const plainSegment = fullText.substring(lastIndex, match.index);
      if (plainSegment) {
        // Render inline markdown: **bold** and `code`
        const textDiv = document.createElement('div');
        textDiv.className = 'text-block';
        // Split by bold, inline code, and markdown links
        // Split by bold, inline code, markdown images, and links
        const parts = plainSegment.split(/(\*\*[\s\S]+?\*\*|`[^`]+`|!\[[^\]]*\]\([^\)]+\)|\[[^\]]+\]\([^\)]+\))/g);
        parts.forEach(part => {
          if (!part) return;
          // Bold **text**
          if (/^\*\*[\s\S]+?\*\*$/.test(part)) {
            const strong = document.createElement('strong');
            strong.textContent = part.slice(2, -2);
            textDiv.appendChild(strong);
          } else if (/^`[^`]+`$/.test(part)) {
            const codeElem = document.createElement('code');
            codeElem.className = 'inline-code';
            codeElem.textContent = part.slice(1, -1);
            textDiv.appendChild(codeElem);
          } else if (/^!\[[^\]]*\]\([^\)]+\)$/.test(part)) {
            // Markdown media (image or video)
            const mImg = part.match(/^!\[([^\]]*)\]\(([^\)]+)\)$/);
            if (mImg) {
              const url = mImg[2];
              const alt = mImg[1] || '';
              const lower = url.toLowerCase();
              if (lower.match(/\.(mp3|wav|m4a|ogg|webm)(?:$|\?)/)) {
                // Audio element
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.src = url;
                // Replay button
                const replayBtn = document.createElement('button');
                replayBtn.textContent = '↻';
                replayBtn.title = 'Replay audio';
                replayBtn.style.marginLeft = '6px';
                replayBtn.addEventListener('click', () => { audio.currentTime = 0; audio.play(); });
                const wrapper = document.createElement('div');
                wrapper.appendChild(audio);
                wrapper.appendChild(replayBtn);
                textDiv.appendChild(wrapper);
              } else if (lower.match(/\.(mp4|webm|ogg)(?:$|\?)/)) {
                const vid = document.createElement('video');
                vid.controls = true;
                vid.src = url;
                vid.style.maxWidth = '100%';
                textDiv.appendChild(vid);
              } else {
                const img = document.createElement('img');
                img.src = url;
                img.alt = alt;
                img.style.maxWidth = '100%';
                textDiv.appendChild(img);
              }
            }
          } else if (/^\[[^\]]+\]\([^\)]+\)$/.test(part)) {
            // Markdown link
            const m = part.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
            if (m) {
              const a = document.createElement('a');
              a.href = m[2];
              a.textContent = m[1];
              a.target = '_blank';
              a.rel = 'noopener';
              textDiv.appendChild(a);
            }
          } else {
            textDiv.appendChild(document.createTextNode(part));
          }
        });
        container.appendChild(textDiv);
      }
      let codeContent = match[1].replace(/^\n|\n$/g, '');
      const lines = codeContent.split('\n');
      const firstLine = lines.shift();
      const restContent = lines.join('\n');
      // Render code block with header (first line) and copy button
      const block = document.createElement('div');
      block.className = 'code-block';
      if (firstLine != null) {
        const headerDiv = document.createElement('div');
        headerDiv.className = 'code-first-line';
        headerDiv.textContent = firstLine;
        const btn = document.createElement('button');
        btn.className = 'copy-button';
        btn.innerHTML = COPY_ICON;
        btn.setAttribute('aria-label', 'Copy to clipboard');
        btn.addEventListener('click', () => {
          copyTextToClipboard(restContent)
            .then(() => { btn.innerHTML = CHECK_ICON; setTimeout(() => { btn.innerHTML = COPY_ICON; }, 2000); })
            .catch(err => console.error('Copy failed:', err));
        });
        headerDiv.appendChild(btn);
        block.appendChild(headerDiv);
      }
      const pre = document.createElement('pre');
      const codeElem = document.createElement('code');
      codeElem.textContent = restContent;
      pre.appendChild(codeElem);
      block.appendChild(pre);
      container.appendChild(block);
      lastIndex = codeFenceRE.lastIndex;
    }
    const tail = fullText.substring(lastIndex);
    if (tail) {
      // Render inline markdown in tail: **bold**, `code`, image/audio/video, and [links](url)
      const textDiv = document.createElement('div');
      textDiv.className = 'text-block';
      const parts = tail.split(/(\*\*[\s\S]+?\*\*|`[^`]+`|!\[[^\]]*\]\([^\)]+\)|\[[^\]]+\]\([^\)]+\))/g);
      parts.forEach(part => {
        if (!part) return;
        if (/^\*\*[\s\S]+?\*\*$/.test(part)) {
          const innerText = part.slice(2, -2);
          const strong = document.createElement('strong');
          strong.textContent = innerText;
          textDiv.appendChild(strong);
        } else if (/^`[^`]+`$/.test(part)) {
          const codeElem = document.createElement('code');
          codeElem.className = 'inline-code';
          codeElem.textContent = part.slice(1, -1);
          textDiv.appendChild(codeElem);
        } else if (/^!\[[^\]]*\]\([^\)]+\)$/.test(part)) {
          // Inline media: image, audio, or video
          const mImg = part.match(/^!\[([^\]]*)\]\(([^\)]+)\)$/);
          if (mImg) {
            const url = mImg[2];
            const alt = mImg[1] || '';
            const lower = url.toLowerCase();
            if (lower.match(/\.(mp3|wav|m4a|ogg|webm)(?:$|\?)/)) {
            const audio = document.createElement('audio');
              audio.controls = true;
              audio.src = url;
              const replayBtn = document.createElement('button');
              replayBtn.textContent = '↻';
              replayBtn.title = 'Replay audio';
              replayBtn.style.marginLeft = '6px';
              replayBtn.addEventListener('click', () => { audio.currentTime = 0; audio.play(); });
              const wrapper = document.createElement('div');
              wrapper.appendChild(audio);
              wrapper.appendChild(replayBtn);
              textDiv.appendChild(wrapper);
            } else if (lower.match(/\.(mp4|webm|ogg)(?:$|\?)/)) {
              const vid = document.createElement('video');
              vid.controls = true;
              vid.src = url;
              vid.style.maxWidth = '100%';
              textDiv.appendChild(vid);
            } else {
              const img = document.createElement('img');
              img.src = url;
              img.alt = alt;
              img.style.maxWidth = '100%';
              textDiv.appendChild(img);
            }
          }
        } else if (/^\[[^\]]+\]\([^\)]+\)$/.test(part)) {
          // Markdown link
          const m = part.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
          if (m) {
            const display = m[1];
            const url = m[2];
            const lower = url.toLowerCase();
            if (display === 'audio' || lower.match(/\.(mp3|wav|m4a|ogg|webm)(?:$|\?)/)) {
            const audio = document.createElement('audio');
              audio.controls = true;
              audio.src = url;
              const replayBtn = document.createElement('button');
              replayBtn.textContent = '↻';
              replayBtn.title = 'Replay audio';
              replayBtn.style.marginLeft = '6px';
              replayBtn.addEventListener('click', () => { audio.currentTime = 0; audio.play(); });
              const wrapper = document.createElement('div');
              wrapper.appendChild(audio);
              wrapper.appendChild(replayBtn);
              textDiv.appendChild(wrapper);
            } else if (lower.match(/\.(mp4|webm|ogg)(?:$|\?)/)) {
              const vid = document.createElement('video');
              vid.controls = true;
              vid.src = url;
              vid.style.maxWidth = '100%';
              textDiv.appendChild(vid);
            } else {
              const a = document.createElement('a');
              a.href = url;
              a.textContent = display;
              a.target = '_blank';
              a.rel = 'noopener';
              textDiv.appendChild(a);
            }
          }
        } else {
          textDiv.appendChild(document.createTextNode(part));
        }
      });
      container.appendChild(textDiv);
    }
  }
  function loadConversation(id) {
    currentConversationId = id;
    populateConversationSelect();
    responseDiv.innerHTML = '';
    const conv = conversations.find(c => c.id === id);
    if (conv && conv.messages) {
      conv.messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = `message ${msg.role}-message`;
        responseDiv.appendChild(div);
        // Render metadata for assistant messages if available
        if (msg.role === 'assistant' && msg.provider && msg.model) {
          const metaDiv = document.createElement('div');
          metaDiv.className = 'message-meta';
          const capProvider = msg.provider.charAt(0).toUpperCase() + msg.provider.slice(1);
          metaDiv.textContent = `${capProvider} • ${msg.model}`;
          div.appendChild(metaDiv);
        }
        // Render message content with markdown support
        renderMessage(div, msg.content);
      });
      responseDiv.scrollTop = responseDiv.scrollHeight;
    }
  }
  function createNewConversation() {
    const id = 'conv-' + Date.now();
    const name = 'Chat ' + new Date().toLocaleString();
    const conv = { id, name, messages: [] };
    conversations.push(conv);
    saveConversations();
    currentConversationId = id;
    populateConversationSelect();
    loadConversation(id);
  }
  convSelect.addEventListener('change', () => loadConversation(convSelect.value));
  newChatButton.addEventListener('click', createNewConversation);
  // Initialize first conversation
  if (conversations.length === 0) createNewConversation();
  else { currentConversationId = conversations[0].id; populateConversationSelect(); loadConversation(currentConversationId); }

  async function fetchModels() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) return;
    modelSelect.innerHTML = '<option disabled>Loading models...</option>';
    try {
      const response = await fetch('/api/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-Provider': localStorage.getItem('provider') || 'openai',
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      // Sort models alphabetically by ID
      const models = data.data.slice().sort((a, b) => a.id.localeCompare(b.id));
      modelSelect.innerHTML = '';
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.id;
        // Select o4-mini by default if available
        if (model.id === 'o4-mini') {
          option.selected = true;
        }
        modelSelect.appendChild(option);
      });
      // If o4-mini not present, default to the first model
      if (!modelSelect.value && modelSelect.options.length > 0) {
        modelSelect.selectedIndex = 0;
      }
      // Trigger change to enforce chat mode for audio-preview models
      modelSelect.dispatchEvent(new Event('change'));
    } catch (err) {
      console.error('Error fetching models:', err);
      modelSelect.innerHTML = '<option disabled selected>Failed to load models</option>';
      alert(`Error fetching models: ${err.message}`);
    }
  }
  // Removed unused handleAudioTranscription helper and duplicate variables
  // Image upload handler
  const imgInput = document.getElementById('image-input');
  const imgButton = document.getElementById('img-button');
  imgButton.addEventListener('click', () => imgInput.click());
  imgInput.addEventListener('change', async () => {
    const file = imgInput.files[0];
    if (!file) return;
    // Show image preview in chat
    const userDiv = document.createElement('div');
    userDiv.className = 'message user-message';
    const imgEl = document.createElement('img');
    imgEl.src = URL.createObjectURL(file);
    imgEl.style.maxWidth = '100%';
    userDiv.appendChild(imgEl);
    responseDiv.appendChild(userDiv);
    responseDiv.scrollTop = responseDiv.scrollHeight;
    // Upload image to server
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message loading';
    loadingDiv.textContent = 'Uploading image...';
    responseDiv.appendChild(loadingDiv);
    try {
      // Upload image via multipart/form-data
      const formData = new FormData();
      formData.append('file', file);
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      if (!uploadRes.ok) throw new Error(`Upload error: ${uploadRes.status} ${uploadRes.statusText}`);
      const { url } = await uploadRes.json();
      const fullUrl = url.startsWith('http') ? url : window.location.origin + url;
      loadingDiv.remove();
      // Append image markdown with full URL and send
      const imgMarkdown = `\n![${file.name}](${fullUrl})`;
      promptTextarea.value = (promptTextarea.value || '') + imgMarkdown;
      promptTextarea.focus();
    } catch (err) {
      console.error('Image upload error:', err);
      alert(err.message);
      loadingDiv.remove();
    }
  });
  // Video upload handler
  const videoInput = document.getElementById('video-input');
  const videoButton = document.getElementById('video-button');
  videoButton.addEventListener('click', () => videoInput.click());
  videoInput.addEventListener('change', async () => {
    const file = videoInput.files[0];
    if (!file) return;
    // Show video preview
    const userDiv = document.createElement('div');
    userDiv.className = 'message user-message';
    const videoEl = document.createElement('video');
    videoEl.controls = true;
    videoEl.style.maxWidth = '100%';
    const fileUrl = URL.createObjectURL(file);
    videoEl.src = fileUrl;
    userDiv.appendChild(videoEl);
    responseDiv.appendChild(userDiv);
    responseDiv.scrollTop = responseDiv.scrollHeight;
    // Show loading
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message loading';
    loadingDiv.textContent = 'Extracting and uploading frames...';
    responseDiv.appendChild(loadingDiv);
    try {
      // Prepare processing video element
      const procVideo = document.createElement('video');
      procVideo.preload = 'metadata';
      procVideo.muted = true;
      procVideo.src = fileUrl;
      await new Promise(resolve => procVideo.addEventListener('loadedmetadata', resolve));
      const duration = procVideo.duration;
      const fileSize = file.size;
      const mb = 1024 * 1024;
      let frameCount = Math.floor(fileSize / mb);
      if (frameCount < 1) frameCount = 1;
      const frameUrls = [];
      for (let i = 1; i <= frameCount; i++) {
        const ratio = (i * mb) / fileSize;
        const time = Math.min(duration, ratio * duration);
        const url = await new Promise((resolve, reject) => {
          function onSeeked() {
            const canvas = document.createElement('canvas');
            canvas.width = procVideo.videoWidth;
            canvas.height = procVideo.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(procVideo, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(async blob => {
              try {
                const form = new FormData();
                form.append('file', blob, `frame-${i}.png`);
                const res = await fetch('/api/upload', { method: 'POST', body: form });
                if (!res.ok) throw new Error(`Upload error: ${res.status} ${res.statusText}`);
                const json = await res.json();
                resolve(json.url);
              } catch (err) {
                reject(err);
              }
            }, 'image/png');
            procVideo.removeEventListener('seeked', onSeeked);
          }
          procVideo.addEventListener('seeked', onSeeked);
          procVideo.currentTime = time;
        });
        const fullUrl = url.startsWith('http') ? url : window.location.origin + url;
        frameUrls.push(fullUrl);
        responseDiv.scrollTop = responseDiv.scrollHeight;
      }
      loadingDiv.remove();
      const markdown = frameUrls.map((u, idx) => `\n![frame ${idx+1}](${u})`).join('');
      promptTextarea.value = (promptTextarea.value || '') + markdown;
      promptTextarea.focus();
    } catch (err) {
      console.error('Frame extraction/upload error:', err);
      alert(err.message);
      loadingDiv.remove();
    } finally {
      URL.revokeObjectURL(fileUrl);
    }
  });
  // Handle send button click to perform completion/chat request
  const sendButton = document.getElementById('send-button');
  const promptTextarea = document.getElementById('prompt');
  const apiTypeSelect = document.getElementById('api-type');
  // If audio-preview model is selected, force chat mode and disable completion option
  modelSelect.addEventListener('change', () => {
    const modelLower = modelSelect.value.toLowerCase();
    const isAudioPreview = modelLower.startsWith('gpt-4o-audio-preview') || modelLower.startsWith('gpt-4o-mini-audio-preview');
    const completionOption = apiTypeSelect.querySelector('option[value="completion"]');
    if (isAudioPreview) {
      apiTypeSelect.value = 'chat';
      if (completionOption) completionOption.disabled = true;
    } else {
      if (completionOption) completionOption.disabled = false;
    }
  });
  sendButton.addEventListener('click', sendRequest);
  // Microphone button: record audio, transcribe via Whisper, and send transcription
  const micButton = document.getElementById('mic-button');
  let isRecording = false;
  let mediaRecorder = null;
  let audioStream = null;  // underlying MediaStream
  let audioChunks = [];
  micButton.addEventListener('click', async () => {
    if (!isRecording) {
      try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Choose a supported MIME type for recording
      let recorderOptions = {};
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        recorderOptions.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        recorderOptions.mimeType = 'audio/mp4';
      }
      mediaRecorder = new MediaRecorder(audioStream, recorderOptions);
        audioChunks = [];
        mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.start();
        isRecording = true;
        micButton.textContent = '⏹';
        sendButton.disabled = true;
      } catch (err) {
        console.error('Could not start recording:', err);
        alert('Could not start audio recording: ' + err.message);
      }
    } else {
      // Attach stop handler before stopping to ensure Safari fires it
      mediaRecorder.onstop = async () => {
        // Stop all audio tracks to release the microphone
        if (audioStream) {
          audioStream.getTracks().forEach(t => t.stop());
          audioStream = null;
        }
        const recordedType = audioChunks[0]?.type;
        // Safari may produce an empty blob.type, so default to 'audio/mp4' for compatibility
        const audioBlob = new Blob(audioChunks, { type: recordedType || 'audio/mp4' });

        const selectedModelRaw = modelSelect.value || '';
        const selectedModel = selectedModelRaw.toLowerCase();

        // Helper to append user audio preview to chat
        function appendUserAudioPreview(blob) {
          const audioUrl = URL.createObjectURL(blob);
          const audioDiv = document.createElement('div');
          audioDiv.className = 'message user-message';
          const audioEl = document.createElement('audio');
          audioEl.controls = true;
          audioEl.src = audioUrl;
          audioDiv.appendChild(audioEl);
          responseDiv.appendChild(audioDiv);
          responseDiv.scrollTop = responseDiv.scrollHeight;
        }

        // Branch logic based on selected model
        if (selectedModel === 'gpt-4o-audio-preview' || selectedModel === 'gpt-4o-mini-audio-preview') {
          // 1. Visual feedback: show the recorded audio
          appendUserAudioPreview(audioBlob);

          // Save user audio message to conversation (store as markdown placeholder)


          // 2. Build chat completion with audio
          const apiKey = apiKeyInput.value.trim();
          const provider = localStorage.getItem('provider') || 'openai';
          if (!apiKey) {
            alert('Please enter your API key.');
            resetRecordingUI();
            return;
          }

          // Prepare audio payload for GPT-4o preview
          let mimeType = audioBlob.type || 'audio/webm';
          let format = (mimeType.split('/')[1] || '').split(';')[0]; // strip codec suffix
          if (format === 'mpeg') format = 'mp3';
          if (format === 'x-wav') format = 'wav';

          let b64data;
          try {
            if (['wav', 'mp3'].includes(format)) {
              const arrayBuffer = await audioBlob.arrayBuffer();
              const bytes = new Uint8Array(arrayBuffer);
              let binary = '';
              for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
              b64data = btoa(binary);
            } else {
              // Convert unsupported format to WAV (16-bit PCM)
              const { base64, fmt } = await convertBlobToWav(audioBlob);
              b64data = base64;
              format = fmt; // 'wav'
            }
          } catch (convErr) {
            console.error('Audio encode error:', convErr);
            alert('Failed to encode audio data');
            resetRecordingUI();
            return;
          }

          const userMessageParts = [];
          // Include optional text prompt from textarea if provided
          const anyText = promptTextarea.value.trim();
          if (anyText) {
            userMessageParts.push({ type: 'text', text: anyText });
          }
          userMessageParts.push({
            type: 'input_audio',
            input_audio: {
              data: b64data,
              format: format,
            }
          });

          // Clear prompt area
          promptTextarea.value = '';

          // Loading indicator
          const loadingDiv = document.createElement('div');
          loadingDiv.className = 'message loading';
          loadingDiv.textContent = 'Loading...';
          responseDiv.appendChild(loadingDiv);
          responseDiv.scrollTop = responseDiv.scrollHeight;

          try {
            const body = {
              model: selectedModelRaw,
              messages: [ { role: 'user', content: userMessageParts } ],
              modalities: ['text', 'audio'],
              audio: { voice: 'alloy', format: 'wav' },
              // Request non-streaming (full) audio to avoid cutoff
              stream: false
            };
            const res = await fetch('/api/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'X-Provider': provider,
              },
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
            const result = await res.json();

            // Remove loading indicator
            loadingDiv.remove();

            const assistantContainer = document.createElement('div');
            assistantContainer.className = 'message assistant-message';

            const metaDiv = document.createElement('div');
            metaDiv.className = 'message-meta';
            const capProvider = provider.charAt(0).toUpperCase() + provider.slice(1);
            metaDiv.textContent = `${capProvider} • ${selectedModelRaw}`;
            assistantContainer.appendChild(metaDiv);
            responseDiv.appendChild(assistantContainer);

            const content = result.choices?.[0]?.message?.content;

            if (Array.isArray(content)) {
              let combinedText = '';
              content.forEach(part => {
                if (part.type === 'text' || part.text) {
                  combinedText += part.text;
                } else if (part.type === 'audio' || part.audio || part.audio_url || part.input_audio) {
            const rawUrl = part.audio?.url || part.audio_url?.url || part.audio_url || part.input_audio?.url || part.input_audio || part.source || '';
                  if (!rawUrl) return;
                  const audioUrl = rawUrl.startsWith('http') ? rawUrl : (window.location.origin + rawUrl);
                  // Include markdown placeholder for persistence
                  combinedText += `\n![audio](${audioUrl})`;
                }
              });
              if (combinedText.trim()) {
                renderMessage(assistantContainer, combinedText.trim());
              }
              // Save conversation
              const conv = conversations.find(c => c.id === currentConversationId);
              if (conv) {
                conv.messages.push({
                  role: 'assistant',
                  content: combinedText.trim(),
                  provider,
                  model: selectedModelRaw,
                });
                saveConversations();
              }
            } else {
              // Handle cases where content is null but audio provided separately
              const standalone = result.choices?.[0]?.audio || result.choices?.[0]?.message?.audio;
              let rendered = false;
              if (standalone && standalone.url) {
                const audioUrl = standalone.url.startsWith('http') ? standalone.url : (window.location.origin + standalone.url);

                // Render transcript text and inline audio from standalone response
                const transcriptText = (standalone.transcript || '').trim();
                let contentToRender = transcriptText;
                // Append audio markdown placeholder
                contentToRender += (transcriptText ? '\n' : '') + `![audio](${audioUrl})`;
                renderMessage(assistantContainer, contentToRender);

                // Save conv
                const conv = conversations.find(c => c.id === currentConversationId);
                if (conv) {
                  conv.messages.push({
                    role: 'assistant',
                    content: contentToRender,
                    provider,
                    model: selectedModelRaw,
                  });
                  saveConversations();
                }
                rendered = true;
              }
              if (!rendered) {
                // Fallback to JSON
                const fallbackText = JSON.stringify(result, null, 2);
                renderMessage(assistantContainer, fallbackText);
              }
            }

          } catch (err) {
            console.error('Error during GPT-4o audio request:', err);
            loadingDiv.remove();
            const errDiv = document.createElement('div');
            errDiv.className = 'message assistant-message';
            errDiv.textContent = `Error: ${err.message}`;
            responseDiv.appendChild(errDiv);
            alert(`Error: ${err.message}`);
          } finally {
            resetRecordingUI();
          }

        } else if (selectedModel.includes('whisper')) {
          // The existing Whisper transcription path remains unchanged
          const audioUrl = URL.createObjectURL(audioBlob);
          const audioDiv = document.createElement('div');
          audioDiv.className = 'message user-message';
          const audioEl = document.createElement('audio');
          audioEl.controls = true;
          audioEl.src = audioUrl;
          audioDiv.appendChild(audioEl);
          responseDiv.appendChild(audioDiv);
          responseDiv.scrollTop = responseDiv.scrollHeight;

          await handleWhisperTranscription(audioBlob);

          resetRecordingUI();
        } else {
          // Fallback: transcribe with Whisper then send text prompt
          await handleWhisperTranscription(audioBlob);
          resetRecordingUI();
        }

        async function handleWhisperTranscription(blob) {
          const apiKey = apiKeyInput.value.trim();
          const provider = localStorage.getItem('provider') || 'openai';
          const transcriptionModel = 'whisper-1';
          try {
            const mime = blob.type || 'audio/mp4';
            const res = await fetch('/api/audio/transcriptions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'X-Provider': provider,
                'X-Model': transcriptionModel,
                'Content-Type': mime,
              },
              body: blob,
            });
            if (!res.ok) throw new Error(`Transcription error: ${res.status} ${res.statusText}`);
            const data = await res.json();
            const transcription = data.text || '';

            const selectedModelAgain = modelSelect.value;
            if (selectedModelAgain.toLowerCase().includes('whisper')) {
              const assistantDiv = document.createElement('div');
              assistantDiv.className = 'message assistant-message';
              const metaDiv = document.createElement('div');
              metaDiv.className = 'message-meta';
              const capProv = provider.charAt(0).toUpperCase() + provider.slice(1);
              metaDiv.textContent = `${capProv} • ${transcriptionModel}`;
              assistantDiv.appendChild(metaDiv);
              assistantDiv.appendChild(document.createTextNode(transcription));
              responseDiv.appendChild(assistantDiv);

              const conv = conversations.find(c => c.id === currentConversationId);
              if (conv) {
                conv.messages.push({
                  role: 'assistant',
                  content: transcription,
                  provider,
                  model: transcriptionModel,
                });
                saveConversations();
              }
              responseDiv.scrollTop = responseDiv.scrollHeight;
            } else {
              promptTextarea.value = transcription;
              sendRequest();
            }
          } catch (err) {
            console.error('Transcription error:', err);
            alert(`Transcription error: ${err.message}`);
          }
        }

        function resetRecordingUI() {
          micButton.textContent = '🎤';
          isRecording = false;
          sendButton.disabled = false;
        }
      };
      mediaRecorder.stop();
    }
  });

  async function sendRequest() {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;
    const prompt = promptTextarea.value.trim();
    const apiType = apiTypeSelect.value;
    if (!apiKey) {
      alert('Please enter your API key.');
      return;
    }
    if (!model) {
      alert('Please select a model.');
      return;
    }
    if (!prompt) {
      alert('Please enter a prompt.');
      return;
    }
    sendButton.disabled = true;
    // Append user message (supports image markdown)
    const userDiv = document.createElement('div');
    userDiv.className = 'message user-message';
    // Render user content with markdown (images, links, bold, code)
    renderMessage(userDiv, prompt);
    responseDiv.appendChild(userDiv);
    // Save user message to current conversation
    const userConv = conversations.find(c => c.id === currentConversationId);
    if (userConv) {
      userConv.messages.push({ role: 'user', content: prompt });
      // If first user message, set conversation title to first few words
      if (userConv.messages.length === 1) {
        const words = prompt.trim().split(/\s+/);
        let title = words.slice(0, 5).join(' ');
        if (words.length > 5) title += '...';
        userConv.name = title;
        // Update conversation select dropdown
        saveConversations();
        populateConversationSelect();
        convSelect.value = currentConversationId;
      } else {
        saveConversations();
      }
    }
    // Clear prompt input
    promptTextarea.value = '';
    // Loading indicator for assistant response
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message loading';
    loadingDiv.textContent = 'Loading...';
    responseDiv.appendChild(loadingDiv);
    // Scroll to bottom
    responseDiv.scrollTop = responseDiv.scrollHeight;
    try {
    // If using an image generation model, call the generations API
    const imageModels = ['gpt-image-1', 'dall-e-2', 'dall-e-3'];
    if (imageModels.includes(model.toLowerCase())) {
      // Show loading
      const loadingDivImg = loadingDiv;
      try {
        const genBody = { model, prompt, n: 1, size: '1024x1024' };
        const resImg = await fetch('/api/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'X-Provider': localStorage.getItem('provider') || 'openai',
          },
          body: JSON.stringify(genBody),
        });
        const imgResult = await resImg.json();
        if (!resImg.ok) {
          const errMsg = (imgResult.error && imgResult.error.message) || imgResult.error || `${resImg.status} ${resImg.statusText}`;
          throw new Error(`Image API error: ${errMsg}`);
        }
        loadingDivImg.remove();
        const urls = Array.isArray(imgResult.data)
          ? imgResult.data.map(d => d.url)
          : [];
        const assistantContainerImg = document.createElement('div');
        assistantContainerImg.className = 'message assistant-message';
        // Provider/model metadata
        const providerName = localStorage.getItem('provider') || 'openai';
        const metaDivImg = document.createElement('div');
        metaDivImg.className = 'message-meta';
        const capProviderImg = providerName.charAt(0).toUpperCase() + providerName.slice(1);
        metaDivImg.textContent = `${capProviderImg} • ${model}`;
        assistantContainerImg.appendChild(metaDivImg);
        responseDiv.appendChild(assistantContainerImg);
        // Render each generated image
        const markdownImgs = urls.map((u, idx) => `\n![generated ${idx+1}](${u})`).join('');
        renderMessage(assistantContainerImg, markdownImgs);
        // Save to conversation
        const convImg = conversations.find(c => c.id === currentConversationId);
        if (convImg) {
          convImg.messages.push({
            role: 'assistant',
            content: markdownImgs,
            provider: providerName,
            model: model,
          });
          saveConversations();
        }
      } catch (err) {
        console.error('Error during image generation:', err);
        if (loadingDivImg) loadingDivImg.remove();
        const errDiv = document.createElement('div');
        errDiv.className = 'message assistant-message';
        errDiv.textContent = `Error: ${err.message}`;
        responseDiv.appendChild(errDiv);
        alert(`Error: ${err.message}`);
      } finally {
        sendButton.disabled = false;
      }
      return;
    }
    // Otherwise, use standard chat/completions API
    // Determine request URL and payload. For audio-preview models, always use chat endpoint
    let actualUrl;
    let body;
    const modelLower = model.toLowerCase();
    const isAudioPreview = modelLower.startsWith('gpt-4o-audio-preview') || modelLower.startsWith('gpt-4o-mini-audio-preview');
    if (isAudioPreview) {
      actualUrl = '/api/chat/completions';
      // Wrap text prompt in content parts, request audio output
      body = {
        model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        modalities: ['text', 'audio'],
        audio: { voice: 'alloy', format: 'wav' },
        stream: false
      };
    } else if (apiType === 'chat') {
      actualUrl = '/api/chat/completions';
      body = { model, messages: [{ role: 'user', content: prompt }] };
    } else {
      actualUrl = '/api/completions';
      body = { model, prompt };
    }
    const res = await fetch(actualUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Provider': localStorage.getItem('provider') || 'openai',
      },
      body: JSON.stringify(body),
    });
      if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
      }
      const result = await res.json();
      let assistantContent = null;
      if (apiType === 'chat') {
        assistantContent = result.choices?.[0]?.message?.content;
      } else {
        assistantContent = result.choices?.[0]?.text;
      }

      // Check for standalone audio object in choice (also for audio-preview models)
      let standaloneAudio = null;
      if (apiType === 'chat' || isAudioPreview) {
        const choiceAudio = result.choices?.[0]?.audio || result.choices?.[0]?.message?.audio;
        if (choiceAudio && (choiceAudio.url || choiceAudio.data)) {
          standaloneAudio = choiceAudio;
        }
      }

      // Remove loading indicator, then display assistant response
      loadingDiv.remove();

      const assistantContainer = document.createElement('div');
      assistantContainer.className = 'message assistant-message';

      // Provider/model metadata
      const providerName = localStorage.getItem('provider') || 'openai';
      const metaDiv = document.createElement('div');
      metaDiv.className = 'message-meta';
      const capProvider = providerName.charAt(0).toUpperCase() + providerName.slice(1);
      metaDiv.textContent = `${capProvider} • ${model}`;
      assistantContainer.appendChild(metaDiv);
      responseDiv.appendChild(assistantContainer);

      let textForStorage = '';

      let renderedSomething = false;

      if (Array.isArray(assistantContent) && assistantContent.length) {
        // Iterate parts
        assistantContent.forEach(part => {
          if (part.type === 'text' || part.text) {
            renderedSomething = true;
            textForStorage += part.text;
            renderMessage(assistantContainer, part.text);
          } else if (part.type === 'audio' || part.audio || part.audio_url || part.input_audio) {
            const rawUrl = part.audio?.url || part.audio_url?.url || part.audio_url || part.input_audio?.url || part.input_audio || part.source || '';
            if (!rawUrl) return;
            const audioUrl = rawUrl.startsWith('http') ? rawUrl : (window.location.origin + rawUrl);
            const audioEl = document.createElement('audio');
            audioEl.controls = true;
            audioEl.src = audioUrl;

            const replayBtn = document.createElement('button');
            replayBtn.textContent = '↻';
            replayBtn.title = 'Replay audio';
            replayBtn.style.marginLeft = '6px';
            replayBtn.addEventListener('click', () => { audioEl.currentTime = 0; audioEl.play(); });

            const wrapper = document.createElement('div');
            wrapper.appendChild(audioEl);
            wrapper.appendChild(replayBtn);
            assistantContainer.appendChild(wrapper);

            textForStorage += `\n![audio](${audioUrl})`;
            renderedSomething = true;
          }
        });
      } else {
        const fullText = typeof assistantContent === 'string' && assistantContent
                         ? assistantContent
                         : (typeof assistantContent === 'object' ? '' : null);

        if (fullText) {
          textForStorage += fullText;
          renderMessage(assistantContainer, fullText);
          renderedSomething = true;
        }

        // Handle standalone audio
        if (standaloneAudio) {
          const rawUrl = standaloneAudio.url || '';
          if (rawUrl) {
            const audioUrl = rawUrl.startsWith('http') ? rawUrl : (window.location.origin + rawUrl);
            const audioEl = document.createElement('audio');
            audioEl.controls = true;
            audioEl.src = audioUrl;

            const replayBtn = document.createElement('button');
            replayBtn.textContent = '↻';
            replayBtn.title = 'Replay audio';
            replayBtn.style.marginLeft = '6px';
            replayBtn.addEventListener('click', () => { audioEl.currentTime = 0; audioEl.play(); });

            const wrapper = document.createElement('div');
            wrapper.appendChild(audioEl);
            wrapper.appendChild(replayBtn);
            assistantContainer.appendChild(wrapper);

            textForStorage += `\n![audio](${audioUrl})`;
            renderedSomething = true;
          }
        }
      }

      // Fallback: if nothing was rendered, show minimal notice instead of raw JSON
      if (!renderedSomething) {
        const notice = '[assistant sent unsupported content]';
        renderMessage(assistantContainer, notice);
        textForStorage += notice;
      }

      // Save assistant message to current conversation
      const conv = conversations.find(c => c.id === currentConversationId);
      if (conv) {
        conv.messages.push({
          role: 'assistant',
          content: textForStorage,
          provider: providerName,
          model: model,
        });
        saveConversations();
      }
    } catch (err) {
      console.error('Error during API request:', err);
      // Remove loading indicator if present
      if (loadingDiv) loadingDiv.remove();
      const errDiv = document.createElement('div');
      errDiv.className = 'message assistant-message';
      errDiv.textContent = `Error: ${err.message}`;
      responseDiv.appendChild(errDiv);
      alert(`Error: ${err.message}`);
      responseDiv.scrollTop = responseDiv.scrollHeight;
    } finally {
      sendButton.disabled = false;
    }
  }
});