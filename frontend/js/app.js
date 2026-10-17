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
    const ok = await copyText(text);
    if (btn && btn.hasAttribute('data-icon-only')) {
      if (ok) {
        btn.classList.add('copied');
        toast('Скопировано');
        setTimeout(() => btn.classList.remove('copied'), 1100);
      } else {
        toast('Не удалось скопировать', 'error');
      }
      return;
    }
    const original = btn.textContent;
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
        if (s.fill == null && s.stroke == null) push('fill', '#4b4a46');
        common();
        return '<rect ' + a.join(' ') + '/>';
      case 'circle':
        push('cx', s.cx || 0); push('cy', s.cy || 0); push('r', s.r || 0);
        if (s.fill == null) push('fill', '#4b4a46');
        common();
        return '<circle ' + a.join(' ') + '/>';
      case 'ellipse':
        push('cx', s.cx || 0); push('cy', s.cy || 0);
        push('rx', s.rx || 0); push('ry', s.ry || 0);
        if (s.fill == null) push('fill', '#4b4a46');
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
        push('stroke', s.stroke || '#4b4a46');
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
          if (s.fill == null) push('fill', '#4b4a46');
        } else {
          push('fill', 'none');
          push('stroke', s.stroke || '#4b4a46');
          push('stroke-width', s.width || 2);
        }
        common();
        return '<' + s.type + ' ' + a.join(' ') + '/>';
      }
      case 'path':
        push('d', s.d || '');
        push('fill', s.fill || 'none');
        push('stroke', s.stroke || '#4b4a46');
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
    csrf() { return window.__csrf || getCookie('chatstudio_csrf') || ''; },
    async req(method, path, body, isForm, timeoutMs) {
      const headers = {};
      if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
      if (method !== 'GET') headers['X-CSRF-Token'] = api.csrf();
      const controller = timeoutMs > 0 ? new AbortController() : null;
      let timeoutId = null;
      if (controller) timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(path, {
          method, headers, credentials: 'same-origin',
          body: isForm ? body : (body !== undefined ? JSON.stringify(body) : undefined),
          ...(controller ? { signal: controller.signal } : {}),
        });
        if (res.status === 401) { showAuth(); throw new Error('Сессия истекла. Войдите снова.'); }
        if (res.status === 204) return null;

        const raw = await res.text();
        if (!res.ok) {
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { /* keep raw response */ }
          let detail = parsed && typeof parsed === 'object' ? parsed.detail : null;
          let message = detail != null ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : raw.trim();
          if (!message || message === 'null' || message === 'undefined' || message === '{}') {
            message = 'Сервер вернул пустое описание ошибки';
          }
          throw new Error('HTTP ' + res.status + ': ' + message);
        }
        if (!raw.trim()) {
          throw new Error('Сервер вернул пустой ответ на ' + method + ' ' + path + ' (HTTP ' + res.status + ')');
        }
        try {
          return JSON.parse(raw);
        } catch (parseError) {
          throw new Error('Сервер вернул некорректный JSON на ' + method + ' ' + path + ' (HTTP ' + res.status + ')');
        }
      } catch (err) {
        if (controller && err && err.name === 'AbortError') {
          throw new Error('Истекло время ожидания ответа сервера (' + Math.round(timeoutMs / 1000) + ' с)');
        }
        if (err instanceof Error) throw err;
        const message = err == null || err === 'null' || err === 'undefined'
          ? 'Сервер не вернул описание ошибки'
          : String(err);
        throw new Error(message);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    },
    get(p) { return api.req('GET', p); },
    post(p, b) { return api.req('POST', p, b === undefined ? {} : b); },
    postTimed(p, b, timeoutMs) { return api.req('POST', p, b === undefined ? {} : b, false, timeoutMs); },
    postForm(p, fd) { return api.req('POST', p, fd, true); },
    patch(p, b) { return api.req('PATCH', p, b); },
    put(p, b) { return api.req('PUT', p, b === undefined ? {} : b); },
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
    sending: false,
    streamEl: null,
    streamBuf: '',
    streamStarted: false,
    activeAssistantId: null,
    thinkBody: null,
    modelSets: [],
    modelSetId: '',
    effort: 'medium',
    usage: null,
    draftTail: null,
    memories: [],
    style: localStorage.getItem('cs_style') || 'auto',
    readonly: false,
    publicToken: null,
    greetTimer: null,
    audioReady: Object.create(null),
    audioPending: Object.create(null),
    audioStatusRequested: new Set(),
    audioStatusChatId: null,
    audioRequestInFlight: Object.create(null),
    audioBusyMessageId: null,
    audioStatusPollTimer: null,
    audioStatusPollRunning: false,
    audioMessageId: null,
    audioDuration: 0,
    greetIdx: Math.floor(Math.random() * 100),
    suggIdx: Math.floor(Math.random() * 50),
    sidebarCollapsed: localStorage.getItem('cs_sidebar') === '1',
  };

  const EFFORTS = ['low', 'medium', 'high', 'extra', 'max'];
  const EFFORT_LABELS = ['Low', 'Medium', 'High', 'Extra', 'Max'];

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
    const result = await api.get('/api/chats' + (state.query ? '?q=' + encodeURIComponent(state.query) : ''));
    if (!Array.isArray(result)) {
      throw new Error('Сервер вернул некорректный список чатов');
    }
    // Ignore malformed/null rows from stale responses instead of crashing on c.id.
    state.chats = result.filter(c => c && typeof c === 'object' && typeof c.id === 'string' && c.id);
    renderChatList();
  }

  function renderChatList() {
    const box = $('#chat-list');
    // Defensive normalization: an incomplete response must never crash the sidebar.
    state.chats = (Array.isArray(state.chats) ? state.chats : [])
      .filter(c => c && typeof c === 'object' && typeof c.id === 'string' && c.id);
    if (!state.chats.length) {
      box.innerHTML = '<div class="side-empty">' + (state.query ? 'Ничего не найдено' : 'Пока нет чатов') + '</div>';
      return;
    }
    box.innerHTML = state.chats.map(c =>
      '<div class="chat-item' + (c.id === state.currentChatId ? ' active' : '') + '" data-id="' + c.id + '">' +
        '<span class="title">' + escapeHtml(c.title || 'Новый чат') + '</span>' +
        ((c.mode === 'code' || c.mode === 'council' || (c.bundle_id && c.mode !== 'council')) ?
          '<span class="chat-meta">' +
            (c.mode === 'code' ? '<em class="mode-tag">код</em>' : '') +
            (c.mode === 'council' ? '<em class="mode-tag">совет</em>' : '') +
            (c.bundle_id && c.mode !== 'council' ? '<em class="bundle-tag">совет</em>' : '') +
          '</span>' : '') +
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
      title: 'Новый чат',
      mode: mode || 'chat',
    });
    if (!chat || typeof chat !== 'object' || typeof chat.id !== 'string' || !chat.id) {
      throw new Error('Сервер не вернул созданный чат с корректным ID');
    }
    state.chats = (Array.isArray(state.chats) ? state.chats : [])
      .filter(c => c && typeof c === 'object' && typeof c.id === 'string' && c.id);
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
    const loadedTree = await api.get('/api/chats/' + id + '/messages');
    state.tree = Array.isArray(loadedTree) ? loadedTree : [];
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
    if (!Array.isArray(nodes) || id == null) return null;
    for (const n of nodes) {
      // Histories can contain malformed/null rows; never let one break sending.
      if (!n || typeof n !== 'object') continue;
      if (n.id === id) return n;
      const children = Array.isArray(n.children) ? n.children : [];
      const f = findNode(children, id);
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
    let nodes = Array.isArray(tree) ? tree : [];
    const selected = choices && typeof choices === 'object' ? choices : {};
    let parentKey = 'root';
    while (Array.isArray(nodes) && nodes.length) {
      // Remove invalid entries before resolving a branch index or reading node.id.
      const siblings = nodes.filter(node =>
        node && typeof node === 'object' && typeof node.id === 'string' && node.id
      );
      if (!siblings.length) break;
      const rawIndex = selected[parentKey];
      let idx = rawIndex == null ? NaN : Number(rawIndex);
      if (!Number.isInteger(idx) || idx >= siblings.length || idx < 0) idx = siblings.length - 1;
      const node = siblings[idx];
      path.push({ node, siblings, index: idx, parentKey });
      nodes = Array.isArray(node.children) ? node.children : [];
      parentKey = node.id;
    }
    return path;
  }

  function allMessages(tree) {
    const entries = [];
    const seen = new Set();
    const visit = (nodes) => {
      let siblings = (Array.isArray(nodes) ? nodes : [])
        .filter(node => node && typeof node === 'object' &&
          typeof node.id === 'string' && node.id && !seen.has(node));
      const times = siblings.map(node => Date.parse(node.created_at || ''));
      // Keep all sibling generations together, oldest first when timestamps are available.
      if (times.length > 1 && times.every(Number.isFinite)) {
        siblings = siblings.map((node, index) => ({ node, index, time: times[index] }))
          .sort((a, b) => a.time - b.time || a.index - b.index)
          .map(item => item.node);
      }
      siblings.forEach(node => {
        seen.add(node);
        entries.push({ node });
      });
      // Render alternatives first, then their descendants, so regenerated answers stay adjacent.
      siblings.forEach(node => visit(node.children));
    };
    visit(tree);
    return entries;
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

  function genAnim(label) {
    return '<span class="gen-anim">' +
      '<span class="gen-anim-icon">' + thinkAnim() + '</span>' +
      '<span class="gen-anim-text">' + escapeHtml(label || 'Создаю чат…') + '</span>' +
      '</span>';
  }

  function msgHtml(entry, isLast) {
    const n = entry.node;
    const isUser = n.role === 'user';
    const generating = !isUser && (n.status === 'queued' || n.status === 'processing');
    let inner;
    if (isUser) {
      inner = attsHtml(n.attachments) +
        '<div class="user-message-row">' +
          '<button class="user-copy-btn" data-mact="copy-user" data-icon-only="1" data-id="' + escapeHtml(n.id) +
            '" title="Копировать сообщение" aria-label="Копировать сообщение">' + icon('copy') + '</button>' +
          '<div class="bubble">' + escapeHtml(n.content) + '</div>' +
        '</div>';
    } else {
      const failed = n.status === 'failed';
      const hasThink = !!(n.thinking && String(n.thinking).trim());
      const draft = n.draft || '';

      if (generating && n.creating) {
        // first message of a brand-new chat: show the creation animation right away
        inner = genAnim(n.creatingLabel || 'Создаю чат…');
      } else if (generating) {
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
        // a failed request is just shown as an error message, nothing more
        inner = '<div class="content md" style="color:var(--danger)">Ошибка: ' +
          escapeHtml(n.error || 'запрос не прошёл') + '</div>';
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
      const generating = n.status === 'queued' || n.status === 'processing';
      const parts = [];
      if (n.status === 'cancelled') parts.push('<span class="status">остановлено</span>');
      if (generating) {
        parts.push('<button data-mact="stop" data-id="' + n.id + '">' + icon('stop') + 'Остановить</button>');
      } else {
        if (n.content) {
          parts.push('<button class="message-action-labeled" data-mact="copy" data-id="' + escapeHtml(n.id) +
            '" title="Копировать ответ" aria-label="Копировать ответ">' + icon('copy') + '<span>Копировать</span></button>');
          parts.push('<button class="message-action-labeled" data-mact="save" data-id="' + escapeHtml(n.id) +
            '" title="Сохранить ответ" aria-label="Сохранить ответ">' + icon('download') + '<span>Сохранить</span></button>');
          if (n.memories && n.memories.length) {
            parts.push('<button class="icon-only-action" data-icon-only="1" data-mact="memory" data-id="' + escapeHtml(n.id) +
              '" title="Что записано в память" aria-label="Память">' + icon('sparkle') + '</button>');
          }
        }
        if (n.sources && n.sources.length) {
          parts.push('<button class="icon-only-action" data-icon-only="1" data-mact="sources" data-id="' + escapeHtml(n.id) +
            '" title="Источники из интернета" aria-label="Источники из интернета">' +
            icon('globe') + '<b class="cnt">' + n.sources.length + '</b></button>');
        }
      }
      meta = '<div class="meta">' + parts.join('') + '</div>';
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

    let askCard = '';
    if (!isUser && n.ask) {
      askCard = '<div class="ask-card">' +
        '<div class="ask-q">' + icon('sparkle') + '<span>' + escapeHtml(n.ask) + '</span></div>' +
        '<div class="ask-row">' +
        '<input type="text" class="ask-input" placeholder="Ваш ответ…" />' +
        '<button class="chip-btn ask-send">' + icon('arrow-up') + 'Ответить</button>' +
        '</div></div>';
    }

    const audioCtl = !isUser && !state.readonly && n.status === 'completed' && String(n.content || '').trim()
      ? audioControlHtml(n) : '';

    const actionsRow = !isUser && !state.readonly && (meta || audioCtl)
      ? '<div class="msg-actions-row">' + meta + audioCtl + '</div>' : '';

    return '<div class="msg ' + n.role + '" data-mid="' + n.id + '">' +
      '<div class="role">' + (isUser ? 'Вы' : 'ChatStudio') + '</div>' +
      tools + inner + askCard + actionsRow + memLine + '</div>';
  }

  function audioControlHtml(n) {
    const id = escapeHtml(n.id);
    if (state.audioPending[n.id]) {
      return '<div class="answer-audio-wrap" data-audio-control="' + id + '">' +
        '<button class="answer-audio-generate is-loading" data-mact="audio-pending" data-id="' + id + '" disabled>' +
          '<span class="audio-loading-ring"></span><span>Создаю озвучку…</span></button></div>';
    }
    if (state.audioReady[n.id]) {
      return '<div class="answer-audio-wrap" data-audio-control="' + id + '">' +
        '<button class="answer-audio-preview" data-mact="play-audio" data-id="' + id + '" title="Открыть аудиоплеер">' +
          '<span class="audio-preview-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>' +
          '<span class="audio-preview-copy"><b>Аудиоверсия ответа</b><small>Нажмите, чтобы слушать</small></span>' +
          '<span class="audio-preview-play">' + icon('play') + '</span>' +
        '</button></div>';
    }
    if (state.audioBusyMessageId) {
      const sameMessage = String(state.audioBusyMessageId) === String(n.id);
      return '<div class="answer-audio-wrap" data-audio-control="' + id + '">' +
        '<button class="answer-audio-generate is-loading" data-mact="audio-pending" data-id="' + id + '" disabled>' +
          '<span class="audio-loading-ring"></span><span>' +
          (sameMessage ? 'Создаю озвучку…' : 'Другая озвучка уже создаётся…') +
          '</span></button></div>';
    }
    return '<div class="answer-audio-wrap" data-audio-control="' + id + '">' +
      '<button class="answer-audio-generate" data-mact="generate-audio" data-id="' + id + '" title="Создать голосовую версию ответа">' +
        icon('audio') + '<span>Аудиоверсия ответа</span></button></div>';
  }

  function updateAudioControl(messageId) {
    const wrapper = $$('[data-audio-control]').find(el => el.dataset.audioControl === String(messageId));
    const entry = findNode(state.tree, messageId);
    if (wrapper && entry) wrapper.innerHTML = audioControlHtml(entry);
  }

  function updateAllAudioControls() {
    allMessages(state.tree).forEach(entry => {
      const n = entry && entry.node;
      if (n && n.role === 'assistant' && n.status === 'completed' && String(n.content || '').trim()) {
        updateAudioControl(n.id);
      }
    });
  }

  function applyAudioStatus(messageId, result) {
    if (!result) return;
    const previousBusyId = state.audioBusyMessageId;
    if (result.busy && result.generating_message_id) {
      state.audioBusyMessageId = String(result.generating_message_id);
    } else if (!result.busy && !(previousBusyId && state.audioRequestInFlight[previousBusyId])) {
      state.audioBusyMessageId = null;
      if (previousBusyId && String(previousBusyId) !== String(messageId) && !state.audioRequestInFlight[previousBusyId]) {
        state.audioPending[previousBusyId] = false;
        state.audioStatusRequested.delete(previousBusyId);
        updateAudioControl(previousBusyId);
      }
    }

    if (result.ready) {
      state.audioReady[messageId] = true;
      state.audioPending[messageId] = false;
    } else if (result.generating) {
      state.audioPending[messageId] = true;
    } else if (!state.audioRequestInFlight[messageId]) {
      state.audioPending[messageId] = false;
    }

    if (previousBusyId !== state.audioBusyMessageId) updateAllAudioControls();
    updateAudioControl(messageId);
  }

  async function refreshAudioStatus(messageId) {
    try {
      const result = await api.get('/api/messages/' + encodeURIComponent(messageId) + '/audio/status');
      applyAudioStatus(messageId, result);
      return result;
    } catch (e) {
      return null;
    }
  }

  function startAudioStatusPolling() {
    if (state.readonly || state.audioStatusPollTimer) return;
    state.audioStatusPollTimer = window.setInterval(async () => {
      if (state.audioStatusPollRunning || state.readonly) return;
      const entries = allMessages(state.tree);
      const messages = entries
        .map(entry => entry && entry.node)
        .filter(n => n && n.role === 'assistant' && n.status === 'completed' && String(n.content || '').trim());
      if (!messages.length) {
        window.clearInterval(state.audioStatusPollTimer);
        state.audioStatusPollTimer = null;
        return;
      }
      const active = state.audioBusyMessageId &&
        messages.find(n => String(n.id) === String(state.audioBusyMessageId));
      const monitor = active || messages[messages.length - 1];
      state.audioStatusPollRunning = true;
      try {
        await refreshAudioStatus(monitor.id);
      } finally {
        state.audioStatusPollRunning = false;
      }
    }, 2500);
  }

  function hydrateAudioStatuses(entries) {
    if (state.readonly) return;
    if (state.audioStatusChatId !== state.currentChatId) {
      state.audioStatusRequested.clear();
      state.audioStatusChatId = state.currentChatId;
    }
    let hasCompletedAnswer = false;
    entries.forEach(entry => {
      const n = entry.node;
      if (!n || n.role !== 'assistant' || n.status !== 'completed' || !String(n.content || '').trim()) return;
      hasCompletedAnswer = true;
      if (state.audioStatusRequested.has(n.id) && !state.audioPending[n.id] &&
          String(state.audioBusyMessageId || '') !== String(n.id)) return;
      state.audioStatusRequested.add(n.id);
      refreshAudioStatus(n.id);
    });
    // Poll the server while this chat has answers so generation started on
    // another device appears here too, and its completion is reflected.
    if (hasCompletedAnswer) startAudioStatusPolling();
  }

  async function generateAnswerAudio(messageId) {
    if (state.audioPending[messageId] || state.audioRequestInFlight[messageId]) return;
    if (state.audioBusyMessageId && String(state.audioBusyMessageId) !== String(messageId)) {
      toast('Уже создаётся другая озвучка. Дождитесь завершения.', 'error');
      return;
    }
    state.audioRequestInFlight[messageId] = true;
    state.audioPending[messageId] = true;
    state.audioBusyMessageId = String(messageId);
    updateAllAudioControls();
    startAudioStatusPolling();
    try {
      const result = await api.post('/api/messages/' + encodeURIComponent(messageId) + '/audio', {});
      state.audioRequestInFlight[messageId] = false;
      state.audioPending[messageId] = false;
      state.audioReady[messageId] = !!(result && result.ready);
      state.audioStatusRequested.add(messageId);
      state.audioBusyMessageId = null;
      updateAllAudioControls();
      toast('Озвучка готова — нажмите на аудиокарточку');
    } catch (err) {
      state.audioRequestInFlight[messageId] = false;
      state.audioPending[messageId] = false;
      if (String(state.audioBusyMessageId) === String(messageId)) state.audioBusyMessageId = null;
      updateAllAudioControls();
      toast('Не удалось озвучить ответ: ' + (err.message || 'ошибка сервера'), 'error');
      await refreshAudioStatus(messageId);
    }
  }

  function formatAudioTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const s = Math.floor(seconds);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function updateAudioPlayerControls() {
    const audio = $('#audio-player-source');
    const play = $('#audio-play-toggle');
    if (!audio || !play) return;
    play.innerHTML = icon(audio.paused ? 'play' : 'pause');
    play.title = audio.paused ? 'Воспроизвести' : 'Пауза';
    play.setAttribute('aria-label', play.title);
    const progress = $('#audio-progress');
    if (progress) {
      const max = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      progress.value = max ? Math.round((audio.currentTime / max) * 1000) : 0;
      progress.disabled = !max;
    }
    const current = $('#audio-current-time'), total = $('#audio-total-time');
    if (current) current.textContent = formatAudioTime(audio.currentTime || 0);
    if (total) total.textContent = formatAudioTime(audio.duration || 0);

    // Keep iOS/Safari headset controls aware of playback state and position.
    // Existing previous/next-track handlers below map these keys to ±10 seconds.
    const session = navigator.mediaSession;
    if (session) {
      try {
        session.playbackState = audio.ended ? 'none' : (audio.paused ? 'paused' : 'playing');
      } catch (e) { /* media-session playback state is optional */ }
      const duration = Number(audio.duration);
      if (typeof session.setPositionState === 'function' && Number.isFinite(duration) && duration > 0) {
        try {
          session.setPositionState({
            duration,
            playbackRate: Number(audio.playbackRate) || 1,
            position: Math.max(0, Math.min(duration, Number(audio.currentTime) || 0)),
          });
        } catch (e) { /* media-session position is unsupported in some browsers */ }
      }
    }
  }

  function openAudioPlayer(messageId, autoplay) {
    const n = findNode(state.tree, messageId);
    if (!n || !state.audioReady[messageId]) return;
    const shell = $('#audio-player-shell'), audio = $('#audio-player-source');
    if (!shell || !audio) return;
    state.audioMessageId = messageId;
    const chat = state.chats.find(c => c.id === state.currentChatId);
    const playerTitle = (chat && chat.title) || 'Ответ';
    $('#audio-player-title').textContent = playerTitle;
    if (navigator.mediaSession && typeof window.MediaMetadata === 'function') {
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: playerTitle, artist: 'ai-ch', album: 'Озвучка ответов',
        });
      } catch (e) { /* media metadata is optional */ }
    }
    audio.pause();
    audio.src = '/api/messages/' + encodeURIComponent(messageId) + '/audio/file';
    audio.load();
    shell.classList.add('open');
    shell.setAttribute('aria-hidden', 'false');
    document.body.classList.add('audio-player-open');
    updateAudioPlayerControls();
    if (autoplay) audio.play().catch(() => toast('Нажмите воспроизведение, чтобы запустить аудио.', 'error'));
    requestAnimationFrame(() => $('#audio-close-btn')?.focus());
  }

  function closeAudioPlayer() {
    const shell = $('#audio-player-shell'), audio = $('#audio-player-source');
    if (audio) audio.pause();
    if (shell) {
      shell.classList.remove('open');
      shell.setAttribute('aria-hidden', 'true');
    }
    // Avoid stale controls on the iOS lock screen after dismissing the player.
    if (navigator.mediaSession) {
      try {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
        if (typeof navigator.mediaSession.setPositionState === 'function') {
          navigator.mediaSession.setPositionState();
        }
      } catch (e) { /* media-session cleanup is optional */ }
    }
    document.body.classList.remove('audio-player-open');
  }

  function bindAudioPlayer() {
    const audio = $('#audio-player-source');
    if (!audio) return;
    audio.addEventListener('loadedmetadata', updateAudioPlayerControls);
    audio.addEventListener('timeupdate', updateAudioPlayerControls);
    audio.addEventListener('play', updateAudioPlayerControls);
    audio.addEventListener('pause', updateAudioPlayerControls);
    audio.addEventListener('ended', updateAudioPlayerControls);
    $$('[data-audio-close]').forEach(btn => btn.addEventListener('click', closeAudioPlayer));
    $('#audio-play-toggle')?.addEventListener('click', () => {
      if (audio.paused) audio.play().catch(() => toast('Не удалось запустить аудио.', 'error'));
      else audio.pause();
    });
    const seekAudio = (offset) => {
      const current = Number(audio.currentTime) || 0;
      const duration = Number.isFinite(audio.duration) ? audio.duration : current + 10;
      audio.currentTime = Math.max(0, Math.min(duration, current + offset));
      updateAudioPlayerControls();
    };
    $$('[data-audio-action]').forEach(btn => btn.addEventListener('click', () => {
      if (btn.dataset.audioAction === 'back') seekAudio(-10);
      else if (btn.dataset.audioAction === 'forward') seekAudio(10);
    }));
    // Headset/media-key previous and next track buttons act as ±10 second seek.
    if (navigator.mediaSession && typeof navigator.mediaSession.setActionHandler === 'function') {
      [['previoustrack', () => seekAudio(-10)], ['nexttrack', () => seekAudio(10)],
       ['seekbackward', () => seekAudio(-10)], ['seekforward', () => seekAudio(10)]]
        .forEach(([action, handler]) => {
          try { navigator.mediaSession.setActionHandler(action, handler); } catch (e) { /* unsupported media action */ }
        });
    }
    $('#audio-progress')?.addEventListener('input', ev => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = (Number(ev.target.value) / 1000) * audio.duration;
      }
    });
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && $('#audio-player-shell')?.classList.contains('open')) closeAudioPlayer();
    });
  }

  function toolRunHtml(r, i) {
    const running = !!r.running;
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
    return '<div class="tool-box collapsed' + (r.ok ? '' : ' err') + '">' +
      '<div class="tool-head">' +
      (running ? thinkAnim() : icon('terminal')) +
      '<span class="tool-title">Шаг ' + (i + 1) + ' — ' +
      (running ? 'выполняется…' : ('код выполнен' + (r.ok ? '' : ' с ошибкой'))) + '</span>' +
      (r.timed_out ? '<em class="warn">таймаут</em>' : '') +
      '<button type="button" class="tool-toggle" data-tool-toggle aria-expanded="false" title="Развернуть вывод">' +
      icon('chevron-down') + '<span data-tool-toggle-label>Развернуть</span></button></div>' +
      '<div class="tool-content">' +
      '<pre class="tool-code">' + escapeHtml(r.code || '') + '</pre>' +
      (r.stdout ? '<pre class="tool-out">' + escapeHtml(r.stdout) + '</pre>' : '') +
      (r.stderr ? '<pre class="tool-err">' + escapeHtml(r.stderr) + '</pre>' : '') +
      (files ? '<div class="tool-files">' + files + '</div>' : '') +
      '</div></div>';
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
    box.classList.add('empty');
    box.innerHTML =
      '<div class="empty-state">' +
        '<h2 class="greet" id="greet-text">' +
          escapeHtml(GREETINGS[state.greetIdx % GREETINGS.length]) + '</h2>' +
        '<div class="tiles" id="tiles"></div>' +
        '<div class="chips" id="sugg-chips"></div>' +
      '</div>';
    renderTiles();
    bindTiles();
    renderSuggestionChips();
    rollPlaceholder();
    startRotation();
  }

  function renderSuggestionChips() {
    const box = $('#sugg-chips');
    if (!box) return;
    const total = SUGGESTIONS.length, n = 2;
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
    let tick = 0;
    state.greetTimer = setInterval(() => {
      if (!$('#greet-text')) { stopRotation(); return; }
      tick += 1;
      if (tick % 2 === 0) rotateGreeting();
      renderSuggestionChips();
    }, 11000);
  }

  function stopRotation() {
    if (state.greetTimer) { clearInterval(state.greetTimer); state.greetTimer = null; }
    if (state.tileTimer) { clearInterval(state.tileTimer); state.tileTimer = null; }
  }

  function updateShareButtonVisibility() {
    const button = $('#share-btn');
    if (button) button.classList.toggle('hidden', !state.currentChatId || !!state.readonly);
  }

  function renderMessages(options) {
    const box = $('#messages');
    const opts = options || {};
    updateShareButtonVisibility();
    const entries = allMessages(state.tree);
    if (!entries.length) { renderEmptyState(); return; }
    box.classList.remove('empty');
    stopRotation();
    box.innerHTML = '<div class="msg-wrap">' +
      entries.map((e, i) => msgHtml(e, i === entries.length - 1)).join('') + '</div>';
    bindMessageEvents();
    renderMath(box.querySelector('.msg-wrap'));
    hydrateAudioStatuses(entries);

    if (opts.focusMessageId) {
      const target = $('.msg', box).find(el => el.dataset.mid === String(opts.focusMessageId));
      const content = target ? $('.content.md', target) : null;
      if (content) content.classList.add('answer-arrive');
      requestAnimationFrame(() => scrollToMessageStart(opts.focusMessageId));
    } else {
      scrollToBottom();
    }
  }

  function bindMessageEvents() {
    $$('[data-tool-toggle]').forEach(btn => btn.addEventListener('click', () => {
      const box = btn.closest('.tool-box');
      if (!box) return;
      const expanded = box.classList.toggle('collapsed') === false;
      btn.setAttribute('aria-expanded', String(expanded));
      btn.title = expanded ? 'Свернуть вывод' : 'Развернуть вывод';
      const label = $('[data-tool-toggle-label]', btn);
      if (label) label.textContent = expanded ? 'Свернуть' : 'Развернуть';
    }));
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

    // Delegate message actions because individual controls may be replaced dynamically.
    const messageActions = $('#messages');
    if (messageActions && !messageActions.dataset.actionsBound) {
      messageActions.dataset.actionsBound = 'true';
      messageActions.addEventListener('click', async (event) => {
        const btn = event.target.closest('[data-mact]');
        if (!btn || !messageActions.contains(btn) || btn.disabled) return;
        const id = btn.dataset.id, act = btn.dataset.mact;
      if (act === 'copy') {
        const n = findNode(state.tree, id);
        if (n) await copyWithFeedback(btn, n.content || '');
      } else if (act === 'copy-user') {
        const n = findNode(state.tree, id);
        if (n) await copyWithFeedback(btn, n.content || '');
      } else if (act === 'generate-audio') {
        await generateAnswerAudio(id);
      } else if (act === 'play-audio') {
        openAudioPlayer(id, true);
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
      } else if (act === 'expand') {
        const n = findNode(state.tree, id);
        if (n) { n.showFull = true; renderMessages(); }
      } else if (act === 'memory') { await openMemory(id); }
      else if (act === 'sources') {
        const n = findNode(state.tree, id);
        if (n) openSources(n.sources || []);
      }
      });
    }

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

  }

  function scrollToBottom() {
    const box = $('#messages');
    box.scrollTop = box.scrollHeight;
    state.stickBottom = true;
  }

  function scrollToMessageStart(messageId) {
    const box = $('#messages');
    if (!box || messageId == null) return;
    const target = $('.msg', box).find(el => el.dataset.mid === String(messageId));
    if (!target) return;
    const boxTop = box.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    const top = Math.max(0, box.scrollTop + targetTop - boxTop - 4);
    state.stickBottom = false;
    box.scrollTo({ top, behavior: 'smooth' });
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

  async function streamRequest(path, body, opts) {
    // opts: { optimistic: true } — a pending assistant bubble was already
    // rendered by the caller; don't block on it and don't reset the tree ids
    if (state.streaming) return;
    setStreaming(true);
    if (!opts || !opts.optimistic) {
      state.activeAssistantId = null;
    }
    state.streamEl = null; state.thinkBody = null; state.draftTail = null;
    state.streamBuf = ''; state.streamStarted = false;
    state.genStart = Date.now();
    state.lastEvent = Date.now();
    if (state.genTimer) clearInterval(state.genTimer);
    state.genTimer = setInterval(() => {
      // the limit bar fills live while the answer is still streaming;
      // the exact dollar amount lands on `done` (server bills per model)
      const w = windowUsage();
      if (w && w.budget_usd) {
        const outTokens = Math.round(((state.streamBuf || '').length) / 3.6);
        const live = Number(w.spend_usd || 0);
        paintUsage(live / w.budget_usd * 100,
          'Идёт генерация · ' + outTokens.toLocaleString('ru-RU') +
          ' ток. выхода · бюджет $' + live.toFixed(4) + ' из $' + w.budget_usd +
          ' за ' + w.hours + ' ч');
      }
      const el = $('[data-gen]');
      const secs = Math.round((Date.now() - (state.genStart || Date.now())) / 1000);
      const idle = Math.round((Date.now() - (state.lastEvent || Date.now())) / 1000);
      if (!el) return;
      el.textContent = state.streamBuf.length.toLocaleString('ru-RU') + ' симв. · ' + secs + ' с' +
        (idle > 45 ? ' · модель долго думает…' : '');
      el.classList.toggle('warn', idle > 45);
    }, 1000);
    const controller = new AbortController();
    let watchdog = null;
    let watchdogExpired = false;
    let responseReceived = false;
    const armWatchdog = (delay) => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        watchdogExpired = true;
        controller.abort();
      }, delay);
    };
    // The API should begin the SSE response promptly. Once connected, allow
    // longer model think time, but never leave the composer locked forever.
    armWatchdog(120000);
    try {
      const headers = { 'X-CSRF-Token': api.csrf() };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(path, {
        method: 'POST', headers, credentials: 'same-origin',
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (res.status === 401) { showAuth(); return; }
      if (!res.ok) { const t = await res.text(); throw new Error(t); }
      responseReceived = true;
      armWatchdog(330000);

      await consumeSse(res, (ev, data) => {
        armWatchdog(330000);
        state.lastEvent = Date.now();
        if (ev === 'chat_created') {
          // The combined endpoint tells the UI which chat now owns this stream.
          if (data && typeof data === 'object' && data.id) {
            state.currentChatId = data.id;
            updateShareButtonVisibility();
            state.chats = (Array.isArray(state.chats) ? state.chats : [])
              .filter(c => c && typeof c === 'object' && typeof c.id === 'string' && c.id);
            const index = state.chats.findIndex(c => c.id === data.id);
            if (index >= 0) state.chats[index] = data;
            else state.chats.unshift(data);
            const title = $('#chat-title');
            if (title) title.textContent = data.title || 'Новый чат';
            renderChatList();
          }
        } else if (ev === 'user_message' || ev === 'assistant_message') {
          const tmp = ev === 'user_message' ? state.tmpUser : state.tmpAssistant;
          let node = null;
          if (tmp) {
            // swap the optimistic node in place (no flicker, no duplicates)
            node = findNode(state.tree, tmp.id);
            if (node) {
              const parentId = data.parent_message_id || node.parent_message_id;
              Object.assign(node, data, { children: node.children || [] });
              if (parentId) node.parent_message_id = parentId;
            }
          }
          if (!node) node = insertMessage(state.tree, data);
          if (ev === 'assistant_message') {
            // Chat creation and request acceptance are finished at this point.
            // Do not leave the optimistic bubble saying "Создаю чат…" while
            // the model is thinking or waiting in a queue.
            node.creating = true;
            node.creatingLabel = 'Запрос принят · ожидаю ответ модели…';
            state.activeAssistantId = node.id;
          }
          renderMessages();
          if (ev === 'assistant_message') bindStreamRefs();
        } else if (ev === 'stage') {
          // search / routing stages: the bubble keeps the creation animation,
          // the label tells what is happening right now
          const n = findNode(state.tree, state.activeAssistantId);
          if (n) {
            n.stage = data.stage || '';
            if (data.stage === 'search') {
              n.creating = true;
              n.creatingLabel = 'Ищу в интернете…';
            }
          }
          renderMessages();
          bindStreamRefs();
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
          if (n) { n.draft = state.streamBuf; n.creating = false; state.streamStarted = true; }
          if (state.draftTail) state.draftTail.textContent = tailText(state.streamBuf, 260);
          maybeScroll();
        } else if (ev === 'memory') {
          const n = findNode(state.tree, state.activeAssistantId);
          if (n) n.memories = (n.memories || []).concat(data.items || []);
          loadMemory();
        } else if (ev === 'tool_start') {
          const n = findNode(state.tree, state.activeAssistantId);
          if (n) {
            n.tool_runs = (n.tool_runs || []).concat([
              { code: data.code || '', running: true, ok: true, files: [] },
            ]);
          }
          renderMessages();
          bindStreamRefs();
          appendLog('▶ запуск кода…');
        } else if (ev === 'tool') {
          const n = findNode(state.tree, state.activeAssistantId);
          if (n) {
            const runs = n.tool_runs || [];
            const idx = runs.findIndex(r => r.running);
            if (idx >= 0) runs[idx] = data; else runs.push(data);
            n.tool_runs = runs;
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
        } else if (ev === 'ask') {
          const n = findNode(state.tree, state.activeAssistantId);
          if (n) n.ask = data.question;
          renderMessages();
          bindStreamRefs();
        } else if (ev === 'done') {
          const n = findNode(state.tree, data.message_id) ||
            findNode(state.tree, state.activeAssistantId);
          if (n) {
            n.status = 'completed';
            n.content = data.text || state.streamBuf;
            n.draft = ''; n.creating = false;
          }
          renderMessages({ focusMessageId: n ? n.id : null });
          // Start the complete preprocess -> TTS pipeline as soon as the final
          // answer arrives. It runs in the background and never blocks the chat.
          if (n && !state.readonly && String(n.content || '').trim() && !state.audioReady[n.id] && !state.audioPending[n.id]) {
            generateAnswerAudio(n.id).catch((err) => console.warn('Automatic answer audio failed:', err));
          }
          loadUsage();
        } else if (ev === 'error') {
          const n = findNode(state.tree, data.message_id) ||
            findNode(state.tree, state.activeAssistantId);
          if (n) { n.status = 'failed'; n.creating = false; n.error = data.error; }
          renderMessages();
        } else if (ev === 'cancelled') {
          const n = findNode(state.tree, data.message_id) ||
            findNode(state.tree, state.activeAssistantId);
          if (n) { n.status = 'cancelled'; n.creating = false; if (data.text) n.content = data.text; }
          renderMessages();
        }
      });
    } catch (err) {
      console.error(err);
      const friendlyError = watchdogExpired
        ? (responseReceived
          ? 'Ответ остановился без новых событий более 330 секунд. Можно отправить запрос ещё раз.'
          : 'Сервер не начал ответ за 120 секунд. Текст запроса сохранён — попробуйте ещё раз.')
        : usefulErrorMessage(err, 'Неизвестная ошибка при отправке запроса');
      if (!responseReceived && opts && opts.optimistic && opts.input) {
        restoreUnsentDraft(opts.input, opts.draft || '');
        const unsent = Array.isArray(opts.attachments) ? opts.attachments : [];
        if (unsent.length) {
          const present = new Set(state.pendingAttachments.map(f => f.id));
          state.pendingAttachments = unsent.filter(f => !present.has(f.id)).concat(state.pendingAttachments);
          renderAttachments();
        }
      }
      toast('Ошибка: ' + friendlyError, 'error');
      // the optimistic messages must not hang — turn them into a plain error
      const a = state.activeAssistantId ? findNode(state.tree, state.activeAssistantId) : null;
      if (a && a.status !== 'completed' && a.status !== 'cancelled') {
        a.status = 'failed'; a.creating = false;
        a.error = (err && err.message) ? err.message : 'запрос не прошёл';
        renderMessages();
      }
      // if the server never answered at all, the synthetic bubble is a ghost:
      // drop it and re-sync from the real history so nothing stays on screen
      const ghost = state.tmpAssistant ? findNode(state.tree, state.tmpAssistant.id) : null;
      if (ghost && /^tmp_/.test(ghost.id) && state.currentChatId) {
        // Recovery must never block finally/state reset; the network call itself
        // may be the reason this request failed in the first place.
        const recoveryChatId = state.currentChatId;
        openChat(recoveryChatId).catch((e) => console.warn('Chat recovery failed:', e));
      }
      // forget temporary ids so a retry starts a clean branch
      state.tmpUser = null; state.tmpAssistant = null;
    } finally {
      if (watchdog) clearTimeout(watchdog);
      setStreaming(false);
      // Limits and sidebar refresh happen in the background and cannot hold the
      // send controls hostage if a secondary endpoint is slow.
      setTimeout(() => { loadLimits().then(loadUsage).catch((e) => console.warn('Limits refresh failed:', e)); }, 250);
      if (state.genTimer) { clearInterval(state.genTimer); state.genTimer = null; }
      state.streamEl = null;
      loadChats().catch((e) => console.warn('Chat list refresh failed:', e));
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

  function usefulErrorMessage(err, fallback) {
    const raw = err && typeof err.message === 'string' ? err.message : (typeof err === 'string' ? err : '');
    const value = raw.trim();
    if (!value || value === 'null' || value === 'undefined' || value === '[object Object]') {
      return fallback || 'Неизвестная ошибка сервера';
    }
    return value;
  }

  function setSendPreparing(on) {
    const btn = $('#send-btn');
    if (!btn) return;
    btn.disabled = !!on;
    btn.classList.toggle('preparing', !!on);
    btn.setAttribute('aria-busy', String(!!on));
    btn.title = on ? 'Подготавливаю запрос…' : 'Отправить';
  }

  function restoreUnsentDraft(input, draft) {
    if (!input) return;
    const current = input.value || '';
    if (!current.trim()) {
      input.value = draft;
    } else if (current !== draft && !current.includes(draft)) {
      // Preserve both the failed request and any text typed while it was being prepared.
      input.value = draft + '\n\n' + current;
    }
    autoGrow();
    input.focus();
  }

  async function sendCurrent() {
    const input = $('#input');
    if (!input) return;
    const draft = input.value;
    const content = draft.trim();
    if (!content || state.streaming || state.sending) return;

    // Validate pending attachments before reading IDs; a stale/null item must not abort sending.
    const pending = Array.isArray(state.pendingAttachments) ? state.pendingAttachments : [];
    const hasInvalidAttachment = pending.some(f =>
      !f || typeof f !== 'object' || typeof f.id !== 'string' || !f.id
    );
    if (hasInvalidAttachment) {
      state.pendingAttachments = pending.filter(f =>
        f && typeof f === 'object' && typeof f.id === 'string' && f.id
      );
      renderAttachments();
      toast('Одно из вложений устарело. Прикрепите этот файл заново; текст запроса сохранён.', 'error');
      return;
    }
    // Freeze the current attachment selection; new attachments stay for the next message.
    const sentAttachments = pending.slice();
    const attachments = sentAttachments.map(f => f.id);
    const attList = sentAttachments.map(f => ({
      file_id: f.id, name: f.original_name || f.name || 'файл',
      kind: f.kind || 'other', size: f.size || 0,
    }));
    const isNewChat = !state.currentChatId;

    state.sending = true;
    setSendPreparing(true);
    let requestStarted = false;
    try {
      // Create the chat and send its first message via one request.
      if (isNewChat) {
        state.tree = [];
        state.choices = {};
      }
      const path = activePath(state.tree, state.choices);
      const lastPathEntry = path.length ? path[path.length - 1] : null;
      const parentId = !isNewChat && lastPathEntry && lastPathEntry.node && lastPathEntry.node.id
        ? lastPathEntry.node.id
        : null;

      const userId = 'tmp_u_' + Date.now().toString(36);
      const asstId = 'tmp_a_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const userNode = {
        id: userId, role: 'user', content, status: 'completed',
        parent_message_id: parentId, attachments: attList, children: [],
        created_at: new Date().toISOString(),
      };
      const asstNode = {
        id: asstId, role: 'assistant', content: '', status: 'processing',
        parent_message_id: userId, children: [],
        created_at: new Date().toISOString(),
        creating: true, creatingLabel: isNewChat ? 'Создаю чат и отправляю запрос…' : 'Запрос отправляется…',
        error: null,
      };
      const parentNode = parentId ? findNode(state.tree, parentId) : null;
      if (parentNode) {
        parentNode.children = parentNode.children || [];
        parentNode.children.push(userNode, asstNode);
      } else {
        state.tree.push(userNode, asstNode);
      }
      state.activeAssistantId = asstId;
      renderMessages();

      const sentIds = new Set(attachments);
      state.pendingAttachments = state.pendingAttachments.filter(f => !sentIds.has(f.id));
      renderAttachments();

      state.tmpUser = { id: userId, content };
      state.tmpAssistant = { id: asstId };
      const endpoint = isNewChat
        ? '/api/new-chat/messages'
        : '/api/chats/' + encodeURIComponent(state.currentChatId) + '/messages';
      const request = streamRequest(endpoint, {
        content,
        parent_message_id: parentId,
        attachment_ids: attachments,
        model_set_id: state.modelSetId || null,
        web_search: true,
        effort: state.effort,
        style: state.style,
      }, { optimistic: true, input, draft, attachments: sentAttachments });
      requestStarted = true;

      // Clear only after the network request has actually started. If it fails
      // before the SSE stream opens, streamRequest restores the text and files.
      if (input.value === draft) {
        input.value = '';
        autoGrow();
      }
      state.sending = false;
      setSendPreparing(false);
      await request;
      state.tmpUser = null;
      state.tmpAssistant = null;
    } catch (err) {
      console.error(err);
      const message = usefulErrorMessage(err, 'Неизвестная ошибка при подготовке запроса');
      if (!requestStarted) {
        if (!(input.value || '').trim()) restoreUnsentDraft(input, draft);
        toast('Не удалось начать отправку: ' + message + '. Текст сохранён.', 'error');
      } else {
        toast('Ошибка при отправке запроса: ' + message, 'error');
      }
      state.tmpUser = null;
      state.tmpAssistant = null;
    } finally {
      state.sending = false;
      setSendPreparing(false);
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
    // The server uses one primary model for all AI tasks.
    if ($('#context-btn')) $('#context-btn').addEventListener('click', openUsageModal);
    if ($('#project-btn')) $('#project-btn').addEventListener('click', () => toggleProjectPanel());
    if ($('#pp-close')) $('#pp-close').addEventListener('click', () => toggleProjectPanel(false));
    if ($('#pp-refresh')) $('#pp-refresh').addEventListener('click', () => loadProject(true));
    if ($('#pp-git')) $('#pp-git').addEventListener('click', openGit);
  }

  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(n);
  }

  // percent of the plan's dollar budget spent inside the rolling window
  function windowUsage() {
    const w = (state.limits && state.limits.window) || null;
    if (!w || !w.budget_usd) return null;
    return w;
  }

  function planUsage() {
    const data = state.limits || {};
    const lim = data.limits || {};
    const use = data.usage || {};
    const defs = [
      ['files', 'files_count', 'Файлы', 'шт'],
      ['storage', 'user_storage', 'Хранилище', ' Б'],
      ['requests', 'messages_per_day', 'Запросы в день', 'шт'],
    ];
    const rows = [];
    defs.forEach(d => {
      const used = Number(use[d[0]] || 0);
      const cap = lim[d[1]];
      const unlimited = (cap === null || cap === undefined);
      const pct = unlimited ? 0 : Math.min(100, Math.round(used / cap * 100));
      rows.push({ key: d[0], label: d[2], unit: d[3], used: used, cap: cap, unlimited: unlimited, pct: pct });
    });
    const worst = rows.reduce((m, r) => (r.unlimited ? m : Math.max(m, r.pct)), 0);
    return { rows: rows, worst: worst, plan: data.plan || 'free' };
  }

  function paintUsage(pct, note) {
    const btn = $('#context-btn');
    if (!btn) return;
    const label = $('#usage-pct');
    const bar = $('#usage-bar');
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    if (label) label.textContent = p + '%';
    if (bar) bar.style.width = p + '%';
    btn.classList.toggle('warn', p >= 80);
    btn.classList.toggle('full', p >= 100);
    btn.title = note;
  }

  async function loadUsage() {
    if (!$('#context-btn')) return;
    if (!state.limits) await loadLimits();
    const w = windowUsage();
    if (w) {
      paintUsage(w.percent,
        'Израсходовано $' + Number(w.spend_usd).toFixed(2) + ' из $' + w.budget_usd +
        ' за ' + w.hours + ' ч · осталось $' +
        Math.max(0, w.budget_usd - w.spend_usd).toFixed(2));
      return;
    }
    const info = planUsage();
    paintUsage(info.worst, 'Использование лимитов подписки: ' + info.worst + '%');
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

  async function loadLimits() {
    try { state.limits = await api.get('/api/limits'); }
    catch (e) { state.limits = null; }
  }

  async function openContextMenu() {
    if (!state.currentChatId) { toast('Сначала откройте чат', 'error'); return; }
    let u;
    try { u = await api.get('/api/chats/' + state.currentChatId + '/usage'); }
    catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
    state.usage = u;
    const barW = Math.min(100, Math.max(0, u.percent || 0));
    const lim = (state.limits && state.limits.limits) || {};
    const cmin = Number(lim.compress_min != null ? lim.compress_min : 5);
    const cmax = Number(lim.compress_max != null ? lim.compress_max : 85);
    const cdef = Math.max(cmin, Math.min(cmax, Math.round((cmin + cmax) / 2 / 5) * 5));
    const perDay = lim.compress_per_day;
    openModal({
      title: 'Контекст и проценты',
      okText: 'Закрыть',
      body: '<h4 class="sec">Контекст и проценты</h4>' +
        usageCards(u) +
        '<div class="usage-bar"><i style="width:' + barW + '%"></i></div>' +
        '<p class="usage-note">Окно модели — ' + fmtNum(u.context_len) + ' токенов. ' +
        'Резюме истории: ' + (u.summary_chars ? fmtNum(u.summary_chars) + ' симв.' : 'нет') + '. ' +
        'Усилие: ' + escapeHtml(u.effort || 'recommended') + '.</p>' +
        '<label style="margin-top:14px">Сжать историю до <b id="cmp-val">' + cdef + '</b>%</label>' +
        '<input type="range" id="cmp-range" class="orange-range" min="' + cmin + '" max="' + cmax +
        '" step="5" value="' + cdef + '" />' +
        '<p class="usage-note">Ваш тариф («' + escapeHtml((state.limits && state.limits.plan) || 'free') +
        '»): сжатие от ' + cmin + '% до ' + cmax + '%' +
        (perDay != null ? ' · до ' + perDay + ' сжатий в день' : ' · без лимита сжатий') + '.</p>' +
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
    // The client no longer selects a model set; the server always uses one primary MAIN model.
    // Keep the set list for admin tools only, never send the Auto Routing set as a selection.
    state.modelSetId = '';
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
    const q = (state.fileQuery || '').toLowerCase();
    const kind = state.fileKind || 'all';
    let items = state.files || [];
    if (q) items = items.filter(f => (f.original_name || '').toLowerCase().includes(q));
    if (kind !== 'all') {
      items = items.filter(f => {
        const k = f.kind || 'other';
        if (kind === 'image') return k === 'image';
        if (kind === 'doc') return ['pdf', 'doc', 'docx', 'txt', 'md', 'code', 'text'].includes(k);
        if (kind === 'table') return ['sheet', 'csv', 'xlsx'].includes(k);
        if (kind === 'slide') return k === 'slide' || k === 'presentation';
        return !['image', 'pdf', 'doc', 'docx', 'txt', 'md', 'code', 'text', 'sheet', 'csv', 'xlsx', 'slide'].includes(k);
      });
    }
    if (!items.length) {
      box.innerHTML = '<div class="side-empty">' +
        (state.files.length ? 'Ничего не найдено' : 'Файлов пока нет') + '</div>';
      return;
    }
    box.innerHTML = items.map(f =>
      '<div class="file-item">' +
        '<span class="fi-kind">' + kindIcon(f.kind) + '</span>' +
        '<span class="fi-name" title="' + escapeHtml(f.original_name) + '">' + escapeHtml(f.original_name) + '</span>' +
        '<span class="fi-size">' + formatSize(f.size) + '</span>' +
        '<a class="fi-btn" href="/api/files/' + f.id + '/download" title="Скачать" download>' +
        icon('download') + '</a>' +
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
    $('#mem-quick-btn').addEventListener('click', () => openMemory());
    $('#close-files-btn').addEventListener('click', () => toggleFiles(false));
    $('#upload-btn').addEventListener('click', () => $('#file-input').click());
    $('#file-search').addEventListener('input', (e) => {
      state.fileQuery = e.target.value.trim();
      renderFiles();
    });
    $('#file-filter').addEventListener('change', (e) => {
      state.fileKind = e.target.value;
      renderFiles();
    });
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

  // live cost estimate for a model: prices are $ per 1M tokens
  function wireCostCalc(root, calcId, ids) {
    const box = $('#' + calcId, root);
    if (!box) return;
    const get = (id) => { const n = $('#' + id, root); return n ? (parseFloat(n.value) || 0) : 0; };
    const upd = () => {
      const pin = get(ids.in), pout = get(ids.out), pcache = get(ids.cache);
      const ctx = get(ids.ctx), mx = get(ids.max);
      const full = (pin * ctx) / 1e6 + (pout * mx) / 1e6;
      const short = (pin * 1000) / 1e6 + (pout * 500) / 1e6;
      box.innerHTML =
        '<div class="calc-line"><span>Вход</span><b>$' + pin + ' / 1M токенов</b></div>' +
        '<div class="calc-line"><span>Выход</span><b>$' + pout + ' / 1M токенов</b></div>' +
        '<div class="calc-line"><span>Кэш</span><b>$' + pcache + ' / 1M токенов</b></div>' +
        '<div class="calc-line total"><span>Короткий ответ (1k контекст + 0.5k ответ)</span><b>≈ $' +
          short.toFixed(5) + '</b></div>' +
        '<div class="calc-line total"><span>Полный контекст ' + fmtNum(ctx) + ' + ответ ' +
          fmtNum(mx) + '</span><b>≈ $' + full.toFixed(4) + '</b></div>' +
        (pout ? '<div class="calc-line"><span>1000 таких ответов</span><b>≈ $' +
          (full * 1000).toFixed(2) + '</b></div>' : '');
    };
    $$('input', root).forEach(i => {
      i.addEventListener('input', upd);
      i.addEventListener('change', upd);
    });
    upd();
  }

  function adminForm(root, title, fields, onSubmit, done) {
    root.innerHTML = '<div class="modal-back"><div class="modal wide"><h3>' + escapeHtml(title) + '</h3>' +
      '<div class="modal-body lim-plans">' + fields.map(f =>
        f.type === 'html' ? (f.html || '') :
        '<label>' + escapeHtml(f.label) +
        (f.type === 'select'
          ? '<select id="' + f.id + '">' + f.options.map(o => '<option>' + escapeHtml(o) + '</option>').join('') + '</select>'
          : '<input id="' + f.id + '" type="' + (f.type || 'text') + '"' +
            (f.value !== undefined ? ' value="' + escapeHtml(f.value) + '"' : '') +
            (f.placeholder ? ' placeholder="' + escapeHtml(f.placeholder) + '"' : '') +
            (f.calc ? ' data-calc="1" inputmode="decimal"' : '') + ' />') +
        (f.note ? '<span class="field-note">' + f.note + '</span>' : '') +
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
              '<span class="ms-price">' + (e.price_in || e.price_out
                ? '$' + (e.price_in || 0) + ' / $' + (e.price_out || 0)
                : '—') + '</span>' +
              '<button data-edit-entry="' + s.id + '|' + e.id + '" title="Модель, цены, контекст, лимит ответа">Изменить</button>' +
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
      $$('[data-del-entry]', root).forEach(b => {
        const [sid, eid] = b.dataset.delEntry.split('|');
        b.addEventListener('click', async () => {
          await api.del('/api/admin/model-sets/' + sid + '/entries/' + eid); rerender();
        });
      });
      $$('[data-edit-entry]', root).forEach(b => {
        const [sid, eid] = b.dataset.editEntry.split('|');
        b.addEventListener('click', () => editEntryForm(root, sid, eid, rerender));
      });
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
    adminForm(root, 'Добавить модель в набор', [
      { id: 'me-url', label: 'Base URL', placeholder: 'https://…/v1' },
      { id: 'me-model', label: 'Модель', placeholder: 'qwen36-35b' },
      { id: 'me-key', label: 'API-ключ', placeholder: 'sk-…' },
      { id: 'me-pos', label: 'Позиция', type: 'number', value: '0' },
      { id: 'me-temp', label: 'Temperature', type: 'number', value: '0.2' },
      { id: 'me-max', label: 'Максимум токенов в ОТВЕТЕ', type: 'number', value: '32000', calc: true },
      { id: 'me-ctx', label: 'Максимальный КОНТЕКСТ, токенов (0 = общий)', type: 'number', value: '0', calc: true },
      { id: 'me-pin', label: 'Цена входа, $ за 1M токенов', type: 'number', value: '0', calc: true },
      { id: 'me-pout', label: 'Цена выхода, $ за 1M токенов', type: 'number', value: '0', calc: true },
      { id: 'me-pcache', label: 'Цена кэша, $ за 1M токенов', type: 'number', value: '0', calc: true },
      { type: 'html', html: '<div id="me-calc" class="field-calc"></div>' },
    ], async () => {
      await api.post('/api/admin/model-sets/' + setId + '/entries', {
        base_url: $('#me-url').value.trim(),
        model: $('#me-model').value.trim(),
        api_key: $('#me-key').value,
        position: parseInt($('#me-pos').value, 10) || 0,
        temperature: parseFloat($('#me-temp').value) || 0.2,
        max_tokens: parseInt($('#me-max').value, 10) || 32000,
        context_len: parseInt($('#me-ctx').value, 10) || 0,
        price_in: parseFloat($('#me-pin').value) || 0,
        price_out: parseFloat($('#me-pout').value) || 0,
        price_cache: parseFloat($('#me-pcache').value) || 0,
      });
    }, done);
    wireCostCalc(root, 'me-calc',
      { in: 'me-pin', out: 'me-pout', cache: 'me-pcache', ctx: 'me-ctx', max: 'me-max' });
  }

  async function editEntryForm(root, setId, entryId, done) {
    let entry = null;
    try {
      const sets = await api.get('/api/models/sets');
      (sets || []).forEach(s => {
        (s.entries || []).forEach(e => { if (e.id === entryId) entry = e; });
      });
    } catch (e) { /* ignore */ }
    if (!entry) { toast('Модель не найдена', 'error'); return; }
    adminForm(root, 'Модель: ' + (entry.model || ''), [
      { id: 'ee-model', label: 'Модель', value: entry.model || '' },
      { id: 'ee-url', label: 'Base URL', value: entry.base_url || '' },
      { id: 'ee-key', label: 'API-ключ (пусто = не менять)', placeholder: 'sk-…' },
      { id: 'ee-temp', label: 'Temperature', type: 'number', value: String(entry.temperature != null ? entry.temperature : 0.2) },
      { id: 'ee-max', label: 'Максимум токенов в ОТВЕТЕ', type: 'number', value: String(entry.max_tokens || 32000), calc: true },
      { id: 'ee-ctx', label: 'Максимальный КОНТЕКСТ, токенов (0 = общий)', type: 'number', value: String(entry.context_len || 0), calc: true },
      { id: 'ee-pin', label: 'Цена входа, $ за 1M токенов', type: 'number', value: String(entry.price_in || 0), calc: true },
      { id: 'ee-pout', label: 'Цена выхода, $ за 1M токенов', type: 'number', value: String(entry.price_out || 0), calc: true },
      { id: 'ee-pcache', label: 'Цена кэша, $ за 1M токенов', type: 'number', value: String(entry.price_cache || 0), calc: true },
      { type: 'html', html: '<div id="ee-calc" class="field-calc"></div>' },
    ], async () => {
      const body = {
        model: $('#ee-model').value.trim(),
        base_url: $('#ee-url').value.trim(),
        temperature: parseFloat($('#ee-temp').value) || 0.2,
        max_tokens: parseInt($('#ee-max').value, 10) || 32000,
        context_len: parseInt($('#ee-ctx').value, 10) || 0,
        price_in: parseFloat($('#ee-pin').value) || 0,
        price_out: parseFloat($('#ee-pout').value) || 0,
        price_cache: parseFloat($('#ee-pcache').value) || 0,
      };
      const key = $('#ee-key').value;
      if (key) body.api_key = key;
      await api.patch('/api/admin/model-sets/' + setId + '/entries/' + entryId, body);
      toast('Модель обновлена');
    }, done);
    wireCostCalc(root, 'ee-calc',
      { in: 'ee-pin', out: 'ee-pout', cache: 'ee-pcache', ctx: 'ee-ctx', max: 'ee-max' });
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
    $('#sidebar-limits-btn').addEventListener('click', openLimits);
    // Код-агент и Консилиум убраны из интерфейса — обработчиков больше нет
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
    $('#messages').addEventListener('scroll', () => {
      const box = $('#messages');
      state.stickBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 70;
    });
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
          '<p class="usage-note">Поиск в интернете: всегда включён · Память: ' +
          ((state.memories || []).length) + ' записей<br/>' +
          'Тема: тёплая светлая (Claude-like); тёмная — автоматически по системе.</p>' +
          (isAdmin ? '<h4 class="sec">Состояние сервера</h4>' : '') +
          (isAdmin ? '<div id="sys-block">' + systemRowsHtml() + '</div>' : '') +
          '<h4 class="sec">Разделы</h4>' +
          '<div class="settings-grid">' +
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
      body: '<p class="usage-note">Все участники отвечают <b>в этом же чате</b> и параллельно. ' +
        'Переключай ответы стрелками ‹ › под сообщением — последний вариант «Совет» ' +
        'сводит их в один общий ответ.</p>' +
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

  // ---------- server load ----------
  async function loadSystem() {
    try { state.system = await api.get('/api/system'); }
    catch (e) { /* noop */ }
  }

  function systemRowsHtml() {
    const s = state.system;
    if (!s) return '<p class="usage-note">Загрузка…</p>';
    const row = (label, pct, note) =>
      '<div class="sys-row"><span>' + label + '</span>' +
      '<i><b style="width:' + Math.min(100, Math.max(0, pct)) + '%"></b></i>' +
      '<u>' + pct + '%</u></div>' +
      '<div class="sys-note">' + note + '</div>';
    return row('Процессор', s.cpu, 'load average: ' + s.load.map(v => v.toFixed(2)).join(' · ') +
        ' · ядер: ' + s.cpus) +
      row('Оперативная память', s.ram_pct, 'занято ' + formatSize(s.ram_used) +
        ' из ' + formatSize(s.ram_total)) +
      row('Диск', s.disk_pct, 'занято ' + formatSize(s.disk_used) +
        ' из ' + formatSize(s.disk_total) + ' · свободно ' + formatSize(s.disk_free)) +
      '<p class="usage-note">Квота на пользователя: ' + formatSize(s.quota) +
      '. При нехватке места самые старые файлы удаляются автоматически.</p>';
  }

  // ---------- plan limits ----------
  async function openLimits() {
    let data;
    try { data = await api.get('/api/limits/all'); }
    catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
    const labels = data.labels || {};
    const bytes = { file_size: 1, user_storage: 1 };
    const field = (plan, key, value) => {
      const isBytes = bytes[key];
      const shown = isBytes ? Math.round((value || 0) / (1024 * 1024)) : (value === null ? '' : value);
      return '<label class="lim-field"><span>' + escapeHtml(labels[key] || key) +
        (isBytes ? ' <em>МБ</em>' : '') + '</span>' +
        '<input type="number" data-plan="' + plan + '" data-key="' + key + '" value="' +
        shown + '" placeholder="∞" /></label>';
    };
    const modelBoxes = (plan) => {
      const allowed = data.allowed[plan] || [];
      const open = allowed.length === 0;
      return '<div class="lim-models">' + (data.models || []).map(m =>
        '<label class="council-row"><input type="checkbox" data-mplan="' + plan +
        '" data-mid="' + m.id + '"' + (open || allowed.indexOf(m.id) >= 0 ? ' checked' : '') +
        '/><span><b>' + escapeHtml(m.name) + '</b></span></label>').join('') +
        '<p class="usage-note">Ничего не отмечено = разрешены все модели.</p></div>';
    };
    const lf = data.limits.free || {};
    const lp = data.limits.pro || {};
    const tableKeys = Array.from(new Set(Object.keys(lf).concat(Object.keys(lp)))).filter(key => key !== 'posts');
    const rowFor = (key) => '<tr><td class="lk">' + escapeHtml(labels[key] || key) +
      (bytes[key] ? ' <em>МБ</em>' : '') + '</td>' +
      '<td>' + field('free', key, lf[key]) + '</td>' +
      '<td>' + field('pro', key, lp[key]) + '</td></tr>';
    const block = (plan) =>
      '<div class="lim-plan"><h5>Модели тарифа ' + plan.toUpperCase() + '</h5>' +
      modelBoxes(plan) + '</div>';
    openModal({
      title: 'Тарифы, лимиты и деньги',
      okText: 'Сохранить',
      body: '<p class="usage-note">Пустое поле — без ограничения. Размеры в мегабайтах, ' +
        'деньги в долларах ($). Настройка действует для всех действий: файлы, чаты, ' +
        'код-агенты, шаги агента, консилиум, запуск кода, озвучивание ответов, цена тарифа и цена токенов.</p>' +
        '<table class="lim-table"><thead><tr><th>Лимит</th>' +
        '<th>Free<button class="reset-plan" data-reset-plan="free">сбросить</button></th>' +
        '<th>Pro<button class="reset-plan" data-reset-plan="pro">сбросить</button></th>' +
        '</tr></thead>' +
        '<tbody>' + tableKeys.map(rowFor).join('') + '</tbody></table>' +
        '<div class="lim-plans">' + (data.plans || ['free', 'pro']).map(block).join('') + '</div>' +
        '<h4 class="sec">Пользователи</h4><div id="lim-users">Загрузка…</div>',
      onOk: async (root) => {
        const grouped = {};
        $$('[data-plan]', root).forEach(inp => {
          const plan = inp.dataset.plan;
          const key = inp.dataset.key;
          const raw = inp.value.trim();
          let val = raw === '' ? null : Number(raw);
          if (val !== null && bytes[key]) val = Math.round(val * 1024 * 1024);
          grouped[plan] = grouped[plan] || {};
          grouped[plan][key] = val;
        });
        for (const plan of Object.keys(grouped)) {
          await api.put('/api/limits/' + plan, grouped[plan]);
        }
        for (const plan of (data.plans || [])) {
          const ids = $$('[data-mplan="' + plan + '"]', root)
            .filter(c => c.checked).map(c => c.dataset.mid);
          const all = (data.models || []).map(m => m.id);
          await api.put('/api/limits/' + plan + '/models',
            { ids: ids.length === all.length ? [] : ids });
        }
        toast('Тарифы сохранены');
        return true;
      },
    });
    loadLimitUsers();
    $$('[data-reset-plan]', $('#modal-root')).forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Сбросить лимиты тарифа ' + b.dataset.resetPlan.toUpperCase() +
                   ' к значениям по умолчанию?')) return;
      try {
        await api.post('/api/limits/' + b.dataset.resetPlan + '/reset', {});
        toast('Лимиты ' + b.dataset.resetPlan.toUpperCase() + ' сброшены');
        const root = $('#modal-root');
        root.innerHTML = '';
        await openLimits();
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));
  }

  async function loadLimitUsers() {
    const box = $('#lim-users');
    if (!box) return;
    let rows = [];
    try { rows = await api.get('/api/limits/users'); } catch (e) { rows = []; }
    box.innerHTML = '<div class="link-list">' + rows.map(u =>
      '<div class="link-row"><div class="link-info"><b>' + escapeHtml(u.name || u.email) + '</b>' +
      '<span>' + escapeHtml(u.email) + ' · запросов: ' + u.requests +
      ' · токенов: ' + fmtNum(u.tokens_in + u.tokens_out) +
      ' · файлы: ' + formatSize(u.storage) +
      ' · тариф $' + u.plan_price + ' · расход $' + u.cost + '</span></div>' +
      '<button class="chip-btn" data-uplan="' + u.id + '">' +
      (u.plan === 'pro' ? '→ Free' : '→ Pro') + '</button></div>').join('') +
      '</div>';
    $$('[data-uplan]').forEach(b => b.addEventListener('click', async () => {
      const cur = rows.find(x => x.id === b.dataset.uplan);
      const next = cur && cur.plan === 'pro' ? 'free' : 'pro';
      try {
        await api.put('/api/limits/user/' + b.dataset.uplan, { plan: next });
        toast('Тариф изменён: ' + next);
        loadLimitUsers();
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    }));
  }

  // ---------- GitHub for the code agent ----------
  async function openGit() {
    if (!state.currentChatId) { toast('Откройте проект', 'error'); return; }
    let me = { connected: false, login: '' };
    try { me = await api.get('/api/github/me'); } catch (e) { /* noop */ }
    let st = { initialized: false };
    try { st = await api.get('/api/github/chats/' + state.currentChatId + '/status'); }
    catch (e) { /* noop */ }
    openModal({
      title: 'GitHub · ' + (st.initialized ? 'репозиторий готов' : 'не подключён'),
      okText: 'Закрыть',
      body:
        '<h4 class="sec">Аккаунт</h4>' +
        '<div class="lim-grid">' +
        '<label class="lim-field"><span>Логин GitHub</span>' +
        '<input id="gh-login" value="' + escapeHtml(me.login || '') + '" placeholder="username" /></label>' +
        '<label class="lim-field"><span>Токен (repo)</span>' +
        '<input id="gh-token" type="password" placeholder="' +
        (me.connected ? '•••••••• (сохранён)' : 'ghp_...') + '" /></label>' +
        '</div>' +
        '<div class="settings-grid" style="margin-top:10px">' +
        '<button class="chip-btn" id="gh-save">Сохранить доступ</button>' +
        (me.connected ? '<button class="chip-btn danger" id="gh-forget">Отключить</button>' : '') +
        '</div>' +
        '<h4 class="sec">Проект</h4>' +
        '<label class="lim-field"><span>Репозиторий (owner/repo)</span>' +
        '<input id="gh-repo" placeholder="user/my-project" /></label>' +
        '<div class="settings-grid" style="margin-top:10px">' +
        '<button class="chip-btn" id="gh-init">init</button>' +
        '<button class="chip-btn" id="gh-commit">commit</button>' +
        '<button class="chip-btn" id="gh-push">push</button>' +
        '<button class="chip-btn" id="gh-sync">commit + push</button>' +
        '</div>' +
        (st.initialized ? '<p class="usage-note">Ветка: <b>' + escapeHtml(st.branch || '') +
          '</b> · remote: ' + escapeHtml(st.remote || '—') + '<br/>' +
          escapeHtml((st.changes || 'нет изменений').slice(0, 400)) + '</p>' : '') +
        '<pre class="pp-logs" id="gh-log" style="margin-top:10px"></pre>',
      onOk: () => true,
    });
    const log = (t) => { const el = $('#gh-log'); if (el) el.textContent = String(t || '').slice(-4000); };
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    on('#gh-save', async () => {
      try {
        await api.post('/api/github/me', {
          login: $('#gh-login').value.trim(), token: $('#gh-token').value.trim(),
        });
        toast('Доступ сохранён');
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    });
    on('#gh-forget', async () => {
      try { await api.del('/api/github/me'); closeModal(); openGit(); }
      catch (e) { toast('Ошибка: ' + e.message, 'error'); }
    });
    ['init', 'commit', 'push', 'sync'].forEach(act => {
      on('#gh-' + act, async () => {
        log('выполняется ' + act + '…');
        try {
          const res = await api.post('/api/github/chats/' + state.currentChatId + '/git', {
            action: act,
            repo: ($('#gh-repo') || {}).value ? $('#gh-repo').value.trim() : '',
            message: 'Update from ChatStudio',
          });
          log((res.log || '') + (res.ok ? '\n✓ готово' : '\n✗ ошибка'));
          loadProject(false);
        } catch (e) { log('Ошибка: ' + e.message); }
      });
    });
  }

  // ---------- main page: action tiles ----------
  const ACTION_TILES = [
    {
      id: 'essay', label: 'Написать сочинение', icon: 'i-pencil', color: '#f2c14e',
      title: 'Сочинение',
      questions: '**Сочинение.** Ответьте, пожалуйста, на пару вопросов — и я сразу напишу.\n\n' +
        '1. Тема или вопрос сочинения?\n2. Объём (например, 250 слов / 2 страницы)?\n' +
        '3. Класс, курс или аудитория?\n4. Нужны аргументы из литературы или можно своими словами?\n\n' +
        'Можно ответить одной строкой — остальное подберу сам.',
    },
    {
      id: 'doc', label: 'Документ Word', icon: 'i-doc', color: '#2f6fb0',
      title: 'Документ Word',
      questions: '**Документ Word.** Чтобы получилось то, что нужно, уточните:\n\n' +
        '1. Тема и назначение документа?\n2. Какие разделы должны быть?\n' +
        '3. Примерный объём (страниц)?\n4. Нужен ли титульный лист и оглавление?\n5. Стиль оформления (деловой, научный, отчёт)?\n\n' +
        'Ответьте одной строкой — оформлю в лучшем виде.',
    },
    {
      id: 'slides', label: 'Презентация', icon: 'i-slides', color: '#55544f',
      title: 'Презентация',
      questions: '**Презентация.** Расскажите:\n\n' +
        '1. О чём презентация (тема)?\n2. Для кого (школа, инвесторы, коллеги)?\n' +
        '3. Сколько слайдов?\n4. Нужны ли графики и цифры?\n5. Стиль: Apple, Fluent, Glass, Neural, Minimal?\n\n' +
        'Достаточно одной строки.',
    },
    {
      id: 'sheet', label: 'Таблица Excel', icon: 'i-sheet', color: '#2f8f6f',
      title: 'Таблица Excel',
      questions: '**Таблица Excel.** Уточните:\n\n' +
        '1. Какие данные и по какой теме?\n2. Какие колонки нужны?\n' +
        '3. Нужны ли формулы, итоги и графики?\n4. Данные дадите вы или их надо придумать/собрать?\n\n' +
        'Ответьте одной строкой.',
    },
    {
      id: 'code', label: 'Написать код', icon: 'i-terminal', color: '#7c5cbf',
      title: 'Код',
      questions: '**Код.** Что нужно написать?\n\n' +
        '1. Задача и язык (Python, JS, SQL)?\n2. Есть ли входные данные или пример?\n' +
        '3. Нужны ли тесты и комментарии?\n\n' +
        'Если нужен полноценный проект с файлами — опишите задачу, я напишу код и файлы.',
    },
    {
      id: 'draw', label: 'Нарисовать схему', icon: 'i-sparkle', color: '#4b4a46',
      title: 'Схема',
      questions: '**Схема.** Опишите:\n\n' +
        '1. Что изобразить (блок-схема, чертёж, план, диаграмма)?\n' +
        '2. Какие элементы и связи между ними?\n3. Нужны ли размеры и подписи?\n\n' +
        'Нарисую в SVG — можно будет скачать.',
    },
    { id: 'image', label: 'Сделать график', icon: 'i-chart', color: '#0e7c9b', title: 'График',
      questions: '**График.** Какие данные построить? Пришлите числа или опишите, откуда их взять, и укажите тип графика (линия, столбцы, круговая).' },
    { id: 'research', label: 'Найти в интернете', icon: 'i-globe', color: '#3f7a3f', title: 'Поиск',
      questions: '**Поиск.** Что именно найти? Сформулируйте вопрос — я поищу в интернете и дам ответ со ссылками на источники.' },
    { id: 'explain', label: 'Объяснить простыми словами', icon: 'i-brain', color: '#a03f6f', title: 'Объяснение',
      questions: '**Объяснение.** Что объяснить? Напишите тему — объясню простыми словами, с примерами.' },
    { id: 'plan', label: 'Составить план', icon: 'i-file', color: '#4b4a46', title: 'План',
      questions: '**План.** Уточните:\n\n1. План чего (проект, обучение, неделя, статья)?\n2. На какой срок?\n3. Какие есть ограничения по времени и ресурсам?\n\nОтветьте одной строкой — составлю подробный план.' },
    { id: 'translate', label: 'Перевести', icon: 'i-globe-box', color: '#4a5568', title: 'Перевод',
      questions: '**Перевод.** Пришлите текст и укажите язык, на который перевести (и стиль: деловой, литературный, разговорный).' },
  ];

  // inline tile icon paths — drawn directly, so they render everywhere
  const TILE_PATHS = {
    pencil: '<path d="M4 20h4l10-10-4-4L4 16z"/><path d="M14 6l4 4"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
    slides: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/><path d="M7 8h6M7 11h4"/>',
    sheet: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18 16l.7 1.8L20.5 18.5l-1.8.7L18 21l-.7-1.8L15.5 18.5l1.8-.7z"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 17v-6M12.5 17V8M17 17v-9"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
    brain: '<path d="M9.6 4.6A2.6 2.6 0 0 0 7 7.2v.4A2.8 2.8 0 0 0 5.3 12.4 2.8 2.8 0 0 0 7 17.1v.3a2.6 2.6 0 0 0 5.2 0V5.9a2.6 2.6 0 0 0-2.6-1.3Z"/><path d="M14.4 4.6A2.6 2.6 0 0 1 17 7.2v.4a2.8 2.8 0 0 1 1.7 4.8A2.8 2.8 0 0 1 17 17.1v.3a2.6 2.6 0 0 1-5.2 0"/><path d="M12 4.6v15"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    link: '<path d="M9.5 14.5l5-5"/><path d="M11 7l1.5-1.5a3.5 3.5 0 1 1 5 5L16 12M13 17l-1.5 1.5a3.5 3.5 0 1 1-5-5L8 12"/>',
  };

  // maps old sprite ids (and bare names) onto the inline set
  const TILE_ALIAS = {
    'i-pencil': 'pencil', 'i-doc': 'doc', 'i-slides': 'slides', 'i-sheet': 'sheet',
    'i-terminal': 'terminal', 'i-sparkle': 'sparkle', 'i-chart': 'chart',
    'i-globe': 'globe', 'i-globe-box': 'globe', 'i-brain': 'brain',
    'i-file': 'file', 'i-link': 'link', 'i-search': 'globe',
  };

  function tileIcon(name) {
    const key = TILE_ALIAS[name] || name;
    const path = TILE_PATHS[key] || TILE_PATHS.sparkle;
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#ffffff" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
  }

  function tileHtml(t) {
    return '<span class="tile' + (t.locked ? ' locked' : '') + '"' +
      ' aria-hidden="true" title="' + escapeHtml(t.label) + '"' +
      ' style="--tile:' + t.color + '">' +
      '<span class="tile-ico">' + tileIcon(t.icon) + '</span>' +
      '<span class="tile-label">' + escapeHtml(t.label) + '</span>' +
      (t.locked ? '<span class="tile-lock">' + icon('lock') + '</span>' : '') + '</span>';
  }

  function renderTiles() {
    const box = $('#tiles');
    if (!box) return;
    const sequence = ACTION_TILES.map(tileHtml).join('');
    // Duplicate artwork only to make the moving row loop smoothly; no icon is a button.
    box.innerHTML = '<div class="tile-track">' +
      '<div class="tile-sequence">' + sequence + '</div>' +
      '<div class="tile-sequence" aria-hidden="true">' + sequence + '</div>' +
      '</div>';
  }


  function bindTiles() {
    $$('[data-tile]').forEach(b => b.addEventListener('click', () => {
      const t = ACTION_TILES.find(x => x.id === b.dataset.tile);
      if (!t) return;
      if (t.locked) {
        toast('«' + t.label + '» появится в ближайшем обновлении — уже пишем', 'error');
        return;
      }
      useTile(t);
    }));
  }

  async function useTile(t) {
    let chat;
    try {
      chat = await api.post('/api/chats', { title: t.title || t.label });
    } catch (e) { toast('Ошибка: ' + e.message, 'error'); return; }
    state.chats.unshift(chat);
    renderChatList();
    await openChat(chat.id);
    if (t.questions) {
      try {
        await api.post('/api/chats/' + chat.id + '/seed', { text: t.questions });
        state.tree = await api.get('/api/chats/' + chat.id + '/messages');
        renderMessages();
      } catch (e) { toast('Ошибка: ' + e.message, 'error'); }
      toast('Ответьте на вопросы — и я приступлю');
      $('#input').focus();
    } else {
      $('#input').focus();
    }
  }

  function rotateTiles() {
    const box = $('#tiles');
    if (!box) return;
    box.classList.add('swap');
    setTimeout(() => {
      renderTiles();
      bindTiles();
      box.classList.remove('swap');
    }, 420);
  }

  // ---------- model choice ----------
  // There is no model picker: the backend uses one primary MAIN model for every AI task.
  function currentModelSet() {
    return null;
  }

  function updateModelButton() {
    // no model button in the composer anymore
  }

  // playful composer placeholders
  const PLACEHOLDERS = [
    'Жду указаний…', 'Слушаю, мой повелитель…', 'Что изволите?', 'Приказывайте…',
    'Готов служить…', 'Ваше слово?', 'Я весь внимание…', 'Жду вашу мудрую мысль…',
    'Повелевайте…', 'Скажите слово — и я начну…', 'Ваш ход, господин…',
    'Куда направим усилия?', 'Слушаю и повинуюсь…', 'Излагайте, я записываю…',
  ];

  function rollPlaceholder() {
    const el = $('#input');
    if (!el) return;
    el.placeholder = PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)];
  }

// ---------- subscription limits window ----------
  function limitValueLabel(key, value) {
    if (value === null || value === undefined) return 'без лимита';
    if (key === 'user_storage' || key === 'file_size') return formatSize(value);
    return fmtNum(value);
  }

  function planCompareHtml(lim, compare) {
    const pro = (compare && compare.pro) || {};
    const order = ['budget_usd', 'window_hours', 'audio_generations', 'file_size', 'user_storage', 'files_count',
                   'chats_count', 'messages_per_day', 'code_agents',
                   'agent_steps', 'council_members', 'sandbox_seconds'];
    const labels = {
      budget_usd: 'Бюджет на окно, $', window_hours: 'Окно, часов',
      audio_generations: 'Голосовых ответов за окно',
      file_size: 'Размер файла', user_storage: 'Хранилище', files_count: 'Файлов всего',
      chats_count: 'Чатов всего', messages_per_day: 'Сообщений в день',
      code_agents: 'Код-агентов', agent_steps: 'Шагов агента',
      council_members: 'Участников консилиума', sandbox_seconds: 'Секунд на код',
    };
    const rows = order.filter(k => lim[k] !== undefined || pro[k] !== undefined).map(k => {
      const mine = lim[k];
      const theirs = pro[k];
      let mult = '—';
      if (theirs === null || theirs === undefined) mult = '∞';
      else if (mine === null || mine === undefined) mult = '=';
      else if (Number(mine) > 0) {
        const m = Number(theirs) / Number(mine);
        mult = m >= 1.05 ? '×' + (Math.round(m * 10) / 10) : '=';
      }
      return '<tr><td>' + (labels[k] || k) + '</td>' +
        '<td>' + limitValueLabel(k, mine) + '</td>' +
        '<td class="pro-col">' + limitValueLabel(k, theirs) + '</td>' +
        '<td class="mult">' + mult + '</td></tr>';
    }).join('');
    const half = Math.ceil(rows.length / 2);
    const head = '<thead><tr><th>Лимит</th><th>Сейчас</th><th>С подпиской</th><th>×</th></tr></thead>';
    return '<div class="cmp-cols">' +
      '<table class="cmp">' + head + '<tbody>' + rows.slice(0, half).join('') + '</tbody></table>' +
      '<table class="cmp">' + head + '<tbody>' + rows.slice(half).join('') + '</tbody></table>' +
      '</div>';
  }

  async function openUsageModal() {
    await loadLimits();
    const data = state.limits || {};
    const lim = data.limits || {};
    const pro = (data.compare && data.compare.pro) || {};
    const plan = data.plan || 'free';
    const w = data.window || null;
    const use = data.usage || {};
    const proPrice = Number(pro.price || 0);

    let money = '';
    if (w && w.budget_usd) {
      const left = Math.max(0, Number(w.budget_usd) - Number(w.spend_usd));
      const pct = Math.min(100, Math.round(w.percent));
      money = '<div class="lim-row ' + (pct >= 80 ? 'warn' : '') + '">' +
        '<div class="lr-top"><b>Деньги за ' + w.hours + ' ч</b>' +
        '<i>$' + Number(w.spend_usd).toFixed(2) + ' из $' + Number(w.budget_usd).toFixed(2) +
        ' · осталось $' + left.toFixed(2) + ' (' + (100 - pct) + '%)</i></div>' +
        '<div class="lr-bar"><i style="width:' + pct + '%"></i></div></div>';
    }

    const defs = [
      ['files', 'files_count', 'Файлы'],
      ['storage', 'user_storage', 'Хранилище'],
      ['requests', 'messages_per_day', 'Сообщений в день'],
    ];
    const rows = defs.map(d => {
      const used = Number(use[d[0]] || 0);
      const cap = lim[d[1]];
      const unlimited = cap === null || cap === undefined;
      const pct = unlimited ? 0 : Math.min(100, Math.round(used / cap * 100));
      const right = unlimited
        ? limitValueLabel(d[1], used) + ' · без лимита'
        : limitValueLabel(d[1], used) + ' из ' + limitValueLabel(d[1], cap) +
          ' · осталось ' + limitValueLabel(d[1], Math.max(0, cap - used));
      return '<div class="lim-row ' + (unlimited ? 'unlimited' : (pct >= 80 ? 'warn' : '')) + '">' +
        '<div class="lr-top"><b>' + d[2] + '</b><i>' + right + ' · ' +
        (unlimited ? '∞' : pct + '%') + '</i></div>' +
        '<div class="lr-bar"><i style="width:' + (unlimited ? 100 : pct) + '%"></i></div></div>';
    }).join('');

    const audioUsed = Number(w && w.audio_generations || 0);
    const audioCap = w && w.audio_limit !== undefined ? w.audio_limit : lim.audio_generations;
    const audioUnlimited = audioCap === null || audioCap === undefined;
    const audioHours = Number(w && w.hours || lim.window_hours || 5);
    const audioPct = audioUnlimited ? 0 : Math.min(100, Math.round(audioUsed / Math.max(1, Number(audioCap)) * 100));
    const audioRight = audioUnlimited
      ? audioUsed + ' · без лимита'
      : audioUsed + ' из ' + audioCap + ' за ' + audioHours + ' ч · осталось ' + Math.max(0, Number(audioCap) - audioUsed);
    const audioRow = '<div class="lim-row ' + (audioUnlimited ? 'unlimited' : (audioPct >= 80 ? 'warn' : '')) + '">' +
      '<div class="lr-top"><b>Голосовые ответы</b><i>' + audioRight + ' · ' +
      (audioUnlimited ? '∞' : audioPct + '%') + '</i></div>' +
      '<div class="lr-bar"><i style="width:' + (audioUnlimited ? 100 : audioPct) + '%"></i></div></div>';

    openModal({
      title: 'Лимиты подписки',
      okText: 'Понятно',
      body:
        '<div class="sub-head">' +
          '<div class="sub-plan">Тариф «' + escapeHtml(String(plan).toUpperCase()) + '»' +
          '<br><em>' + (w && w.budget_usd
            ? 'израсходовано ' + Math.round(w.percent) + '% бюджета за ' + w.hours + ' ч'
            : 'лимит по минутам и файлам') + '</em></div>' +
        '</div>' +
        money + rows + audioRow +
        '<h4 class="sec">Что даёт подписка</h4>' +
        planCompareHtml(lim, data.compare) +
        '<p class="usage-note">Подписка оформляется у администратора — напишите ему в чат.</p>',
      onOk: () => true,
    });
  }

  // ---------- boot ----------
  async function boot() {
    showApp();
    applySidebar();

    // The empty welcome screen needs no server data. Render it immediately
    // rather than waiting for the sidebar, files, models, memory and limits.
    const welcomeRenderedEarly = !state.currentChatId && allMessages(state.tree).length === 0;
    if (welcomeRenderedEarly) renderMessages();

    if (state.user && state.user.is_admin) {
      $('#sidebar-limits-btn').classList.remove('hidden');
      await loadSystem();
      setInterval(loadSystem, 20000);
    }
    $('#menu-btn').style.display = window.innerWidth <= 860 ? 'grid' : 'none';
    await loadChats();
    await loadFiles();
    await loadModelSets();
    await loadMemory();
    await loadLimits();
    await loadUsage();

    // Avoid rebuilding the welcome block (and restarting its animation) once
    // background data has arrived. If a chat was opened meanwhile, render it.
    if (!welcomeRenderedEarly || state.currentChatId || allMessages(state.tree).length) {
      renderMessages();
    }
  }

  async function init() {
    bindAuth(); bindSidebar(); bindComposer(); bindFiles(); bindAudioPlayer();
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

  function syncAppViewportHeight() {
    const h = window.visualViewport && window.visualViewport.height
      ? window.visualViewport.height
      : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', Math.round(h) + 'px');
  }
  syncAppViewportHeight();
  window.addEventListener('resize', syncAppViewportHeight, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncAppViewportHeight, { passive: true });
  }

  document.addEventListener('DOMContentLoaded', init);

  // KaTeX loads with defer: re-render math once it is available
  window.addEventListener('load', () => {
    const box = document.getElementById('messages');
    if (box) renderMath(box.querySelector('.msg-wrap'));
  });
})();
