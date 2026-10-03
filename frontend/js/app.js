/* ChatStudio — SPA (vanilla JS) */
(() => {
  'use strict';

  // ---------- utils ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatSize(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' Б';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' КБ';
    return (n / 1024 / 1024).toFixed(1) + ' МБ';
  }
  function timeAgo(iso) {
    const d = new Date(iso + (iso && !iso.endsWith('Z') ? 'Z' : ''));
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'только что';
    if (s < 3600) return Math.floor(s / 60) + ' мин назад';
    if (s < 86400) return Math.floor(s / 3600) + ' ч назад';
    if (s < 604800) return Math.floor(s / 86400) + ' дн назад';
    return d.toLocaleDateString('ru-RU');
  }

  // ---------- markdown ----------
  function inlineFmt(s) {
    s = escapeHtml(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return s;
  }

  function codeBlockHtml(lang, code) {
    const id = 'code_' + Math.random().toString(36).slice(2);
    window.__codeStore = window.__codeStore || {};
    window.__codeStore[id] = code;
    return '<div class="code-block"><div class="code-head"><span>' +
      escapeHtml(lang || 'code') + '</span><button data-copy="' + id + '">Копировать</button>' +
      '</div><pre><code>' + escapeHtml(code) + '</code></pre></div>';
  }

  function renderMarkdown(src) {
    if (!src) return '';
    const codes = [];
    let text = String(src).replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      const i = codes.length;
      codes.push({ lang: (lang || '').trim(), code: code.replace(/\s+$/, '') });
      return '\u0000C' + i + '\u0000';
    });

    const lines = text.split('\n');
    const out = [];
    let listType = null, para = [], inQuote = false;

    const flushPara = () => { if (para.length) { out.push('<p>' + inlineFmt(para.join(' ')) + '</p>'); para = []; } };
    const closeList = () => { if (listType) { out.push('</' + listType + '>'); listType = null; } };
    const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };

    for (const line of lines) {
      const cm = line.match(/^\u0000C(\d+)\u0000$/);
      if (cm) {
        flushPara(); closeList(); closeQuote();
        const b = codes[+cm[1]];
        out.push(codeBlockHtml(b.lang, b.code));
        continue;
      }
      if (!line.trim()) { flushPara(); closeList(); closeQuote(); continue; }
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushPara(); closeList(); closeQuote();
        const lvl = Math.min(m[1].length, 3);
        out.push('<h' + lvl + '>' + inlineFmt(m[2]) + '</h' + lvl + '>');
        continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); closeList(); closeQuote(); out.push('<hr>'); continue; }
      if ((m = line.match(/^\s*&gt;\s?(.*)$/))) {
        flushPara(); closeList();
        if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
        out.push('<p>' + inlineFmt(m[1]) + '</p>');
        continue;
      }
      if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
        flushPara(); closeQuote();
        if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
        out.push('<li>' + inlineFmt(m[1]) + '</li>');
        continue;
      }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        flushPara(); closeQuote();
        if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
        out.push('<li>' + inlineFmt(m[1]) + '</li>');
        continue;
      }
      closeList(); closeQuote();
      para.push(line.trim());
    }
    flushPara(); closeList(); closeQuote();
    return out.join('\n');
  }

  // ---------- api ----------
  const api = {
    csrf() { return window.__csrf || getCookie('chatstudio_csrf') || ''; },
    async req(method, path, body, isForm) {
      const headers = {};
      if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
      if (method !== 'GET') headers['X-CSRF-Token'] = api.csrf();
      const res = await fetch(path, {
        method, headers, credentials: 'same-origin',
        body: isForm ? body : (body !== undefined ? JSON.stringify(body) : undefined),
      });
      if (res.status === 401) { showAuth(); throw new Error('unauthorized'); }
      if (res.status === 204) return null;
      if (!res.ok) {
        let msg = res.status + '';
        try { const j = await res.json(); msg = j.detail || JSON.stringify(j); } catch (e) { /* noop */ }
        throw new Error(msg);
      }
      return res.json();
    },
    get(p) { return api.req('GET', p); },
    post(p, b) { return api.req('POST', p, b === undefined ? {} : b); },
    postForm(p, fd) { return api.req('POST', p, fd, true); },
    patch(p, b) { return api.req('PATCH', p, b); },
    del(p) { return api.req('DELETE', p); },
  };

  // ---------- state ----------
  const state = {
    user: null,
    chats: [],
    query: '',
    currentChatId: null,
    tree: [],
    choices: {},          // parentKey -> child index
    files: [],
    pendingAttachments: [],
    streaming: false,
    streamEl: null,
    streamBuf: '',
    activeAssistantId: null,
    sidebarCollapsed: localStorage.getItem('cs_sidebar') === '1',
  };

  // ---------- auth ----------
  function showAuth() {
    $('#auth-screen').classList.remove('hidden');
    $('#main-screen').classList.add('hidden');
  }
  function showApp() {
    $('#auth-screen').classList.add('hidden');
    $('#main-screen').classList.remove('hidden');
    $('#who').textContent = (state.user ? (state.user.name || state.user.email) : '') +
      (state.user && state.user.is_admin ? ' · admin' : '');
  }

  function bindAuth() {
    const loginForm = $('#login-form'), regForm = $('#register-form');
    $$('[data-mode]').forEach(a => a.addEventListener('click', () => {
      const mode = a.dataset.mode;
      loginForm.classList.toggle('hidden', mode !== 'login');
      regForm.classList.toggle('hidden', mode !== 'register');
      $('#auth-error').textContent = '';
    }));

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#auth-error').textContent = '';
      try {
        const out = await api.post('/api/auth/login', {
          email: $('#login-email').value.trim(),
          password: $('#login-password').value,
        });
        window.__csrf = out.csrf_token;
        state.user = out.user;
        await boot();
      } catch (err) { $('#auth-error').textContent = 'Ошибка входа: ' + err.message; }
    });

    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#auth-error').textContent = '';
      try {
        const out = await api.post('/api/auth/register', {
          email: $('#reg-email').value.trim(),
          password: $('#reg-password').value,
          name: $('#reg-name').value.trim(),
        });
        window.__csrf = out.csrf_token;
        state.user = out.user;
        await boot();
      } catch (err) { $('#auth-error').textContent = 'Ошибка регистрации: ' + err.message; }
    });
  }

  // ---------- chats ----------
  async function loadChats() {
    state.chats = await api.get('/api/chats' + (state.query ? '?q=' + encodeURIComponent(state.query) : ''));
    renderChatList();
  }

  function renderChatList() {
    const box = $('#chat-list');
    if (!state.chats.length) {
      box.innerHTML = '<div class="side-empty">' + (state.query ? 'Ничего не найдено' : 'Пока нет чатов') + '</div>';
      return;
    }
    box.innerHTML = state.chats.map(c =>
      '<div class="chat-item' + (c.id === state.currentChatId ? ' active' : '') + '" data-id="' + c.id + '">' +
        '<span class="title">' + escapeHtml(c.title || 'Новый чат') + '</span>' +
        '<span class="acts">' +
          '<button data-act="rename" title="Переименовать">✎</button>' +
          '<button data-act="delete" title="Удалить">🗑</button>' +
        '</span>' +
      '</div>').join('');

    $$('.chat-item', box).forEach(el => {
      el.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        const id = el.dataset.id;
        if (btn) {
          e.stopPropagation();
          if (btn.dataset.act === 'rename') return openRename(id);
          if (btn.dataset.act === 'delete') return removeChat(id);
        }
        openChat(id);
      });
    });
  }

  async function newChat() {
    const chat = await api.post('/api/chats', { title: 'Новый чат' });
    state.chats.unshift(chat);
    renderChatList();
    await openChat(chat.id);
    $('#input').focus();
  }

  function openRename(id) {
    const chat = state.chats.find(c => c.id === id);
    openModal({
      title: 'Переименовать чат',
      body: '<input id="rename-input" value="' + escapeHtml(chat ? chat.title : '') + '" />',
      onOk: async (root) => {
        const val = $('#rename-input', root).value.trim();
        if (!val) return false;
        const upd = await api.patch('/api/chats/' + id, { title: val });
        const i = state.chats.findIndex(c => c.id === id);
        if (i >= 0) state.chats[i] = upd;
        renderChatList();
        if (state.currentChatId === id) $('#chat-title').textContent = upd.title;
        return true;
      },
    });
  }

  async function removeChat(id) {
    if (!confirm('Удалить чат вместе со всеми сообщениями?')) return;
    await api.del('/api/chats/' + id);
    state.chats = state.chats.filter(c => c.id !== id);
    if (state.currentChatId === id) {
      state.currentChatId = null; state.tree = []; state.choices = {};
      $('#chat-title').textContent = 'ChatStudio';
      renderMessages();
    }
    renderChatList();
  }

  async function openChat(id) {
    state.currentChatId = id;
    state.choices = {};
    const chat = state.chats.find(c => c.id === id);
    $('#chat-title').textContent = chat ? chat.title : 'Чат';
    state.tree = await api.get('/api/chats/' + id + '/messages');
    renderChatList();
    renderMessages();
    closeMobileSidebar();
  }

  async function renameCurrentChat() {
    if (!state.currentChatId) return;
    openRename(state.currentChatId);
  }

  // ---------- messages ----------
  function findNode(nodes, id) {
    for (const n of nodes) {
      if (n.id === id) return n;
      const f = findNode(n.children || [], id);
      if (f) return f;
    }
    return null;
  }

  function insertMessage(tree, msg) {
    const node = Object.assign({}, msg, { children: [] });
    if (msg.parent_message_id) {
      const parent = findNode(tree, msg.parent_message_id);
      if (parent) { parent.children = parent.children || []; parent.children.push(node); return node; }
    }
    tree.push(node);
    return node;
  }

  function activePath(tree, choices) {
    const path = [];
    let nodes = tree, parentKey = 'root';
    while (nodes && nodes.length) {
      let idx = choices[parentKey];
      if (idx == null || idx >= nodes.length || idx < 0) idx = nodes.length - 1;
      const node = nodes[idx];
      path.push({ node, siblings: nodes, index: idx, parentKey });
      nodes = (node.children && node.children.length) ? node.children : null;
      parentKey = node.id;
    }
    return path;
  }

  function msgHtml(entry) {
    const n = entry.node;
    const isUser = n.role === 'user';
    let inner;
    if (isUser) {
      inner = '<div class="bubble">' + escapeHtml(n.content) + '</div>';
    } else {
      const failed = n.status === 'failed';
      const waiting = (n.status === 'queued' || n.status === 'processing') && !n.content;
      inner = '<div class="content md"' + (failed ? ' style="color:var(--danger)"' : '') + '>' +
        (failed ? 'Ошибка: ' + escapeHtml(n.error || 'генерация не удалась')
                : renderMarkdown(n.content || '')) + '</div>';
      if (waiting) inner += '<div class="thinking"><i></i><i></i><i></i></div>';
    }

    let meta = '';
    if (!isUser) {
      meta = '<div class="meta">' +
        (n.status === 'cancelled' ? '<span class="status">остановлено</span>' : '') +
        '<button data-mact="copy" data-id="' + n.id + '">Копировать</button>' +
        '<button data-mact="retry" data-id="' + n.id + '">Повторить</button>' +
        '<button data-mact="continue" data-id="' + n.id + '">Продолжить</button>' +
        (n.status === 'processing' ? '<button data-mact="stop" data-id="' + n.id + '">Остановить</button>' : '') +
        '</div>';
    }

    let branch = '';
    if (entry.siblings.length > 1) {
      branch = '<div class="branch-nav" data-parent="' + entry.parentKey + '" data-index="' + entry.index + '">' +
        '<button data-b="prev">‹</button>' +
        '<span>' + (entry.index + 1) + ' / ' + entry.siblings.length + '</span>' +
        '<button data-b="next">›</button></div>';
    }

    return '<div class="msg ' + n.role + '" data-mid="' + n.id + '">' +
      '<div class="role">' + (isUser ? 'Вы' : 'ChatStudio') + '</div>' + inner + branch + meta + '</div>';
  }

  function renderMessages() {
    const box = $('#messages');
    const path = activePath(state.tree, state.choices);
    if (!path.length) {
      box.innerHTML =
        '<div class="empty-state"><h2>Чем помочь сегодня?</h2>' +
        '<p>Задайте вопрос или прикрепите файл — ChatStudio ответит.</p>' +
        '<div class="chips">' +
        '<button data-prompt="Объясни кратко, что такое FastAPI.">Что такое FastAPI?</button>' +
        '<button data-prompt="Составь план изучения Python на 4 недели.">План изучения Python</button>' +
        '<button data-prompt="Напиши функцию на Python для чтения CSV и вывода статистики.">Пример кода</button>' +
        '</div></div>';
      $$('.chips button', box).forEach(b => b.addEventListener('click', () => {
        $('#input').value = b.dataset.prompt; autoGrow(); sendCurrent();
      }));
      return;
    }
    box.innerHTML = '<div class="msg-wrap">' + path.map(msgHtml).join('') + '</div>';
    bindMessageEvents();
    scrollToBottom();
  }

  function bindMessageEvents() {
    $$('[data-mact]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.id, act = btn.dataset.mact;
      if (act === 'copy') {
        const n = findNode(state.tree, id);
        if (n) { await navigator.clipboard.writeText(n.content || ''); btn.textContent = 'Скопировано'; setTimeout(() => btn.textContent = 'Копировать', 1200); }
      } else if (act === 'retry') { streamRequest('/api/messages/' + id + '/retry'); }
      else if (act === 'continue') { streamRequest('/api/messages/' + id + '/continue'); }
      else if (act === 'stop') { await api.post('/api/messages/' + id + '/stop'); }
    }));

    $$('.branch-nav').forEach(nav => {
      nav.querySelectorAll('[data-b]').forEach(b => b.addEventListener('click', () => {
        const parent = nav.dataset.parent;
        let idx = parseInt(nav.dataset.index, 10);
        if (b.dataset.b === 'prev') idx -= 1; else idx += 1;
        state.choices[parent] = idx;
        renderMessages();
      }));
    });

    $$('[data-copy]').forEach(b => b.addEventListener('click', async () => {
      const code = (window.__codeStore || {})[b.dataset.copy] || '';
      await navigator.clipboard.writeText(code);
      const old = b.textContent; b.textContent = 'Скопировано';
      setTimeout(() => b.textContent = old, 1200);
    }));
  }

  function scrollToBottom() {
    const box = $('#messages');
    box.scrollTop = box.scrollHeight;
  }

  // ---------- streaming ----------
  async function consumeSse(res, onEvent) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        let ev = 'message', data = '';
        chunk.split('\n').forEach(line => {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        });
        if (data) { try { onEvent(ev, JSON.parse(data)); } catch (e) { /* noop */ } }
      }
    }
  }

  function setStreaming(on) {
    state.streaming = on;
    $('#send-btn').classList.toggle('hidden', on);
    $('#stop-btn').classList.toggle('hidden', !on);
    $('#input').disabled = false;
  }

  async function streamRequest(path, body) {
    if (state.streaming) return;
    setStreaming(true);
    state.streamEl = null; state.streamBuf = ''; state.streamStarted = false; state.activeAssistantId = null;
    try {
      const headers = { 'X-CSRF-Token': api.csrf() };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(path, {
        method: 'POST', headers, credentials: 'same-origin',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401) { showAuth(); return; }
      if (!res.ok) { const t = await res.text(); throw new Error(t); }

      await consumeSse(res, (ev, data) => {
        if (ev === 'user_message' || ev === 'assistant_message') {
          const node = insertMessage(state.tree, data);
          renderMessages();
          if (ev === 'assistant_message') {
            state.activeAssistantId = data.id;
            state.streamEl = $('.msg[data-mid="' + node.id + '"] .content');
          }
        } else if (ev === 'delta') {
          state.streamBuf += data.text || '';
          if (state.streamEl) {
            if (!state.streamStarted) {
              const th = state.streamEl.parentElement.querySelector('.thinking');
              if (th) th.remove();
              state.streamStarted = true;
            }
            state.streamEl.textContent = state.streamBuf;
            scrollToBottom();
          }
        } else if (ev === 'done') {
          const n = findNode(state.tree, data.message_id);
          if (n) { n.status = 'completed'; n.content = state.streamBuf; }
          renderMessages();
        } else if (ev === 'error') {
          const n = findNode(state.tree, data.message_id);
          if (n) { n.status = 'failed'; n.error = data.error; }
          renderMessages();
        } else if (ev === 'cancelled') {
          const n = findNode(state.tree, data.message_id);
          if (n) { n.status = 'cancelled'; if (data.text) n.content = data.text; }
          renderMessages();
        }
      });
    } catch (err) {
      console.error(err);
      alert('Ошибка: ' + err.message);
    } finally {
      setStreaming(false);
      state.streamEl = null;
      await loadChats();
      // refresh title (generated in background)
      if (state.currentChatId) {
        setTimeout(async () => {
          try {
            const chat = await api.get('/api/chats/' + state.currentChatId);
            const i = state.chats.findIndex(c => c.id === chat.id);
            if (i >= 0 && state.chats[i].title !== chat.title) {
              state.chats[i] = chat; renderChatList();
              $('#chat-title').textContent = chat.title;
            }
          } catch (e) { /* noop */ }
        }, 2500);
      }
    }
  }

  async function sendCurrent() {
    const input = $('#input');
    const content = input.value.trim();
    if (!content || state.streaming) return;
    if (!state.currentChatId) {
      const chat = await api.post('/api/chats', { title: 'Новый чат' });
      state.chats.unshift(chat);
      state.currentChatId = chat.id;
      state.tree = []; state.choices = {};
      $('#chat-title').textContent = chat.title;
      renderChatList();
    }
    const attachments = state.pendingAttachments.map(f => f.id);
    input.value = ''; autoGrow();
    state.pendingAttachments = []; renderAttachments();
    await streamRequest('/api/chats/' + state.currentChatId + '/messages',
      { content, attachment_ids: attachments });
  }

  // ---------- composer ----------
  function autoGrow() {
    const t = $('#input');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 200) + 'px';
  }

  function renderAttachments() {
    const box = $('#attach-list');
    box.innerHTML = state.pendingAttachments.map(f =>
      '<span class="attach-chip">📎 ' + escapeHtml(f.original_name) +
      ' <button data-rm="' + f.id + '">✕</button></span>').join('');
    $$('[data-rm]', box).forEach(b => b.addEventListener('click', () => {
      state.pendingAttachments = state.pendingAttachments.filter(x => x.id !== b.dataset.rm);
      renderAttachments();
    }));
  }

  function bindComposer() {
    const input = $('#input');
    input.addEventListener('input', autoGrow);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent(); }
    });
    $('#send-btn').addEventListener('click', sendCurrent);
    $('#stop-btn').addEventListener('click', async () => {
      if (state.activeAssistantId) await api.post('/api/messages/' + state.activeAssistantId + '/stop');
    });
    $('#attach-btn').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length) await uploadFiles(files);
      e.target.value = '';
    });
  }

  // ---------- files ----------
  async function loadFiles() {
    state.files = await api.get('/api/files');
    renderFiles();
  }

  function kindIcon(kind) {
    return ({ pdf: '📕', doc: '📄', sheet: '📊', slide: '📽', image: '🖼', text: '📝' })[kind] || '📁';
  }

  function renderFiles() {
    const box = $('#file-list');
    if (!state.files.length) { box.innerHTML = '<div class="side-empty">Файлов пока нет</div>'; return; }
    box.innerHTML = state.files.map(f =>
      '<div class="file-item">' +
        '<span class="fi-kind">' + kindIcon(f.kind) + '</span>' +
        '<span class="fi-name" title="' + escapeHtml(f.original_name) + '">' + escapeHtml(f.original_name) + '</span>' +
        '<span class="fi-size">' + formatSize(f.size) + '</span>' +
        '<button data-attach="' + f.id + '" title="Прикрепить">＋</button>' +
        '<button data-del="' + f.id + '" title="Удалить">🗑</button>' +
      '</div>').join('');
    $$('[data-del]', box).forEach(b => b.addEventListener('click', async () => {
      await api.del('/api/files/' + b.dataset.del);
      state.files = state.files.filter(x => x.id !== b.dataset.del);
      renderFiles();
    }));
    $$('[data-attach]', box).forEach(b => b.addEventListener('click', () => {
      const f = state.files.find(x => x.id === b.dataset.attach);
      if (f && !state.pendingAttachments.some(x => x.id === f.id)) {
        state.pendingAttachments.push(f);
        renderAttachments();
      }
      toggleFiles(false);
    }));
  }

  async function uploadFiles(files) {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    try {
      const out = await api.postForm('/api/files', fd);
      state.files = out.concat(state.files);
      renderFiles();
      out.forEach(f => state.pendingAttachments.push(f));
      renderAttachments();
    } catch (err) { alert('Ошибка загрузки: ' + err.message); }
  }

  function toggleFiles(force) {
    const p = $('#files-panel');
    const show = force === undefined ? p.classList.contains('hidden') : force;
    p.classList.toggle('hidden', !show);
    if (show) loadFiles();
  }

  function bindFiles() {
    $('#files-btn').addEventListener('click', () => toggleFiles(true));
    $('#toggle-files-btn').addEventListener('click', () => toggleFiles());
    $('#close-files-btn').addEventListener('click', () => toggleFiles(false));
    $('#upload-btn').addEventListener('click', () => $('#file-input').click());
    const dz = $('#drop-zone');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', async (e) => {
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length) await uploadFiles(files);
    });
  }

  // ---------- modal ----------
  function openModal({ title, body, onOk, okText }) {
    const root = $('#modal-root');
    root.innerHTML = '<div class="modal-back"><div class="modal"><h3>' + escapeHtml(title) + '</h3>' +
      '<div class="modal-body">' + body + '</div>' +
      '<div class="row"><button class="ghost" data-cancel>Отмена</button>' +
      '<button class="solid" data-ok>' + escapeHtml(okText || 'Сохранить') + '</button></div></div></div>';
    const back = $('.modal-back', root);
    const close = () => { root.innerHTML = ''; };
    $('[data-cancel]', root).addEventListener('click', close);
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    $('[data-ok]', root).addEventListener('click', async () => {
      try { const ok = onOk ? await onOk(root) : true; if (ok !== false) close(); }
      catch (err) { alert('Ошибка: ' + err.message); }
    });
    const inp = $('input, textarea', root);
    if (inp) { inp.focus(); inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('[data-ok]', root).click(); } }); }
  }

  // ---------- sidebar ----------
  function applySidebar() {
    const sb = $('#sidebar');
    sb.classList.toggle('collapsed', state.sidebarCollapsed && window.innerWidth > 820);
    $('#collapse-btn').textContent = state.sidebarCollapsed ? '»' : '«';
  }
  function closeMobileSidebar() {
    if (window.innerWidth <= 820) { $('#sidebar').classList.remove('open'); $('#sidebar-overlay').classList.remove('show'); }
  }
  function bindSidebar() {
    $('#new-chat-btn').addEventListener('click', newChat);
    $('#collapse-btn').addEventListener('click', () => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      localStorage.setItem('cs_sidebar', state.sidebarCollapsed ? '1' : '0');
      applySidebar();
    });
    $('#menu-btn').addEventListener('click', () => {
      $('#sidebar').classList.add('open'); $('#sidebar-overlay').classList.add('show');
    });
    $('#sidebar-overlay').addEventListener('click', closeMobileSidebar);
    let t = null;
    $('#search-input').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { state.query = e.target.value.trim(); loadChats(); }, 250);
    });
    $('#chat-title').addEventListener('click', renameCurrentChat);
    $('#logout-btn').addEventListener('click', async () => {
      try { await api.post('/api/auth/logout'); } catch (e) { /* noop */ }
      window.__csrf = null; state.user = null;
      showAuth();
    });
    $('#account-btn').addEventListener('click', () => {
      const u = state.user || {};
      openModal({
        title: 'Аккаунт', okText: 'Закрыть',
        body: '<p><b>Email:</b> ' + escapeHtml(u.email) + '</p>' +
              '<p><b>Имя:</b> ' + escapeHtml(u.name || '—') + '</p>' +
              '<p><b>План:</b> ' + escapeHtml(u.plan || 'free') + '</p>' +
              '<p><b>Админ:</b> ' + (u.is_admin ? 'да' : 'нет') + '</p>',
        onOk: () => true,
      });
    });
    $('#settings-btn').addEventListener('click', () => {
      openModal({
        title: 'Настройки', okText: 'Закрыть',
        body: '<p>Тема: тёплая светлая (Claude-like).</p>' +
              '<p>Модели и Model Sets настраиваются администратором.</p>' +
              '<p>Файлы: лимиты задаются в конфигурации сервера.</p>',
        onOk: () => true,
      });
    });
    window.addEventListener('resize', () => {
      applySidebar();
      $('#menu-btn').style.display = window.innerWidth <= 820 ? 'grid' : 'none';
    });
  }

  // ---------- boot ----------
  async function boot() {
    showApp();
    applySidebar();
    $('#menu-btn').style.display = window.innerWidth <= 820 ? 'grid' : 'none';
    await loadChats();
    await loadFiles();
    renderMessages();
  }

  async function init() {
    bindAuth(); bindSidebar(); bindComposer(); bindFiles();
    try {
      const me = await api.get('/api/auth/me');
      state.user = me;
      await boot();
    } catch (e) {
      showAuth();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
