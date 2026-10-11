/* ai-ch — SPA (vanilla JS) */
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
  const FULL_RENDER_LIMIT = 30000;
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
    const isHtml = ['html', 'htm'].indexOf((lang || '').toLowerCase()) >= 0;
    const preview = isHtml
      ? '<div class="html-preview"><div class="hp-bar">' + icon('globe') +
        '<span>Живое превью</span></div>' +
        '<iframe sandbox="allow-scripts allow-forms" loading="lazy" srcdoc="' +
        escapeHtml(code) + '"></iframe></div>'
      : '';
    return '<div class="code-block"><div class="code-head"><span>' +
      escapeHtml(lang || 'code') + '</span><span class="code-acts">' +
      '<button data-copy="' + id + '">' + icon('copy') + 'Копировать</button>' +
      '<button data-dl="' + id + '" title="Скачать">' + icon('download') + '</button>' +
      '</span></div>' + preview + '<pre><code>' + escapeHtml(code) + '</code></pre></div>';
  }

  function renderMarkdown(src) {
    if (!src) return '';
    const codes = [];
    _mathStore = [];
    let text = String(src);
    // models sometimes forget to close a code fence — close it for them,
    // otherwise the whole message turns into one broken block
    if (((text.match(/```/g) || []).length) % 2 === 1) text += '\n```';
    text = text.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
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
    csrf() { return window.__csrf || getCookie('ai-ch_csrf') || ''; },
    async req(method, path, body, isForm) {
      const headers = {};
      if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
      if (method !== 'GET') headers['X-CSRF-Token'] = api.csrf();
      const maxRetries = 2;
      let lastErr;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let res;
        try {
          res = await fetch(path, {
            method, headers, credentials: 'same-origin', signal: AbortSignal.timeout(30000),
            body: isForm ? body : (body !== undefined ? JSON.stringify(body) : undefined),
          });
          console.log('API:', method, path, res.status, res.statusText);
          if (res.status === 401) { showAuth(); throw new Error('unauthorized'); }
          if (res.status === 204) return null;
          if (!res.ok) {
            let msg = res.status + '';
            try { const j = await res.json(); msg = j.detail || JSON.stringify(j); } catch (e) { /* noop */ }
            throw new Error(msg);
          }
          return res.json();
        } catch (e) {
          console.warn('API request failed (attempt ' + (attempt+1) + '):', method, path, e.message);
          lastErr = e;
          // Retry on network errors, timeouts, and 5xx
          const isRetryable = e.name === 'TimeoutError'
            || e.message.includes('Failed to fetch')
            || e.code === 'FETCH_ERROR'
            || (res && res.status >= 500);
          if (!isRetryable || attempt >= maxRetries) throw e;
          // Exponential backoff: 500ms, 1000ms
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
      }
      throw lastErr;
    },
    get(p) { return api.req('GET', p); },
    post(p, b) { return api.req('POST', p, b === undefined ? {} : b); },
    postForm(p, fd) { return api.req('POST', p, fd, true); },
    patch(p, b) { return api.req('PATCH', p, b); },
    put(p, b) { return api.req('PUT', p, b === undefined ? {} : b); },
    del(p) { return api.req('DELETE', p); },
  };

  // ---------- state ----------
  const state = {
    user: null,
    limits: null,
    planSettings: {},
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
    effort: localStorage.getItem('cs_effort') || 'medium',
    draftTail: null,
    memories: [],
    style: localStorage.getItem('cs_style') || 'auto',
    temperature: parseFloat(localStorage.getItem('cs_temp')) || 0.2,
    readonly: false,
    publicToken: null,
    sidebarCollapsed: localStorage.getItem('cs_sidebar') === '1',
  };

  const EFFORTS = ['low', 'medium', 'high', 'extra', 'max'];
  const EFFORT_LABELS = ['Low', 'Medium', 'High', 'Extra', 'Max'];

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

  async function newChat() {
    const chat = await api.post('/api/chats', { title: 'Новый чат' });
    state.chats.unshift(chat);
    renderChatList();
    await openChat(chat.id);
    const input = $('#input');
    if (input) input.focus();
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
      $('#chat-title').textContent = 'ai-ch';
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
    const generating = n.status === 'queued' || n.status === 'processing';
    let inner;
    if (isUser) {
      const hasAtt = n.attachments && n.attachments.length;
      inner = (hasAtt ? attsHtml(n.attachments) : '') +
        '<div class="bubble">' + (n.content ? escapeHtml(n.content) : '(файл)') + '</div>';
    } else {
      const failed = n.status === 'failed';
      const hasThink = !!(n.thinking && String(n.thinking).trim());
      const draft = n.draft || '';

      if (generating) {
        // while generating we only show a few live lines (thinking + answer draft)
        inner = '<div class="think-box">' +
          '<div class="think-head">' + thinkAnim() +
            '<span class="label">' + (hasThink ? 'Размышления' : 'Думает…') + '</span>' +
            '<em class="gen-status" data-gen="1"></em>' +
          '</div>' +
          '<div class="think-tail">' + escapeHtml(tailText(n.thinking, 260)) + '</div>' +
          '<div class="think-tail answer">' + escapeHtml(tailText(n.draft, 900)) + '</div>' +
          '</div>';
      } else if (failed) {
        inner = '<div class="content md" style="color:var(--danger)">Ошибка: ' +
          escapeHtml(n.error || 'генерация не удалась') + '</div>';
      } else {
        const raw = String(n.content || '');
        const truncated = raw.length > FULL_RENDER_LIMIT && !n.showFull;
        const body = truncated ? raw.slice(0, FULL_RENDER_LIMIT) : raw;
        inner = '<div class="content md">' + renderMarkdown(body) + '</div>' +
          (truncated
            ? '<div class="more-note">Показано ' + FULL_RENDER_LIMIT.toLocaleString('ru-RU') +
              ' из ' + raw.length.toLocaleString('ru-RU') + ' символов — ' +
              'чтобы не подвешивать браузер. <button data-mact="expand" data-id="' + n.id +
              '">Показать полностью</button></div>'
            : '');
      }
    }

    let meta = '';
    if (!isUser && !state.readonly) {
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

    let thinkBox = '';
    if (!isUser && !generating && n.status !== 'failed' && n.thinking && String(n.thinking).trim()) {
      thinkBox = '<div class="think-box">' +
        '<div class="think-head">' + thinkAnim() +
          '<span class="label">Размышления</span></div>' +
        '<div class="think-body">' + escapeHtml(n.thinking) + '</div>' +
        '</div>';
    }

    let routeLine = '';
    if (!isUser && n.route) {
      routeLine = '<div class="route-line">' + icon('sparkle') +
        '<span>Auto → <b>' + escapeHtml(n.route) + '</b>' +
        (n.routeBrief ? ' · ' + escapeHtml(n.routeBrief) : '') + '</span></div>';
    }

    let askCard = '';
    if (!isUser && n.ask) {
      askCard = '<div class="ask-card">' +
        '<div class="ask-q">' + icon('sparkle') + '<span>' + escapeHtml(n.ask) + '</span></div>' +
        '<div class="ask-row">' +
        '<input type="text" class="ask-input" placeholder="Ваш ответ…" />' +
        '<button class="chip-btn ask-send">' + icon('arrow-up') + 'Ответить</button>' +
        '</div></div>';
    }

    return '<div class="msg ' + n.role + '" data-mid="' + n.id + '">' +
      '<div class="role">' + (isUser ? 'Вы' : 'ai-ch') + '</div>' +
      routeLine + thinkBox + inner + askCard + branch + meta + sugg + memLine + '</div>';
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
    if (box) box.innerHTML = '';
  }

  function renderMessages() {
    const box = $('#messages');
    const path = activePath(state.tree, state.choices);
    if (!path.length) { renderEmptyState(); return; }

    box.innerHTML = '<div class="msg-wrap">' +
      path.map((e, i) => msgHtml(e, i === path.length - 1)).join('') + '</div>';
    bindMessageEvents();
    renderMath(box.querySelector('.msg-wrap'));
    scrollToBottom();
  }

  function bindMessageEvents() {
    $$('.ask-card').forEach(card => {
      const input = $('.ask-input', card);
      const send = () => {
        const value = (input.value || '').trim();
        if (!value) return;
        $('#input').value = value;
        autoGrow();
        sendCurrent();
      };
      const btn = $('.ask-send', card);
      if (btn) btn.addEventListener('click', send);
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); send(); }
        });
      }
    });

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
            title: (state.chats.find(c => c.id === state.currentChatId) || {}).title || 'ai-ch',
            text: n.content || '',
            html: el ? el.innerHTML : '',
          });
        }
      } else if (act === 'expand') {
        const n = findNode(state.tree, id);
        if (n) { n.showFull = true; renderMessages(); }
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
    state.stickBottom = true;
  }

  function maybeScroll() {
    if (state.stickBottom !== false) scrollToBottom();
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
    updateQuotaControls();
  }

  // ---------- WebSocket streaming with SSE fallback ----------
  let wsConnection = null;

  // Render-compatible streaming uses the session-authenticated HTTP endpoint.
  async function streamWebSocket(path, body) {
    return streamSSE(path, body);
  }

  function streamSSE(path, body) {
    // SSE fallback — uses original consumeSSE
    return new Promise(async (resolve, reject) => {
      try {
        const headers = { 'X-CSRF-Token': api.csrf() };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(path, {
          method: 'POST', headers, credentials: 'same-origin', signal: AbortSignal.timeout(900000),
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        if (res.status === 401) { showAuth(); reject(new Error('unauthorized')); return; }
        if (!res.ok) {
          let msg = res.status + ' ' + res.statusText;
          try { const payload = await res.json(); msg = payload.detail || payload.error || JSON.stringify(payload); }
          catch (e) { try { msg = await res.text(); } catch (_) { /* keep status */ } }
          const failure = new Error(msg); failure.status = res.status; reject(failure); return;
        }
        await consumeSse(res, (ev, data) => {
          state.lastEvent = Date.now();
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
            maybeScroll();
          } else if (ev === 'memory') {
            const n = findNode(state.tree, state.activeAssistantId);
            if (n) n.memories = (n.memories || []).concat(data.items || []);
            loadMemory();
          } else if (ev === 'route') {
            const n = findNode(state.tree, state.activeAssistantId);
            if (n) { n.route = data.name; n.routeBrief = data.brief || ''; }
            renderMessages();
            bindStreamRefs();
            toast('Auto → «' + (data.name || '') + '»' + (data.brief ? ': ' + data.brief : ''));
          } else if (ev === 'step') {
            state.streamBuf = '';
            const n = findNode(state.tree, state.activeAssistantId);
            if (n) { n.draft = ''; n.thinking = ''; }
            state.streamStarted = false;
            renderMessages();
            bindStreamRefs();
          } else if (ev === 'ask') {
            const n = findNode(state.tree, state.activeAssistantId);
            if (n) n.ask = data.question;
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
            if (n && n.role === 'assistant' && !(n.suggestions && n.suggestions.length) && !n.suggestionsLoading) {
              n.suggestionsLoading = true;
              api.post('/api/messages/' + encodeURIComponent(data.message_id) + '/suggestions', {})
                .then(result => {
                  const current = findNode(state.tree, data.message_id);
                  if (!current) return;
                  current.suggestions = result.suggestions || [];
                  current.suggestionsLoading = false;
                  renderMessages();
                })
                .catch(() => {
                  const current = findNode(state.tree, data.message_id);
                  if (current) current.suggestionsLoading = false;
                });
            }

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
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  function handleWsEvent(data) {
    if (data.type === 'delta') {
      state.streamBuf += data.text || '';
      const n = findNode(state.tree, state.activeAssistantId);
      if (n) { n.draft = state.streamBuf; state.streamStarted = true; }
      if (state.draftTail) state.draftTail.textContent = tailText(state.streamBuf, 260);
      maybeScroll();
    } else if (data.type === 'thinking') {
      const n = findNode(state.tree, state.activeAssistantId);
      if (n) n.thinking = (n.thinking || '') + (data.text || '');
      if (state.thinkBody) {
        state.thinkBody.textContent = tailText(n ? n.thinking : '', 260);
        const head = state.thinkBody.parentElement;
        const lbl = head ? head.querySelector('.label') : null;
        if (lbl) lbl.textContent = 'Размышления';
      }
    } else if (data.type === 'done') {
      const n = findNode(state.tree, data.message_id);
      if (n) {
        n.status = 'completed';
        n.content = data.text || state.streamBuf;
        n.draft = '';
      }
      renderMessages();

    } else if (data.type === 'error') {
      const n = findNode(state.tree, data.message_id);
      if (n) { n.status = 'failed'; n.error = data.error; }
      renderMessages();
      toast('Ошибка: ' + data.error, 'error');
    } else if (data.type === 'cancelled') {
      const n = findNode(state.tree, data.message_id);
      if (n) { n.status = 'cancelled'; if (data.text) n.content = data.text; }
      renderMessages();
    } else if (data.type === 'final') {
      // Final update with complete message data
      if (data.data && data.data.id) {
        const existing = findNode(state.tree, data.data.id);
        if (existing) {
          Object.assign(existing, data.data);
          renderMessages();
        }
      }
    }
  }

  async function streamRequest(path, body) {
    if (state.streaming) return;
    setStreaming(true);
    state.streamEl = null; state.thinkBody = null; state.draftTail = null;
    state.streamBuf = ''; state.streamStarted = false; state.activeAssistantId = null;
    state.genStart = Date.now();
    state.lastEvent = Date.now();
    if (state.genTimer) clearInterval(state.genTimer);
    state.genTimer = setInterval(() => {
      const el = $('[data-gen]');
      const secs = Math.round((Date.now() - (state.genStart || Date.now())) / 1000);
      const idle = Math.round((Date.now() - (state.lastEvent || Date.now())) / 1000);
      if (!el) return;
      el.textContent = state.streamBuf.length.toLocaleString('ru-RU') + ' симв. · ' + secs + ' с' +
        (idle > 45 ? ' · модель долго думает…' : '');
      el.classList.toggle('warn', idle > 45);
    }, 1000);
    
    let fetchFailed = false;
    let fetchError = '';
    
    try {
      // Try WebSocket first, fallback to SSE with retry
      await streamWebSocket(path, body);
    } catch (err) {
      fetchFailed = true;
      fetchError = err && err.message ? String(err.message).slice(0, 300) : 'ошибка сети';
      if (err && err.status === 403 && body && body.content) { const draft = $('#input'); if (draft) { draft.value = body.content; autoGrow(); } }
      console.error(err);
      toast('Ошибка: ' + fetchError, 'error');
    } finally {
      setStreaming(false);
      if (state.genTimer) { clearInterval(state.genTimer); state.genTimer = null; }
      // never leave a message stuck in "generating" — that keeps the animation alive
      const stuck = findNode(state.tree, state.activeAssistantId);
      if (stuck && (stuck.status === 'queued' || stuck.status === 'processing')) {
        stuck.status = fetchFailed ? 'failed' : 'cancelled';
        if (fetchFailed && !stuck.error) stuck.error = fetchError || 'генерация прервана';
        renderMessages();
      }
      state.streamEl = null;
      await loadChats();
      await loadLimits();
      // A title is generated after the answer; poll until it is saved or times out.
      if (state.currentChatId) {
        const chatId = state.currentChatId;
        let attempts = 0;
        const refreshTitle = async () => {
          if (state.currentChatId !== chatId) return;
          try {
            const chat = await api.get('/api/chats/' + chatId);
            const i = state.chats.findIndex(c => c.id === chat.id);
            if (i >= 0 && state.chats[i].title !== chat.title) {
              state.chats[i] = chat; renderChatList();
              $('#chat-title').textContent = chat.title;
            }
            if (chat.title === 'Новый чат' && attempts < 12) {
              attempts += 1;
              setTimeout(refreshTitle, 1500);
            }
          } catch (e) {
            if (attempts < 12) { attempts += 1; setTimeout(refreshTitle, 1500); }
          }
        };
        setTimeout(refreshTitle, 1000);
      }
    }
  }

  async function sendCurrent() {
    const input = $('#input');
    const content = input.value.trim();
    if (!content || state.streaming) return;
    if (!state.limits) await loadLimits();
    if (quotaBlocked()) {
      toast('Дневной лимит запросов исчерпан. Обратитесь к администратору ai-ch для сброса счётчика или выдачи подписки.', 'error');
      updateQuotaControls();
      return;
    }
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
        web_search: true,
        effort: state.effort,
        style: state.style,
      });
  }

  // ---------- file upload ----------
  async function uploadFiles(fileList) {
    const fd = new FormData();
    for (const f of fileList) fd.append('files', f);
    try {
      const files = await api.postForm('/api/files', fd);
      // Add to pending attachments and local file list
      state.pendingAttachments = state.pendingAttachments.concat(files.map(f => ({
        id: f.id, original_name: f.original_name, kind: f.kind, size: f.size, mime_type: f.mime_type,
      })));
      state.files = (state.files || []).concat(files);
      renderAttachments();
      if ($('#file-list')) renderFileList();
      toast('Файлы загружены: ' + fileList.length);
    } catch (e) {
      toast('Ошибка загрузки: ' + e.message, 'error');
    }
  }

  // ---------- file list rendering ----------
  function renderFileList() {
    const box = $('#file-list');
    if (!box || !state.files || !state.files.length) {
      if (box) box.innerHTML = '<div class="empty-note">Нет загруженных файлов</div>';
      return;
    }
    const q = ($('#file-search')?.value || '').toLowerCase();
    const typeFilter = ($('#file-filter')?.value || 'all');
    let filtered = state.files;
    if (q) filtered = filtered.filter(f => (f.original_name || '').toLowerCase().includes(q));
    if (typeFilter !== 'all') {
      const typeMap = { image: 'image', doc: 'doc', table: 'sheet', slide: 'slide', other: 'other' };
      const t = typeMap[typeFilter] || typeFilter;
      filtered = filtered.filter(f => f.kind === t);
    }
    box.innerHTML = filtered.map(f =>
      '<a class="msg-att" href="/api/files/' + f.id + '/download" target="_blank" rel="noopener" title="' + escapeHtml(f.original_name) + '">' +
        '<span class="att-icon">' + icon('file') + '</span>' +
        '<span class="att-name">' + escapeHtml(f.original_name) + '</span>' +
        '<span class="att-size">' + formatSize(f.size) + '</span></a>'
    ).join('');
    if (!filtered.length) {
      box.innerHTML = '<div class="empty-note">Ничего не найдено</div>';
    }
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
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrent().catch(err => toast('Ошибка отправки: ' + err.message, 'error')); }
    });
    $('#send-btn').addEventListener('click', () => sendCurrent().catch(err => toast('Ошибка отправки: ' + err.message, 'error')));
    $('#stop-btn').addEventListener('click', async () => {
      if (state.activeAssistantId) await api.post('/api/messages/' + state.activeAssistantId + '/stop');
    });
    $('#attach-btn').addEventListener('click', () => $('#file-input').click());
    const memoryButton = $('#mem-quick-btn');
    if (memoryButton) memoryButton.addEventListener('click', () => openMemory());
    $('#file-input').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length) await uploadFiles(files);
      e.target.value = '';
    });
  }

  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  function quotaBlocked() {
    if (!state.user || state.user.is_admin) return false;
    const usage = (state.limits && state.limits.usage) || {};
    const cap = usage.messages_daily_limit;
    return cap != null && Number(usage.messages_today || 0) >= Number(cap);
  }

  function updateQuotaControls() {
    const blocked = quotaBlocked();
    const send = $('#send-btn');
    if (send) {
      send.disabled = blocked || state.streaming;
      send.title = blocked ? 'Лимит исчерпан. Обратитесь к администратору ai-ch.' : 'Отправить';
    }
    const input = $('#input');
    if (input) input.title = blocked ? 'Дневной лимит исчерпан. Обратитесь к администратору ai-ch.' : '';
  }

  async function loadLimits() {
    try { state.limits = await api.get('/api/limits'); }
    catch (e) { state.limits = null; }
    updateQuotaControls();
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
    const base = (p.title || 'ai-ch').replace(/[^\wа-яА-ЯёЁ\- ]+/g, '').trim().slice(0, 40) || 'ai-ch';
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
        else if (f === 'pdf') printPdf(p.title || 'ai-ch', p.html || ('<pre>' + escapeHtml(text) + '</pre>'));
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

  // ---------- pick from already uploaded files ----------
  async function openFilePicker() {
    if (!state.files || !state.files.length) {
      toast('Сначала загрузите файлы', 'error');
      return;
    }
    const items = state.files.slice(0, 200);
    openModal({
      title: 'Выбрать из загруженных файлов',
      okText: 'Закрыть',
      body: '<div class="link-list">' + items.map(f =>
        '<div class="link-row"><div class="link-info"><b>' + escapeHtml(f.original_name) + '</b>' +
        '<span>' + escapeHtml(f.kind || 'файл') + ' · ' + formatSize(f.size) + '</span></div>' +
        '<button class="chip-btn" data-att="' + f.id + '">' + icon('plus') + 'Прикрепить</button>' +
        '</div>').join('') + '</div>',
      onOk: () => true,
    });
    $$('[data-att]').forEach(b => b.addEventListener('click', () => {
      const f = state.files.find(x => x.id === b.dataset.att);
      if (f && !state.pendingAttachments.some(x => x.id === f.id)) {
        state.pendingAttachments.push(f);
        renderAttachments();
        toast('Прикреплено: ' + f.original_name);
      }
      closeModal();
    }));
  }

  // ---------- load uploaded files list ----------
  async function loadFiles() {
    try {
      state.files = await api.get('/api/files');
      renderFileList();
    } catch (e) {
      state.files = [];
      renderFileList();
    }
  }

  // ---------- bind file search/filter ----------
  function setFilesPanelOpen(open) {
    const panel = $('#files-panel');
    if (!panel) return;
    panel.classList.toggle('hidden', !open);
    const toggle = $('#toggle-files-btn');
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function bindFileControls() {
    const filesToggle = $('#toggle-files-btn');
    if (filesToggle) filesToggle.addEventListener('click', async () => {
      const panel = $('#files-panel');
      const opening = !!panel && panel.classList.contains('hidden');
      setFilesPanelOpen(opening);
      if (opening) await loadFiles();
    });
    const filesClose = $('#close-files-btn');
    if (filesClose) filesClose.addEventListener('click', () => setFilesPanelOpen(false));

    const search = $('#file-search');
    if (search) {
      search.addEventListener('input', () => renderFileList());
    }
    const filter = $('#file-filter');
    if (filter) {
      filter.addEventListener('change', () => renderFileList());
    }
    const uploadBtn = $('#upload-btn');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => $('#file-input').click());
    }
    const pickBtn = $('#pick-file-btn');
    if (pickBtn) {
      pickBtn.addEventListener('click', openFilePicker);
    }
    const dropZone = $('#drop-zone');
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; });
      dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; });
      dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '';
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) await uploadFiles(files);
      });
    }
  }

  // Alias for existing boot call
  function bindFiles() {
    bindFileControls();
  }

  // ---------- server load ----------
  async function openLimits() {
    let data;
    try { data = await api.get('/api/limits/all'); }
    catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
    const labels = data.labels || {};
    state.planSettings = data.limits || {};
    const bytes = { file_size: 1, user_storage: 1 };
    const field = (plan, key, value) => {
      const isBytes = bytes[key];
      const shown = isBytes ? (value == null ? '' : Math.round(value / (1024 * 1024))) : (value == null ? '' : value);
      return '<label class="lim-field"><span>' + escapeHtml(labels[key] || key) +
        (isBytes ? ' <em>МБ</em>' : '') + '</span>' +
        '<input type="number" data-plan="' + plan + '" data-key="' + key + '" value="' +
        escapeHtml(shown) + '" placeholder="∞" /></label>';
    };
    const planBlock = (plan) => {
      const lim = data.limits[plan] || {};
      return '<h4 class="sec">Тариф ' + escapeHtml(plan.toUpperCase()) + '</h4>' +
        '<div class="lim-grid">' + Object.keys(lim).map(k => field(plan, k, lim[k])).join('') + '</div>';
    };
    openModal({
      title: 'Админ-панель · тарифы и пользователи',
      okText: 'Сохранить лимиты',
      body: '<p class="usage-note">Пустое поле — без ограничения. Размеры в мегабайтах, деньги в рублях. '
        + 'Лимит запросов проверяется на сервере до отправки модели. Пользователь после исчерпания увидит сообщение обратиться к администратору.</p>'
        + (data.plans || ['free', 'pro', 'max']).map(planBlock).join('')
        + '<div class="settings-grid" style="margin:12px 0"><button class="chip-btn" id="admin-model-chains">Цепочки моделей и API</button></div>'
        + '<h4 class="sec">Пользователи · подписки и сброс счётчиков</h4><div id="lim-users">Загрузка…</div>',
      onOk: async (root) => {
        const grouped = {};
        $$('[data-plan]', root).forEach(inp => {
          const plan = inp.dataset.plan, key = inp.dataset.key, raw = inp.value.trim();
          let val = raw === '' ? null : Number(raw);
          if (val !== null && bytes[key]) val = Math.round(val * 1024 * 1024);
          grouped[plan] = grouped[plan] || {};
          grouped[plan][key] = val;
        });
        for (const plan of Object.keys(grouped)) {
          await api.put('/api/limits/' + plan, grouped[plan]);
        }
        toast('Лимиты сохранены');
        return true;
      },
    });
    const chains = $('#admin-model-chains');
    if (chains) chains.addEventListener('click', () => {
      $('#modal-root').innerHTML = '';
      openModelChains();
    });
    loadLimitUsers();
  }

  async function loadLimitUsers() {
    const box = $('#lim-users');
    if (!box) return;
    let rows = [];
    try { rows = await api.get('/api/limits/users'); }
    catch (e) { box.textContent = 'Не удалось загрузить пользователей: ' + e.message; return; }
    box.innerHTML = '<div class="link-list">' + rows.map(u => {
      const expiry = u.subscription_until ? new Date(u.subscription_until).toLocaleString('ru-RU') : (u.plan === 'free' ? 'нет подписки' : 'бессрочно');
      const details = 'тариф ' + (u.plan || 'free') + ' · запросов после сброса: ' + u.requests
        + ' · токены: ' + fmtAdminNumber((Number(u.tokens_in) || 0) + (Number(u.tokens_out) || 0))
        + ' · расход: ' + u.cost + ' ₽ · подписка: ' + expiry;
      if (u.is_admin) {
        return '<div class="link-row"><div class="link-info"><b>' + escapeHtml(u.name || u.email) + '</b><span>'
          + escapeHtml(u.email) + ' · администратор · ' + escapeHtml(details) + '</span></div></div>';
      }
      return '<div class="link-row" style="align-items:flex-start"><div class="link-info"><b>'
        + escapeHtml(u.name || u.email) + '</b><span>' + escapeHtml(u.email) + ' · ' + escapeHtml(details) + '</span>'
        + '<div class="settings-grid" style="margin-top:8px">'
        + '<select data-user-plan="' + u.id + '" aria-label="Тариф">'
        + '<option value="free"' + (u.plan === 'free' ? ' selected' : '') + '>Free</option>'
        + '<option value="pro"' + (u.plan === 'pro' ? ' selected' : '') + '>Pro</option>'
        + '<option value="max"' + (u.plan === 'max' ? ' selected' : '') + '>Max</option></select>'
        + '<input type="number" min="1" max="3650" data-user-days="' + u.id + '" value="' + escapeHtml(state.planSettings[u.plan] && state.planSettings[u.plan].subscription_days != null ? state.planSettings[u.plan].subscription_days : '') + '" placeholder="Дней; пусто = навсегда" aria-label="Длительность подписки в днях"/>'
        + '<button class="chip-btn" data-user-save="' + u.id + '">Применить тариф</button>'
        + '<button class="chip-btn" data-user-reset="' + u.id + '">Обнулить счётчики</button>'
        + '</div></div></div>';
    }).join('') + '</div>';

    $('[data-user-plan]', box).forEach(select => select.addEventListener('change', () => {
      const target = $('[data-user-days="' + select.dataset.userPlan + '"]', box);
      const defaultDays = state.planSettings[select.value] ? state.planSettings[select.value].subscription_days : null;
      if (target) target.value = defaultDays == null ? '' : String(defaultDays);
    }));
    $('[data-user-save]', box).forEach(button => button.addEventListener('click', async () => {
      const id = button.dataset.userSave;
      const plan = $('[data-user-plan="' + id + '"]', box).value;
      const rawDays = $('[data-user-days="' + id + '"]', box).value.trim();
      const days = rawDays === '' ? null : Math.max(1, Math.min(3650, Number(rawDays) || 30));
      try {
        await api.put('/api/limits/user/' + id, { plan, days });
        toast(plan === 'free' ? 'Тариф Free установлен' : 'Подписка сохранена');
        await loadLimitUsers();
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));
    $$('[data-user-reset]', box).forEach(button => button.addEventListener('click', async () => {
      try {
        await api.post('/api/limits/user/' + button.dataset.userReset + '/reset');
        toast('Счётчики обнулены');
        await loadLimitUsers();
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));
  }

  function fmtAdminNumber(n) {
    n = Number(n) || 0;
    return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
  }

  async function openModelChains() {
    let all;
    try { all = await api.get('/api/admin/model-sets'); }
    catch (e) { toast('Не удалось загрузить модели: ' + e.message, 'error'); return; }

    const labels = {
      MAIN: 'Основной ответ',
      TITLE: 'Заголовок чата',
      CONTINUE: 'Продолжение ответа',
      SUGGESTIONS: 'Предлагаемые вопросы',
      SUMMARY: 'Сжатие истории / summary',
      FILE_ANALYSIS: 'Анализ файлов'
    };
    const routes = Object.keys(labels);
    const sets = (all || []).filter(s => !s.is_router);
    const routeName = route => labels[route] || route;
    const escapeValue = value => escapeHtml(value == null ? '' : value);

    const entryHtml = (set, entry) => {
      const eid = entry.id;
      const field = (key, value, type, label, extra) =>
        '<label class="lim-field"><span>' + escapeHtml(label) + '</span><input type="' + (type || 'text') +
        '" data-chain-entry="' + eid + '" data-chain-field="' + key + '"' +
        (extra || '') + ' value="' + escapeValue(value) + '"' +
        (key === 'api_key' ? ' placeholder="' + (entry.has_api_key ? 'Ключ сохранён; пустое поле оставит его' : 'API-ключ') + '"' : '') +
        '/></label>';
      return '<div class="model-editor-entry" style="border:1px solid var(--border);border-radius:10px;padding:12px;margin:10px 0">' +
        '<b>Модель / резерв</b><div class="lim-grid" style="margin-top:8px">' +
        field('position', entry.position, 'number', 'Порядок (0 — первый)') +
        field('provider', entry.provider || 'openai', 'text', 'Формат API / provider') +
        field('model', entry.model, 'text', 'Model ID') +
        field('base_url', entry.base_url, 'url', 'Base URL') +
        field('api_key', '', 'password', 'API-ключ') +
        field('context_len', entry.context_len || 0, 'number', 'Контекст, токены (0 — общий)') +
        field('max_tokens', entry.max_tokens, 'number', 'Максимум выходных токенов') +
        field('temperature', entry.temperature, 'number', 'Temperature') +
        field('timeout', entry.timeout, 'number', 'Таймаут, сек') +
        field('free_token_limit', entry.free_token_limit, 'number', 'Лимит токенов Free / окно', ' placeholder="∞"') +
        field('pro_token_limit', entry.pro_token_limit, 'number', 'Лимит токенов Pro/Max / окно', ' placeholder="∞"') +
        field('quota_reset_hours', entry.quota_reset_hours || 6, 'number', 'Сброс квоты, часов') +
        field('max_concurrency', entry.max_concurrency || 1, 'number', 'Макс. одновременных запросов') +
        field('price_in', entry.price_in || 0, 'number', 'Цена input за 1M токенов') +
        field('price_out', entry.price_out || 0, 'number', 'Цена output за 1M токенов') +
        field('price_cache', entry.price_cache || 0, 'number', 'Цена cache за 1M токенов') +
        '<label class="lim-field"><span>Модель включена</span><input type="checkbox" data-chain-entry="' + eid +
        '" data-chain-field="is_active"' + (entry.is_active ? ' checked' : '') + '/></label>' +
        '</div><button class="chip-btn" data-delete-entry="' + eid + '" data-delete-set="' + set.id + '">Удалить из цепочки</button></div>';
    };

    const renderSet = set => {
      const entries = (set.entries || []).slice().sort((a,b) => Number(a.position) - Number(b.position));
      return '<section style="border:1px solid var(--border);border-radius:12px;padding:12px;margin:14px 0">' +
        '<h4 class="sec">' + escapeHtml(routeName(set.route_type)) + '</h4>' +
        '<div class="lim-grid">' +
        '<label class="lim-field"><span>Название цепочки / задачи</span><input data-set-name="' + set.id + '" value="' + escapeValue(set.name) + '"/></label>' +
        '<label class="lim-field"><span>Slug</span><input value="' + escapeValue(set.slug) + '" disabled/></label>' +
        '<label class="lim-field"><span>Цепочка включена</span><input type="checkbox" data-set-active="' + set.id + '"' + (set.is_active ? ' checked' : '') + '/></label>' +
        '</div>' +
        (entries.length ? entries.map(e => entryHtml(set,e)).join('') : '<p class="usage-note">Пока нет моделей. Добавь первую ниже.</p>') +
        '<h5 style="margin:14px 0 6px">Добавить модель в задачу</h5>' +
        '<div class="lim-grid">' +
        '<label class="lim-field"><span>Model ID</span><input data-new-model="' + set.id + '" placeholder="точный model-id провайдера"/></label>' +
        '<label class="lim-field"><span>Base URL</span><input data-new-base="' + set.id + '" type="url" value="' + escapeValue((entries[0] || {}).base_url || '') + '"/></label>' +
        '<label class="lim-field"><span>API-ключ</span><input data-new-key="' + set.id + '" type="password" placeholder="ключ именно этого API"/></label>' +
        '<label class="lim-field"><span>Формат API</span><input data-new-provider="' + set.id + '" value="openai" placeholder="openai"/></label>' +
        '<label class="lim-field"><span>Лимит Free (токены за окно)</span><input data-new-free="' + set.id + '" type="number" placeholder="пусто = без лимита"/></label>' +
        '<label class="lim-field"><span>Лимит Pro/Max (токены за окно)</span><input data-new-pro="' + set.id + '" type="number" placeholder="пусто = без лимита"/></label>' +
        '<label class="lim-field"><span>Окно сброса, часов</span><input data-new-reset="' + set.id + '" type="number" value="6"/></label>' +
        '<label class="lim-field"><span>Параллельность API</span><input data-new-concurrency="' + set.id + '" type="number" value="1"/></label>' +
        '</div><button class="chip-btn" data-add-entry="' + set.id + '">Добавить модель / резерв</button></section>';
    };

    openModal({
      title: 'Модели, задачи и лимиты',
      okText: 'Сохранить настройки',
      body: '<p class="usage-note">Для каждой задачи настрой отдельную цепочку. Порядок 0, 1, 2… означает приоритет резерва: при ошибке или исчерпании квоты сервис перейдёт к следующей модели. Лимиты считаются в токенах за скользящее окно (по умолчанию 6 часов). Пустой лимит означает отсутствие пользовательского ограничения. Вводи реальные Model ID, Base URL и ключи своего API-провайдера.</p>' +
        '<div class="settings-grid" style="margin:12px 0"><label class="lim-field"><span>Новая задача</span><input id="new-task-name" placeholder="например, Анализ кода"/></label>' +
        '<label class="lim-field"><span>Тип задачи</span><select id="new-task-type">' + routes.map(r => '<option value="' + r + '">' + escapeHtml(routeName(r)) + '</option>').join('') + '</select></label>' +
        '<label class="lim-field"><span>Slug (необязательно)</span><input id="new-task-slug" placeholder="auto-generated"/></label>' +
        '<button class="chip-btn" id="create-task-chain">Создать цепочку задачи</button></div>' +
        (routes.map(route => {
          const group = sets.filter(s => s.route_type === route);
          return '<h3 style="margin:18px 0 8px">' + escapeHtml(routeName(route)) + '</h3>' +
            (group.length ? group.map(renderSet).join('') : '<p class="usage-note">Нет цепочек этого типа. Создай выше.</p>');
        }).join('')),
      onOk: async root => {
        const setUpdates = {};
        $$('[data-set-name]', root).forEach(input => {
          setUpdates[input.dataset.setName] = setUpdates[input.dataset.setName] || {};
          setUpdates[input.dataset.setName].name = input.value.trim();
        });
        $$('[data-set-active]', root).forEach(input => {
          setUpdates[input.dataset.setActive] = setUpdates[input.dataset.setActive] || {};
          setUpdates[input.dataset.setActive].is_active = input.checked;
        });
        for (const [id, values] of Object.entries(setUpdates)) {
          if (values.name || values.is_active !== undefined) await api.patch('/api/admin/model-sets/' + id, values);
        }

        const updates = {};
        $$('[data-chain-entry]', root).forEach(input => {
          const id = input.dataset.chainEntry, key = input.dataset.chainField;
          updates[id] = updates[id] || {};
          if (key === 'is_active') { updates[id][key] = input.checked; return; }
          const raw = input.value.trim();
          if (key === 'api_key' && !raw) return;
          if (key === 'free_token_limit' || key === 'pro_token_limit') {
            updates[id][key] = raw === '' ? null : Number(raw);
          } else if (['position','context_len','max_tokens','timeout','quota_reset_hours','max_concurrency'].includes(key)) {
            updates[id][key] = raw === '' ? 0 : Number(raw);
          } else if (['temperature','price_in','price_out','price_cache'].includes(key)) {
            updates[id][key] = raw === '' ? 0 : Number(raw);
          } else updates[id][key] = raw;
        });
        for (const [id, values] of Object.entries(updates)) {
          const parent = sets.find(s => (s.entries || []).some(e => e.id === id));
          if (parent) await api.patch('/api/admin/model-sets/' + parent.id + '/entries/' + id, values);
        }
        toast('Настройки задач, моделей и лимитов сохранены');
        return true;
      },
    });

    const create = $('#create-task-chain');
    if (create) create.addEventListener('click', async () => {
      const name = ($('#new-task-name') || {}).value?.trim() || '';
      const route_type = ($('#new-task-type') || {}).value || 'MAIN';
      const slug = ($('#new-task-slug') || {}).value?.trim() || undefined;
      if (!name) { toast('Укажи название новой задачи', 'error'); return; }
      try {
        await api.post('/api/admin/model-sets', { name, slug, route_type, is_active: true });
        $('#modal-root').innerHTML = '';
        await openModelChains();
        toast('Цепочка создана — добавь в неё хотя бы одну модель');
      } catch (e) { toast('Не удалось создать задачу: ' + e.message, 'error'); }
    });

    $$('[data-delete-entry]').forEach(button => button.addEventListener('click', async () => {
      try {
        await api.del('/api/admin/model-sets/' + button.dataset.deleteSet + '/entries/' + button.dataset.deleteEntry);
        $('#modal-root').innerHTML = '';
        await openModelChains();
      } catch (e) { toast('Не удалось удалить модель: ' + e.message, 'error'); }
    }));

    $$('[data-add-entry]').forEach(button => button.addEventListener('click', async () => {
      const id = button.dataset.addEntry;
      const model = $('[data-new-model="' + id + '"]')?.value.trim() || '';
      const base = $('[data-new-base="' + id + '"]')?.value.trim() || '';
      const key = $('[data-new-key="' + id + '"]')?.value.trim() || '';
      const provider = $('[data-new-provider="' + id + '"]')?.value.trim() || 'openai';
      const freeRaw = $('[data-new-free="' + id + '"]')?.value.trim() || '';
      const proRaw = $('[data-new-pro="' + id + '"]')?.value.trim() || '';
      const resetRaw = $('[data-new-reset="' + id + '"]')?.value.trim() || '6';
      const concurrencyRaw = $('[data-new-concurrency="' + id + '"]')?.value.trim() || '1';
      if (!model || !base || !key) { toast('Нужны точные Model ID, Base URL и API-ключ', 'error'); return; }
      const set = sets.find(s => s.id === id);
      const nextPosition = Math.max(-1, ...(set?.entries || []).map(e => Number(e.position)));
      try {
        await api.post('/api/admin/model-sets/' + id + '/entries', {
          provider, base_url: base, model, api_key: key,
          position: nextPosition + 1, temperature: 0.2, max_tokens: 12000, timeout: 180,
          context_len: 0, price_in: 0, price_out: 0, price_cache: 0,
          free_token_limit: freeRaw === '' ? null : Number(freeRaw),
          pro_token_limit: proRaw === '' ? null : Number(proRaw),
          quota_reset_hours: Math.max(1, Number(resetRaw) || 6),
          max_concurrency: Math.max(1, Number(concurrencyRaw) || 1),
          is_active: true
        });
        $('#modal-root').innerHTML = '';
        await openModelChains();
        toast('Модель добавлена');
      } catch (e) { toast('Не удалось добавить модель: ' + e.message, 'error'); }
    }));
  }

  // ---------- Sidebar and account navigation ----------

  function applySidebar() {
    const sidebar = $('#sidebar');
    if (!sidebar) return;
    const mobile = window.innerWidth <= 860;
    if (mobile) sidebar.classList.remove('collapsed');
    else {
      sidebar.classList.toggle('collapsed', !!state.sidebarCollapsed);
      sidebar.classList.remove('open');
    }
    const overlay = $('#sidebar-overlay');
    if (overlay && !mobile) overlay.classList.remove('show');
    const openButton = $('#sidebar-open-btn');
    if (openButton) openButton.classList.toggle('hidden', mobile || !state.sidebarCollapsed);
  }
  function openMobileSidebar() {
    const sidebar = $('#sidebar'), overlay = $('#sidebar-overlay');
    if (sidebar) sidebar.classList.add('open');
    if (overlay) overlay.classList.add('show');
  }
  function closeMobileSidebar() {
    const sidebar = $('#sidebar'), overlay = $('#sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
  }
  function bindSidebar() {
    const newButton = $('#new-chat-btn');
    if (newButton) newButton.addEventListener('click', async () => {
      try { await newChat(); } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    });
    const collapse = $('#collapse-btn');
    if (collapse) collapse.addEventListener('click', () => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      localStorage.setItem('cs_sidebar', state.sidebarCollapsed ? '1' : '0');
      applySidebar();
    });
    const openSidebar = $('#sidebar-open-btn');
    if (openSidebar) openSidebar.addEventListener('click', () => {
      state.sidebarCollapsed = false; localStorage.setItem('cs_sidebar', '0'); applySidebar();
    });
    const menu = $('#menu-btn');
    if (menu) menu.addEventListener('click', () => {
      const sidebar = $('#sidebar');
      if (sidebar && sidebar.classList.contains('open')) closeMobileSidebar();
      else openMobileSidebar();
    });
    const overlay = $('#sidebar-overlay');
    if (overlay) overlay.addEventListener('click', closeMobileSidebar);
    const search = $('#search-input');
    if (search) search.addEventListener('input', () => {
      state.query = search.value.trim();
      loadChats().catch(e => toast('Ошибка поиска: ' + e.message, 'error'));
    });
    const settingsButton = $('#settings-btn');
    if (settingsButton) settingsButton.addEventListener('click', openSettings);
    const limitsButton = $('#limits-btn');
    if (limitsButton) limitsButton.addEventListener('click', openMyLimits);
    const shareButton = $('#share-btn');
    if (shareButton) shareButton.addEventListener('click', shareCurrentChat);
    window.addEventListener('resize', applySidebar);
    applySidebar();
  }
  async function openSettings() {
    const user = state.user || {};
    openModal({
      title: 'Настройки и профиль', okText: 'Закрыть',
      body: '<div class="kv"><span>Аккаунт</span><b>' + escapeHtml(user.email || '') + '</b></div>' +
        '<div class="kv"><span>Имя</span><b>' + escapeHtml(user.name || '—') + '</b></div>' +
        '<div class="kv"><span>Тариф</span><b>' + escapeHtml(user.plan || 'free') + '</b></div>' +
        '<div class="settings-grid" style="margin-top:12px">' +
        '<button class="chip-btn" id="settings-memory">Память</button>' +
        '<button class="chip-btn" id="settings-limit-view">Тариф и лимиты</button>' +
        '<button class="chip-btn" id="settings-links">Мои ссылки</button>' +
        (user.is_admin ? '<button class="chip-btn" id="settings-admin">Админ-панель</button>' : '') +
        '<button class="chip-btn" id="settings-logout">Выйти</button></div>',
      onOk: () => true,
    });
    const memory = $('#settings-memory'), links = $('#settings-links'), logout = $('#settings-logout');
    const accountLimits = $('#settings-limit-view');
    if (accountLimits) accountLimits.addEventListener('click', () => openMyLimits());
    const adminButton = $('#settings-admin');
    if (adminButton) adminButton.addEventListener('click', () => {
      $('#modal-root').innerHTML = '';
      openLimits();
    });
    if (memory) memory.addEventListener('click', () => openMemory());
    if (links) links.addEventListener('click', () => openLinks());
    if (logout) logout.addEventListener('click', async () => {
      try {
        await api.post('/api/auth/logout');
        state.user = null; state.chats = []; state.tree = []; window.__csrf = '';
        $('#modal-root').innerHTML = ''; showAuth();
      } catch (e) { toast('Не удалось выйти: ' + e.message, 'error'); }
    });
  }

  async function openMyLimits() {
    let data = state.limits;
    try { data = await api.get('/api/limits'); state.limits = data; }
    catch (e) { toast('Не удалось загрузить лимиты: ' + e.message, 'error'); return; }
    const labels = data.labels || {};
    const limits = data.limits || {};
    const usage = data.usage || {};
    const show = (key, value) => {
      let rendered;
      if (value == null) rendered = 'Без ограничения';
      else if (key === 'file_size' || key === 'user_storage') rendered = (Number(value) / (1024 * 1024)).toFixed(0) + ' МБ';
      else rendered = String(value);
      return '<div class="kv"><span>' + escapeHtml(labels[key] || key) + '</span><b>' + escapeHtml(rendered) + '</b></div>';
    };
    const total = usage.storage == null ? '—' : (Number(usage.storage) / (1024 * 1024)).toFixed(1) + ' МБ';
    const msgCap = usage.messages_daily_limit == null ? 'без дневного ограничения' : (Number(usage.messages_today || 0) + ' / ' + usage.messages_daily_limit + ' сегодня');
    const sub = usage.subscription_until ? new Date(usage.subscription_until).toLocaleString('ru-RU') : ((data.plan || 'free') === 'free' ? 'Нет платной подписки' : 'Бессрочно');
    openModal({
      title: 'Тариф и лимиты',
      okText: 'Закрыть',
      body: '<div class="kv"><span>Текущий тариф</span><b>' + escapeHtml(String(data.plan || 'free').toUpperCase()) + '</b></div>' +
        '<div class="kv"><span>Подписка</span><b>' + escapeHtml(sub) + '</b></div>' +
        '<div class="kv"><span>Сообщения</span><b>' + escapeHtml(msgCap) + '</b></div>' +
        '<div class="kv"><span>Занятое хранилище</span><b>' + escapeHtml(total) + '</b></div>' +
        '<div class="kv"><span>Файлов</span><b>' + escapeHtml(String(usage.files || 0)) + '</b></div>' +
        '<h4 class="sec" style="margin-top:14px">Ограничения тарифа</h4>' +
        ['messages_per_day','file_size','user_storage','files_count','chats_count','compress_per_day','compress_min','compress_max'].filter(k => Object.prototype.hasOwnProperty.call(limits, k)).map(k => show(k, limits[k])).join('') +
        (state.user && state.user.is_admin ? '<div class="settings-grid" style="margin-top:14px"><button class="chip-btn" id="open-admin-limits">Управление лимитами и моделями</button></div>' : '') +
        '<p class="usage-note" style="margin-top:12px">Квоты проверяются сервером. Ограничения отдельных моделей, окно сброса и резервные цепочки настраиваются администратором в разделе «Модели и лимиты».</p>',
      onOk: () => true,
    });
    const admin = $('#open-admin-limits');
    if (admin) admin.addEventListener('click', () => { $('#modal-root').innerHTML = ''; openLimits(); });
  }

  async function shareCurrentChat() {
    if (!state.currentChatId) { toast('Сначала откройте чат', 'error'); return; }
    try {
      const res = await api.post('/api/chats/' + state.currentChatId + '/share');
      const url = location.origin + (res.url || ('/?share=' + res.share_token));
      if (await copyText(url)) toast('Ссылка на чат скопирована');
      else openModal({
        title: 'Ссылка на чат', okText: 'Закрыть',
        body: '<input id="share-url" readonly value="' + escapeHtml(url) + '" />',
        onOk: () => true,
      });
    } catch (e) { toast('Не удалось поделиться: ' + e.message, 'error'); }
  }
  async function showPublicView(token) {
    try {
      const data = await api.get('/api/public/chats/' + encodeURIComponent(token));
      state.readonly = true; state.publicToken = token; state.user = null;
      state.currentChatId = null; state.tree = data.messages || [];
      showApp(); closeMobileSidebar();
      const sidebar = $('#sidebar'); if (sidebar) sidebar.classList.add('collapsed');
      const title = $('#chat-title'); if (title) title.textContent = data.title || 'Чат';
      const who = $('#who'); if (who) who.textContent = data.author ? 'Общий доступ · ' + data.author : 'Общий доступ';
      const composer = $('#composer'); if (composer) composer.classList.add('hidden');
      const files = $('#files-panel'); if (files) files.classList.add('hidden');
      const share = $('#share-btn'); if (share) share.classList.add('hidden');
      const fileButton = $('#toggle-files-btn'); if (fileButton) fileButton.classList.add('hidden');
      renderMessages();
    } catch (e) { showAuth(); toast('Ссылка недоступна: ' + e.message, 'error'); }
  }


  // ---------- boot ----------
  async function boot() {
    showApp();
    applySidebar();
    $('#menu-btn').style.display = window.innerWidth <= 860 ? 'grid' : 'none';
    try {
      await loadChats();
      await loadFiles();
      await loadMemory();

      await loadLimits();

      renderMessages();

    } catch (e) {
      console.error('Boot error:', e.message, e.stack);
      toast('Ошибка загрузки: ' + e.message, 'error');
    }
  }

  async function init() {
    bindAuth(); bindSidebar(); bindComposer(); bindFiles(); const token = new URLSearchParams(location.search).get('share');
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
