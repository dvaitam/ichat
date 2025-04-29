document.addEventListener('DOMContentLoaded', () => {
  // Sections and controls
  const apiKeySection = document.getElementById('api-key-section');
  const mainUI = document.getElementById('main-ui');
  const apiKeyInput = document.getElementById('api-key');
  const logoutButton = document.getElementById('logout-button');
  const modelSelect = document.getElementById('model');
  const responseDiv = document.getElementById('response');
  // Initialize UI based on stored API key
  const savedKey = localStorage.getItem('apiKey') || '';
  apiKeyInput.value = savedKey;
  if (savedKey) {
    apiKeySection.style.display = 'none';
    mainUI.style.display = 'flex';
    fetchModels();
  } else {
    mainUI.style.display = 'none';
  }
  // Store key and show main UI on entry
  apiKeyInput.addEventListener('blur', () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) return;
    localStorage.setItem('apiKey', apiKey);
    apiKeySection.style.display = 'none';
    mainUI.style.display = 'flex';
    fetchModels();
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
        const textDiv = document.createElement('div');
        textDiv.className = 'text-block';
        textDiv.textContent = plainSegment;
        container.appendChild(textDiv);
      }
      let codeContent = match[1].replace(/^\n|\n$/g, '');
      const lines = codeContent.split('\n');
      const firstLine = lines.shift();
      const restContent = lines.join('\n');
      if (firstLine != null) {
        const firstLineDiv = document.createElement('div');
        firstLineDiv.className = 'code-first-line';
        firstLineDiv.textContent = firstLine;
        container.appendChild(firstLineDiv);
      }
      const block = document.createElement('div');
      block.className = 'code-block';
      const btn = document.createElement('button');
      btn.className = 'copy-button';
      btn.textContent = 'Copy';
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(restContent)
          .then(() => { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 2000); })
          .catch(err => console.error('Copy failed:', err));
      });
      block.appendChild(btn);
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
      const textDiv = document.createElement('div');
      textDiv.className = 'text-block';
      textDiv.textContent = tail;
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
    if (userConv) { userConv.messages.push({ role: 'user', content: prompt }); saveConversations(); }
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
          const textDiv = document.createElement('div');
          textDiv.className = 'text-block';
          textDiv.textContent = plainSegment;
          assistantContainer.appendChild(textDiv);
        }
        // Extract code fence content and remove surrounding newlines
        let codeContent = match[1].replace(/^\n|\n$/g, '');
        // Split off the first line (e.g., language specifier or header)
        const lines = codeContent.split('\n');
        const firstLine = lines.shift();
        const restContent = lines.join('\n');
        // Render the first line outside of the code block
        if (firstLine != null) {
          const firstLineDiv = document.createElement('div');
          firstLineDiv.className = 'code-first-line';
          firstLineDiv.textContent = firstLine;
          assistantContainer.appendChild(firstLineDiv);
        }
        // Render the remaining code inside a styled code block
        const container = document.createElement('div');
        container.className = 'code-block';
        const button = document.createElement('button');
        button.className = 'copy-button';
        button.textContent = 'Copy';
        button.addEventListener('click', () => {
          navigator.clipboard.writeText(restContent)
            .then(() => {
              button.textContent = 'Copied!';
              setTimeout(() => { button.textContent = 'Copy'; }, 2000);
            })
            .catch(err => { console.error('Copy to clipboard failed:', err); });
        });
        container.appendChild(button);
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
        const textDiv = document.createElement('div');
        textDiv.className = 'text-block';
        textDiv.textContent = tailSegment;
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