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
  let _mathStore = [];
  const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g;

  function inlineFmt(s) {
    s = escapeHtml(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // restore raw math last so markdown does not mangle it
    s = s.replace(/\u0001M(\d+)\u0001/g, (m, i) => _mathStore[+i] || '');
    return s;
  }

  function renderMath(root) {
    if (!root || !window.renderMathInElement) return;
    try {
      window.renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option'],
      });
    } catch (e) { /* katex optional */ }
  }

  function tailText(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? '…' + s.slice(-n) : s;
  }

  // --- drawing skill: ```draw {json} -> inline SVG ---
  function shapeSvg(s) {
    if (!s || !s.type) return '';
    const a = [];
    const push = (k, v) => { if (v !== undefined && v !== null && v !== '') a.push(k + '="' + v + '"'); };
    const common = () => {
      push('fill', s.fill);
      push('stroke', s.stroke);
      push('stroke-width', s.width);
      push('opacity', s.opacity);
      if (s.dash) push('stroke-dasharray', typeof s.dash === 'number' ? (s.dash + ' ' + s.dash) : s.dash);
      if (s.rotate) push('transform', 'rotate(' + s.rotate + ' ' + (s.cx || s.x || 0) + ' ' + (s.cy || s.y || 0) + ')');
    };
    const pts = (list) => (list || []).map(p => (p[0] || 0) + ',' + (p[1] || 0)).join(' ');
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
        if (s.dash) push('stroke-dasharray', typeof s.dash === 'number' ? (s.dash + ' ' + s.dash) : s.dash);
        push('opacity', s.opacity);
        return '<line ' + a.join(' ') + '/>';
      case 'arrow':
        return arrowSvg(s);
      case 'arc': {
        const cx = s.cx || 0, cy = s.cy || 0, r = s.r || 0;
        const a0 = (Number(s.start) || 0) * Math.PI / 180;
        const a1 = (Number(s.end) || 180) * Math.PI / 180;
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        const large = Math.abs((Number(s.end) || 0) - (Number(s.start) || 0)) > 180 ? 1 : 0;
        push('d', 'M ' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A ' + r + ' ' + r + ' 0 ' +
          large + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2));
        push('fill', s.fill || 'none');
        push('stroke', s.stroke || '#c96442');
        push('stroke-width', s.width || 2);
        push('opacity', s.opacity);
        if (s.dash) push('stroke-dasharray', typeof s.dash === 'number' ? (s.dash + ' ' + s.dash) : s.dash);
        return '<path ' + a.join(' ') + '/>';
      }
      case 'star': {
        const cx = s.cx || 0, cy = s.cy || 0, R = s.r || 20;
        const n = Math.max(3, Math.min(24, Number(s.points) || 5));
        const r2 = R * 0.45;
        const out = [];
        for (let k = 0; k < n * 2; k++) {
          const ang = (Math.PI / n) * k - Math.PI / 2;
          const rad = k % 2 === 0 ? R : r2;
          out.push([(cx + rad * Math.cos(ang)).toFixed(2), (cy + rad * Math.sin(ang)).toFixed(2)]);
        }
        push('points', out.map(p => p[0] + ',' + p[1]).join(' '));
        if (s.fill == null) push('fill', '#f2c14e');
        common();
        return '<polygon ' + a.join(' ') + '/>';
      }
      case 'dim': {
        // blueprint dimension line: extension ticks + arrows + centred label
        const x1 = Number(s.x1) || 0, y1 = Number(s.y1) || 0;
        const x2 = Number(s.x2) || 0, y2 = Number(s.y2) || 0;
        const stroke = s.stroke || '#1f1e1d';
        const w = s.width || 1.4;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const tick = 6;
        const vertical = Math.abs(y2 - y1) > Math.abs(x2 - x1);
        const t1 = vertical
          ? '<line x1="' + (x1 - tick) + '" y1="' + y1 + '" x2="' + (x1 + tick) + '" y2="' + y1 + '" stroke="' + stroke + '" stroke-width="' + w + '"/>'
          : '<line x1="' + x1 + '" y1="' + (y1 - tick) + '" x2="' + x1 + '" y2="' + (y1 + tick) + '" stroke="' + stroke + '" stroke-width="' + w + '"/>';
        const t2 = vertical
          ? '<line x1="' + (x2 - tick) + '" y1="' + y2 + '" x2="' + (x2 + tick) + '" y2="' + y2 + '" stroke="' + stroke + '" stroke-width="' + w + '"/>'
          : '<line x1="' + x2 + '" y1="' + (y2 - tick) + '" x2="' + x2 + '" y2="' + (y2 + tick) + '" stroke="' + stroke + '" stroke-width="' + w + '"/>';
        return '<g>' + t1 + t2 +
          arrowSvg({ x1: x1, y1: y1, x2: x2, y2: y2, stroke: stroke, width: w, both: true }) +
          (s.text ? '<text x="' + mx + '" y="' + (my - 6) + '" font-size="' + (s.size || 12) +
            '" fill="' + stroke + '" text-anchor="middle">' + escapeHtml(s.text) + '</text>' : '') +
          '</g>';
      }
      case 'polyline':
      case 'polygon': {
        push('points', pts(s.points));
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
        if (s.dash) push('stroke-dasharray', typeof s.dash === 'number' ? (s.dash + ' ' + s.dash) : s.dash);
        return '<path ' + a.join(' ') + '/>';
      case 'text':
        push('x', s.x || 0); push('y', s.y || 0);
        push('font-size', s.size || 16);
        push('fill', s.fill || '#1f1e1d');
        push('opacity', s.opacity);
        if (s.anchor) push('text-anchor', s.anchor);
        if (s.weight) push('font-weight', s.weight);
        if (s.rotate) push('transform', 'rotate(' + s.rotate + ' ' + (s.x || 0) + ' ' + (s.y || 0) + ')');
        return '<text ' + a.join(' ') + '>' + escapeHtml(s.text || '') + '</text>';
      default:
        return '';
    }
  }

  function arrowSvg(s) {
    const x1 = Number(s.x1) || 0, y1 = Number(s.y1) || 0;
    let x2 = Number(s.x2) || 0, y2 = Number(s.y2) || 0;
    const stroke = s.stroke || '#2f6fb0';
    const w = Number(s.width) || 2;
    const head = Math.max(6, w * 3.2);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const tipX = x2, tipY = y2;
    const bx = x2 - head * Math.cos(ang), by = y2 - head * Math.sin(ang);
    const spread = 0.42;
    const p1x = bx + (head * 0.55) * Math.cos(ang + Math.PI / 2 + spread);
    const p1y = by + (head * 0.55) * Math.sin(ang + Math.PI / 2 + spread);
    const p2x = bx + (head * 0.55) * Math.cos(ang - Math.PI / 2 - spread);
    const p2y = by + (head * 0.55) * Math.sin(ang - Math.PI / 2 - spread);
    const line = '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + bx.toFixed(2) + '" y2="' + by.toFixed(2) +
      '" stroke="' + stroke + '" stroke-width="' + w + '"' +
      (s.dash ? ' stroke-dasharray="' + (typeof s.dash === 'number' ? s.dash + ' ' + s.dash : s.dash) + '"' : '') +
      (s.opacity != null ? ' opacity="' + s.opacity + '"' : '') + '/>';
    const headEl = '<polygon points="' + tipX + ',' + tipY + ' ' + p1x.toFixed(2) + ',' + p1y.toFixed(2) +
      ' ' + p2x.toFixed(2) + ',' + p2y.toFixed(2) + '" fill="' + stroke + '"/>';
    if (!s.both) return '<g>' + line + headEl + '</g>';
    const ang2 = ang + Math.PI;
    const bx2 = x1 + head * Math.cos(ang2), by2 = y1 + head * Math.sin(ang2);
    const forward = ang;
    const q1x = bx2 + (head * 0.55) * Math.cos(forward + Math.PI / 2 + spread);
    const q1y = by2 + (head * 0.55) * Math.sin(forward + Math.PI / 2 + spread);
    const q2x = bx2 + (head * 0.55) * Math.cos(forward - Math.PI / 2 - spread);
    const q2y = by2 + (head * 0.55) * Math.sin(forward - Math.PI / 2 - spread);
    const headEl2 = '<polygon points="' + x1 + ',' + y1 + ' ' + q1x.toFixed(2) + ',' + q1y.toFixed(2) +
      ' ' + q2x.toFixed(2) + ',' + q2y.toFixed(2) + '" fill="' + stroke + '"/>';
    return '<g>' + line + headEl + headEl2 + '</g>';
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
    window.__codeStore[id] = { lang: lang || '', code: code };
    return '<div class="code-block"><div class="code-head"><span>' +
      escapeHtml(lang || 'code') + '</span><span class="code-acts">' +
      '<button data-copy="' + id + '">' + icon('copy') + 'Копировать</button>' +
      '<button data-dl="' + id + '" title="Скачать">' + icon('download') + '</button>' +
      '</span></div><pre><code>' + escapeHtml(code) + '</code></pre></div>';
  }

  function renderMarkdown(src) {
    if (!src) return '';
    const codes = [];
    _mathStore = [];
    let text = String(src).replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      const i = codes.length;
      codes.push({ lang: (lang || '').trim(), code: code.replace(/\s+$/, '') });
      return '\u0000C' + i + '\u0000';
    });
    // pull math out before markdown mangles it (KaTeX renders it later)
    text = text.replace(MATH_RE, (m) => {
      const i = _mathStore.length;
      _mathStore.push(m);
      return '\u0001M' + i + '\u0001';
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
        const tid = 'tbl_' + Math.random().toString(36).slice(2);
        window.__tableStore = window.__tableStore || {};
        window.__tableStore[tid] = [head].concat(body);
        out.push('<div class="table-wrap" data-tbl="' + tid + '">' +
          '<button class="tbl-dl" data-dl-table="' + tid + '" title="Скачать таблицу">' +
          icon('download') + '</button>' +
          '<table><thead><tr>' +
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
    effort: localStorage.getItem('cs_effort') || 'recommended',
    usage: null,
    draftTail: null,
    memories: [],
    style: localStorage.getItem('cs_style') || 'auto',
    readonly: false,
    publicToken: null,
    greetTimer: null,
    greetIdx: Math.floor(Math.random() * 100),
    suggIdx: Math.floor(Math.random() * 50),
    sidebarCollapsed: localStorage.getItem('cs_sidebar') === '1',
  };

  const EFFORTS = ['recommended', 'low', 'medium', 'high', 'extra', 'max'];
  const EFFORT_LABELS = ['Recommended', 'Low', 'Medium', 'High', 'Extra', 'Max'];

  const TARIFFS = [
    { name: 'Free', ctx: 10, out: 20, files: 5, note: 'знакомство и лёгкие задачи' },
    { name: 'Plus', ctx: 30, out: 45, files: 25, note: 'ежедневная работа' },
    { name: 'Pro', ctx: 60, out: 70, files: 100, note: 'длинные диалоги и файлы' },
    { name: 'Max', ctx: 85, out: 90, files: 500, note: 'максимум контекста' },
  ];

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
        '<span class="chat-meta">' +
          (c.mode === 'code' ? '<em class="mode-tag">код</em>' : '') +
          (c.mode === 'council' ? '<em class="mode-tag">совет</em>' : '') +
          (c.bundle_id && c.mode !== 'council' ? '<em class="bundle-tag">совет</em>' : '') +
          (c.model_name ? '<em class="model-tag">' + escapeHtml(c.model_name) + '</em>' : '') +
        '</span>' +
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

  async function newChat(mode) {
    const chat = await api.post('/api/chats', {
      title: mode === 'code' ? 'Код-проект' : 'Новый чат',
      mode: mode || 'chat',
    });
    state.chats.unshift(chat);
    renderChatList();
    await openChat(chat.id);
    $('#input').focus();
    if (mode === 'code') {
      toast('Код-агент: файлы проекта сохраняются между сообщениями');
    }
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
    const meta = state.chats.find(c => c.id === id) || {};
    const isCode = meta.mode === 'code';
    $('#project-btn').classList.toggle('hidden', !isCode);
    if (isCode) { toggleProjectPanel(true); } else { toggleProjectPanel(false); }
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
    return '<span class="think-anim">' + '<span></span>'.repeat(7) +
      '<i class="core"></i></span>';
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
        if (n.sources && n.sources.length) {
          parts.push('<button data-mact="sources" data-id="' + n.id + '" title="Источники из интернета">' +
            icon('globe') + 'Источники <b class="cnt">' + n.sources.length + '</b></button>');
        }
        if (n.content) {
          parts.push('<button data-mact="rate-up" data-id="' + n.id + '" class="rate' +
            (n.rating > 0 ? ' on' : '') + '" title="Хороший ответ">' + icon('thumb-up') + '</button>');
          parts.push('<button data-mact="rate-down" data-id="' + n.id + '" class="rate' +
            (n.rating < 0 ? ' on' : '') + '" title="Плохой ответ">' + icon('thumb-down') + '</button>');
          parts.push('<button data-mact="copy" data-id="' + n.id + '">' + icon('copy') + 'Копировать</button>');
          parts.push('<button data-mact="save" data-id="' + n.id + '" title="Сохранить как">' + icon('download') + 'Сохранить</button>');
          if (n.memories && n.memories.length) {
            parts.push('<button data-mact="memory" data-id="' + n.id + '" title="Что записано в память">' +
              icon('sparkle') + 'Память</button>');
          }
          parts.push('<button data-mact="delete" data-id="' + n.id + '" title="Удалить ответ">' + icon('trash') + '</button>');
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

    let memLine = '';
    if (!isUser && n.memories && n.memories.length && !generating) {
      memLine = '<div class="mem-line" data-memline="' + n.id + '">' + icon('sparkle') +
        '<span>Запомнил: ' + escapeHtml(n.memories.join('; ').slice(0, 140)) + '</span></div>';
    }

    let tools = '';
    if (!isUser && n.tool_runs && n.tool_runs.length) {
      tools = n.tool_runs.map((r, i) => toolRunHtml(r, i)).join('');
    }

    let routeLine = '';
    if (!isUser && n.route) {
      routeLine = '<div class="route-line">' + icon('sparkle') +
        '<span>Auto → <b>' + escapeHtml(n.route) + '</b></span></div>';
    }

    return '<div class="msg ' + n.role + '" data-mid="' + n.id + '">' +
      '<div class="role">' + (isUser ? 'Вы' : 'ChatStudio') + '</div>' +
      routeLine + tools + inner + branch + meta + sugg + memLine + '</div>';
  }

  function toolRunHtml(r, i) {
    const files = (r.files || []).map(f => {
      const url = '/api/files/' + f.file_id + '/download';
      if (f.kind === 'image') {
        return '<a class="tool-file img" href="' + url + '" target="_blank" rel="noopener">' +
          '<img src="' + url + '?inline=1" alt="' + escapeHtml(f.name) + '" loading="lazy" /></a>';
      }
      return '<a class="tool-file" href="' + url + '" target="_blank" rel="noopener">' +
        icon('download') + '<span>' + escapeHtml(f.name) + '</span>' +
        '<em>' + formatSize(f.size) + '</em></a>';
    }).join('');
    return '<div class="tool-box' + (r.ok ? '' : ' err') + '">' +
      '<div class="tool-head">' + icon('terminal') +
      '<span>Шаг ' + (i + 1) + ' — код выполнен' + (r.ok ? '' : ' с ошибкой') + '</span>' +
      (r.timed_out ? '<em class="warn">таймаут</em>' : '') + '</div>' +
      '<pre class="tool-code">' + escapeHtml(r.code || '') + '</pre>' +
      (r.stdout ? '<pre class="tool-out">' + escapeHtml(r.stdout) + '</pre>' : '') +
      (r.stderr ? '<pre class="tool-err">' + escapeHtml(r.stderr) + '</pre>' : '') +
      (files ? '<div class="tool-files">' + files + '</div>' : '') +
      '</div>';
  }

  function openSources(list) {
    openModal({
      title: 'Источники',
      okText: 'Закрыть',
      body: '<div class="src-list">' + list.map((s, i) =>
        '<a class="src-row" href="' + escapeHtml(s.url || '#') + '" target="_blank" rel="noopener">' +
        '<b>[' + (i + 1) + '] ' + escapeHtml(s.title || s.url || '') + '</b>' +
        (s.snippet ? '<span>' + escapeHtml(String(s.snippet).slice(0, 200)) + '</span>' : '') +
        '<em>' + escapeHtml(s.url || '') + '</em></a>').join('') + '</div>',
      onOk: () => true,
    });
  }

  function renderEmptyState() {
    const box = $('#messages');
    box.innerHTML =
      '<div class="empty-state">' +
        '<h2 class="greet" id="greet-text">' +
          escapeHtml(GREETINGS[state.greetIdx % GREETINGS.length]) + '</h2>' +
        '<p>Задайте вопрос, прикрепите файл или включите поиск в интернете.</p>' +
        '<div class="chips" id="sugg-chips"></div>' +
        '<div id="empty-showcase" class="showcase"></div>' +
      '</div>';
    renderSuggestionChips();
    startRotation();
    startShowcase();
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
    stopShowcase();
    box.innerHTML = '<div class="msg-wrap">' +
      path.map((e, i) => msgHtml(e, i === path.length - 1)).join('') + '</div>';
    bindMessageEvents();
    renderMath(box.querySelector('.msg-wrap'));
    scrollToBottom();
  }

  function bindMessageEvents() {
    $$('.mem-line').forEach(el => el.addEventListener('click', () => openMemory(el.dataset.memline)));

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
      else if (act === 'delete') { await deleteMessage(id); }
      else if (act === 'save') {
        const n = findNode(state.tree, id);
        if (n) {
          const el = $('.msg[data-mid="' + id + '"] .content');
          openSaveMenu({
            title: (state.chats.find(c => c.id === state.currentChatId) || {}).title || 'ChatStudio',
            text: n.content || '',
            html: el ? el.innerHTML : '',
          });
        }
      } else if (act === 'memory') { await openMemory(id); }
      else if (act === 'sources') {
        const n = findNode(state.tree, id);
        if (n) openSources(n.sources || []);
      }
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

    $$('[data-copy]').forEach(b => b.addEventListener('click', () => {
      const rec = (window.__codeStore || {})[b.dataset.copy];
      copyWithFeedback(b, rec ? rec.code : '');
    }));

    $$('[data-dl]').forEach(b => b.addEventListener('click', () => {
      const rec = (window.__codeStore || {})[b.dataset.dl];
      if (rec) openSaveMenu({ title: 'Код', text: rec.code, lang: rec.lang, svg: false });
    }));

    $$('[data-dl-table]').forEach(b => b.addEventListener('click', () => {
      const rows = (window.__tableStore || {})[b.dataset.dlTable];
      if (!rows) return;
      openTableMenu(rows);
    }));

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

  function bindStreamRefs() {
    const el = state.activeAssistantId
      ? $('.msg[data-mid="' + state.activeAssistantId + '"]')
      : null;
    state.streamEl = el ? $('.content', el) : null;
    state.thinkBody = el ? $('.think-tail', el) : null;
    state.draftTail = el ? $('.think-tail.answer', el) : null;
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

  function removeFromTree(nodes, id) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) { nodes.splice(i, 1); return true; }
      if (removeFromTree(nodes[i].children || [], id)) return true;
    }
    return false;
  }

  async function deleteMessage(id) {
    const n = findNode(state.tree, id);
    const many = n && n.children && n.children.length;
    if (!confirm(many ? 'Удалить этот ответ и все вложенные сообщения?' : 'Удалить это сообщение?')) return;
    try {
      await api.del('/api/messages/' + id);
      removeFromTree(state.tree, id);
      renderMessages();
      loadUsage();
      toast('Удалено');
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
            bindStreamRefs();
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
        } else if (ev === 'memory') {
          const n = findNode(state.tree, state.activeAssistantId);
          if (n) n.memories = (n.memories || []).concat(data.items || []);
          loadMemory();
        } else if (ev === 'route') {
          const n = findNode(state.tree, state.activeAssistantId);
          if (n) n.route = data.name;
          renderMessages();
          bindStreamRefs();
          toast('Auto: запрос направлен в «' + (data.name || '') + '»');
        } else if (ev === 'tool') {
          const n = findNode(state.tree, state.activeAssistantId);
          if (n) {
            n.tool_runs = (n.tool_runs || []).concat([data]);
            if (data.files && data.files.length) {
              n.attachments = (n.attachments || []).concat(data.files.map(f => ({
                id: f.id, file_id: f.file_id, name: f.name, kind: f.kind, size: f.size,
              })));
            }
          }
          renderMessages();
          bindStreamRefs();
          if (data.stdout) appendLog('▸ ' + String(data.stdout).trim().slice(0, 4000));
          if (data.stderr) appendLog('! ' + String(data.stderr).trim().slice(0, 2000));
          if (data.files && data.files.length) {
            appendLog('✓ файлы: ' + data.files.map(f => f.name).join(', '));
          }
          loadProject(false);
        } else if (ev === 'step') {
          state.streamBuf = '';
          const n = findNode(state.tree, state.activeAssistantId);
          if (n) n.draft = '';
          renderMessages();
          bindStreamRefs();
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
    // continue the ACTIVE branch: the last message of the visible path
    const path = activePath(state.tree, state.choices);
    const parentId = path.length ? path[path.length - 1].node.id : null;
    input.value = ''; autoGrow();
    state.pendingAttachments = []; renderAttachments();
    await streamRequest('/api/chats/' + state.currentChatId + '/messages',
      {
        content,
        parent_message_id: parentId,
        attachment_ids: attachments,
        model_set_id: state.modelSetId || null,
        web_search: true,
        effort: state.effort,
        style: state.style,
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
      if (idx < 0) idx = 0;
      state.effort = EFFORTS[idx];
      er.value = String(idx);
      $('#effort-label').textContent = EFFORT_LABELS[idx];
      if (save) localStorage.setItem('cs_effort', state.effort);
    };
    er.addEventListener('input', () => applyEffort(EFFORTS[parseInt(er.value, 10)] || 'recommended', true));
    applyEffort(state.effort, false);
    const sel = $('#style-select');
    sel.value = state.style;
    sel.addEventListener('change', () => {
      state.style = sel.value;
      localStorage.setItem('cs_style', state.style);
    });
    $('#context-btn').addEventListener('click', openContextMenu);
    $('#project-btn').addEventListener('click', () => toggleProjectPanel());
    $('#pp-close').addEventListener('click', () => toggleProjectPanel(false));
    $('#pp-refresh').addEventListener('click', () => loadProject(true));
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

  function limitsHtml(plan) {
    const mine = String(plan || '').toLowerCase();
    return '<h4 class="sec">Лимиты по тарифам (в % от окна модели)</h4>' +
      '<div class="tariffs">' + TARIFFS.map(t => {
        const isMine = t.name.toLowerCase() === mine;
        return '<div class="tariff' + (isMine ? ' me' : '') + '">' +
          '<div class="tariff-head"><b>' + t.name + '</b>' +
          (isMine ? '<span class="badge">ваш тариф</span>' : '') + '</div>' +
          '<div class="tariff-row"><span>Контекст</span><i><b style="width:' + t.ctx + '%"></b></i><u>' + t.ctx + '%</u></div>' +
          '<div class="tariff-row"><span>Ответ</span><i><b style="width:' + t.out + '%"></b></i><u>' + t.out + '%</u></div>' +
          '<div class="tariff-note">' + t.note + ' · файлов: ' + t.files + '</div>' +
          '</div>';
      }).join('') + '</div>';
  }

  async function openContextMenu() {
    if (!state.currentChatId) { toast('Сначала откройте чат', 'error'); return; }
    let u;
    try { u = await api.get('/api/chats/' + state.currentChatId + '/usage'); }
    catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
    state.usage = u;
    const barW = Math.min(100, Math.max(0, u.percent || 0));
    openModal({
      title: 'Контекст и проценты',
      okText: 'Закрыть',
      body: '<h4 class="sec">Контекст и проценты</h4>' +
        usageCards(u) +
        '<div class="usage-bar"><i style="width:' + barW + '%"></i></div>' +
        '<p class="usage-note">Окно модели — ' + fmtNum(u.context_len) + ' токенов. ' +
        'Резюме истории: ' + (u.summary_chars ? fmtNum(u.summary_chars) + ' симв.' : 'нет') + '. ' +
        'Усилие: ' + escapeHtml(u.effort || 'recommended') + '.</p>' +
        '<label style="margin-top:14px">Сжать историю до <b id="cmp-val">50</b>%</label>' +
        '<input type="range" id="cmp-range" class="orange-range" min="5" max="85" step="5" value="50" />' +
        '<p class="usage-note">Сжатие делает та же модель: старое сворачивается в краткое резюме.</p>' +
        '<div style="margin-top:10px"><button class="chip-btn" id="cmp-go">' +
        icon('sparkle') + 'Сжать историю</button></div>' +
        limitsHtml(state.user && state.user.plan),
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
      '<option value="' + s.id + '">' + (s.is_router ? '🔀 ' : '') +
      escapeHtml(s.name) + '</option>').join('');
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
    $('#models-btn').addEventListener('click', openModelStats);
    $('#wall-btn').addEventListener('click', openWall);
    $('#publish-btn').addEventListener('click', publishCurrentChat);
    $('#mem-quick-btn').addEventListener('click', () => openMemory());
    $('#memory-btn').addEventListener('click', () => openMemory());
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
  function closeModal() {
    $('#modal-root').innerHTML = '';
  }

  function openModal({ title, body, onOk, okText }) {
    const root = $('#modal-root');
    const infoOnly = (okText || '') === 'Закрыть';
    root.innerHTML = '<div class="modal-back"><div class="modal' + (infoOnly ? ' wide' : '') +
      '"><h3>' + escapeHtml(title) + '</h3>' +
      '<div class="modal-body">' + body + '</div>' +
      '<div class="row">' +
      (infoOnly ? '' : '<button class="ghost" data-cancel>Отмена</button>') +
      '<button class="solid" data-ok>' + escapeHtml(okText || 'Сохранить') + '</button></div></div></div>';
    const back = $('.modal-back', root);
    const close = () => { root.innerHTML = ''; };
    const cancel = $('[data-cancel]', root);
    if (cancel) cancel.addEventListener('click', close);
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
    $('#new-chat-btn').addEventListener('click', () => newChat('chat'));
    $('#new-code-btn').addEventListener('click', () => newChat('code'));
    $('#new-council-btn').addEventListener('click', openCouncil);
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
    $('#settings-btn').addEventListener('click', () => {
      const u = state.user || {};
      const isAdmin = !!u.is_admin;
      const who = u.name || u.email || 'Аккаунт';
      openModal({
        title: 'Настройки и профиль',
        okText: 'Закрыть',
        body:
          '<div class="profile-box">' +
          '<img class="profile-ava" src="/api/avatars/' + (u.avatar || 0) + '.svg" alt="" />' +
          '<div class="profile-info"><b>' + escapeHtml(who) + '</b>' +
          '<span>' + escapeHtml(u.email || '') + '</span>' +
          '<span class="role-chip">' + (isAdmin ? 'администратор' : 'пользователь') + '</span></div>' +
          '</div>' +
          '<h4 class="sec">Параметры</h4>' +
          '<p class="usage-note">Поиск в интернете: всегда включён · Усилие: ' +
          escapeHtml(state.effort) + ' · Память: ' +
          ((state.memories || []).length) + ' записей<br/>' +
          'Тема: тёплая светлая (Claude-like); тёмная — автоматически по системе.</p>' +
          '<h4 class="sec">Разделы</h4>' +
          '<div class="settings-grid">' +
          '<button class="chip-btn" id="set-models">' + icon('chart') + 'Модели и статус</button>' +
          '<button class="chip-btn" id="set-wall">' + icon('globe-box') + 'Стенка постов</button>' +
          '<button class="chip-btn" id="set-memory">' + icon('sparkle') + 'Память</button>' +
          '<button class="chip-btn" id="set-links">' + icon('link') + 'Мои ссылки</button>' +
          '<button class="chip-btn" id="set-files">' + icon('folder') + 'Файлы</button>' +
          (isAdmin
            ? '<button class="chip-btn" id="open-ms">' + icon('settings') + 'Model Sets</button>' +
              '<button class="chip-btn" id="open-stats">' + icon('chart') + 'Статистика</button>' +
              '<button class="chip-btn" id="open-allchats">' + icon('file') + 'Все чаты</button>'
            : '') +
          '</div>' +
          '<div style="margin-top:18px"><button class="chip-btn danger" id="set-logout">' +
          icon('logout') + 'Выйти из аккаунта</button></div>',
        onOk: () => true,
      });
      const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
      on('#set-models', () => { closeModal(); openModelStats(); });
      on('#set-wall', () => { closeModal(); openWall(); });
      on('#set-memory', () => { closeModal(); openMemory(); });
      on('#set-links', () => { closeModal(); openLinks(); });
      on('#set-files', () => { closeModal(); toggleFiles(true); });
      on('#open-ms', () => { closeModal(); openModelSetsAdmin(); });
      on('#open-stats', () => { closeModal(); openAdminStats(); });
      on('#open-allchats', () => { closeModal(); openAdminChats(); });
      on('#set-logout', async () => {
        try { await api.post('/api/auth/logout'); } catch (e) { /* noop */ }
        location.reload();
      });
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

  // ---------- local file generation ----------
  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 600);
  }

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zipStore(entries) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const dt = new Date();
    const dosTime = ((dt.getHours() << 11) | (dt.getMinutes() << 5) | Math.floor(dt.getSeconds() / 2)) & 0xFFFF;
    const dosDate = (((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate()) & 0xFFFF;
    entries.forEach((e) => {
      const nameBytes = enc.encode(e.name);
      const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
      const crc = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true); lv.setUint16(6, 0, true); lv.setUint16(8, 0, true);
      lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      parts.push(local, data);

      const cen = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
      cen.set(nameBytes, 46);
      central.push(cen);
      offset += local.length + data.length;
    });
    const centralSize = central.reduce((a, b) => a + b.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  }

  function xmlEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function textToDocx(text) {
    const paras = String(text || '').split(/\r?\n/).map((line) =>
      '<w:p><w:r><w:t xml:space="preserve">' + xmlEsc(line) + '</w:t></w:r></w:p>').join('');
    const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' + paras + '<w:sectPr/></w:body></w:document>';
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';
    return zipStore([
      { name: '[Content_Types].xml', data: ct },
      { name: '_rels/.rels', data: rels },
      { name: 'word/document.xml', data: doc },
    ]);
  }

  function colName(i) {
    let s = '';
    i += 1;
    while (i > 0) {
      const m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function rowsToXlsx(rows) {
    const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      rows.map((r, i) => '<row r="' + (i + 1) + '">' + r.map((c, j) =>
        '<c r="' + colName(j) + (i + 1) + '" t="inlineStr"><is><t xml:space="preserve">' +
        xmlEsc(c) + '</t></is></c>').join('') + '</row>').join('') +
      '</sheetData></worksheet>';
    const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';
    const wbrels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '</Relationships>';
    const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
    return zipStore([
      { name: '[Content_Types].xml', data: ct },
      { name: '_rels/.rels', data: rels },
      { name: 'xl/workbook.xml', data: wb },
      { name: 'xl/_rels/workbook.xml.rels', data: wbrels },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
    ]);
  }

  function rowsToOds(rows) {
    const content = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<office:document-content ' +
      'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
      'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
      'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2">' +
      '<office:body><office:spreadsheet><table:table table:name="Sheet1">' +
      rows.map((r) => '<table:table-row>' + r.map((c) =>
        '<table:table-cell office:value-type="string"><text:p>' + xmlEsc(c) +
        '</text:p></table:table-cell>').join('') + '</table:table-row>').join('') +
      '</table:table></office:spreadsheet></office:body></office:document-content>';
    const manifest = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
      '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>' +
      '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
      '</manifest:manifest>';
    return zipStore([
      { name: 'mimetype', data: 'application/vnd.oasis.opendocument.spreadsheet' },
      { name: 'content.xml', data: content },
      { name: 'META-INF/manifest.xml', data: manifest },
    ]);
  }

  function printPdf(title, html) {
    const w = window.open('', '_blank');
    if (!w) { toast('Разрешите всплывающие окна для PDF', 'error'); return; }
    w.document.write('<html><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>' +
      '<style>body{font-family:system-ui,-apple-system,sans-serif;line-height:1.6;padding:34px;' +
      'max-width:820px;margin:0 auto;color:#1f1e1d}pre{background:#f4f2ec;padding:12px;border-radius:8px;' +
      'overflow-x:auto;white-space:pre-wrap}code{font-family:ui-monospace,Menlo,monospace;font-size:13px}' +
      'table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 10px;text-align:left}' +
      'h1,h2,h3{margin-top:1.2em}blockquote{border-left:3px solid #ddd;margin:0;padding:2px 14px;color:#666}' +
      '</style></head><body>' + html + '</body></html>');
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* noop */ } }, 500);
  }

  function openSaveMenu(p) {
    const base = (p.title || 'chatstudio').replace(/[^\wа-яА-ЯёЁ\- ]+/g, '').trim().slice(0, 40) || 'chatstudio';
    const items = [
      { id: 'txt', label: 'TXT', hint: 'обычный текст' },
      { id: 'md', label: 'Markdown', hint: '.md' },
      { id: 'docx', label: 'DOCX', hint: 'Word' },
      { id: 'pdf', label: 'PDF', hint: 'через печать' },
    ];
    if (p.svg) items.push({ id: 'svg', label: 'SVG', hint: 'вектор' });
    openModal({
      title: 'Сохранить как',
      okText: 'Закрыть',
      body: '<div class="fmt-grid">' + items.map((it) =>
        '<button class="fmt-btn" data-fmt="' + it.id + '"><b>' + it.label + '</b><span>' +
        it.hint + '</span></button>').join('') + '</div>',
      onOk: () => true,
    });
    $$('[data-fmt]').forEach(b => b.addEventListener('click', () => {
      const f = b.dataset.fmt;
      const text = p.text || '';
      try {
        if (f === 'txt') downloadBlob(base + '.txt', new Blob([text], { type: 'text/plain;charset=utf-8' }));
        else if (f === 'md') downloadBlob(base + '.md', new Blob([text], { type: 'text/markdown;charset=utf-8' }));
        else if (f === 'docx') downloadBlob(base + '.docx', textToDocx(text));
        else if (f === 'pdf') printPdf(p.title || 'ChatStudio', p.html || ('<pre>' + escapeHtml(text) + '</pre>'));
        else if (f === 'svg' && p.svg) downloadBlob(base + '.svg', new Blob([p.svg], { type: 'image/svg+xml' }));
        $('#modal-root').innerHTML = '';
        toast('Файл сохранён');
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));
  }

  function openTableMenu(rows) {
    openModal({
      title: 'Скачать таблицу',
      okText: 'Закрыть',
      body: '<div class="fmt-grid">' +
        '<button class="fmt-btn" data-tf="xlsx"><b>XLSX</b><span>Excel</span></button>' +
        '<button class="fmt-btn" data-tf="ods"><b>ODS</b><span>LibreOffice</span></button>' +
        '<button class="fmt-btn" data-tf="csv"><b>CSV</b><span>текст</span></button>' +
        '<button class="fmt-btn" data-tf="pdf"><b>PDF</b><span>печать</span></button>' +
        '</div>',
      onOk: () => true,
    });
    $$('[data-tf]').forEach(b => b.addEventListener('click', () => {
      const f = b.dataset.tf;
      try {
        if (f === 'xlsx') downloadBlob('table.xlsx', rowsToXlsx(rows));
        else if (f === 'ods') downloadBlob('table.ods', rowsToOds(rows));
        else if (f === 'csv') downloadBlob('table.csv', new Blob(
          [rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n')],
          { type: 'text/csv;charset=utf-8' }));
        else if (f === 'pdf') printPdf('Таблица', '<table><tbody>' +
          rows.map(r => '<tr>' + r.map(c => '<td>' + escapeHtml(c) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>');
        $('#modal-root').innerHTML = '';
        toast('Файл сохранён');
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));
  }

  // ---------- memory ----------
  async function loadMemory() {
    try {
      const items = await api.get('/api/memory');
      state.memories = items;
      const counts = document.querySelectorAll('.mem-count');
      counts.forEach((el) => { el.textContent = items.length ? String(items.length) : ''; });
    } catch (e) { state.memories = []; }
  }

  async function openMemory(filterMessageId) {
    let items = [];
    try { items = await api.get('/api/memory'); } catch (e) { items = []; }
    if (filterMessageId) items = items.filter(m => m.message_id === filterMessageId);
    openModal({
      title: filterMessageId ? 'Что запомнил по этому ответу' : 'Память о вас',
      okText: 'Закрыть',
      body: (items.length
        ? '<div class="mem-list">' + items.map(m =>
            '<div class="mem-row"><span>' + escapeHtml(m.content) + '</span>' +
            '<button data-del-mem="' + m.id + '" title="Удалить из памяти">' + icon('trash') + '</button></div>').join('') +
          '</div>'
        : '<p>Пока ничего не записано.</p>') +
        '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="chip-btn" id="mem-add">' + icon('plus') + 'Добавить</button>' +
        (items.length && !filterMessageId
          ? '<button class="chip-btn" id="mem-clear">' + icon('trash') + 'Очистить всё</button>' : '') +
        '</div>',
      onOk: () => true,
    });
    $$('[data-del-mem]').forEach(b => b.addEventListener('click', async () => {
      try {
        await api.del('/api/memory/' + b.dataset.delMem);
        $('#modal-root').innerHTML = '';
        await loadMemory();
        openMemory(filterMessageId);
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));
    const add = $('#mem-add');
    if (add) add.addEventListener('click', () => {
      openModal({
        title: 'Добавить в память',
        body: '<textarea id="mem-text" rows="4" placeholder="Что запомнить о вас?"></textarea>',
        onOk: async (root) => {
          const val = $('#mem-text', root).value.trim();
          if (!val) return false;
          await api.post('/api/memory', { content: val });
          await loadMemory();
          $('#modal-root').innerHTML = '';
          openMemory();
          toast('Записано в память');
          return true;
        },
      });
    });
    const clr = $('#mem-clear');
    if (clr) clr.addEventListener('click', async () => {
      if (!confirm('Очистить всю память о вас?')) return;
      try {
        await api.del('/api/memory');
        await loadMemory();
        $('#modal-root').innerHTML = '';
        openMemory();
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    });
  }

  async function openCouncil() {
    let models = [];
    try { models = await api.get('/api/council/models'); } catch (e) { models = []; }
    if (models.length < 2) {
      toast('Совет недоступен', 'error');
      return;
    }
    openModal({
      title: 'Совет моделей · бета',
      okText: 'Запустить',
      body: '<p class="usage-note">Вопрос уйдёт всем участникам параллельно. ' +
        'Каждый ответ сохранится отдельным чатом (они связаны группой «совет»), ' +
        'а в этом чате появится объединённый ответ.</p>' +
        '<textarea id="council-q" rows="3" placeholder="Ваш вопрос для совета..."></textarea>' +
        '<div class="council-models">' + models.map((m, i) =>
          '<label class="council-row"><input type="checkbox" data-ms="' + m.id + '"' +
          (i < 3 ? ' checked' : '') + '/><span><b>' + escapeHtml(m.name) + '</b>' +
          (m.hint ? '<em>' + escapeHtml(m.hint) + '</em>' : '') + '</span></label>').join('') +
        '</div>',
      onOk: async (root) => {
        const q = ($('#council-q', root) || {}).value ? $('#council-q', root).value.trim() : '';
        if (!q) { toast('Введите вопрос', 'error'); return false; }
        const ids = $$('[data-ms]', root).filter(c => c.checked).map(c => c.dataset.ms);
        if (ids.length < 1) { toast('Выберите хотя бы одного участника', 'error'); return false; }
        try {
          const res = await api.post('/api/council', { question: q, personas: ids });
          await loadChats();
          await openChat(res.merge_chat_id);
          toast('Совет запущен: ' + ids.length + ' участников');
          return true;
        } catch (e) {
          toast('Ошибка: ' + e.message, 'error');
          return false;
        }
      },
    });
  }

  async function openMemory(filterMessageId) {
    let items = [];
    try { items = await api.get('/api/memory'); } catch (e) { items = []; }
    if (filterMessageId) items = items.filter(m => m.message_id === filterMessageId);
    const facts = items.filter(m => (m.kind || 'fact') === 'fact');
    const prefs = items.filter(m => m.kind === 'preference');
    const row = (m) => '<div class="mem-row"><span>' + escapeHtml(m.content) + '</span>' +
      '<button data-del-mem="' + m.id + '" title="Удалить из памяти">' + icon('trash') + '</button></div>';

    openModal({
      title: filterMessageId ? 'Что записано по этому ответу' : 'Память о вас',
      okText: 'Закрыть',
      body:
        '<h4 class="sec">Предпочтения · уходят в каждый запрос</h4>' +
        (prefs.length
          ? '<div class="mem-list">' + prefs.map(row).join('') + '</div>'
          : '<p class="usage-note">Пока нет. Например: «отвечай кратко», «всегда с примерами кода».</p>') +
        '<div style="margin:8px 0 16px"><button class="chip-btn" id="mem-add-pref">' +
        icon('plus') + 'Добавить предпочтение</button></div>' +
        '<h4 class="sec">Факты</h4>' +
        (facts.length
          ? '<div class="mem-list">' + facts.map(row).join('') + '</div>'
          : '<p class="usage-note">Пока пусто.</p>') +
        '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="chip-btn" id="mem-add">' + icon('plus') + 'Добавить факт</button>' +
        (items.length && !filterMessageId
          ? '<button class="chip-btn" id="mem-clear">' + icon('trash') + 'Очистить всё</button>' : '') +
        '</div>',
      onOk: () => true,
    });

    $$('[data-del-mem]').forEach(b => b.addEventListener('click', async () => {
      try {
        await api.del('/api/memory/' + b.dataset.delMem);
        $('#modal-root').innerHTML = '';
        await loadMemory();
        openMemory(filterMessageId);
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));

    const addFor = (kind, title) => {
      openModal({
        title,
        okText: 'Сохранить',
        body: '<textarea id="mem-text" rows="3" placeholder="' +
          (kind === 'preference' ? 'Например: отвечай кратко и по делу' : 'Например: меня зовут Тимур') +
          '"></textarea>',
        onOk: async (root) => {
          const val = ($('#mem-text', root) || {}).value ? $('#mem-text', root).value.trim() : '';
          if (!val) return false;
          await api.post('/api/memory', { content: val, kind });
          await loadMemory();
          $('#modal-root').innerHTML = '';
          openMemory();
          toast(kind === 'preference' ? 'Предпочтение сохранено' : 'Факт сохранён');
          return true;
        },
      });
    };
    const addF = $('#mem-add');
    if (addF) addF.addEventListener('click', () => addFor('fact', 'Добавить факт'));
    const addP = $('#mem-add-pref');
    if (addP) addP.addEventListener('click', () => addFor('preference', 'Добавить предпочтение'));

    const clr = $('#mem-clear');
    if (clr) clr.addEventListener('click', async () => {
      if (!confirm('Очистить всю память о вас?')) return;
      try {
        await api.del('/api/memory');
        await loadMemory();
        $('#modal-root').innerHTML = '';
        openMemory();
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    });
  }

  // ---------- models & status ----------
  async function openModelStats() {
    let stats = [];
    try { stats = await api.get('/api/models/stats'); } catch (e) { stats = []; }
    const card = (s) => {
      const total = (s.rating_up + s.rating_down) || 0;
      const good = total ? Math.round((s.rating_up / total) * 100) : 0;
      return '<div class="model-card">' +
        '<div class="mc-head"><b>' + escapeHtml(s.name) + '</b>' +
        '<em class="route">' + escapeHtml(s.route_type) + '</em></div>' +
        '<div class="mc-model">' + escapeHtml(s.model || '—') + '</div>' +
        '<div class="mc-bar"><i style="width:' + Math.min(100, s.share) + '%"></i></div>' +
        '<div class="mc-rows">' +
        '<span>Доля запросов: <b>' + s.share + '%</b></span>' +
        '<span>Запросов: <b>' + s.messages + '</b></span>' +
        '<span>Вход: <b>' + fmtNum(s.tokens_in) + '</b></span>' +
        '<span>Выход: <b>' + fmtNum(s.tokens_out) + '</b></span>' +
        '<span>Из кэша: <b>' + fmtNum(s.tokens_cached) + '</b></span>' +
        '<span>Оценки: 👍 <b>' + s.rating_up + '</b> · 👎 <b>' + s.rating_down + '</b></span>' +
        '<span>Входов: <b>' + s.active_entries + '/' + s.entries + '</b></span>' +
        '</div>' +
        (total ? '<div class="mc-good">Довольных ответами: <b>' + good + '%</b></div>' : '') +
        '</div>';
    };
    openModal({
      title: 'Модели и статус',
      okText: 'Закрыть',
      body: '<p class="usage-note">Общая статистика по всем моделям — доступна всем пользователям.</p>' +
        (stats.length ? '<div class="model-grid">' + stats.map(card).join('') + '</div>'
                      : '<p>Моделей пока нет.</p>'),
      onOk: () => true,
    });
  }

  // ---------- wall of posts ----------
  function postCard(p, compact) {
    const img = p.image_file_id
      ? '<img class="post-img" src="/api/files/' + p.image_file_id + '/download?inline=1" alt="" loading="lazy" />'
      : '';
    return '<div class="post-card" data-post="' + p.id + '">' +
      img +
      '<div class="post-body">' +
      '<div class="post-head"><b>' + escapeHtml(p.title || 'Пост') + '</b>' +
      '<em>' + escapeHtml(p.author || '') + ' · ' + timeAgo(p.created_at) + '</em></div>' +
      '<p class="post-preview">' + escapeHtml((p.preview || '').slice(0, compact ? 180 : 420)) + '</p>' +
      '<div class="post-foot">' +
      '<button class="pv" data-vote="1" data-id="' + p.id + '"' + (p.my_vote > 0 ? ' class="on"' : '') + '>👍 <b>' + p.likes + '</b></button>' +
      '<button class="pv" data-vote="-1" data-id="' + p.id + '"' + (p.my_vote < 0 ? ' class="on"' : '') + '>👎 <b>' + p.dislikes + '</b></button>' +
      '<span class="pv-ro">💬 <b>' + p.comments + '</b></span>' +
      '<span class="pv-ro">👁 <b>' + p.views + '</b></span>' +
      '<span class="pv-ro" data-open-post="' + p.id + '">Открыть</span>' +
      (p.can_delete ? '<button class="pv del" data-del-post="' + p.id + '">Удалить</button>' : '') +
      '</div></div></div>';
  }

  function bindPostCards(root) {
    $$('[data-vote]', root).forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = b.dataset.id;
      const value = parseInt(b.dataset.vote, 10);
      const cards = $$('.post-card[data-post="' + id + '"]');
      const cur = cards[0] && cards[0].querySelector('.pv.on[data-vote]');
      const next = cur && parseInt(cur.dataset.vote, 10) === value ? 0 : value;
      try {
        const upd = await api.post('/api/posts/' + id + '/vote', { value: next });
        cards.forEach(card => card.outerHTML = postCard(upd, card.classList.contains('compact')));
        bindPostCards(root);
      } catch (err) { toast('Ошибка: ' + err.message, 'error'); }
    }));
    $$('[data-open-post]', root).forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      openPost(b.dataset.openPost);
    }));
    $$('[data-del-post]', root).forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Удалить пост со стенки?')) return;
      try {
        await api.del('/api/posts/' + b.dataset.delPost);
        toast('Пост удалён');
        closeModal();
        openWall();
      } catch (err) { toast('Ошибка: ' + err.message, 'error'); }
    }));
  }

  async function openWall() {
    let items = [];
    try { items = await api.get('/api/posts?limit=60'); } catch (e) { items = []; }
    openModal({
      title: 'Стенка постов',
      okText: 'Закрыть',
      body: '<div class="wall-top">' +
        '<span class="usage-note">Публичные ответы. Лайки, дизлайки и комментарии — для авторизованных.</span>' +
        '<button class="chip-btn" id="wall-publish">' + icon('share') + 'Опубликовать чат</button>' +
        '</div>' +
        (items.length ? '<div class="wall-grid">' + items.map(p => postCard(p, true)).join('') + '</div>'
                      : '<p>Пока постов нет. Открой чат и нажми «Опубликовать».</p>'),
      onOk: () => true,
    });
    bindPostCards($('#modal-root'));
    const pub = $('#wall-publish');
    if (pub) pub.addEventListener('click', () => publishCurrentChat());
  }

  async function openPost(id) {
    let p;
    try { p = await api.get('/api/posts/' + id); }
    catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
    if (!p.chat_id) {
      toast('Чат недоступен', 'error');
      return;
    }
    // viewing a post counts a view and opens the full chat read-only
    api.post('/api/posts/' + id + '/view').catch(() => {});
    const chat = await api.get('/api/chats/' + p.chat_id).catch(() => null);
    const token = chat && chat.share_token;
    if (!token) { toast('Ссылка недоступна', 'error'); return; }
    window.open('/?share=' + token, '_blank');
  }

  async function publishCurrentChat() {
    if (!state.currentChatId) { toast('Сначала откройте чат', 'error'); return; }
    const chat = state.chats.find(c => c.id === state.currentChatId) || {};
    openModal({
      title: 'Опубликовать на стенке',
      okText: 'Опубликовать',
      body: '<p class="usage-note">Чат станет публичным (ссылка только для чтения), ' +
        'а его последний ответ появится на стенке с превью.</p>' +
        '<input id="post-title" value="' + escapeHtml(chat.title || 'Пост') + '" placeholder="Заголовок" />',
      onOk: async (root) => {
        const title = ($('#post-title', root) || {}).value ? $('#post-title', root).value.trim() : '';
        try {
          await api.post('/api/posts', { chat_id: state.currentChatId, title });
          await loadWallCount();
          toast('Опубликовано на стенке');
          return true;
        } catch (e) { toast('Ошибка: ' + e.message, 'error'); return false; }
      },
    });
  }

  async function loadWallCount() {
    try {
      const items = await api.get('/api/posts?limit=100');
      const btn = $('#wall-btn');
      const badge = btn && btn.querySelector('.wall-count');
      if (badge) badge.textContent = items.length ? String(items.length) : '';
    } catch (e) { /* noop */ }
  }

  // ---------- main page showcase (rotates every ~4s) ----------
  let showcaseTimer = null;

  async function startShowcase() {
    stopShowcase();
    let post = null, stats = [];
    try { post = await api.get('/api/posts/top'); } catch (e) { post = null; }
    try { stats = await api.get('/api/models/stats'); } catch (e) { stats = []; }
    const top = stats[0] || null;
    let flip = false;
    const paint = () => {
      const box = $('#empty-showcase');
      if (!box) { stopShowcase(); return; }
      if (flip && post) {
        box.innerHTML = '<div class="show-label">Топ-пост стенки</div>' +
          '<div class="wall-grid">' + postCard(Object.assign({}, post, { can_delete: false }), true) + '</div>';
        bindPostCards(box);
      } else if (top) {
        const total = (top.rating_up + top.rating_down) || 0;
        const good = total ? Math.round((top.rating_up / total) * 100) : 0;
        box.innerHTML = '<div class="show-label">Модель дня</div>' +
          '<div class="model-card compact"><div class="mc-head"><b>' + escapeHtml(top.name) + '</b>' +
          '<em class="route">' + escapeHtml(top.route_type) + '</em></div>' +
          '<div class="mc-model">' + escapeHtml(top.model || '—') + '</div>' +
          '<div class="mc-bar"><i style="width:' + Math.min(100, top.share) + '%"></i></div>' +
          '<div class="mc-rows"><span>Запросов: <b>' + top.messages + '</b></span>' +
          '<span>Вход/выход: <b>' + fmtNum(top.tokens_in) + ' / ' + fmtNum(top.tokens_out) + '</b></span>' +
          '<span>Оценки: 👍 <b>' + top.rating_up + '</b> · 👎 <b>' + top.rating_down + '</b></span>' +
          (total ? '<span>Довольных: <b>' + good + '%</b></span>' : '') +
          '</div></div>';
      } else {
        box.innerHTML = '';
      }
      flip = !flip;
    };
    paint();
    if (post || top) showcaseTimer = setInterval(paint, 4000);
  }

  function stopShowcase() {
    if (showcaseTimer) { clearInterval(showcaseTimer); showcaseTimer = null; }
  }

  // ---------- code-agent project panel ----------
  function toggleProjectPanel(show) {
    const panel = $('#project-panel');
    if (!panel) return;
    const visible = show === undefined ? panel.classList.contains('hidden') : !!show;
    panel.classList.toggle('hidden', !visible);
    if (visible) loadProject(true);
  }

  async function loadProject(resetLogs) {
    if (!state.currentChatId) return;
    try {
      const data = await api.get('/api/chats/' + state.currentChatId + '/project');
      const files = data.files || [];
      const tree = $('#pp-tree');
      tree.innerHTML = files.length
        ? files.map(f =>
            '<div class="pp-file" title="' + escapeHtml(f.path) + '">' + icon('file') +
            '<span>' + escapeHtml(f.path) + '</span><em>' + formatSize(f.size) + '</em></div>').join('')
        : '<div class="pp-empty">Файлов пока нет — попроси агента создать проект.</div>';
      if (resetLogs) $('#pp-logs').textContent = '';
    } catch (e) { /* noop */ }
  }

  function appendLog(text) {
    const box = $('#pp-logs');
    if (!box || !text) return;
    box.textContent = (box.textContent + '\n' + text).slice(-20000);
    box.scrollTop = box.scrollHeight;
  }

  // ---------- boot ----------
  async function boot() {
    showApp();
    applySidebar();
    $('#menu-btn').style.display = window.innerWidth <= 860 ? 'grid' : 'none';
    await loadChats();
    await loadFiles();
    await loadModelSets();
    await loadMemory();
    await loadWallCount();
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

  // KaTeX loads with defer: re-render math once it is available
  window.addEventListener('load', () => {
    const box = document.getElementById('messages');
    if (box) renderMath(box.querySelector('.msg-wrap'));
  });
})();
