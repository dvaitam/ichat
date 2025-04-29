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
        const parts = plainSegment.split(/(\*\*[\s\S]+?\*\*|`[^`]+`)/g);
        parts.forEach(part => {
          if (!part) return;
          if (/^\*\*[\s\S]+?\*\*$/.test(part)) {
            const innerText = part.slice(2, -2);
            const strong = document.createElement('strong');
            // Support inline code within bold
            const innerParts = innerText.split(/(`[^`]+`)/g);
            innerParts.forEach(ip => {
              if (!ip) return;
              if (/^`[^`]+`$/.test(ip)) {
                const codeElem = document.createElement('code');
                codeElem.className = 'inline-code';
                codeElem.textContent = ip.slice(1, -1);
                strong.appendChild(codeElem);
              } else {
                strong.appendChild(document.createTextNode(ip));
              }
            });
            textDiv.appendChild(strong);
          } else if (/^`[^`]+`$/.test(part)) {
            const codeElem = document.createElement('code');
            codeElem.className = 'inline-code';
            codeElem.textContent = part.slice(1, -1);
            textDiv.appendChild(codeElem);
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
      // Render inline markdown in tail: **bold** and `code`
      const textDiv = document.createElement('div');
      textDiv.className = 'text-block';
      const parts = tail.split(/(\*\*[\s\S]+?\*\*|`[^`]+`)/g);
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
        if (msg.role === 'user') div.textContent = msg.content;
        else renderMessage(div, msg.content);
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
    } catch (err) {
      console.error('Error fetching models:', err);
      modelSelect.innerHTML = '<option disabled selected>Failed to load models</option>';
      alert(`Error fetching models: ${err.message}`);
    }
  }
  // Handle send button click to perform completion/chat request
  const sendButton = document.getElementById('send-button');
  const promptTextarea = document.getElementById('prompt');
  const apiTypeSelect = document.getElementById('api-type');
  sendButton.addEventListener('click', sendRequest);

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
    // Append user message
    const userDiv = document.createElement('div');
    userDiv.className = 'message user-message';
    userDiv.textContent = prompt;
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
      const url = apiType === 'chat'
        ? '/api/chat/completions'
        : '/api/completions';
      const body = apiType === 'chat'
        ? { model, messages: [{ role: 'user', content: prompt }] }
        : { model, prompt };
      const res = await fetch(url, {
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
      let text;
      if (apiType === 'chat') {
        text = result.choices?.[0]?.message?.content;
      } else {
        text = result.choices?.[0]?.text;
      }
      // Remove loading indicator, then display assistant response
      loadingDiv.remove();
      const assistantContainer = document.createElement('div');
      assistantContainer.className = 'message assistant-message';
      responseDiv.appendChild(assistantContainer);
      const fullText = text || JSON.stringify(result, null, 2);
      // Save assistant message to current conversation
      const conv = conversations.find(c => c.id === currentConversationId);
      if (conv) { conv.messages.push({ role: 'assistant', content: fullText }); saveConversations(); }
      const codeFenceRE = /```([\s\S]*?)```/g;
      let lastIndex = 0;
      let match;
      while ((match = codeFenceRE.exec(fullText)) !== null) {
        const plainSegment = fullText.substring(lastIndex, match.index);
        if (plainSegment) {
          // Render inline markdown: **bold** and `code`
          const textDiv = document.createElement('div');
          textDiv.className = 'text-block';
          const parts = plainSegment.split(/(\*\*[\s\S]+?\*\*|`[^`]+`)/g);
          parts.forEach(part => {
            if (!part) return;
            if (/^\*\*[\s\S]+?\*\*$/.test(part)) {
              // Bold with potential inline code
              const innerText = part.slice(2, -2);
              const strong = document.createElement('strong');
              const innerParts = innerText.split(/(`[^`]+`)/g);
              innerParts.forEach(ip => {
                if (!ip) return;
                if (/^`[^`]+`$/.test(ip)) {
                  const codeElem = document.createElement('code');
                  codeElem.className = 'inline-code';
                  codeElem.textContent = ip.slice(1, -1);
                  strong.appendChild(codeElem);
                } else {
                  strong.appendChild(document.createTextNode(ip));
                }
              });
              textDiv.appendChild(strong);
            } else if (/^`[^`]+`$/.test(part)) {
              const codeElem = document.createElement('code');
              codeElem.className = 'inline-code';
              codeElem.textContent = part.slice(1, -1);
              textDiv.appendChild(codeElem);
            } else {
              textDiv.appendChild(document.createTextNode(part));
            }
          });
          assistantContainer.appendChild(textDiv);
        }
        // Extract code fence content and remove surrounding newlines
        let codeContent = match[1].replace(/^\n|\n$/g, '');
        // Split off the first line (e.g., language specifier or header)
        const lines = codeContent.split('\n');
        const firstLine = lines.shift();
        const restContent = lines.join('\n');
        // Render code block with header (first line) and copy button
        const container = document.createElement('div');
        container.className = 'code-block';
        if (firstLine != null) {
          const headerDiv = document.createElement('div');
          headerDiv.className = 'code-first-line';
          headerDiv.textContent = firstLine;
          const button = document.createElement('button');
          button.className = 'copy-button';
          button.innerHTML = COPY_ICON;
          button.setAttribute('aria-label', 'Copy to clipboard');
          button.addEventListener('click', () => {
            copyTextToClipboard(restContent)
              .then(() => { button.innerHTML = CHECK_ICON; setTimeout(() => { button.innerHTML = COPY_ICON; }, 2000); })
              .catch(err => { console.error('Copy to clipboard failed:', err); });
          });
          headerDiv.appendChild(button);
          container.appendChild(headerDiv);
        }
        const pre = document.createElement('pre');
        const codeElem = document.createElement('code');
        codeElem.textContent = restContent;
        pre.appendChild(codeElem);
        container.appendChild(pre);
        assistantContainer.appendChild(container);
        lastIndex = codeFenceRE.lastIndex;
      }
      const tailSegment = fullText.substring(lastIndex);
      if (tailSegment) {
        // Render inline markdown in tailSegment: **bold** and `code`
        const textDiv = document.createElement('div');
        textDiv.className = 'text-block';
        const parts = tailSegment.split(/(\*\*[\s\S]+?\*\*|`[^`]+`)/g);
        parts.forEach(part => {
          if (!part) return;
          if (/^\*\*[\s\S]+?\*\*$/.test(part)) {
            // Bold with potential inline code
            const innerText = part.slice(2, -2);
            const strong = document.createElement('strong');
            const innerParts = innerText.split(/(`[^`]+`)/g);
            innerParts.forEach(ip => {
              if (!ip) return;
              if (/^`[^`]+`$/.test(ip)) {
                const codeElem = document.createElement('code');
                codeElem.className = 'inline-code';
                codeElem.textContent = ip.slice(1, -1);
                strong.appendChild(codeElem);
              } else {
                strong.appendChild(document.createTextNode(ip));
              }
            });
            textDiv.appendChild(strong);
          } else if (/^`[^`]+`$/.test(part)) {
            const codeElem = document.createElement('code');
            codeElem.className = 'inline-code';
            codeElem.textContent = part.slice(1, -1);
            textDiv.appendChild(codeElem);
          } else {
            textDiv.appendChild(document.createTextNode(part));
          }
        });
        assistantContainer.appendChild(textDiv);
      }
      // Scroll to bottom after rendering
      responseDiv.scrollTop = responseDiv.scrollHeight;
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