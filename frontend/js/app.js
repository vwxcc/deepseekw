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
  // inline SVG icon from the sprite in index.html
  function icon(id, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>';
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

  // Clipboard that also works over plain http:// (not a secure context)
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through to legacy path */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function toast(message, kind) {
    let root = document.getElementById('toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'toast-root';
      document.body.appendChild(root);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }, 3400);
  }

  async function copyWithFeedback(btn, text, okLabel) {
    const original = btn.textContent;
    const ok = await copyText(text);
    btn.textContent = ok ? (okLabel || 'Скопировано') : 'Не удалось';
    if (!ok) toast('Не удалось скопировать', 'error');
    setTimeout(() => { btn.textContent = original; }, 1300);
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

  function tailText(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? '…' + s.slice(-n) : s;
  }

  // --- drawing skill: ```draw {json} -> inline SVG ---
  function shapeSvg(s) {
    if (!s || !s.type) return '';
    const a = [];
    const push = (k, v) => { if (v !== undefined && v !== null) a.push(k + '="' + v + '"'); };
    const common = () => {
      push('fill', s.fill);
      push('stroke', s.stroke);
      push('stroke-width', s.width);
      push('opacity', s.opacity);
    };
    switch (String(s.type)) {
      case 'rect':
        push('x', s.x || 0); push('y', s.y || 0);
        push('width', s.w || 0); push('height', s.h || 0);
        if (s.rx) push('rx', s.rx);
        if (s.fill == null && s.stroke == null) push('fill', '#c96442');
        common();
        return '<rect ' + a.join(' ') + '/>';
      case 'circle':
        push('cx', s.cx || 0); push('cy', s.cy || 0); push('r', s.r || 0);
        if (s.fill == null) push('fill', '#c96442');
        common();
        return '<circle ' + a.join(' ') + '/>';
      case 'ellipse':
        push('cx', s.cx || 0); push('cy', s.cy || 0);
        push('rx', s.rx || 0); push('ry', s.ry || 0);
        if (s.fill == null) push('fill', '#c96442');
        common();
        return '<ellipse ' + a.join(' ') + '/>';
      case 'line':
        push('x1', s.x1 || 0); push('y1', s.y1 || 0);
        push('x2', s.x2 || 0); push('y2', s.y2 || 0);
        push('stroke', s.stroke || '#1f1e1d');
        push('stroke-width', s.width || 2);
        return '<line ' + a.join(' ') + '/>';
      case 'polyline':
      case 'polygon': {
        const pts = (s.points || []).map(p => (p[0] || 0) + ',' + (p[1] || 0)).join(' ');
        push('points', pts);
        if (String(s.type) === 'polygon') {
          if (s.fill == null) push('fill', '#c96442');
        } else {
          push('fill', 'none');
          push('stroke', s.stroke || '#c96442');
          push('stroke-width', s.width || 2);
        }
        common();
        return '<' + s.type + ' ' + a.join(' ') + '/>';
      }
      case 'path':
        push('d', s.d || '');
        push('fill', s.fill || 'none');
        push('stroke', s.stroke || '#c96442');
        push('stroke-width', s.width || 2);
        push('opacity', s.opacity);
        return '<path ' + a.join(' ') + '/>';
      case 'text':
        push('x', s.x || 0); push('y', s.y || 0);
        push('font-size', s.size || 16);
        push('fill', s.fill || '#1f1e1d');
        push('opacity', s.opacity);
        return '<text ' + a.join(' ') + '>' + escapeHtml(s.text || '') + '</text>';
      default:
        return '';
    }
  }

  function drawBlockHtml(code) {
    let spec;
    try { spec = JSON.parse(code); } catch (e) { return codeBlockHtml('draw', code); }
    const w = spec.width || 420, h = spec.height || 300;
    const bg = spec.background || 'transparent';
    const shapes = (spec.shapes || []).map(shapeSvg).join('');
    return '<div class="draw-block"><svg viewBox="0 0 ' + w + ' ' + h +
      '" width="100%" style="max-width:' + w + 'px;background:' + bg + '">' + shapes + '</svg></div>';
  }

  function codeBlockHtml(lang, code) {
    const id = 'code_' + Math.random().toString(36).slice(2);
    window.__codeStore = window.__codeStore || {};
    window.__codeStore[id] = code;
    return '<div class="code-block"><div class="code-head"><span>' +
      escapeHtml(lang || 'code') + '</span><button data-copy="' + id + '">' +
      icon('copy') + 'Копировать</button>' +
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
    const isTableSep = (s) => s.includes('|') && /^[\s:|-]+$/.test(s) && s.includes('-');
    const splitRow = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const cm = line.match(/^\u0000C(\d+)\u0000$/);
      if (cm) {
        flushPara(); closeList(); closeQuote();
        const b = codes[+cm[1]];
        out.push(b.lang === 'draw' ? drawBlockHtml(b.code) : codeBlockHtml(b.lang, b.code));
        continue;
      }
      if (!line.trim()) { flushPara(); closeList(); closeQuote(); continue; }
      let m;

      // tables: header row followed by a |---| separator row
      if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flushPara(); closeList(); closeQuote();
        const head = splitRow(line);
        const body = [];
        let j = i + 2;
        while (j < lines.length && lines[j].includes('|') && lines[j].trim()) {
          body.push(splitRow(lines[j]));
          j++;
        }
        out.push('<div class="table-wrap"><table><thead><tr>' +
          head.map(c => '<th>' + inlineFmt(c) + '</th>').join('') +
          '</tr></thead><tbody>' +
          body.map(r => '<tr>' +
            head.map((_, k) => '<td>' + inlineFmt(r[k] || '') + '</td>').join('') +
          '</tr>').join('') +
          '</tbody></table></div>');
        i = j - 1;
        continue;
      }

      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushPara(); closeList(); closeQuote();
        const lvl = Math.min(m[1].length, 3);
        out.push('<h' + lvl + '>' + inlineFmt(m[2]) + '</h' + lvl + '>');
        continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flushPara(); closeList(); closeQuote(); out.push('<hr>'); continue; }
      if ((m = line.match(/^\s*>\s?(.*)$/))) {
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
    streamStarted: false,
    activeAssistantId: null,
    thinkBody: null,
    modelSets: [],
    modelSetId: localStorage.getItem('cs_model') || '',
    effort: localStorage.getItem('cs_effort') || 'medium',
    usage: null,
    draftTail: null,
    readonly: false,
    publicToken: null,
    greetTimer: null,
    greetIdx: Math.floor(Math.random() * 100),
    suggIdx: Math.floor(Math.random() * 50),
    sidebarCollapsed: localStorage.getItem('cs_sidebar') === '1',
  };

  const EFFORTS = ['none', 'low', 'medium', 'high'];
  const EFFORT_LABELS = ['нет', 'низкое', 'среднее', 'высокое'];

  const GREETINGS = [    'Чем помочь сегодня?', 'О чём подумаем?', 'С чего начнём?', 'Что обсудим?',
    'Какой вопрос разберём?', 'Чем займёмся?', 'Что будем делать?', 'Какая задача?',
    'Что нужно сделать?', 'Чем могу помочь?', 'Что вас интересует?', 'Расскажите, что нужно',
    'Задайте вопрос', 'Что хотите узнать?', 'Над чем работаем?', 'Что исследуем?',
    'О чём поговорим?', 'Что разберём?', 'Какая идея?', 'Что придумаем?',
    'Чем помочь?', 'Что подскажем?', 'Какой план?', 'Что изучим?',
    'Куда двигаемся?', 'Что создадим?', 'Какую проблему решаем?', 'Что анализируем?',
    'О чём поразмышляем?', 'Что объяснить?', 'Какой текст разберём?', 'Что написать?',
    'Какую тему раскроем?', 'Что посчитать?', 'Какой код нужен?', 'Что спроектируем?',
    'О чём расскажу?', 'Что найдём?', 'Какую задачу решим?', 'Что улучшим?',
    'С чего начать?', 'Какой вопрос у вас?', 'Что уточнить?', 'Как помочь?',
    'О чём речь?', 'Что разложим по полочкам?', 'Какую идею обсудим?', 'Что проверим?',
    'Куда копаем?', 'Что переведём?', 'Какой документ разберём?', 'Что суммируем?',
    'О чём спросить?', 'Что построим?', 'Какой план составим?', 'Что оптимизируем?',
    'Какую тему разберём?', 'Что изобретём?', 'О чём подумать?', 'Что настроим?',
    'Какую статью разберём?', 'Что напишем?', 'О чём мечтаем?', 'Что решаем?',
    'Какую мысль разовьём?', 'Что подытожим?', 'О чём поговорим сегодня?', 'Что найдём вместе?',
    'Какая цель?', 'Что нужно объяснить?', 'Какой вопрос на повестке?', 'Что разгадаем?',
    'О чём поспорим?', 'Что посоветовать?', 'Какую задачу разберём?', 'Что сравним?',
    'Какой пример нужен?', 'Что расскажем?', 'О чём почитать?', 'Что запланируем?',
    'Какую идею проверим?', 'Что упростим?', 'О чём подумаем вместе?', 'Что посмотрим?',
    'Какой вопрос решаем?', 'Что подправим?', 'О чём расскажете?', 'Что придумаем вместе?',
    'Какую проблему разберём?', 'Что нарисуем?', 'О чём поговорим?', 'Что сделаем?',
    'Какой текст напишем?', 'Что разберём подробно?', 'О чём подумаем сейчас?', 'Что принесёте?',
  ];

  const SUGGESTIONS = [
    'Помоги с Python — пример кода',
    'Объясни, что такое API',
    'Составь план на неделю',
    'Напиши SQL-запрос с JOIN',
    'Как работает Docker?',
    'Переведи текст на английский',
    'Сократи этот текст',
    'Сравни React и Vue',
    'Напиши регулярное выражение',
    'Объясни async/await простыми словами',
    'Составь резюме для junior-разработчика',
    'Как настроить CI/CD?',
    'Разбери ошибку в коде',
    'Придумай название для проекта',
    'Напиши письмо клиенту',
    'Сделай конспект статьи',
    'Как ускорить запрос к базе?',
    'Объясни разницу между TCP и UDP',
    'Составь бюджет на месяц',
    'Напиши bash-скрипт для бэкапа',
    'Что такое векторная база данных?',
    'Придумай 10 идей для стартапа',
    'Как работает JWT?',
    'Оптимизируй этот алгоритм',
    'Напиши тесты на pytest',
    'Объясни принципы SOLID',
    'Как развернуть приложение на сервере?',
    'Составь чек-лист для релиза',
    'Придумай вопросы для собеседования',
    'Как работает HTTPS?',
    'Напиши Dockerfile для Python',
    'Разбери JSON на части',
    'Объясни, что такое REST',
    'Составь план изучения ML',
    'Напиши функцию сортировки',
    'Как чистить данные в pandas?',
    'Придумай структуру базы данных',
    'Объясни git rebase',
    'Как работает Redis?',
    'Составь договор простыми словами',
    'Напиши HTML-страницу с формой',
    'Объясни, что такое WebSocket',
    'Как защитить API?',
    'Придумай метрики для продукта',
    'Напиши текст для лендинга',
    'Объясни разницу между процессами и потоками',
    'Как настроить nginx?',
    'Составь roadmap проекта',
    'Напиши SQL для отчёта',
    'Что почитать про архитектуру?',
  ];


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
          '<button data-act="rename" title="Переименовать">' + icon('pencil') + '</button>' +
          '<button data-act="delete" title="Удалить">' + icon('trash') + '</button>' +
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
    await loadUsage();
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

  function attsHtml(atts) {
    if (!atts || !atts.length) return '';
    return '<div class="msg-atts">' + atts.map(a => {
      const url = '/api/files/' + a.file_id + '/download';
      if (a.kind === 'image') {
        return '<a class="msg-att img" href="' + url + '" target="_blank" rel="noopener" title="' +
          escapeHtml(a.name) + '"><img src="' + url + '?inline=1" alt="' + escapeHtml(a.name) + '" loading="lazy" /></a>';
      }
      return '<a class="msg-att" href="' + url + '" target="_blank" rel="noopener" title="' +
        escapeHtml(a.name) + '">' +
        '<span class="att-icon">' + icon('file') + '</span>' +
        '<span class="att-name">' + escapeHtml(a.name) + '</span>' +
        '<span class="att-size">' + formatSize(a.size) + '</span></a>';
    }).join('') + '</div>';
  }

  function thinkAnim() {
    return '<span class="think-anim">' + '<span></span>'.repeat(8) + '</span>';
  }

  function msgHtml(entry, isLast) {
    const n = entry.node;
    const isUser = n.role === 'user';
    let inner;
    if (isUser) {
      inner = attsHtml(n.attachments) + '<div class="bubble">' + escapeHtml(n.content) + '</div>';
    } else {
      const failed = n.status === 'failed';
      const generating = n.status === 'queued' || n.status === 'processing';
      const hasThink = !!(n.thinking && String(n.thinking).trim());
      const draft = n.draft || '';

      if (generating) {
        // while generating we only show a few live lines (thinking + answer draft)
        inner = '<div class="think-box">' +
          '<div class="think-head">' + thinkAnim() +
            '<span class="label">' + (hasThink ? 'Размышления' : 'Думает…') + '</span>' +
          '</div>' +
          '<div class="think-tail">' + escapeHtml(tailText(n.thinking, 260)) + '</div>' +
          '<div class="think-tail answer">' + escapeHtml(tailText(n.draft, 260)) + '</div>' +
          '</div>';
      } else if (failed) {
        inner = '<div class="content md" style="color:var(--danger)">Ошибка: ' +
          escapeHtml(n.error || 'генерация не удалась') + '</div>';
      } else {
        inner = '<div class="content md">' + renderMarkdown(n.content || '') + '</div>';
      }
    }

    let meta = '';
    if (!isUser && !state.readonly) {
      const generating = n.status === 'queued' || n.status === 'processing';
      const parts = [];
      if (n.status === 'cancelled') parts.push('<span class="status">остановлено</span>');
      if (generating) {
        parts.push('<button data-mact="stop" data-id="' + n.id + '">' + icon('stop') + 'Остановить</button>');
      } else {
        if (n.content) {
          parts.push('<button data-mact="rate-up" data-id="' + n.id + '" class="rate' +
            (n.rating > 0 ? ' on' : '') + '" title="Хороший ответ">' + icon('thumb-up') + '</button>');
          parts.push('<button data-mact="rate-down" data-id="' + n.id + '" class="rate' +
            (n.rating < 0 ? ' on' : '') + '" title="Плохой ответ">' + icon('thumb-down') + '</button>');
          parts.push('<button data-mact="copy" data-id="' + n.id + '">' + icon('copy') + 'Копировать</button>');
        }
        parts.push('<button data-mact="retry" data-id="' + n.id + '">' + icon('refresh') + 'Повторить</button>');
        if (n.content) parts.push('<button data-mact="continue" data-id="' + n.id + '">' + icon('continue') + 'Продолжить</button>');
      }
      meta = '<div class="meta">' + parts.join('') + '</div>';
    }

    let branch = '';
    if (entry.siblings.length > 1) {
      branch = '<div class="branch-nav" data-parent="' + entry.parentKey + '" data-index="' + entry.index + '">' +
        '<button data-b="prev">' + icon('chevron', 'prev') + '</button>' +
        '<span>' + (entry.index + 1) + ' / ' + entry.siblings.length + '</span>' +
        '<button data-b="next">' + icon('chevron') + '</button></div>';
    }

    let sugg = '';
    if (!isUser && isLast && n.status === 'completed' && n.suggestions && n.suggestions.length) {
      sugg = '<div class="chips left">' + n.suggestions.map(s =>
        '<button data-sugg="' + escapeHtml(s) + '">' + escapeHtml(s) + '</button>').join('') + '</div>';
    }

    return '<div class="msg ' + n.role + '" data-mid="' + n.id + '">' +
      '<div class="role">' + (isUser ? 'Вы' : 'ChatStudio') + '</div>' + inner + branch + meta + sugg + '</div>';
  }

  function renderEmptyState() {
    const box = $('#messages');
    box.innerHTML =
      '<div class="empty-state">' +
        '<h2 class="greet" id="greet-text">' +
          escapeHtml(GREETINGS[state.greetIdx % GREETINGS.length]) + '</h2>' +
        '<p>Задайте вопрос, прикрепите файл или включите поиск в интернете.</p>' +
        '<div class="chips" id="sugg-chips"></div>' +
      '</div>';
    renderSuggestionChips();
    startRotation();
  }

  function renderSuggestionChips() {
    const box = $('#sugg-chips');
    if (!box) return;
    const total = SUGGESTIONS.length, n = 4;
    const picks = [];
    for (let i = 0; i < n; i++) picks.push(SUGGESTIONS[(state.suggIdx + i) % total]);
    state.suggIdx = (state.suggIdx + n) % total;
    box.innerHTML = picks.map((p, i) =>
      '<button class="chip-in" style="animation-delay:' + (i * 70) +
      'ms" data-prompt="' + escapeHtml(p) + '">' + escapeHtml(p) + '</button>').join('');
    $$('button[data-prompt]', box).forEach(b => b.addEventListener('click', () => {
      $('#input').value = b.dataset.prompt; autoGrow(); sendCurrent();
    }));
  }

  function rotateGreeting() {
    state.greetIdx = (state.greetIdx + 1) % GREETINGS.length;
    const el = $('#greet-text');
    if (!el) return;
    el.textContent = GREETINGS[state.greetIdx];
    el.classList.remove('greet');
    void el.offsetWidth;   // restart the CSS animation
    el.classList.add('greet');
  }

  function startRotation() {
    stopRotation();
    state.greetTimer = setInterval(() => {
      if (!$('#greet-text')) { stopRotation(); return; }
      rotateGreeting();
      renderSuggestionChips();
    }, 4200);
  }

  function stopRotation() {
    if (state.greetTimer) { clearInterval(state.greetTimer); state.greetTimer = null; }
  }

  function renderMessages() {
    const box = $('#messages');
    const path = activePath(state.tree, state.choices);
    if (!path.length) { renderEmptyState(); return; }
    stopRotation();
    box.innerHTML = '<div class="msg-wrap">' +
      path.map((e, i) => msgHtml(e, i === path.length - 1)).join('') + '</div>';
    bindMessageEvents();
    scrollToBottom();
  }

  function bindMessageEvents() {
    $$('.think-head').forEach(h => h.addEventListener('click', () => {
      const box = h.closest('.think-box');
      if (!box) return;
      box.classList.toggle('collapsed');
      const msgEl = h.closest('.msg');
      const n = msgEl ? findNode(state.tree, msgEl.dataset.mid) : null;
      if (n) n.thinkCollapsed = box.classList.contains('collapsed');
    }));

    $$('[data-mact]').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.id, act = btn.dataset.mact;
      if (act === 'copy') {
        const n = findNode(state.tree, id);
        if (n) await copyWithFeedback(btn, n.content || '');
      } else if (act === 'retry') { streamRequest('/api/messages/' + id + '/retry'); }
      else if (act === 'continue') { streamRequest('/api/messages/' + id + '/continue'); }
      else if (act === 'stop') { await api.post('/api/messages/' + id + '/stop'); }
      else if (act === 'rate-up') { await rateMessage(id, 1); }
      else if (act === 'rate-down') { await rateMessage(id, -1); }
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

    $$('[data-copy]').forEach(b => b.addEventListener('click', () =>
      copyWithFeedback(b, (window.__codeStore || {})[b.dataset.copy] || '')));

    $$('[data-sugg]').forEach(b => b.addEventListener('click', () => {
      $('#input').value = b.dataset.sugg;
      autoGrow();
      sendCurrent();
    }));
  }

  function scrollToBottom() {
    const box = $('#messages');
    box.scrollTop = box.scrollHeight;
  }

  async function rateMessage(id, rating) {
    const n = findNode(state.tree, id);
    const next = n && n.rating === rating ? 0 : rating;
    try {
      await api.post('/api/messages/' + id + '/rate', { rating: next });
      if (n) n.rating = next;
      renderMessages();
    } catch (e) {
      toast('Ошибка: ' + e.message, 'error');
    }
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
    state.streamEl = null; state.thinkBody = null; state.draftTail = null;
    state.streamBuf = ''; state.streamStarted = false; state.activeAssistantId = null;
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
            const el = $('.msg[data-mid="' + node.id + '"]');
            state.streamEl = el ? $('.content', el) : null;
            state.thinkBody = el ? $('.think-tail', el) : null;
            state.draftTail = el ? $('.think-tail.answer', el) : null;
          }
        } else if (ev === 'thinking') {
          const n = findNode(state.tree, state.activeAssistantId);
          if (n) n.thinking = (n.thinking || '') + (data.text || '');
          if (state.thinkBody) {
            state.thinkBody.textContent = tailText(n ? n.thinking : '', 260);
            const head = state.thinkBody.parentElement;
            const lbl = head ? head.querySelector('.label') : null;
            if (lbl) lbl.textContent = 'Размышления';
          }
        } else if (ev === 'delta') {
          state.streamBuf += data.text || '';
          const n = findNode(state.tree, state.activeAssistantId);
          if (n) { n.draft = state.streamBuf; state.streamStarted = true; }
          if (state.draftTail) state.draftTail.textContent = tailText(state.streamBuf, 260);
          scrollToBottom();
        } else if (ev === 'done') {
          const n = findNode(state.tree, data.message_id);
          if (n) {
            n.status = 'completed';
            n.content = data.text || state.streamBuf;
            n.draft = '';
          }
          renderMessages();
          loadUsage();
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
      toast('Ошибка: ' + err.message, 'error');
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
      {
        content,
        attachment_ids: attachments,
        model_set_id: state.modelSetId || null,
        web_search: true,
        effort: state.effort,
      });
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
      '<span class="attach-chip">' + icon('paperclip') + escapeHtml(f.original_name) +
      '<button data-rm="' + f.id + '" title="Убрать">' + icon('x') + '</button></span>').join('');
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
    $('#model-select').addEventListener('change', (e) => {
      state.modelSetId = e.target.value;
      localStorage.setItem('cs_model', state.modelSetId);
    });
    const er = $('#effort-range');
    const applyEffort = (v, save) => {
      let idx = EFFORTS.indexOf(v);
      if (idx < 0) idx = 2;
      state.effort = EFFORTS[idx];
      er.value = String(idx);
      $('#effort-label').textContent = EFFORT_LABELS[idx];
      if (save) localStorage.setItem('cs_effort', state.effort);
    };
    er.addEventListener('input', () => applyEffort(EFFORTS[parseInt(er.value, 10)] || 'medium', true));
    applyEffort(state.effort, false);
    $('#context-btn').addEventListener('click', openContextMenu);
  }

  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  async function loadUsage() {
    const btn = $('#context-btn');
    if (!btn) return;
    if (!state.currentChatId) { btn.textContent = '—'; return; }
    try {
      const u = await api.get('/api/chats/' + state.currentChatId + '/usage');
      state.usage = u;
      const p = u.percent || 0;
      btn.textContent = p.toFixed(1) + '%';
      btn.classList.toggle('warn', p > 60);
      btn.title = 'Контекст: ' + p.toFixed(2) + '% из ' + fmtNum(u.context_len) + ' токенов';
    } catch (e) {
      btn.textContent = '—';
    }
  }

  function usageCards(u) {
    const card = (label, val) =>
      '<div class="usage-card"><span>' + label + '</span><b>' + val + '</b></div>';
    return '<div class="usage-grid">' +
      card('Вход', fmtNum(u.tokens_in)) +
      card('Выход', fmtNum(u.tokens_out)) +
      card('Из кэша', fmtNum(u.tokens_cached)) +
      card('Сообщений', u.messages) +
      card('Средний вход', fmtNum(u.avg_in)) +
      card('Занято', (u.percent || 0).toFixed(2) + '%') +
      '</div>';
  }

  async function openContextMenu() {
    if (!state.currentChatId) { toast('Сначала откройте чат', 'error'); return; }
    let u;
    try { u = await api.get('/api/chats/' + state.currentChatId + '/usage'); }
    catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
    state.usage = u;
    const barW = Math.min(100, Math.max(0, u.percent || 0));
    openModal({
      title: 'Контекст диалога',
      okText: 'Закрыть',
      body: usageCards(u) +
        '<div class="usage-bar"><i style="width:' + barW + '%"></i></div>' +
        '<p class="usage-note">Окно модели — ' + fmtNum(u.context_len) + ' токенов. ' +
        'Резюме истории: ' + (u.summary_chars ? fmtNum(u.summary_chars) + ' симв.' : 'нет') + '. ' +
        'Усилие: ' + escapeHtml(u.effort || 'medium') + '.</p>' +
        '<label style="margin-top:14px">Сжать историю до <b id="cmp-val">50</b>%</label>' +
        '<input type="range" id="cmp-range" class="orange-range" min="5" max="85" step="5" value="50" />' +
        '<p class="usage-note">Сжатие делает та же модель: старое сворачивается в краткое резюме.</p>' +
        '<div style="margin-top:10px"><button class="chip-btn" id="cmp-go">' +
        icon('sparkle') + 'Сжать историю</button></div>',
      onOk: () => true,
    });
    const r = $('#cmp-range');
    if (r) r.addEventListener('input', () => { $('#cmp-val').textContent = r.value; });
    const go = $('#cmp-go');
    if (go) go.addEventListener('click', async () => {
      const p = parseInt(r.value, 10) || 50;
      toast('Сжимаю историю…');
      try {
        await api.post('/api/chats/' + state.currentChatId + '/compress', { target_percent: p });
        toast('История сжата');
        $('#modal-root').innerHTML = '';
        await loadUsage();
      } catch (e) { toast('Не удалось: ' + e.message, 'error'); }
    });
  }

  async function openLinks() {
    let items = [];
    try { items = await api.get('/api/chats/shared'); } catch (e) { items = []; }
    openModal({
      title: 'Мои публичные ссылки',
      okText: 'Закрыть',
      body: items.length
        ? '<div class="link-list">' + items.map(s =>
            '<div class="link-row"><div class="link-info"><b>' + escapeHtml(s.title) + '</b>' +
            '<span>' + s.messages + ' сообщ. · ' + timeAgo(s.created_at) + '</span></div>' +
            '<button class="chip-btn" data-copy-link="' + s.share_token + '" title="Копировать">' + icon('copy') + '</button>' +
            '<button class="chip-btn" data-open-link="' + s.share_token + '" title="Открыть">' + icon('link') + '</button>' +
            '</div>').join('') + '</div>'
        : '<p>Пока нет публичных ссылок. Откройте чат и нажмите иконку «Поделиться».</p>',
      onOk: () => true,
    });
    $$('[data-copy-link]').forEach(b => b.addEventListener('click', async () => {
      const ok = await copyText(location.origin + '/?share=' + b.dataset.copyLink);
      toast(ok ? 'Ссылка скопирована' : 'Не удалось скопировать', ok ? '' : 'error');
    }));
    $$('[data-open-link]').forEach(b => b.addEventListener('click', () =>
      window.open('/?share=' + b.dataset.openLink, '_blank')));
  }

  async function openAdminStats() {
    let s;
    try { s = await api.get('/api/admin/stats'); }
    catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
    const maxH = Math.max(1, ...s.hourly.map(h => h.messages));
    const bars = s.hourly.length
      ? s.hourly.map(h =>
          '<div class="bar" title="' + escapeHtml(h.hour) + ' — ' + h.messages + ' сообщ.">' +
          '<i style="height:' + Math.round((h.messages / maxH) * 100) + '%"></i>' +
          '<span>' + escapeHtml((h.hour || '').slice(11, 13)) + '</span></div>').join('')
      : '<p class="usage-note">Нет данных за 24 часа</p>';
    const card = (label, val) =>
      '<div class="usage-card"><span>' + label + '</span><b>' + val + '</b></div>';
    openModal({
      title: 'Статистика использования',
      okText: 'Закрыть',
      body: '<div class="usage-grid">' +
        card('Пользователи', s.users) + card('Чаты', s.chats) +
        card('Сообщения', s.messages) + card('Файлы', s.files) +
        card('Токенов вход', fmtNum(s.tokens_in)) + card('Токенов выход', fmtNum(s.tokens_out)) +
        card('Из кэша', fmtNum(s.tokens_cached)) +
        card('Оценки', '👍 ' + s.rating_up + ' · 👎 ' + s.rating_down) +
        '</div>' +
        '<h4 class="sec">Активность за 24 часа</h4><div class="chart">' + bars + '</div>' +
        '<h4 class="sec">Модели</h4>' +
        (s.top_models.length
          ? s.top_models.map(m => '<div class="kv"><span>' + escapeHtml(m.name) + '</span><b>' + m.count + '</b></div>').join('')
          : '<p class="usage-note">—</p>'),
      onOk: () => true,
    });
  }

  async function openAdminChats() {
    let items = [];
    try { items = await api.get('/api/admin/chats?limit=200'); }
    catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
    openModal({
      title: 'Все чаты',
      okText: 'Закрыть',
      body: items.length
        ? '<div class="link-list">' + items.map(c =>
            '<div class="link-row"><div class="link-info"><b>' + escapeHtml(c.title) + '</b>' +
            '<span>' + escapeHtml(c.owner) + ' · ' + c.messages + ' сообщ. · ' +
            fmtNum(c.tokens_in) + '/' + fmtNum(c.tokens_out) + ' ток. · 👍' + c.rating_up +
            ' 👎' + c.rating_down + '</span></div>' +
            '<button class="chip-btn" data-open-chat="' + c.id + '">' + icon('link') + 'Открыть</button>' +
            '</div>').join('') + '</div>'
        : '<p>Чатов нет.</p>',
      onOk: () => true,
    });
    $$('[data-open-chat]').forEach(b => b.addEventListener('click', async () => {
      try {
        const sh = await api.post('/api/admin/chats/' + b.dataset.openChat + '/share');
        window.open('/?share=' + sh.share_token, '_blank');
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));
  }

  async function loadModelSets() {
    try {
      state.modelSets = await api.get('/api/models/sets');
    } catch (e) {
      state.modelSets = [];
    }
    const sel = $('#model-select');
    if (!sel) return;
    const mains = state.modelSets.filter(s => s.route_type === 'MAIN');
    if (!mains.length) { sel.classList.add('hidden'); return; }
    sel.classList.remove('hidden');
    sel.innerHTML = mains.map(s =>
      '<option value="' + s.id + '">' + escapeHtml(s.name) + '</option>').join('');
    if (state.modelSetId && mains.some(s => s.id === state.modelSetId)) {
      sel.value = state.modelSetId;
    } else {
      sel.value = mains[0].id;
      state.modelSetId = mains[0].id;
    }
  }

  // ---------- files ----------
  async function loadFiles() {
    state.files = await api.get('/api/files');
    renderFiles();
  }

  function kindIcon() {
    return icon('file');
  }

  function renderFiles() {
    const box = $('#file-list');
    if (!state.files.length) { box.innerHTML = '<div class="side-empty">Файлов пока нет</div>'; return; }
    box.innerHTML = state.files.map(f =>
      '<div class="file-item">' +
        '<span class="fi-kind">' + kindIcon(f.kind) + '</span>' +
        '<span class="fi-name" title="' + escapeHtml(f.original_name) + '">' + escapeHtml(f.original_name) + '</span>' +
        '<span class="fi-size">' + formatSize(f.size) + '</span>' +
        '<button data-attach="' + f.id + '" title="Прикрепить">' + icon('plus') + '</button>' +
        '<button data-del="' + f.id + '" title="Удалить">' + icon('trash') + '</button>' +
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
    } catch (err) { toast('Ошибка загрузки: ' + err.message, 'error'); }
  }

  function toggleFiles(force) {
    const p = $('#files-panel');
    const show = force === undefined ? p.classList.contains('hidden') : force;
    p.classList.toggle('hidden', !show);
    if (show) loadFiles();
  }

  function bindFiles() {
    $('#files-btn').addEventListener('click', () => toggleFiles(true));
    $('#links-btn').addEventListener('click', openLinks);
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
      catch (err) { toast('Ошибка: ' + err.message, 'error'); }
    });
    const inp = $('input, textarea', root);
    if (inp) { inp.focus(); inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('[data-ok]', root).click(); } }); }
  }

  // ---------- admin: model sets ----------
  function adminForm(root, title, fields, onSubmit, done) {
    root.innerHTML = '<div class="modal-back"><div class="modal"><h3>' + escapeHtml(title) + '</h3>' +
      '<div class="modal-body">' + fields.map(f =>
        '<label>' + escapeHtml(f.label) +
        (f.type === 'select'
          ? '<select id="' + f.id + '">' + f.options.map(o => '<option>' + escapeHtml(o) + '</option>').join('') + '</select>'
          : '<input id="' + f.id + '" type="' + (f.type || 'text') + '"' +
            (f.value !== undefined ? ' value="' + escapeHtml(f.value) + '"' : '') +
            (f.placeholder ? ' placeholder="' + escapeHtml(f.placeholder) + '"' : '') + ' />') +
        '</label>').join('') + '</div>' +
      '<div class="row"><button class="ghost" data-cancel>Отмена</button>' +
      '<button class="solid" data-ok>Сохранить</button></div></div></div>';
    $('[data-cancel]', root).addEventListener('click', done);
    $('[data-ok]', root).addEventListener('click', async () => {
      try { await onSubmit(); done(); } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    });
  }

  async function openModelSetsAdmin() {
    const root = $('#modal-root');

    async function rerender() {
      const sets = await api.get('/api/admin/model-sets');
      const body = sets.length ? sets.map(s =>
        '<div class="ms-set"><div class="ms-head">' +
          '<span class="ms-route">' + escapeHtml(s.route_type) + '</span>' +
          '<b>' + escapeHtml(s.name) + '</b>' +
          '<span class="ms-slug">' + escapeHtml(s.slug) + '</span>' +
          '<span class="spacer" style="flex:1"></span>' +
          '<button data-toggle="' + s.id + '" data-active="' + (s.is_active ? 1 : 0) + '">' +
            (s.is_active ? 'вкл' : 'выкл') + '</button>' +
          '<button data-del-set="' + s.id + '" title="Удалить набор">' + icon('trash') + '</button>' +
        '</div><div class="ms-entries">' +
          (s.entries.length ? s.entries.map(e =>
            '<div class="ms-entry">' +
              '<span class="ms-pos">' + e.position + '</span>' +
              '<span class="ms-model">' + escapeHtml(e.model) + '</span>' +
              '<span class="ms-url" title="' + escapeHtml(e.base_url) + '">' + escapeHtml(e.base_url) + '</span>' +
              '<span class="ms-key">' + (e.has_api_key ? icon('check') : '—') + '</span>' +
              '<button data-del-entry="' + s.id + '|' + e.id + '" title="Удалить">' + icon('trash') + '</button>' +
            '</div>').join('') : '<div class="ms-empty">нет моделей</div>') +
          '<button class="chip-btn" data-add-entry="' + s.id + '">' + icon('plus') + 'модель</button>' +
        '</div></div>').join('') : '<p>Наборов нет.</p>';

      root.innerHTML = '<div class="modal-back"><div class="modal" style="max-width:760px">' +
        '<h3>Model Sets</h3><div class="modal-body" style="max-height:62vh;overflow:auto">' + body + '</div>' +
        '<div class="row"><button class="ghost" data-add-set>' + icon('plus') + 'Набор</button>' +
        '<span style="flex:1"></span><button class="solid" data-close>Закрыть</button></div></div></div>';

      $('[data-close]', root).addEventListener('click', () => { root.innerHTML = ''; });
      $('[data-add-set]', root).addEventListener('click', () => addSetForm(root, rerender));
      $$('[data-del-set]', root).forEach(b => b.addEventListener('click', async () => {
        if (!confirm('Удалить набор и все его модели?')) return;
        await api.del('/api/admin/model-sets/' + b.dataset.delSet); rerender();
      }));
      $$('[data-toggle]', root).forEach(b => b.addEventListener('click', async () => {
        await api.patch('/api/admin/model-sets/' + b.dataset.toggle,
          { is_active: b.dataset.active !== '1' }); rerender();
      }));
      $$('[data-del-entry]', root).forEach(b => b.addEventListener('click', async () => {
        const [sid, eid] = b.dataset.delEntry.split('|');
        await api.del('/api/admin/model-sets/' + sid + '/entries/' + eid); rerender();
      }));
      $$('[data-add-entry]', root).forEach(b =>
        b.addEventListener('click', () => addEntryForm(root, b.dataset.addEntry, rerender)));
    }

    await rerender();
  }

  function addSetForm(root, done) {
    adminForm(root, 'Новый Model Set', [
      { id: 'ms-name', label: 'Название', placeholder: 'Например: Qwen Fast' },
      { id: 'ms-route', label: 'Маршрут', type: 'select', options: ['MAIN', 'TITLE', 'SUGGESTIONS'] },
    ], async () => {
      await api.post('/api/admin/model-sets', {
        name: $('#ms-name').value.trim(),
        route_type: $('#ms-route').value,
      });
    }, done);
  }

  function addEntryForm(root, setId, done) {
    adminForm(root, 'Новая модель (шаг fallback)', [
      { id: 'me-url', label: 'Base URL', placeholder: 'https://…/v1' },
      { id: 'me-model', label: 'Модель', placeholder: 'qwen36-35b' },
      { id: 'me-key', label: 'API-ключ', placeholder: 'sk-…' },
      { id: 'me-pos', label: 'Позиция', type: 'number', value: '0' },
      { id: 'me-temp', label: 'Temperature', type: 'number', value: '0.2' },
      { id: 'me-max', label: 'Max tokens', type: 'number', value: '32000' },
    ], async () => {
      await api.post('/api/admin/model-sets/' + setId + '/entries', {
        base_url: $('#me-url').value.trim(),
        model: $('#me-model').value.trim(),
        api_key: $('#me-key').value,
        position: parseInt($('#me-pos').value, 10) || 0,
        temperature: parseFloat($('#me-temp').value) || 0.2,
        max_tokens: parseInt($('#me-max').value, 10) || 32000,
      });
    }, done);
  }

  // ---------- sidebar ----------
  function applySidebar() {
    const sb = $('#sidebar');
    const collapsed = state.sidebarCollapsed && window.innerWidth > 860;
    sb.classList.toggle('collapsed', collapsed);
    const openBtn = $('#sidebar-open-btn');
    if (openBtn) openBtn.classList.toggle('hidden', !collapsed);
  }
  function closeMobileSidebar() {
    if (window.innerWidth <= 860) {
      $('#sidebar').classList.remove('open');
      $('#sidebar-overlay').classList.remove('show');
    }
  }
  function bindSidebar() {
    $('#new-chat-btn').addEventListener('click', newChat);
    $('#collapse-btn').addEventListener('click', () => {
      state.sidebarCollapsed = true;
      localStorage.setItem('cs_sidebar', '1');
      applySidebar();
    });
    $('#sidebar-open-btn').addEventListener('click', () => {
      state.sidebarCollapsed = false;
      localStorage.setItem('cs_sidebar', '0');
      applySidebar();
    });
    $('#share-btn').addEventListener('click', openShare);
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
      const isAdmin = !!(state.user && state.user.is_admin);
      openModal({
        title: 'Настройки', okText: 'Закрыть',
        body: '<p>Тема: тёплая светлая (Claude-like); тёмная — автоматически по системе.</p>' +
              '<p>Поиск в интернете: всегда включён (SearXNG).</p>' +
              '<p>Усилие модели: ' + escapeHtml(state.effort) + '.</p>' +
              (isAdmin
                ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
                  '<button class="chip-btn" id="open-ms">' + icon('settings') + 'Model Sets</button>' +
                  '<button class="chip-btn" id="open-stats">' + icon('chart') + 'Статистика</button>' +
                  '<button class="chip-btn" id="open-allchats">' + icon('file') + 'Все чаты</button>' +
                  '</div>'
                : '<p>Model Sets и статистику видит администратор.</p>'),
        onOk: () => true,
      });
      const b = $('#open-ms');
      if (b) b.addEventListener('click', () => { $('#modal-root').innerHTML = ''; openModelSetsAdmin(); });
      const st = $('#open-stats');
      if (st) st.addEventListener('click', () => { $('#modal-root').innerHTML = ''; openAdminStats(); });
      const ac = $('#open-allchats');
      if (ac) ac.addEventListener('click', () => { $('#modal-root').innerHTML = ''; openAdminChats(); });
    });
    window.addEventListener('resize', () => {
      applySidebar();
      $('#menu-btn').style.display = window.innerWidth <= 860 ? 'grid' : 'none';
    });
  }

  // ---------- share / public ----------
  async function openShare() {
    if (!state.currentChatId) { toast('Сначала откройте чат', 'error'); return; }
    let st;
    try { st = await api.get('/api/chats/' + state.currentChatId + '/share'); }
    catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }

    const url = st.share_token ? (location.origin + '/?share=' + st.share_token) : '';
    openModal({
      title: 'Поделиться чатом',
      okText: 'Закрыть',
      body: st.is_public
        ? '<p>Чат открыт по ссылке — доступ только на чтение.</p>' +
          '<input id="share-url" readonly value="' + escapeHtml(url) + '" />' +
          '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="chip-btn" id="copy-link">' + icon('copy') + 'Копировать</button>' +
          '<button class="chip-btn" id="open-link">' + icon('link') + 'Открыть</button>' +
          '<button class="chip-btn" id="stop-share">' + icon('x') + 'Отключить</button></div>'
        : '<p>Создать публичную ссылку на этот чат? Доступ будет только на чтение.</p>' +
          '<div style="margin-top:12px"><button class="chip-btn" id="start-share">' +
          icon('link') + 'Создать ссылку</button></div>',
      onOk: () => true,
    });

    const start = $('#start-share');
    if (start) start.addEventListener('click', async () => {
      try { await api.post('/api/chats/' + state.currentChatId + '/share'); }
      catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
      $('#modal-root').innerHTML = ''; openShare();
    });
    const copy = $('#copy-link');
    if (copy) copy.addEventListener('click', async () => {
      const ok = await copyText(url);
      toast(ok ? 'Ссылка скопирована' : 'Не удалось скопировать', ok ? '' : 'error');
    });
    const open = $('#open-link');
    if (open) open.addEventListener('click', () => window.open(url, '_blank'));
    const stop = $('#stop-share');
    if (stop) stop.addEventListener('click', async () => {
      try { await api.del('/api/chats/' + state.currentChatId + '/share'); }
      catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
      $('#modal-root').innerHTML = ''; openShare();
    });
  }

  async function currentUserOrNull() {
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  async function showPublicView(token) {
    let data;
    try {
      const r = await fetch('/api/public/chats/' + encodeURIComponent(token),
        { credentials: 'same-origin' });
      if (!r.ok) {
        throw new Error(r.status === 404 ? 'ссылка недействительна или отключена' : 'HTTP ' + r.status);
      }
      data = await r.json();
    } catch (e) {
      showAuth();
      $('#auth-error').textContent = 'Не удалось открыть ссылку: ' + e.message;
      return;
    }

    state.user = await currentUserOrNull();
    state.publicToken = token;
    state.readonly = true;
    state.tree = data.messages || [];
    state.currentChatId = null;
    state.choices = {};

    $('#auth-screen').classList.add('hidden');
    $('#main-screen').classList.remove('hidden');
    $('#sidebar').classList.add('collapsed');
    $('#chat-title').textContent = data.title || 'Публичный чат';
    $('#composer').classList.add('hidden');
    $('#share-btn').classList.add('hidden');

    const banner = document.createElement('div');
    banner.className = 'public-banner';
    banner.innerHTML = '<span>' + icon('link') + ' Публичный чат' +
      (data.author ? ' · ' + escapeHtml(data.author) : '') + ' — только чтение</span>' +
      (state.user
        ? '<button id="fork-btn">Продолжить у себя</button>'
        : '<button id="login-btn">Войти, чтобы продолжить</button>');
    $('#chat-area').insertBefore(banner, $('#messages'));

    const fb = $('#fork-btn');
    if (fb) fb.addEventListener('click', async () => {
      try {
        await api.post('/api/public/chats/' + encodeURIComponent(token) + '/fork');
        location.href = '/';
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    });
    const lb = $('#login-btn');
    if (lb) lb.addEventListener('click', () => { location.href = '/'; });

    renderMessages();
  }

  // ---------- boot ----------
  async function boot() {
    showApp();
    applySidebar();
    $('#menu-btn').style.display = window.innerWidth <= 860 ? 'grid' : 'none';
    await loadChats();
    await loadFiles();
    await loadModelSets();
    await loadUsage();
    renderMessages();
  }

  async function init() {
    bindAuth(); bindSidebar(); bindComposer(); bindFiles();
    const token = new URLSearchParams(location.search).get('share');
    if (token) { await showPublicView(token); return; }
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
