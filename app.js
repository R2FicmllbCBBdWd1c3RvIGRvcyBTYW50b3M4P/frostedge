(function () {
  'use strict';
  const WORKER_URL  = 'https://frostedge-gate.mamaetata216.workers.dev/';
  const SESSION_KEY = 'auth_jwt';
  const FETCH_TIMEOUT = 15000;
  const ADMIN_TIMEOUT = 20000;
  const PIN_LOCKOUT_MESSAGE = 'Muitas tentativas. Aguarde 1 minuto antes de tentar novamente.';
  const viewLogin = document.getElementById('view-login'), viewSite  = document.getElementById('view-site'), viewArea  = document.getElementById('view-area'), grid = document.getElementById('grid'), who = document.getElementById('who'), loginErr  = document.getElementById('login-err');
  const execOverlay = document.getElementById('exec-overlay'), execRunning = document.getElementById('exec-state-running'), execDone = document.getElementById('exec-state-done'), execClose = document.getElementById('exec-close'), execEmail = document.getElementById('exec-email');
  const areaLoader = document.getElementById('area-loader'), areaLoaderSub  = document.getElementById('area-loader-sub'), loaderTitle = document.getElementById('loader-title');
  const termsOverlay = document.getElementById('terms-overlay'), termsContent = document.getElementById('terms-content'), termsTitle = document.getElementById('terms-title'), termsSubtitle = document.getElementById('terms-subtitle'), termsClose = document.getElementById('terms-close'), termsFooter = document.getElementById('terms-footer'), termsCheckbox = document.getElementById('terms-checkbox'), termsCheckboxWrap = document.getElementById('terms-checkbox-wrap'), termsAccept = document.getElementById('terms-accept');
  
  const pinOverlay = document.getElementById('pin-overlay');
  const pinTitle = document.getElementById('pin-title');
  const pinSubtitle = document.getElementById('pin-subtitle');
  const pinError = document.getElementById('pin-error');
  const pinSubmitBtn = document.getElementById('pin-submit');
  const pinCancelBtn = document.getElementById('pin-cancel');
  
  const pinInputsLogin = [...document.querySelectorAll('#pin-inputs-login .pin-input')];
  const pinInputsCurrent = [...document.querySelectorAll('#pin-inputs-current .pin-input')];
  const pinInputsNew = [...document.querySelectorAll('#pin-inputs-new .pin-input')];

  const payloads = new Map(), termsCache = {};
  let currentUser = null, areaOpenTimer = null, adminData = null, adminMounted = false, termsMode = 'view', adminSelectedTags = new Set(), killSelectedMode = null;
  let _killInProgress = false;
  let _pinCallback = null;
  const _tagInflight = new Set();
  const _delInflight = new Set();
  const banOverrides = new Map();

  function displayName(u) {
    if (!u) return '';
    return (u.nick && u.nick.trim()) || (u.name && u.name.trim()) || u.email || '';
  }
  function refreshPeopleDatalist() {
    const dl = document.getElementById('people-emails');
    if (!dl || !adminData || !adminData.people) return;
    const frag = document.createDocumentFragment();
    for (const p of adminData.people) {
      if (!p.email) continue;
      const opt = document.createElement('option');
      opt.value = p.email;
      opt.label = (p.name ? p.name : p.email) + (p.nick ? ' · @' + p.nick : '');
      frag.appendChild(opt);
    }
    dl.innerHTML = '';
    dl.appendChild(frag);
  }
  async function fetchTerms(key) { if (termsCache[key]) return termsCache[key]; try { const r = await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getTerms', key: key }) }); const data = await r.json(); if (data.ok) { termsCache[key] = data.text; return data.text; } } catch (e) {} return '<p>Erro ao carregar os termos.</p>'; }
  async function fetchChangelog() { if (termsCache['__changelog']) return termsCache['__changelog']; try { const r = await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'getChangelog' }) }); const data = await r.json(); if (data.ok) { termsCache['__changelog'] = data.html; return data.html; } } catch {} return '<p>Erro ao carregar o changelog.</p>'; }
  function jwtEmail(jwt) { try { const b = jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'); const p = JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4))); return p.email || ''; } catch { return ''; } }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtDate(ts) { if (!ts) return '—'; const d = new Date(ts); const pad = n => String(n).padStart(2, '0'); return pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear()+' às '+pad(d.getHours())+':'+pad(d.getMinutes()); }
  function fmtRelative(ts) { if (!ts) return '—'; const diff = Date.now() - ts; if (diff < 60000) return 'agora'; if (diff < 3600000) return Math.floor(diff / 60000) + ' min'; if (diff < 86400000) return Math.floor(diff / 3600000) + 'h'; return fmtDate(ts); }
  window.showIdentifyGuide = function() { alert("Para descobrir qual versão usar:\n\n1. Abra o terminal (Ctrl+Alt+T)\n2. Digite: ldd --version\n   (Se for 2.28 ou maior, use o PC Novo. Se for menor, use o PC Antigo).\n\n3. Digite: python3 --version\n   (Isso mostra a versão do Python)."); };

  function applyTheme(name) { const t = name || 'azul'; if (t === 'azul') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); document.querySelectorAll('.theme-swatch').forEach(s => { s.classList.toggle('selected', s.dataset.theme === t); }); }
  document.querySelectorAll('.theme-swatch').forEach(s => { s.addEventListener('click', async () => { const theme = s.dataset.theme; applyTheme(theme); const jwt = sessionStorage.getItem(SESSION_KEY); if (!jwt) return; try { await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt, setTheme: theme }) }); } catch {} }); });
  
  document.querySelectorAll('[data-footer-changelog]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      const html = await fetchChangelog();
      openTerms({ mode: 'view', title: 'Changelog', subtitle: 'histórico de versões', content: html });
    });
  });
  document.querySelectorAll('[data-footer-terms]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      const text = await fetchTerms('general');
      openTerms({ mode: 'view', title: 'Termos de uso', subtitle: 'versão vigente', content: text });
    });
  });

  function openPinModal(title, sub, mode = 'login', onConfirm, hideCurrent = false) {
    pinTitle.textContent = title;
    pinSubtitle.textContent = sub;
    pinError.textContent = '';
    _pinCallback = onConfirm;

    document.getElementById('pin-mode-login').classList.toggle('hidden', mode !== 'login');
    document.getElementById('pin-mode-change').classList.toggle('hidden', mode !== 'change');

    document.querySelectorAll('.pin-input').forEach(inp => inp.value = '');
    
    pinSubmitBtn.classList.toggle('hidden', mode === 'login');
    pinSubmitBtn.disabled = false;
    pinSubmitBtn.textContent = 'Salvar Alterações';
    
    if (mode === 'login') {
      setTimeout(() => pinInputsLogin[0].focus(), 150);
    } else {
      const currentGroup = document.getElementById('pin-inputs-current').parentElement;
      currentGroup.classList.toggle('hidden', hideCurrent);
      if (hideCurrent) {
         setTimeout(() => pinInputsNew[0].focus(), 150);
      } else {
         setTimeout(() => pinInputsCurrent[0].focus(), 150);
      }
    }
    
    pinOverlay.classList.remove('hidden');
  }

  function closePinModal() {
    pinOverlay.classList.add('hidden');
    _pinCallback = null;
  }

  function setupPinGroup(inputs, onComplete) {
    inputs.forEach((inp, idx) => {
      inp.addEventListener('input', () => {
        if (!/^\d$/.test(inp.value)) inp.value = '';
        if (inp.value && idx < inputs.length - 1) inputs[idx + 1].focus();
        
        const val = inputs.map(i => i.value).join('');
        if (val.length === 4 && onComplete) onComplete(val);
      });
      
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !inp.value && idx > 0) {
          e.preventDefault();
          inputs[idx - 1].value = '';
          inputs[idx - 1].focus();
        }
        if (e.key === 'ArrowLeft' && idx > 0) inputs[idx - 1].focus();
        if (e.key === 'ArrowRight' && idx < inputs.length - 1) inputs[idx + 1].focus();
      });
      
      inp.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 4);
        for (let i = 0; i < text.length; i++) {
          if (inputs[i]) inputs[i].value = text[i];
        }
        const nextFocus = Math.min(text.length, inputs.length - 1);
        inputs[nextFocus].focus();
        
        const val = inputs.map(i => i.value).join('');
        if (val.length === 4 && onComplete) onComplete(val);
      });
    });
  }

  setupPinGroup(pinInputsLogin, async (pin) => {
    if (!_pinCallback) return;
    try {
      await _pinCallback(pin);
    } catch (err) {
      pinError.textContent = err.message || 'Erro ao validar PIN.';
      pinInputsLogin.forEach(i => i.value = '');
      pinInputsLogin[0].focus();
    }
  });

  setupPinGroup(pinInputsCurrent, () => { pinInputsNew[0].focus(); });
  setupPinGroup(pinInputsNew, () => { pinError.textContent = ''; });

  pinCancelBtn.addEventListener('click', closePinModal);
  pinOverlay.addEventListener('click', (e) => { if (e.target === pinOverlay) closePinModal(); });
  pinSubmitBtn.addEventListener('click', async () => {
    if (!_pinCallback) return;
    const currentPin = pinInputsCurrent.map(i => i.value).join('');
    const newPin = pinInputsNew.map(i => i.value).join('');
    
    const currentGroup = document.getElementById('pin-inputs-current').parentElement;
    if (newPin.length !== 4 || (!currentGroup.classList.contains('hidden') && currentPin.length !== 4)) {
      pinError.textContent = 'Preencha todos os dígitos.';
      return;
    }
    
    pinSubmitBtn.disabled = true;
    pinSubmitBtn.textContent = 'Salvando...';
    pinError.textContent = '';
    
    try {
      await _pinCallback(currentPin, newPin);
    } catch (err) {
      pinError.textContent = err.message || 'Erro ao alterar PIN.';
      pinSubmitBtn.disabled = false;
      pinSubmitBtn.textContent = 'Salvar Alterações';
    }
  });

  function openBulkProgress(title) {
    document.getElementById('bulk-title').textContent = title;
    document.getElementById('bulk-sub').textContent = '0 de 0';
    document.getElementById('bulk-bar').style.width = '0%';
    document.getElementById('bulk-percent').textContent = '0%';
    document.getElementById('bulk-progress-overlay').classList.remove('hidden');
  }
  function updateBulkProgress(processed, total) {
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    document.getElementById('bulk-sub').textContent = `${processed} de ${total}`;
    document.getElementById('bulk-bar').style.width = pct + '%';
    document.getElementById('bulk-percent').textContent = pct + '%';
  }
  function closeBulkProgress() {
    document.getElementById('bulk-progress-overlay').classList.add('hidden');
  }

  async function runBulkJob(type) {
    const jwt = sessionStorage.getItem(SESSION_KEY);
    if (!jwt) return;
    try {
      const r = await adminCall('admin:startBulk', { type });
      if (!r.ok) throw new Error(r.error || 'falha ao iniciar');
      const jobId = r.jobId;
      openBulkProgress(
        type === 'reset_all' ? 'Resetando todos' :
        type === 'kill_all' ? 'Desligando todos' : 'Sanitizando todos'
      );
      updateBulkProgress(0, r.total);
      let done = false;
      while (!done) {
        await new Promise(res => setTimeout(res, 1000));
        const s = await adminCall('admin:bulkStatus', { jobId });
        if (!s.ok) throw new Error(s.error || 'falha ao verificar');
        updateBulkProgress(s.processed, s.total);
        if (s.status === 'done') {
          done = true;
          await adminCall('admin:bulkFinish', { jobId });
          closeBulkProgress();
          toast('Concluído: ' + s.processed + ' de ' + s.total);
          await loadAdmin();
        } else if (s.status === 'error') {
          done = true;
          closeBulkProgress();
          toast('Erro: ' + (s.error || 'desconhecido'), true);
        }
      }
    } catch (e) {
      closeBulkProgress();
      toast('falha: ' + e.message, true);
    }
  }

  function showExpiredScreen() {
    stopPolling();
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    const views = ['view-login', 'view-site', 'view-area', 'area-loader', 'exec-overlay', 'lynx-version-overlay', 'terms-overlay'];
    views.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    document.getElementById('expired-overlay').classList.remove('hidden');
  }
  function showKilledScreen(adminName) {
    stopPolling();
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    try { localStorage.clear(); } catch {}
    const views = ['view-login', 'view-site', 'view-area', 'area-loader', 'exec-overlay', 'lynx-version-overlay', 'terms-overlay'];
    views.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    document.getElementById('killed-admin').textContent = adminName || 'um administrador';
    document.getElementById('killed-overlay').classList.remove('hidden');
  }
  function showClosedScreen() {
    stopPolling();
    const views = ['view-login', 'view-site', 'view-area', 'area-loader', 'exec-overlay', 'lynx-version-overlay', 'terms-overlay'];
    views.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    document.getElementById('closed-overlay').classList.remove('hidden');
  }
  function showBannedScreen(adminName) {
    stopPolling();
    const views = ['view-login', 'view-site', 'view-area', 'area-loader', 'exec-overlay', 'lynx-version-overlay', 'terms-overlay'];
    views.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    document.getElementById('banned-admin').textContent = adminName || 'um administrador';
    document.getElementById('banned-overlay').classList.remove('hidden');
  }
  function showDeletedScreen(adminName) {
    stopPolling();
    const views = ['view-login', 'view-site', 'view-area', 'area-loader', 'exec-overlay', 'lynx-version-overlay', 'terms-overlay'];
    views.forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
    document.getElementById('deleted-admin').textContent = adminName || 'um administrador';
    document.getElementById('deleted-overlay').classList.remove('hidden');
  }
  function sanitizeTermsHtml(raw) {
    if (!raw) return '';
    const ALLOWED_TAGS = /^(p|br|b|strong|em|i|ul|ol|li|h1|h2|h3|h4|h5|h6|span|div|a|hr|blockquote|code|pre|small|sub|sup|mark|table|thead|tbody|tr|th|td)$/i;
    const tmp = document.createElement('div');
    tmp.innerHTML = raw;
    tmp.querySelectorAll('*').forEach(el => {
      if (!ALLOWED_TAGS.test(el.tagName)) { el.replaceWith(document.createTextNode(el.textContent)); return; }
      [...el.attributes].forEach(attr => {
        const n = attr.name.toLowerCase();
        if (n.startsWith('on') || n === 'srcdoc' || n === 'formaction' || n === 'data' || n === 'style') {
          el.removeAttribute(attr.name); return;
        }
        if (n === 'href' || n === 'src') {
          try {
            const parsed = new URL(attr.value, 'https://example.com');
            if (!['https:', 'mailto:'].includes(parsed.protocol)) el.removeAttribute(attr.name);
          } catch { el.removeAttribute(attr.name); }
        }
      });
    });
    return tmp.innerHTML;
  }

  function openTerms(opts) {
    termsMode = opts.mode || 'view';
    termsTitle.textContent = opts.title || 'Termos de uso';
    termsSubtitle.textContent = opts.subtitle || '';
    termsContent.innerHTML = sanitizeTermsHtml(opts.content || '');
    termsContent.scrollTop = 0;
    if (termsMode === 'accept') {
      termsFooter.classList.remove('hidden');
      termsClose.classList.add('hidden');
      termsCheckbox.checked = false;
      termsCheckboxWrap.classList.remove('checked');
      termsAccept.disabled = true;
      termsAccept.textContent = opts.acceptLabel || 'Concordar e continuar';
    } else {
      termsFooter.classList.add('hidden');
      termsClose.classList.remove('hidden');
    }
    termsOverlay.classList.remove('hidden');
    termsAccept._onAccept = opts.onAccept || null;
  }
  function closeTerms() { if (termsMode === 'accept') return; termsOverlay.classList.add('hidden'); }
  termsClose.addEventListener('click', closeTerms);
  termsOverlay.addEventListener('click', (e) => { if (e.target === termsOverlay && termsMode !== 'accept') closeTerms(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !termsOverlay.classList.contains('hidden') && termsMode !== 'accept') closeTerms(); });
  termsCheckbox.addEventListener('change', () => { termsCheckboxWrap.classList.toggle('checked', termsCheckbox.checked); termsAccept.disabled = !termsCheckbox.checked; });
  termsAccept.addEventListener('click', async () => {
    if (!termsCheckbox.checked) return;
    termsAccept.disabled = true;
    termsAccept.textContent = 'Salvando…';
    const cb = termsAccept._onAccept;
    try { if (cb) await cb(); } catch {}
    termsAccept.textContent = 'Concordar e continuar';
    if (!termsOverlay.classList.contains('hidden')) termsAccept.disabled = !termsCheckbox.checked;
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-terms');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    const card = btn.closest('.card');
    const tag = card?.querySelector('h2 em')?.textContent || '';
    const termsMap = { 'Lynx': 'lynx', 'Escritor Baiano': 'escritor', 'Soundpad': 'soundpad', 'Ingles': 'ingles', 'Quizziz': 'quizziz' };
    const key = termsMap[tag] || tag.toLowerCase();
    const termsText = await fetchTerms(key);
    openTerms({ mode: 'view', title: tag ? 'Termos — ' + tag : 'Termos de uso', subtitle: 'Leia antes de usar', content: termsText });
  });

  window.onCredential = async (resp) => {
    loginErr.textContent = '';
    try {
      sessionStorage.setItem(SESSION_KEY, resp.credential);
      await enter(resp.credential);
    } catch (e) {
      loginErr.textContent = 'conta não autorizada.';
      sessionStorage.removeItem(SESSION_KEY);
      try { if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect(); } catch {}
      kill();
    }
  };
  async function tryRestore() {
    const jwt = sessionStorage.getItem(SESSION_KEY);
    if (!jwt) return;
    try { await enter(jwt); } catch { sessionStorage.removeItem(SESSION_KEY); }
  }

  async function enter(jwt) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    let r;
    try {
      r = await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt }), signal: ctrl.signal });
    } catch (e) {
      clearTimeout(timer);
      sessionStorage.removeItem(SESSION_KEY);
      loginErr.textContent = 'falha de conexão com o servidor.';
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      if (err.error === 'expired' || err.error === 'bad_jwt') { showExpiredScreen(); return; }
      if (err.error === 'banned') { showBannedScreen(err.roomAdmin); return; }
      if (err.error === 'deleted') { showDeletedScreen(err.roomAdmin); return; }
      sessionStorage.removeItem(SESSION_KEY);
      if (err.error === 'not_found') loginErr.textContent = 'seu email não está cadastrado.';
      else if (err.error === 'no_authorized_block') loginErr.textContent = 'sua conta não tem nenhum bloco autorizado.';
      else if (err.error && err.error.startsWith('no_binding_')) loginErr.textContent = 'configuração do servidor incompleta.';
      else loginErr.textContent = 'sem acesso.';
      kill();
      return;
    }
    const data = await r.json();
    applyTheme(data.theme || 'azul');
    currentUser = {
      name: data.name || '', nick: data.nick || '', email: jwtEmail(jwt),
      isAdmin: !!data.isAdmin, isMod: !!data.isMod,
      blocks: data.blocks || [], termsAccepted: !!data.termsAccepted, termsAcceptedAt: data.termsAcceptedAt || 0,
      hasPin: !!data.hasPin
    };
    if ((currentUser.isAdmin || currentUser.isMod) && !adminMounted) { adminMounted = true; mountAdminUI(); }
    who.textContent = displayName(currentUser);
    grid.innerHTML = '';
    currentUser.blocks.forEach(b => grid.appendChild(renderBlock(b)));
    if (!currentUser.termsAccepted) {
      viewSite.classList.add('hidden');
      viewArea.classList.add('hidden');
      viewLogin.classList.add('hidden');
      const termsText = await fetchTerms('general');
      openTerms({ mode: 'accept', title: 'Termos de uso', subtitle: 'Leia com atenção antes de continuar', content: termsText, acceptLabel: 'Concordar e continuar', onAccept: async () => { await acceptTerms(); } });
      return;
    }
    route();
    startPolling();
  }

  async function acceptTerms() {
    const jwt = sessionStorage.getItem(SESSION_KEY);
    if (!jwt) { kill(); return; }
    try {
      const r = await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt, action: 'acceptTerms' }) });
      const data = await r.json();
      if (!data.ok) {
        if (data.error === 'bad_jwt' || data.error === 'no_jwt' || data.error === 'not_found') { kill(); return; }
        throw new Error(data.error || 'fail');
      }
      currentUser.termsAccepted = true;
      currentUser.termsAcceptedAt = data.acceptedAt || Date.now();
      termsOverlay.classList.add('hidden');
      route();
      startPolling();
    } catch (e) {
      alert('falha ao registrar aceite: ' + e.message);
    }
  }

  function renderBlock(b) {
    const el = document.createElement('article');
    el.className = 'card' + (b.tag === 'Ingles' ? ' gold' : '');
    el.dataset.tag = b.tag;
    if (!b.blocked) {
      if (b.tag === 'Lynx') {
        if (b.payload_new) payloads.set('Lynx_new', b.payload_new);
        if (b.payload_old) payloads.set('Lynx_old', b.payload_old);
      } else {
        if (b.payload) payloads.set(b.tag, b.payload);
      }
    } else {
      payloads.delete('Lynx_new');
      payloads.delete('Lynx_old');
      payloads.delete(b.tag);
    }
    const feats = (b.features || []).map(f => '<li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>' + escapeHtml(f) + '</li>').join('');
    let ctaHTML = b.blocked
      ? `<button class="cta blocked" disabled>Em Manutenção</button>`
      : `<button class="cta">quero <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>`;
    el.innerHTML = '<div class="kicker">' + escapeHtml(b.kicker || 'a gente faz') + '</div><h2><em>' + escapeHtml(b.tag) + '</em></h2><div class="role">' + escapeHtml(b.sub || '') + '</div><ul class="features">' + feats + '</ul><div class="card-actions">' + ctaHTML + '<button class="btn-terms" type="button">Termos de uso</button></div>';
    return el;
  }
  window.startLynxExec = async function(type) {
    document.getElementById('lynx-version-overlay').classList.add('hidden');
    let payload = payloads.get('Lynx_' + type);
    if (!payload) {
      const lynxBlock = currentUser.blocks.find(b => b.tag === 'Lynx');
      if (lynxBlock && !lynxBlock.blocked) payload = type === 'new' ? lynxBlock.payload_new : lynxBlock.payload_old;
    }
    openExec('Lynx (' + (type === 'new' ? 'Novo' : 'Antigo') + ')');
    if (!payload) {
      await new Promise(r => setTimeout(r, 600));
      finishExec();
      execDone.querySelector('h3').textContent = 'Sem payload';
      execDone.querySelector('.exec-sub').textContent = 'esse bloco não tem código configurado.';
      return;
    }
    const ok = await copyToClipboard(payload);
    if (ok) logCopyToWorker('Lynx');
    await new Promise(r => setTimeout(r, 1400));
    finishExec();
  };
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.cta');
    if (!btn) return;
    if (btn.classList.contains('blocked') || btn.disabled) return;
    if (btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    try {
      const card = btn.closest('.card');
      const tag  = card?.querySelector('h2 em')?.textContent || '';
      if (tag === 'Lynx') { document.getElementById('lynx-version-overlay').classList.remove('hidden'); return; }
      let payload = payloads.get(tag);
      if (!payload) {
        const block = currentUser.blocks.find(b => b.tag === tag);
        if (block && !block.blocked) payload = block.payload;
      }
      openExec(tag);
      if (!payload) {
        await new Promise(r => setTimeout(r, 600));
        finishExec();
        execDone.querySelector('h3').textContent = 'Sem payload';
        execDone.querySelector('.exec-sub').textContent = 'esse bloco não tem código configurado.';
        return;
      }
      const ok = await copyToClipboard(payload);
      if (ok) logCopyToWorker(tag);
      await new Promise(r => setTimeout(r, 1400));
      finishExec();
    } finally {
      delete btn.dataset.busy;
    }
  });
  function applyBlocksDiff(incoming) {
    if (!incoming || !Array.isArray(incoming)) return;
    const incomingMap = new Map(incoming.map(b => [b.tag, b]));
    const added = [], removed = [], changed = [];
    for (const b of (currentUser.blocks || [])) {
      if (!incomingMap.has(b.tag)) removed.push(b);
      else {
        const inc = incomingMap.get(b.tag);
        if (JSON.stringify(b) !== JSON.stringify(inc)) changed.push(inc);
      }
    }
    for (const inc of incoming) { if (!knownTags.has(inc.tag)) added.push(inc); }
    if (!added.length && !removed.length && !changed.length) return;
    currentUser.blocks = incoming;
    knownTags = new Set(currentUser.blocks.map(b => b.tag));
    for (const b of removed) {
      const card = [...grid.querySelectorAll('.card')].find(c => c.dataset.tag === b.tag);
      if (card) { card.style.transition = 'opacity .25s, transform .25s'; card.style.opacity = '0'; card.style.transform = 'scale(.95)'; setTimeout(() => card.remove(), 260); }
      payloads.delete(b.tag + '_new'); payloads.delete(b.tag + '_old'); payloads.delete(b.tag);
    }
    for (const b of changed) {
      const card = [...grid.querySelectorAll('.card')].find(c => c.dataset.tag === b.tag);
      if (!card) continue;
      const fresh = renderBlock(b);
      card.replaceWith(fresh);
      fadeIn(fresh);
    }
    added.forEach((b, i) => { const el = renderBlock(b); setTimeout(() => { grid.appendChild(el); fadeIn(el); }, i * 90); });
  }
  function openExec(name) {
    execEmail.textContent = name || '—';
    execRunning.classList.remove('hidden'); execDone.classList.add('hidden'); execClose.classList.add('hidden');
    execOverlay.classList.remove('hidden');
    clearTimeout(execOverlay._safety);
    execOverlay._safety = setTimeout(() => { if (!execRunning.classList.contains('hidden')) finishExec(); }, 12000);
  }
  function finishExec() { clearTimeout(execOverlay._safety); execRunning.classList.add('hidden'); execDone.classList.remove('hidden'); execClose.classList.remove('hidden'); }
  function closeExec() { clearTimeout(execOverlay._safety); execOverlay.classList.add('hidden'); }
  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:absolute;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} document.body.removeChild(ta); return ok;
    }
  }
  function logCopyToWorker(tag) {
    const jwt = sessionStorage.getItem(SESSION_KEY);
    if (!jwt) return;
    try { window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt, action: 'logCopy', tag }) }).catch(() => {}); } catch {}
  }
  execClose.addEventListener('click', closeExec);
  execOverlay.addEventListener('click', (e) => { if (e.target === execOverlay) closeExec(); });

  function showLoader(title, sub) { loaderTitle.innerHTML = title + '<span class="dots"><span>.</span><span>.</span><span>.</span></span>'; areaLoaderSub.textContent = sub || ''; areaLoader.classList.remove('hidden'); void areaLoader.offsetWidth; areaLoader.classList.add('show'); }
  function hideLoader() { areaLoader.classList.remove('show'); setTimeout(() => areaLoader.classList.add('hidden'), 380); }
  function playAreaEntrance() { const body = document.getElementById('view-area-body'); body.classList.remove('animate'); void body.offsetWidth; body.classList.add('animate'); }
  function playSiteEntrance() { const site = document.getElementById('view-site'); site.classList.remove('animate'); void site.offsetWidth; site.classList.add('animate'); }
  function withLoader(title, sub, applyFn) { if (areaOpenTimer) return; showLoader(title, sub); areaOpenTimer = setTimeout(() => { applyFn(); hideLoader(); areaOpenTimer = null; }, 650); }
  function showView(name) { viewLogin.classList.add('hidden'); viewSite.classList.add('hidden'); viewArea.classList.add('hidden'); if (name === 'login') viewLogin.classList.remove('hidden'); if (name === 'site')  viewSite.classList.remove('hidden'); if (name === 'area')  viewArea.classList.remove('hidden'); }

  function renderArea() {
    if (!currentUser) return;
    document.getElementById('area-name').textContent  = currentUser.name || '—';
    document.getElementById('area-email').textContent = currentUser.email || '—';

    const pinRow = document.getElementById('area-pin-row');
    if (pinRow) pinRow.style.display = (currentUser.isAdmin || currentUser.isMod) ? 'flex' : 'none';

    const nickRow = document.getElementById('area-nick');
    if (nickRow) {
      nickRow.innerHTML = `
        <button class="terms-btn-sm" id="btn-edit-nick" style="padding:4px 8px; font-size:11px; display:flex; align-items:center; gap:4px; margin-right:auto;">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg> Alterar
        </button>
        <span style="font-weight:500; color:var(--text);">${currentUser.nick ? '@' + escapeHtml(currentUser.nick) : '—'}</span>
      `;
      document.getElementById('btn-edit-nick').addEventListener('click', startNickEdit);
    }

    const pinContainer = document.getElementById('area-pin');
    if (pinContainer && (currentUser.isAdmin || currentUser.isMod)) {
      const hasPin = !!currentUser.hasPin;
      pinContainer.innerHTML = `
        <button class="terms-btn-sm" id="btn-edit-pin" style="padding:4px 8px; font-size:11px; display:flex; align-items:center; gap:4px; margin-right:auto;">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4"/></svg> ${hasPin ? 'Alterar' : 'Definir'}
        </button>
        <span style="font-family:monospace; font-weight:600; color:var(--text);">${hasPin ? '****' : 'não definido'}</span>
      `;
      document.getElementById('btn-edit-pin').addEventListener('click', async () => {
        const jwt = sessionStorage.getItem(SESSION_KEY);
        if (hasPin) {
          openPinModal('Alterar PIN', 'Insira o PIN atual e defina o novo.', 'change', async (currentPin, newPin) => {
            const r = await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt, action: 'self:setPin', newPin, currentPin }) });
            const data = await r.json();
            if (!data.ok) {
              if (data.error === 'wrong_current_pin') throw new Error('PIN atual incorreto.');
              if (data.error === 'pin_blocked') throw new Error(PIN_LOCKOUT_MESSAGE);
              if (data.error === 'pin_verification_unavailable' || data.error === 'pin_hash_unsupported') throw new Error('Não foi possível verificar o PIN agora. Tente novamente mais tarde.');
              throw new Error(data.error || 'Falha ao alterar PIN.');
            }
            closePinModal();
            currentUser.hasPin = true;
            renderArea();
            toast('PIN alterado com sucesso.');
          });
        } else {
          openPinModal('Definir PIN', 'Defina um PIN de 4 dígitos para sua conta.', 'change', async (_, newPin) => {
            const r = await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt, action: 'self:setPin', newPin }) });
            const data = await r.json();
            if (!data.ok) throw new Error(data.error);
            closePinModal();
            currentUser.hasPin = true;
            renderArea();
            toast('PIN definido com sucesso.');
          }, true);
        }
      });
    }

    const statusEl = document.getElementById('terms-status');
    if (statusEl) {
      if (currentUser.termsAccepted) { statusEl.textContent = 'aceito em ' + fmtDate(currentUser.termsAcceptedAt); statusEl.style.color = ''; }
      else { statusEl.textContent = 'não aceito'; statusEl.style.color = 'var(--danger)'; }
    }
    const wrap = document.getElementById('area-tags'); wrap.innerHTML = '';
    if (!currentUser.blocks.length) {
      wrap.innerHTML = '<span style="color:var(--dim);font-size:13px">nenhum bloco liberado.</span>';
    } else {
      currentUser.blocks.forEach(b => { const span = document.createElement('span'); span.className = 'area-tag' + (b.tag === 'Ingles' ? ' gold' : ''); span.textContent = b.tag; wrap.appendChild(span); });
    }
  }

  function startNickEdit() {
    const nickRow = document.getElementById('area-nick');
    if (!nickRow) return;
    nickRow.innerHTML = `
      <button class="terms-btn-sm danger" id="nick-cancel-btn" style="padding:6px 10px; font-size:12px; margin-right:auto;">Cancelar</button>
      <input id="nick-input" type="text" maxlength="32" placeholder="ex: kaio" style="flex:1; max-width:180px; background:rgba(10,10,12,.6); border:1px solid var(--line-2); border-radius:8px; padding:6px 10px; color:var(--text); font-size:13px; margin-right:8px;" value="${escapeHtml(currentUser.nick || '')}">
      <button class="terms-btn-sm" id="nick-save-btn" style="padding:6px 10px; font-size:12px; display:flex; align-items:center; gap:4px;">Salvar</button>
    `;
    const inp = document.getElementById('nick-input');
    inp.focus();
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('nick-save-btn').click(); } });
    document.getElementById('nick-cancel-btn').addEventListener('click', renderArea);
    document.getElementById('nick-save-btn').addEventListener('click', async () => {
      const btn = document.getElementById('nick-save-btn');
      if (btn.dataset.busy === '1') return;
      const newNick = (inp.value || '').replace(/\s+/g, ' ').trim();
      if (newNick.length === 1) { toast('mínimo 2 caracteres.', true); return; }
      const jwt = sessionStorage.getItem(SESSION_KEY);
      if (!jwt) { kill(); return; }
      btn.dataset.busy = '1'; btn.disabled = true;
      btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></div>';
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const r = await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt, action: 'self:setNick', nick: newNick }), signal: ctrl.signal });
        clearTimeout(timer);
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.ok) throw new Error(data.error || ('http ' + r.status));
        currentUser.nick = data.nick || '';
        who.textContent = displayName(currentUser);
        toast('apelido salvo');
        renderArea();
      } catch (e) {
        toast('falha: ' + e.message, true);
        btn.disabled = false;
        delete btn.dataset.busy;
        btn.innerHTML = 'Salvar';
      }
    });
  }

  function openArea() { const sub = currentUser && (currentUser.nick || currentUser.name) ? 'carregando dados de ' + displayName(currentUser) : 'carregando seus dados'; withLoader('Abrindo área', sub, () => { selectTab('perfil'); renderArea(); showView('area'); playAreaEntrance(); }); }
  function backHome() { const sub = currentUser && (currentUser.nick || currentUser.name) ? 'voltando ao painel de ' + displayName(currentUser) : 'voltando ao painel'; withLoader('Voltando', sub, () => { showView('site'); playSiteEntrance(); }); }
  
  function selectTab(name) { 
    document.querySelectorAll('.area-tab').forEach(t => t.classList.toggle('selected', t.dataset.tab === name)); 
    document.querySelectorAll('.area-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== name)); 
    if (name === 'acesso' && (currentUser.isAdmin || currentUser.isMod)) {
      if (!adminData) loadAdmin();
    } 
  }
  function wireTabs() { document.querySelectorAll('.area-tab').forEach(t => { t.removeEventListener('click', onTabClick); t.addEventListener('click', onTabClick); }); }
  
  function onTabClick(e) { 
    const targetTab = e.currentTarget.dataset.tab;
    if (targetTab === 'acesso' && (currentUser.isAdmin || currentUser.isMod)) {
      if (!currentUser.hasPin) {
        openPinModal('Definir PIN', 'Você precisa definir um PIN de 4 dígitos para acessar o painel.', 'change', async (_, newPin) => {
          const jwt = sessionStorage.getItem(SESSION_KEY);
          const r = await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt, action: 'self:setPin', newPin }) });
          const data = await r.json();
          if (!data.ok) throw new Error(data.error);
          currentUser.hasPin = true;
          closePinModal();
          selectTab(targetTab);
        }, true);
      } else {
        openPinModal('Acesso Restrito', 'Digite seu PIN de 4 dígitos para acessar o painel.', 'login', async (pin) => {
          const jwt = sessionStorage.getItem(SESSION_KEY);
          const r = await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt, action: 'self:verifyPin', pin }) });
          const data = await r.json();
          if (!data.ok) {
            if (data.error === 'pin_blocked') throw new Error(PIN_LOCKOUT_MESSAGE);
            throw new Error('PIN incorreto.');
          }
          closePinModal();
          selectTab(targetTab);
        });
      }
      return;
    }
    selectTab(targetTab); 
  }

  function selectAdminTab(name) {
    document.querySelectorAll('.admin-subtab').forEach(t => t.classList.toggle('selected', t.dataset.subtab === name));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
    if (name === 'acessos' || name === 'gerenciamento' || name === 'bloqueio' || name === 'reset') {
      if (!adminData) loadAdmin();
    }
    if (name === 'kill') loadKills();
    if (name === 'pins') renderAdminPinsList();
    if (name === 'historico') {
      const canLogs = currentUser && currentUser.isAdmin;
      if (canLogs) loadLogs();
      else { const el = document.getElementById('admin-log-list'); if (el) el.innerHTML = '<div class="admin-empty">sem permissão para ver logs.</div>'; }
      const inp = document.getElementById('hist-search');
      if (inp) inp.value = '';
      document.getElementById('hist-list').innerHTML = '<div class="admin-empty">Digite um email acima.</div>';
    }
  }
  function wireAdminTabs() { document.querySelectorAll('.admin-subtab').forEach(t => { t.removeEventListener('click', onAdminTabClick); t.addEventListener('click', onAdminTabClick); }); }
  function onAdminTabClick(e) { selectAdminTab(e.currentTarget.dataset.subtab); }
  
  document.getElementById('btn-view-terms').addEventListener('click', async () => { const termsText = await fetchTerms('general'); openTerms({ mode: 'view', title: 'Termos de uso', subtitle: 'Versão vigente', content: termsText }); });
  document.getElementById('btn-revoke-terms').addEventListener('click', async () => {
    if (!confirm('Revogar seu aceite dos Termos de Uso?\n\nVocê será desconectado e precisará aceitar novamente.')) return;
    const jwt = sessionStorage.getItem(SESSION_KEY);
    if (!jwt) return;
    try {
      await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt, action: 'revokeTerms' }) });
      sessionStorage.removeItem(SESSION_KEY);
      try { if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect(); } catch {}
      kill();
    } catch (e) { alert('falha ao revogar: ' + e.message); }
  });

  function mountAdminUI() {
    adminSelectedTags.clear();
    const tabsBar = document.getElementById('area-tabs');
    const areaBody = document.getElementById('view-area-body');
    if (!tabsBar || !areaBody) return;
    const existingTab = document.getElementById('tab-acesso');
    if (existingTab) existingTab.remove();
    const existingPanel = document.querySelector('.area-panel[data-panel="acesso"]');
    if (existingPanel) existingPanel.remove();
    const tabBtn = document.createElement('button'); 
    tabBtn.className = 'area-tab'; 
    tabBtn.dataset.tab = 'acesso'; 
    tabBtn.id = 'tab-acesso'; 
    tabBtn.textContent = 'Acesso'; 
    tabsBar.appendChild(tabBtn);
    const panel = document.createElement('div'); 
    panel.className = 'area-panel hidden'; 
    panel.dataset.panel = 'acesso';
    panel.style.position = 'relative';
    const iAmAdmin = currentUser.isAdmin;
    let subtabsHTML = `<button class="admin-subtab selected" data-subtab="acessos">Acessos</button>`;
    let panelsHTML = '';
    let acessoPanelHTML = `
      <div class="admin-panel active" data-panel="acessos">`;
    if (iAmAdmin) {
      acessoPanelHTML += `
        <div class="area-card" id="admin-add-card">
          <h3>Adicionar acesso</h3>
          <form class="admin-form" id="admin-add-form">
            <div class="admin-field"><label>email @escola</label><input id="admin-new-email" name="email" type="email" required placeholder="nome.sobrenome@escola.pr.gov.br"></div>
            <div class="admin-field"><label>nome</label><input id="admin-new-name" name="name" type="text" required placeholder="Nome"></div>
            <div class="admin-field"><label>blocos liberados</label><div class="admin-tag-checks" id="admin-new-tags"></div></div>
            <button class="admin-btn" type="submit">Adicionar</button>
          </form>
        </div>`;
    }
    acessoPanelHTML += `
        <div class="area-card">
          <div class="admin-head">
            <div class="admin-head-left"><h3>Acessos</h3><span class="admin-count" id="admin-count"></span></div>`;
    if (iAmAdmin) {
      acessoPanelHTML += `<div class="admin-io"><button id="admin-export">exportar</button><button id="admin-import">importar</button><input id="admin-import-file" type="file" accept="application/json" style="display:none"></div>`;
    }
    acessoPanelHTML += `</div>
          <div class="admin-tag-filter" id="admin-tag-filter"></div>
          <input id="admin-search" class="admin-search" type="text" placeholder="Buscar por nome ou email…">
          <div class="admin-users" id="admin-users"></div>
        </div>
      </div>`;
    panelsHTML += acessoPanelHTML;
    if (iAmAdmin) {
      subtabsHTML += `<button class="admin-subtab" data-subtab="gerenciamento">Gerenciamento</button>`;
      panelsHTML += `
      <div class="admin-panel" data-panel="gerenciamento">
        <div class="area-card" style="background: rgba(10,10,12,.75); border: 1px solid var(--line); border-radius: 12px;">
          <h3>Gerenciar Moderador</h3>
          <p style="color:var(--dim);font-size:12.5px;margin:0 0 16px">Digite o email para adicionar ou remover um moderador. A sala do moderador vem da tag "Sala A/B/C" que ele tem.</p>
          <div class="admin-field" style="margin-bottom: 16px;">
            <label>EMAIL DO USUÁRIO</label>
            <input id="mod-email" type="email" placeholder="nome.sobrenome@escola.pr.gov.br">
          </div>
          <div class="admin-field" style="margin-bottom: 16px;">
            <label>SALA PERMITIDA (opcional)</label>
            <select id="mod-room" class="admin-select">
              <option value="">Nenhuma (Todas)</option>
              <option value="Sala A">Sala A</option>
              <option value="Sala B">Sala B</option>
              <option value="Sala C">Sala C</option>
            </select>
          </div>
          <button class="admin-btn" id="mod-toggle-btn" style="width: 100%; justify-content: center;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg> Tornar Moderador
          </button>
        </div>
        <div class="area-card" style="background: rgba(10,10,12,.75); border: 1px solid var(--line); border-radius: 12px;">
          <h3>Moderadores Ativos</h3>
          <div id="mod-list-accordion" class="mod-accordion">
            <div class="admin-empty">carregando...</div>
          </div>
        </div>
      </div>`;
      
      subtabsHTML += `<button class="admin-subtab" data-subtab="pins">PINs</button>`;
      panelsHTML += `
      <div class="admin-panel" data-panel="pins">
        <div class="area-card">
          <div class="admin-head">
            <div class="admin-head-left"><h3>Gerenciamento de PINs</h3></div>
          </div>
          <div class="pin-admin-grid" id="admin-pins-list"></div>
        </div>
      </div>`;
    }
    const canHist = iAmAdmin;
    const canLogs = iAmAdmin;
    if (canHist || canLogs) {
      subtabsHTML += `<button class="admin-subtab" data-subtab="historico">Histórico</button>`;
      let histContent = `<div class="admin-panel" data-panel="historico">`;
      histContent += `
        <div class="area-card" id="hist-card">
          <div class="admin-head"><div class="admin-head-left"><h3>Histórico de uso</h3><span class="admin-count" id="hist-count"></span></div></div>
          <div class="hist-search-wrap"><input id="hist-search" class="admin-search" type="text" placeholder="nome.sobrenome@escola.pr.gov.br" style="margin:0"></div>
          <div class="hist-list" id="hist-list"><div class="admin-empty">Digite um email acima.</div></div>
        </div>`;
      histContent += `
        <div class="area-card" id="logs-card">
          <div class="admin-head"><div class="admin-head-left"><h3>Admin Logs</h3></div><div class="admin-io"><button id="admin-logs-export">exportar</button></div></div>
          <div class="hist-list" id="admin-log-list"><div class="admin-empty">carregando...</div></div>
        </div>`;
      histContent += `</div>`;
      panelsHTML += histContent;
    }
    if (iAmAdmin) {
      subtabsHTML += `<button class="admin-subtab" data-subtab="kill">Desligar sessão</button>`;
      panelsHTML += `
      <div class="admin-panel" data-panel="kill">
        <div class="area-card">
          <h3>Desligar sessão</h3><p style="color:var(--dim);font-size:12.5px;margin:0 0 20px">Derruba a aba onde a pessoa está logada de forma imediata.</p>
          <form class="kill-form" id="kill-form">
            <div class="admin-field"><label for="kill-email">email @escola</label><input id="kill-email" name="email" type="email" required placeholder="nome.sobrenome@escola.pr.gov.br"></div>
            <div class="admin-field" style="margin-top: 8px;"><label>modo de execução</label><div class="kill-options" id="kill-options">
              <button type="button" class="kill-opt" data-mode="soft"><div class="kill-radio"></div><div class="kill-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></div><div class="kill-text"><b>Fechar a sessão</b><span>Derruba a aba atual, mas a pessoa pode reabrir o site logada.</span></div></button>
              <button type="button" class="kill-opt danger" data-mode="hard"><div class="kill-radio"></div><div class="kill-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg></div><div class="kill-text"><b>fechar e deslogar</b><span>Derruba a aba, limpa a memória e apaga a sessão. Exige login novamente.</span></div></button>
            </div></div>
            <button class="admin-btn kill-submit-btn" type="submit" id="kill-submit" disabled style="margin-top: 10px;"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Executar Comando</button>
          </form>
        </div>
        <div class="area-card danger-zone">
          <h3><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Zona de Perigo</h3>
          <p style="font-size: 12.5px; margin-bottom: 16px;">Encerra a sessão de <b>TODOS</b> os usuários ativos no sistema instantaneamente.</p>
          <button class="admin-btn admin-btn-danger" type="button" id="admin-kill-all" style="width: 100%; display: flex; justify-content: center; align-items: center; gap: 8px;"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg> Desligar todos os usuários</button>
        </div>
        <div class="area-card"><h3>Desligamentos pendentes</h3><div class="kill-pending-list" id="kill-pending-list"><div class="admin-empty">Nenhum desligamento pendente.</div></div></div>
      </div>`;
      subtabsHTML += `<button class="admin-subtab" data-subtab="bloqueio">Bloqueio</button>`;
      panelsHTML += `
      <div class="admin-panel" data-panel="bloqueio">
        <div class="area-card">
          <h3>Bloqueio Global de Blocos</h3><p style="color:var(--dim);font-size:12.5px;margin:0 0 16px">Ative para impedir o acesso a um bloco em todo o site.</p>
          <div id="block-list" style="display:flex; flex-direction:column; gap:0;"></div>
        </div>
      </div>`;
      subtabsHTML += `<button class="admin-subtab" data-subtab="reset">Reset</button>`;
      panelsHTML += `
      <div class="admin-panel" data-panel="reset">
        <div class="area-card danger-zone">
          <h3><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/></svg> Reset de Dados</h3>
          <p style="font-size: 12.5px; margin-bottom: 16px;">Reconstrói o perfil do zero. Dropa isAdmin, isBanned e o PIN. Preserva isMod e as tags (Sala A/B/C vem daqui). Use quando alguém tiver dados quebrados.</p>
          <div class="admin-field" style="margin-bottom: 16px;">
            <label>EMAIL DO USUÁRIO (ou deixe em branco para TODOS)</label>
            <input id="reset-email" type="email" placeholder="nome.sobrenome@escola.pr.gov.br" list="people-emails">
          </div>
          <button class="admin-btn admin-btn-danger" type="button" id="btn-reset-data" style="width: 100%; display: flex; justify-content: center; align-items: center; gap: 8px; margin-bottom: 12px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Executar Reset
          </button>
          <button class="admin-btn admin-btn-outline" type="button" id="btn-sanitize-data" style="width: 100%; display: flex; justify-content: center; align-items: center; gap: 8px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9"/></svg> Sanitizar todos
          </button>
        </div>
      </div>`;
    }
    panel.innerHTML = `
      <div class="admin-subtabs">
        ${subtabsHTML}
      </div>
      ${panelsHTML}
    `;
    areaBody.appendChild(panel);
    wireTabs();
    wireAdminTabs();
    const adminAddForm = document.getElementById('admin-add-form');
    if (adminAddForm) {
      adminAddForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        if (form.dataset.busy === '1') return;
        const email = form.email.value.trim().toLowerCase();
        const name  = form.name.value.trim();
        const tags  = [...form.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
        if (!email.includes('@') || !name) { toast('dados inválidos', true); return; }
        form.dataset.busy = '1';
        try { await adminCall('admin:setUser', { email, name, tags }); toast('adicionado'); form.reset(); await loadAdmin(); }
        catch (e) { toast('falha: ' + e.message, true); }
        finally { delete form.dataset.busy; }
      });
    }
    const modEmailInp = document.getElementById('mod-email');
    const modRoomSel = document.getElementById('mod-room');
    const modToggleBtn = document.getElementById('mod-toggle-btn');
    function updateModToggleState() {
      if (!adminData || !modEmailInp) return;
      const email = modEmailInp.value.trim().toLowerCase();
      const target = adminData.people?.find(x => x.email === email);
      if (target && target.isMod) {
        modToggleBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Remover Moderador';
        modToggleBtn.className = 'admin-btn admin-btn-danger';
        const curSala = (target.tags || []).find(t => t.startsWith('Sala ')) || '';
        modRoomSel.value = curSala;
      } else {
        modToggleBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg> Tornar Moderador';
        modToggleBtn.className = 'admin-btn';
      }
    }
    window.__updateModToggleState = updateModToggleState;
    if (modEmailInp) modEmailInp.addEventListener('input', updateModToggleState);
    if (modToggleBtn) {
      modToggleBtn.addEventListener('click', async () => {
        if (modToggleBtn.dataset.busy === '1') return;
        const email = modEmailInp.value.trim().toLowerCase();
        if (!email.includes('@')) { toast('email inválido', true); return; }
        const target = adminData.people.find(x => x.email === email);
        const isMod = target?.isMod;
        if (!target && !isMod) {
          if (!confirm('O email ' + email + ' não está cadastrado. Criar moderador mesmo assim?\n\nO usuário vai precisar de blocos autorizados pra logar.')) return;
        }
        const room = modRoomSel.value;
        if (!currentUser.hasPin) { toast('Você precisa definir um PIN antes.', true); return; }
        openPinModal('Autorização', 'Digite seu PIN de admin para salvar as alterações.', 'login', async (adminPin) => {
          modToggleBtn.dataset.busy = '1';
          modToggleBtn.disabled = true;
          const originalHTML = modToggleBtn.innerHTML;
          modToggleBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></div>';
          try {
            const currentTags = (target?.tags || []).filter(t => !t.startsWith('Sala '));
            const newTags = room ? [...currentTags, room] : currentTags;
            if (isMod) {
              await adminCall('admin:setUser', { email, isMod: false, tags: newTags, adminPin });
              toast('moderador removido');
            } else {
              await adminCall('admin:setUser', { email, name: target?.name || '', tags: newTags, isMod: true, adminPin });
              toast('moderador salvo');
            }
            closePinModal();
            await loadAdmin();
            modEmailInp.value = '';
            updateModToggleState();
          } catch (e) {
            throw new Error(e.message === 'wrong_admin_pin' ? 'PIN do administrador incorreto.' : e.message === 'pin_blocked' ? PIN_LOCKOUT_MESSAGE : e.message);
          } finally {
            modToggleBtn.disabled = false;
            delete modToggleBtn.dataset.busy;
            modToggleBtn.innerHTML = originalHTML;
          }
        });
      });
    }
    const adminSearchInp = document.getElementById('admin-search');
    if (adminSearchInp) adminSearchInp.addEventListener('input', applyAdminFilter);
    const dlId = 'people-emails';
    const attachList = (id) => { const el = document.getElementById(id); if (el && !el.getAttribute('list')) el.setAttribute('list', dlId); };
    attachList('admin-search'); attachList('hist-search'); attachList('kill-email'); attachList('mod-email'); attachList('admin-new-email'); attachList('reset-email');
    const logsExportBtn = document.getElementById('admin-logs-export');
    if (logsExportBtn) {
      logsExportBtn.addEventListener('click', async () => {
        if (logsExportBtn.dataset.busy === '1') return;
        logsExportBtn.dataset.busy = '1'; logsExportBtn.disabled = true;
        try {
          const r = await adminCall('admin:logs');
          const logs = r.logs || [];
          if (!logs.length) { toast('nenhum log.', true); return; }
          const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), count: logs.length, logs }, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = 'lynx-logs-' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 500);
          toast('exportado: ' + logs.length + ' registros');
        } catch (e) { toast('falha: ' + e.message, true); }
        finally { logsExportBtn.disabled = false; delete logsExportBtn.dataset.busy; }
      });
    }
    const exportBtn = document.getElementById('admin-export');
    if (exportBtn) exportBtn.addEventListener('click', doExport);
    const importBtn = document.getElementById('admin-import');
    if (importBtn) importBtn.addEventListener('click', () => { document.getElementById('admin-import-file').click(); });
    const importFile = document.getElementById('admin-import-file');
    if (importFile) importFile.addEventListener('change', doImport);
    let histTimer = null;
    const histSearchInp = document.getElementById('hist-search');
    if (histSearchInp) {
      histSearchInp.addEventListener('input', (e) => {
        clearTimeout(histTimer);
        const val = e.target.value.trim().toLowerCase();
        histTimer = setTimeout(() => {
          if (!val || !val.includes('@')) { document.getElementById('hist-list').innerHTML = '<div class="admin-empty">digite um email acima.</div>'; return; }
          loadHistory(val);
        }, 400);
      });
    }
    document.querySelectorAll('.kill-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.kill-opt').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        killSelectedMode = opt.dataset.mode;
        const btn = document.getElementById('kill-submit');
        if (btn) btn.disabled = false;
      });
    });
    const killForm = document.getElementById('kill-form');
    if (killForm) {
      killForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const form = e.target;
        if (form.dataset.busy === '1') return;
        const email = document.getElementById('kill-email').value.trim().toLowerCase();
        if (!email.includes('@') || !killSelectedMode) { toast('dados inválidos', true); return; }
        if (!confirm('Executar ' + killSelectedMode + ' em ' + email + '?')) return;
        form.dataset.busy = '1';
        const doKill = async (adminPin) => {
          try {
            const payload = { email, mode: killSelectedMode, targetTags: (adminData.people.find(p => p.email === email)||{}).tags };
            if (adminPin) payload.adminPin = adminPin;
            await adminCall('admin:killSession', payload);
            toast('enviado');
            e.target.reset(); killSelectedMode = null;
            document.querySelectorAll('.kill-opt').forEach(o => o.classList.remove('selected'));
            document.getElementById('kill-submit').disabled = true;
            await loadKills();
          } catch (err) { toast('falha: ' + err.message, true); }
          finally { delete form.dataset.busy; }
        };
        if (killSelectedMode === 'hard' || killSelectedMode === 'killAll') {
          if (!currentUser.hasPin) { toast('Você precisa definir um PIN antes.', true); delete form.dataset.busy; return; }
          openPinModal('Autorização', 'Digite seu PIN de admin para executar o desligamento permanente.', 'login', async (adminPin) => {
            closePinModal();
            await doKill(adminPin);
          });
        } else {
          await doKill(null);
        }
      });
    }
    const killAllBtn = document.getElementById('admin-kill-all');
    if (killAllBtn) {
      killAllBtn.addEventListener('click', async () => {
        if (killAllBtn.dataset.busy === '1') return;
        if (!confirm('Encerrar a sessão de TODOS os usuários agora?')) return;
        if (!currentUser.hasPin) { toast('Você precisa definir um PIN antes.', true); return; }
        killAllBtn.dataset.busy = '1';
        try { await runBulkJob('kill_all'); } finally { delete killAllBtn.dataset.busy; }
      });
    }

    // ── RESET ──────────────────────────────────────────────
    const resetBtn = document.getElementById('btn-reset-data');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        if (resetBtn.dataset.busy === '1') return;
        const emailInput = document.getElementById('reset-email').value.trim().toLowerCase();
        const isAll = emailInput === '';
        if (!isAll && !emailInput.includes('@')) { toast('email inválido.', true); return; }
        if (isAll) {
          if (!confirm('Resetar TODOS os usuários? Esta operação reconstruirá o perfil de cada um.')) return;
          if (!currentUser.hasPin) { toast('Você precisa definir um PIN antes.', true); return; }
          resetBtn.dataset.busy = '1'; resetBtn.disabled = true;
          try { await runBulkJob('reset_all'); } finally { resetBtn.disabled = false; delete resetBtn.dataset.busy; }
          return;
        }
        const targetLabel = emailInput;
        if (!confirm('Atenção: reset reconstrói o perfil do zero. Dropa isAdmin, isBanned e o PIN. Preserva isMod e as tags.\n\nAlvo: ' + targetLabel + '.\n\nContinuar?')) return;
        if (!currentUser.hasPin) { toast('Você precisa definir um PIN antes.', true); return; }
        openPinModal('Autorização', 'Digite seu PIN de admin para confirmar o reset.', 'login', async (adminPin) => {
          resetBtn.dataset.busy = '1'; resetBtn.disabled = true;
          const originalHTML = resetBtn.innerHTML;
          resetBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></div>';
          try {
            const payload = { action: 'admin:resetUserData', adminPin };
            payload.email = emailInput;
            const r = await adminCall(payload.action, payload);
            if (!r.ok) throw new Error(r.error || 'falha');
            closePinModal();
            toast('reset concluído: ' + (r.count || 0) + ' perfil(is) limpo(s).');
            document.getElementById('reset-email').value = '';
            await loadAdmin();
          } catch (e) {
            throw new Error(e.message === 'wrong_admin_pin' ? 'PIN incorreto.' : e.message === 'pin_blocked' ? PIN_LOCKOUT_MESSAGE : e.message);
          } finally {
            resetBtn.disabled = false; delete resetBtn.dataset.busy; resetBtn.innerHTML = originalHTML;
          }
        });
      });
    }

    // ── SANITIZE ───────────────────────────────────────────
    const sanitizeBtn = document.getElementById('btn-sanitize-data');
    if (sanitizeBtn) {
      sanitizeBtn.addEventListener('click', async () => {
        if (sanitizeBtn.dataset.busy === '1') return;
        if (!confirm('Sanitizar TODOS os usuários?\n\nRemove campos falsos/vazios e deprecated (ex: isAdmin:false, isMod:false, isBanned:false).\nNão altera dados reais: isAdmin, isMod, isBanned, tags, PIN e nome são preservados quando verdadeiros.\n\nContinuar?')) return;
        if (!currentUser.hasPin) { toast('Você precisa definir um PIN antes.', true); return; }
        sanitizeBtn.dataset.busy = '1'; sanitizeBtn.disabled = true;
        try { await runBulkJob('sanitize_all'); } finally { sanitizeBtn.disabled = false; delete sanitizeBtn.dataset.busy; }
      });
    }
  }
  function normalize(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s@._-]/g, '').trim(); }
  function levenshtein(a, b) { if (a === b) return 0; if (!a.length) return b.length; if (!b.length) return a.length; const prev = new Array(b.length + 1), curr = new Array(b.length + 1); for (let j = 0; j <= b.length; j++) prev[j] = j; for (let i = 1; i <= a.length; i++) { curr[0] = i; for (let j = 1; j <= b.length; j++) { const cost = a[i-1] === b[j-1] ? 0 : 1; curr[j] = Math.min(curr[j-1]+1, prev[j]+1, prev[j-1]+cost); } for (let j = 0; j <= b.length; j++) prev[j] = curr[j]; } return prev[b.length]; }
  function thresholdFor(term) { const n = term.length; if (n <= 3) return 1; if (n <= 6) return 2; return 3; }
  function fuzzyMatch(term, hay) { if (!term) return true; if (!hay) return false; const t = normalize(term), h = normalize(hay); if (h.includes(t)) return true; const words = h.split(/[\s@._-]+/).filter(Boolean); if (words.some(w => w.startsWith(t))) return true; const th = thresholdFor(t); if (words.some(w => levenshtein(t, w) <= th)) return true; if (levenshtein(t, h) <= th) return true; return false; }
  function applyAdminFilter() { const input = document.getElementById('admin-search'); if (!input) return; const term = input.value.trim(); document.querySelectorAll('#admin-users .admin-row').forEach(row => { const hay = row.dataset.search || ''; const tags = (row.dataset.tags || '').split('|').filter(Boolean); const tagsOk = [...adminSelectedTags].every(t => tags.includes(t)); const searchOk = fuzzyMatch(term, hay); row.style.display = (tagsOk && searchOk) ? '' : 'none'; }); }
  function doExport() { if (!adminData) { toast('nada para exportar', true); return; } const data = { exportedAt: new Date().toISOString(), authorizedTags: adminData.allTags, people: adminData.people }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'lynx-access-' + new Date().toISOString().slice(0, 10) + '.json'; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 500); toast('exportado'); }
  async function doImport(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const people = Array.isArray(parsed) ? parsed : parsed.people;
      if (!Array.isArray(people) || !people.length) { toast('arquivo inválido', true); return; }
      if (!confirm('Importar ' + people.length + ' pessoa' + (people.length === 1 ? '' : 's') + '? Emails existentes serão sobrescritos.')) return;
      const r = await adminCall('admin:import', { people });
      toast('importado: ' + r.imported);
      await loadAdmin();
    } catch (err) { toast('falha: ' + err.message, true); }
  }
  function renderAdminUsers() {
    const list = document.getElementById('admin-users'); if (!list) return; list.innerHTML = '';
    if (!adminData || !adminData.people || !adminData.people.length) {
      let msg = 'nenhum usuário.';
      if (currentUser && !currentUser.isAdmin) { msg = 'Nenhum usuário encontrado.'; }
      list.innerHTML = '<div class="admin-empty">' + msg + '</div>';
      return;
    }
    const iAmAdmin = currentUser && currentUser.isAdmin;
    for (const p of adminData.people) {
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.dataset.search = ((p.name || '') + ' ' + (p.nick || '') + ' ' + (p.email || '')).toLowerCase();
      row.dataset.tags = (p.tags || []).join('|');
      const meta = document.createElement('div'); meta.className = 'admin-meta';
      const nm = document.createElement('div'); nm.className = 'admin-name';
      let isBanned = p.isBanned === true;
      if (banOverrides.has(p.email)) {
        isBanned = banOverrides.get(p.email);
        if (p.isBanned === isBanned) banOverrides.delete(p.email);
      }
      let nameHtml = escapeHtml(p.name || '(sem nome)');
      if (p.isAdmin === true) nameHtml += ` <span style="font-size:10px;color:#d4af37;border:1px solid rgba(212,175,55,.5);padding:1px 6px;border-radius:999px;margin-left:4px;letter-spacing:.3px;">admin</span>`;
      else if (p.isMod === true) nameHtml += ` <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#e05252" stroke-width="2.5" style="vertical-align:middle; margin-left:4px; margin-bottom:2px;" title="Moderador"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
      if (isBanned) nameHtml += ` <span style="font-size:10px;color:#e05252;border:1px solid rgba(224,82,82,.55);padding:1px 6px;border-radius:999px;margin-left:4px;letter-spacing:.3px;background:rgba(224,82,82,.08);">banido</span>`;
      const currentSala = (p.tags || []).find(t => t === 'Sala A' || t === 'Sala B' || t === 'Sala C') || '';
      if (iAmAdmin) {
        nameHtml += '<span data-sala-placeholder="1"></span>';
      } else if (currentSala) {
        const shortSala = currentSala.replace('Sala ', '');
        nameHtml += ` <span style="font-size:10px; font-weight:600; color:var(--accent-2); margin-left:4px;">#${shortSala}</span>`;
      }
      nm.innerHTML = nameHtml;
      if (iAmAdmin) {
        const placeholder = nm.querySelector('[data-sala-placeholder]');
        if (placeholder) {
          const sel = document.createElement('select');
          sel.className = 'tag-select' + (currentSala ? '' : ' empty');
          sel.dataset.sala = p.email;
          [['', '#sala'], ['Sala A', '#A'], ['Sala B', '#B'], ['Sala C', '#C']].forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            if (val === currentSala || (!val && !currentSala)) opt.selected = true;
            sel.appendChild(opt);
          });
          sel.addEventListener('change', async () => {
            const newSala = sel.value;
            const set = new Set(p.tags || []);
            if (currentSala) set.delete(currentSala);
            if (newSala) set.add(newSala);
            sel.disabled = true;
            try {
              await adminCall('admin:setUser', { email: p.email, name: p.name || '', tags: [...set] });
              toast('sala alterada');
              await loadAdmin();
            } catch (err) {
              toast('falha: ' + err.message, true);
              sel.value = currentSala;
            } finally {
              sel.disabled = false;
            }
          });
          placeholder.replaceWith(sel);
        }
      }
      
      const copyBtn = document.createElement('button');
      copyBtn.className = 'copy-email-btn';
      copyBtn.title = 'Copiar email: ' + p.email;
      copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      copyBtn.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(p.email); toast('Email copiado!'); }
        catch (e) { toast('Falha ao copiar.', true); }
      });
      nm.appendChild(copyBtn);
      meta.append(nm);

      if (p.nick) {
        const nk = document.createElement('div'); nk.className = 'admin-email'; nk.style.color = 'var(--accent-2)'; nk.textContent = '@' + p.nick;
        meta.append(nk);
      }

      const chips = document.createElement('div'); chips.className = 'admin-chips';
      for (const tag of adminData.allTags) {
        const hasTag = (p.tags || []).includes(tag);
        if (iAmAdmin) {
          const c = document.createElement('button');
          c.type = 'button';
          c.className = 'admin-chip' + (hasTag ? ' on' : '');
          c.textContent = tag;
          c.addEventListener('click', async () => {
            const key = p.email + ':' + tag;
            if (_tagInflight.has(key)) return;
            _tagInflight.add(key);
            const wasOn = c.classList.contains('on');
            const originalTags = [...(p.tags || [])];
            const set = new Set(originalTags);
            if (wasOn) set.delete(tag); else set.add(tag);
            p.tags = [...set];
            c.classList.toggle('on');
            row.dataset.tags = p.tags.join('|');
            try {
              await adminCall('admin:setUser', { email: p.email, name: p.name || '', tags: p.tags });
              toast('atualizado');
              applyAdminFilter();
            } catch (e) {
              p.tags = originalTags;
              c.classList.toggle('on', wasOn);
              row.dataset.tags = originalTags.join('|');
              toast('falha: ' + e.message, true);
            } finally {
              _tagInflight.delete(key);
            }
          });
          chips.appendChild(c);
        } else if (hasTag) {
          const span = document.createElement('span');
          span.className = 'admin-chip on';
          span.style.cursor = 'default';
          span.textContent = tag;
          chips.appendChild(span);
        }
      }
      row.appendChild(meta);
      row.appendChild(chips);
      const targetIsAdminOrMod = p.isAdmin || p.isMod;
      const canTarget = iAmAdmin || !targetIsAdminOrMod;
      if (canTarget && iAmAdmin) {
        const banBtn = document.createElement('button');
        banBtn.type = 'button';
        banBtn.className = 'admin-ban-btn ' + (isBanned ? 'unban' : 'ban');
        banBtn.innerHTML = isBanned 
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg> Desbanir'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg> Banir';
        banBtn.addEventListener('click', async () => {
          if (banBtn.dataset.busy === '1') return;
          if (p.isAdmin && !isBanned) { toast('não pode banir admin.', true); return; }
          const action = isBanned ? 'admin:unbanUser' : 'admin:banUser';
          const msg = isBanned ? 'desbanir ' + p.email + '?' : 'BANIR ' + p.email + '?\n\nA sessão dele cai na hora.';
          if (!confirm(msg)) return;
          banBtn.dataset.busy = '1'; banBtn.disabled = true;
          const oldHtml = banBtn.innerHTML;
          banBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></div>';
          try {
            await adminCall(action, { email: p.email, targetTags: p.tags || [] });
            toast(isBanned ? 'desbanido' : 'banido');
            const newBanned = !isBanned;
            banOverrides.set(p.email, newBanned);
            p.isBanned = newBanned;
            await loadAdmin();
          } catch (e) {
            toast('falha: ' + e.message, true);
            banBtn.disabled = false;
            banBtn.innerHTML = oldHtml;
          } finally {
            delete banBtn.dataset.busy;
          }
        });
        row.appendChild(banBtn);
      }
      if (iAmAdmin) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'admin-del';
        del.textContent = 'remover';
        del.addEventListener('click', async () => {
          if (_delInflight.has(p.email)) return;
          if (!confirm('remover ' + p.email + '?')) return;
          _delInflight.add(p.email);
          try { await adminCall('admin:deleteUser', { email: p.email }); toast('removido'); banOverrides.delete(p.email); await loadAdmin(); }
          catch (e) { toast('falha: ' + e.message, true); }
          finally { _delInflight.delete(p.email); }
        });
        row.appendChild(del);
      }
      list.appendChild(row);
    }
    applyAdminFilter();
  }

  function renderAdminPinsList() {
    const list = document.getElementById('admin-pins-list');
    if (!list || !adminData) return;
    list.innerHTML = '';
    list.className = 'pin-admin-grid';
    const people = [...adminData.people].filter(p => p.isAdmin || p.isMod).sort((a, b) => {
      if (!!a.hasPin !== !!b.hasPin) return a.hasPin ? -1 : 1;
      return (a.name || a.email).localeCompare(b.name || b.email);
    });
    if (!people.length) {
      list.innerHTML = '<div class="admin-empty">Nenhum moderador ou admin no sistema.</div>';
      return;
    }
    for (const p of people) {
      const card = document.createElement('div');
      card.className = 'pin-admin-card';
      const info = document.createElement('div');
      info.className = 'pin-admin-info';
      info.innerHTML = `<div class="pin-admin-name">${escapeHtml(p.name || '(sem nome)')}</div><div class="pin-admin-email">${escapeHtml(p.email)}</div>`;
      const valueWrap = document.createElement('div');
      valueWrap.style.display = 'flex'; valueWrap.style.alignItems = 'center'; valueWrap.style.gap = '8px'; valueWrap.style.flexShrink = '0';
      const value = document.createElement('div');
      value.className = 'pin-admin-value' + (p.hasPin ? '' : ' empty');
      value.textContent = p.hasPin ? '****' : 'não definido';
      const changeBtn = document.createElement('button');
      changeBtn.className = 'terms-btn-sm';
      changeBtn.style.padding = '4px 8px'; changeBtn.style.fontSize = '11px';
      changeBtn.textContent = 'Alterar';
      changeBtn.onclick = () => {
        openPinModal('Autorização', 'Digite seu PIN de administrador para alterar o PIN de ' + (p.name || p.email) + '.', 'login', async (adminPin) => {
          closePinModal();
          setTimeout(() => {
             openPinModal('Novo PIN', 'Defina o novo PIN para ' + (p.name || p.email) + '.', 'change', async (_, newPin) => {
               const r = await adminCall('admin:resetPin', { email: p.email, newPin, currentPin: adminPin });
               if (!r.ok) throw new Error(r.error === 'wrong_current_pin' ? 'PIN do administrador incorreto.' : r.error);
               closePinModal();
               toast('PIN alterado com sucesso.');
               await loadAdmin();
             }, true);
          }, 150);
        });
      };
      valueWrap.appendChild(value);
      valueWrap.appendChild(changeBtn);
      card.appendChild(info);
      card.appendChild(valueWrap);
      list.appendChild(card);
    }
  }

  function toast(msg, isErr) {
    const el = document.getElementById('admin-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2200);
  }
  async function requestAdminStepUp() {
    return new Promise((resolve, reject) => {
      const jwt = sessionStorage.getItem(SESSION_KEY);
      if (!jwt) { reject(new Error('no_jwt')); return; }
      if (!currentUser || !currentUser.hasPin) { reject(new Error('PIN necessário')); return; }
      let settled = false;
      const finishCancel = () => { if (settled) return; settled = true; pinCancelBtn.removeEventListener('click', finishCancel); pinOverlay.removeEventListener('click', finishBackdrop); reject(new Error('step_up_cancelled')); };
      const finishBackdrop = (event) => { if (event.target === pinOverlay) finishCancel(); };
      pinCancelBtn.addEventListener('click', finishCancel, { once: true });
      pinOverlay.addEventListener('click', finishBackdrop);
      openPinModal('Acesso Restrito', 'Digite seu PIN de 4 dígitos para continuar.', 'login', async (pin) => {
        const r = await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt, action: 'self:verifyPin', pin }) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.ok) {
          if (data.error === 'pin_blocked') throw new Error(PIN_LOCKOUT_MESSAGE);
          if (data.error === 'pin_hash_unsupported' || data.error === 'pin_verification_unavailable') throw new Error('Não foi possível verificar o PIN salvo.');
          throw new Error(data.error === 'step_up_required' ? 'PIN necessário.' : 'PIN incorreto.');
        }
        if (!settled) { settled = true; pinCancelBtn.removeEventListener('click', finishCancel); pinOverlay.removeEventListener('click', finishBackdrop); closePinModal(); resolve(); }
      });
    });
  }
  function adminCallWithPin(action, extra, hasRetriedStepUp = false) {
    return new Promise((resolve, reject) => {
      if (!currentUser || !currentUser.hasPin) { reject(new Error('Você precisa definir um PIN antes.')); return; }
      let settled = false, submitting = false;
      const cleanup = () => { pinCancelBtn.removeEventListener('click', cancel); pinOverlay.removeEventListener('click', onBackdrop); };
      const cancel = () => { if (settled || submitting) return; settled = true; cleanup(); closePinModal(); reject(new Error('Operação cancelada.')); };
      const onBackdrop = (event) => { if (event.target === pinOverlay) cancel(); };
      pinCancelBtn.addEventListener('click', cancel);
      pinOverlay.addEventListener('click', onBackdrop);
      openPinModal('Autorização', 'Digite seu PIN de administrador para salvar as alterações.', 'login', async (adminPin) => {
        if (settled || submitting) return;
        submitting = true; pinCancelBtn.disabled = true;
        try {
          const result = await adminCall(action, { ...(extra || {}), adminPin }, hasRetriedStepUp);
          if (settled) return;
          settled = true; cleanup(); closePinModal(); resolve(result);
        } catch (error) {
          const message = error && error.message === 'wrong_admin_pin' ? 'PIN do administrador incorreto.'
            : error && error.message === 'pin_blocked' ? PIN_LOCKOUT_MESSAGE
            : error && error.message === 'no_admin_pin' ? 'Você precisa definir um PIN antes.'
            : (error && error.message) || 'Falha ao validar o PIN.';
          throw new Error(message);
        } finally { submitting = false; pinCancelBtn.disabled = false; }
      });
    });
  }

  async function adminCall(action, extra, hasRetriedStepUp = false) {
    const dataToSend = extra || {};
    const setUserNeedsPin = action === 'admin:setUser' && (dataToSend.tags !== undefined || dataToSend.isMod !== undefined);
    const adminModerationNeedsPin = !!(currentUser && currentUser.isAdmin) && (
      action === 'admin:banUser' || action === 'admin:unbanUser' || action === 'admin:deleteUser'
    );
    const adminHighImpactNeedsPin = !!(currentUser && currentUser.isAdmin) && (
      action === 'admin:blockModule' || action === 'admin:killAll' ||
      action === 'admin:resetUserData' || action === 'admin:sanitizeAll' ||
      action === 'admin:startBulk'
    );
    if ((setUserNeedsPin || adminModerationNeedsPin || adminHighImpactNeedsPin) && !String(dataToSend.adminPin || '').trim()) {
      return adminCallWithPin(action, dataToSend, hasRetriedStepUp);
    }
    const jwt = sessionStorage.getItem(SESSION_KEY);
    if (!jwt) throw new Error('no_jwt');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ADMIN_TIMEOUT);
    let r, data;
    try {
      r = await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt, action, ...(extra || {}) }), signal: ctrl.signal });
      data = await r.json().catch(() => ({}));
    } catch (e) {
      clearTimeout(timer);
      throw new Error(e.name === 'AbortError' ? 'timeout' : 'rede');
    } finally { clearTimeout(timer); }
    if (!r.ok && data.error === 'step_up_required' && !hasRetriedStepUp) {
      await requestAdminStepUp();
      return adminCall(action, extra, true);
    }
    if (!r.ok) {
      if (data.error === 'pin_blocked') throw new Error(PIN_LOCKOUT_MESSAGE);
      if (data.error === 'wrong_admin_pin') throw new Error('PIN do administrador incorreto.');
      if (r.status === 401 || data.error === 'no_jwt' || data.error === 'bad_jwt' || data.error === 'email_not_verified') kill();
      throw new Error(data.error || ('http ' + r.status));
    }
    return data;
  }
  function setAdminLoading(isLoading) {
    const panel = document.querySelector('.area-panel[data-panel="acesso"]');
    if (!panel) return;
    let ov = panel.querySelector('.admin-loading-overlay');
    if (isLoading) {
      if (!ov) { ov = document.createElement('div'); ov.className = 'admin-loading-overlay'; ov.innerHTML = '<div class="spinner"></div><span style="font-size:13px;color:var(--dim);margin-top:14px;">carregando dados...</span>'; panel.appendChild(ov); }
    } else { if (ov) ov.remove(); }
  }
  async function loadAdmin() {
    const isFirstLoad = !adminData;
    if (isFirstLoad) setAdminLoading(true);
    try {
      adminData = await adminCall('admin:list');
      adminSelectedTags.clear();
      document.querySelectorAll('.admin-tag-chip').forEach(c => c.classList.remove('on'));
      const clearBtn = document.querySelector('.admin-tag-clear');
      if (clearBtn) clearBtn.classList.add('hidden');
      const searchInp = document.getElementById('admin-search');
      if (searchInp) searchInp.value = '';
      renderAdminTagsInput();
      renderAdminTagFilter();
      renderAdminUsers();
      updateAdminCount();
      renderBlockList();
      renderModeratorsAccordion();
      refreshPeopleDatalist();
      if (window.__updateModToggleState) window.__updateModToggleState();
      const currentTab = document.querySelector('.admin-subtab.selected');
      if (currentTab && currentTab.dataset.subtab === 'pins') renderAdminPinsList();
    } catch (e) { toast('falha ao carregar: ' + e.message, true); }
    finally { if (isFirstLoad) setAdminLoading(false); }
  }
  function updateAdminCount() { const el = document.getElementById('admin-count'); if (!el) return; const total = adminData && adminData.count != null ? adminData.count : 0; el.innerHTML = '<b>' + total + '</b> pessoa' + (total === 1 ? '' : 's'); }
  function renderAdminTagsInput() { const wrap = document.getElementById('admin-new-tags'); if (!wrap) return; wrap.innerHTML = ''; if (!adminData || !adminData.allTags || !adminData.allTags.length) { wrap.innerHTML = '<span style="color:var(--dim);font-size:12.5px">sem tags no catálogo.</span>'; return; } for (const tag of adminData.allTags) { const label = document.createElement('label'); label.className = 'admin-check'; const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = tag; label.append(cb, document.createTextNode(tag)); wrap.appendChild(label); } }
  function renderAdminTagFilter() {
    const wrap = document.getElementById('admin-tag-filter'); if (!wrap) return; wrap.innerHTML = ''; if (!adminData || !adminData.allTags || !adminData.allTags.length) return;
    for (const tag of adminData.allTags) {
      const c = document.createElement('button'); c.type = 'button';
      c.className = 'admin-tag-chip' + (adminSelectedTags.has(tag) ? ' on' : '');
      c.textContent = tag;
      c.addEventListener('click', () => {
        if (adminSelectedTags.has(tag)) adminSelectedTags.delete(tag); else adminSelectedTags.add(tag);
        c.classList.toggle('on');
        const clearBtn = wrap.querySelector('.admin-tag-clear');
        if (clearBtn) clearBtn.classList.toggle('hidden', adminSelectedTags.size === 0);
        applyAdminFilter();
      });
      wrap.appendChild(c);
    }
    const clearBtn = document.createElement('button'); clearBtn.type = 'button';
    clearBtn.className = 'admin-tag-clear' + (adminSelectedTags.size === 0 ? ' hidden' : '');
    clearBtn.textContent = 'limpar filtros';
    clearBtn.addEventListener('click', () => { adminSelectedTags.clear(); wrap.querySelectorAll('.admin-tag-chip').forEach(c => c.classList.remove('on')); clearBtn.classList.add('hidden'); applyAdminFilter(); });
    wrap.appendChild(clearBtn);
  }
  function renderModeratorsAccordion() {
    const wrap = document.getElementById('mod-list-accordion');
    if (!wrap || !adminData) return;
    wrap.innerHTML = '';
    const mods = adminData.people.filter(p => p.isMod);
    if (mods.length === 0) { wrap.innerHTML = '<div class="admin-empty">Nenhum moderador ativo.</div>'; return; }
    mods.forEach(mod => {
      const item = document.createElement('div'); item.className = 'mod-item';
      const header = document.createElement('div'); header.className = 'mod-header';
      header.innerHTML = `
        <div class="mod-header-left">
          <span class="mod-header-name">${escapeHtml(mod.name || '(sem nome)')}${mod.nick ? ' <span style="color:var(--accent-2); font-weight:400;">· @' + escapeHtml(mod.nick) + '</span>' : ''}</span>
          <span class="mod-header-email">${escapeHtml(mod.email)}</span>
        </div>
        <svg class="mod-header-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
      `;
      const body = document.createElement('div'); body.className = 'mod-body';
      const innerEmail = `mod-${mod.email.replace(/[^a-z0-9]/g, '')}`;
      const roomId = `room-${innerEmail}`;
      const currentRoom = (mod.tags || []).find(t => t.startsWith('Sala ')) || '';
      body.innerHTML = `
        <div class="admin-field">
          <label>SALA</label>
          <select class="admin-select" id="${roomId}">
            <option value="">Nenhuma (Todas)</option>
            <option value="Sala A" ${currentRoom === 'Sala A' ? 'selected' : ''}>Sala A</option>
            <option value="Sala B" ${currentRoom === 'Sala B' ? 'selected' : ''}>Sala B</option>
            <option value="Sala C" ${currentRoom === 'Sala C' ? 'selected' : ''}>Sala C</option>
          </select>
        </div>
        <button class="admin-btn" style="margin-top: 16px; width: 100%; justify-content: center;" data-save-mod-placeholder="1">Salvar Alterações</button>
      `;
      header.addEventListener('click', () => item.classList.toggle('open'));
      const saveBtnPlaceholder = body.querySelector('[data-save-mod-placeholder]');
      if (saveBtnPlaceholder) saveBtnPlaceholder.dataset.saveMod = mod.email;
      const saveBtn = body.querySelector('[data-save-mod]');
      saveBtn.addEventListener('click', async () => {
        if (saveBtn.dataset.busy === '1') return;
        const newRoom = body.querySelector(`#${roomId}`).value;
        if (!currentUser.hasPin) { toast('Você precisa definir um PIN antes.', true); return; }
        openPinModal('Autorização', 'Digite seu PIN de admin para salvar as alterações.', 'login', async (adminPin) => {
          const originalHTML = saveBtn.innerHTML;
          saveBtn.dataset.busy = '1'; saveBtn.disabled = true;
          saveBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></div>';
          try {
            const currentTags = (mod.tags || []).filter(t => !t.startsWith('Sala '));
            const newTags = newRoom ? [...currentTags, newRoom] : currentTags;
            await adminCall('admin:setUser', { email: mod.email, name: mod.name, tags: newTags, isMod: true, adminPin });
            toast('moderador atualizado');
            closePinModal();
            await loadAdmin();
            const updatedItem = [...wrap.children].find(el => el.innerText.includes(mod.email));
            if (updatedItem) updatedItem.classList.add('open');
          } catch (e) {
            throw new Error(e.message === 'wrong_admin_pin' ? 'PIN do administrador incorreto.' : e.message === 'pin_blocked' ? PIN_LOCKOUT_MESSAGE : e.message);
          } finally {
            saveBtn.disabled = false; delete saveBtn.dataset.busy; saveBtn.innerHTML = originalHTML;
          }
        });
      });
      item.appendChild(header);
      item.appendChild(body);
      wrap.appendChild(item);
    });
  }
  function renderBlockList() {
    const wrap = document.getElementById('block-list'); if (!wrap || !adminData) return; wrap.innerHTML = '';
    const allTags = adminData.allTags || [];
    for (const tag of allTags) {
      const isBlocked = (adminData.blockedModules || []).includes(tag);
      const row = document.createElement('div'); row.className = 'block-row';
      const nameDiv = document.createElement('div'); nameDiv.className = 'block-name';
      nameDiv.innerHTML = `<span class="block-status ${isBlocked ? 'on' : 'off'}"></span> ${escapeHtml(tag)}`;
      const btn = document.createElement('button');
      btn.className = `block-btn ${isBlocked ? 'btn-unblock' : 'btn-block'}`;
      const iconSvg = isBlocked
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
      btn.innerHTML = iconSvg + (isBlocked ? 'Desbloquear' : 'Bloquear');
      btn.onclick = async () => {
        if (btn.dataset.busy === '1') return;
        const originalHTML = btn.innerHTML;
        btn.dataset.busy = '1'; btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0;"></div>';
        try {
          await adminCall('admin:blockModule', { tag, block: !isBlocked });
          toast(tag + (isBlocked ? ' desbloqueado' : ' bloqueado'));
          await loadAdmin();
        } catch (e) {
          toast(e.message, true);
          btn.disabled = false; btn.innerHTML = originalHTML;
        } finally { delete btn.dataset.busy; }
      };
      row.appendChild(nameDiv); row.appendChild(btn);
      wrap.appendChild(row);
    }
  }
  async function loadHistory(email) {
    const list = document.getElementById('hist-list');
    const countEl = document.getElementById('hist-count');
    if (!list) return;
    list.innerHTML = '<div class="admin-empty">carregando…</div>';
    const target = adminData?.people?.find(p => p.email === email);
    const targetTags = target?.tags || [];
    try {
      const r = await adminCall('admin:history', { email, limit: 200, targetTags });
      const events = r.events || [];
      list.innerHTML = '';
      if (!events.length) { list.innerHTML = '<div class="admin-empty">nenhum evento.</div>'; countEl.textContent = ''; return; }
      countEl.innerHTML = '<b>' + events.length + '</b> eventos';
      for (const ev of events) list.appendChild(renderHistItem(ev, email));
    } catch (e) { list.innerHTML = '<div class="admin-empty">falha: ' + escapeHtml(e.message) + '</div>'; }
  }
  async function loadLogs() {
    const list = document.getElementById('admin-log-list');
    if (!list) return;
    list.innerHTML = '<div class="admin-empty">carregando…</div>';
    try {
      const r = await adminCall('admin:logs');
      const logs = r.logs || [];
      list.innerHTML = '';
      if (!logs.length) { list.innerHTML = '<div class="admin-empty">nenhum log.</div>'; return; }
      for (const ev of logs) list.appendChild(renderHistItem(ev, null));
    } catch (e) { list.innerHTML = '<div class="admin-empty">falha: ' + escapeHtml(e.message) + '</div>'; }
  }
  function renderHistItem(ev, emailParam) {
    const row = document.createElement('div');
    row.className = 'hist-item';
    let iconClass = 'h-login';
    let iconSvg = '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/>';
    let line1 = '';
    const autor = ev.by ? `<em>${escapeHtml(ev.by)}</em>` : 'Sistema';
    const alvo = ev.target ? `<em>${escapeHtml(ev.target)}</em>` : (emailParam ? `<em>${escapeHtml(emailParam)}</em>` : 'Alguém');
    const bloco = `<em>${escapeHtml(ev.tag || ev.target || '?')}</em>`;
    switch (ev.type) {
      case 'login': line1 = 'fez login no site'; break;
      case 'copy': iconClass = 'h-copy'; iconSvg = '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'; line1 = 'copiou o bloco ' + bloco; break;
      case 'terms_accept': iconClass = 'h-terms_a'; iconSvg = '<path d="M20 6 9 17l-5-5"/>'; line1 = 'aceitou os termos de uso'; break;
      case 'user_update': iconClass = 'h-tags'; iconSvg = '<path d="M20 6 9 17l-5-5"/>'; line1 = `${autor} atualizou ${alvo} (${escapeHtml(Array.isArray(ev.changes) ? ev.changes.join(', ') : 'dados da conta')})`; break;
      case 'clear_kill': iconClass = 'h-tags'; iconSvg = '<path d="M20 6 9 17l-5-5"/>'; line1 = `${autor} limpou o bloqueio de sessão de ${alvo}`; break;
      case 'kill_soft': iconClass = 'h-kill_s'; iconSvg = '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/>'; line1 = `${autor} <em style="color:#fbbf24">derrubou a sessão</em> de ${alvo}`; break;
      case 'kill_hard': iconClass = 'h-kill'; iconSvg = '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.01"/>'; line1 = `${autor} <em style="color:#e05252">derrubou e deslogou</em> ${alvo}`; break;
      case 'banned': iconClass = 'h-ban'; iconSvg = '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'; line1 = `${autor} <em style="color:#e05252">BANIU</em> ${alvo} do sistema`; break;
      case 'ban': iconClass = 'h-ban'; iconSvg = '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'; line1 = `${autor} <em style="color:#e05252">BANIU</em> ${alvo}`; break;
      case 'unban': iconClass = 'h-tags'; iconSvg = '<path d="M20 6 9 17l-5-5"/>'; line1 = `${autor} <em style="color:#10b981">desbaniu</em> ${alvo}`; break;
      case 'block': iconClass = 'h-ban'; iconSvg = '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'; line1 = `${autor} <em style="color:#e05252">bloqueou</em> o bloco ${bloco}`; break;
      case 'unblock': iconClass = 'h-tags'; iconSvg = '<path d="M20 6 9 17l-5-5"/>'; line1 = `${autor} <em style="color:#10b981">desbloqueou</em> o bloco ${bloco}`; break;
      case 'kill_all': iconClass = 'h-kill'; iconSvg = '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5v.01"/>'; line1 = `${autor} <em style="color:#e05252">DERRUBOU TODAS as sessões</em> do site`; break;
      case 'import': iconClass = 'h-tags'; iconSvg = '<path d="M20 6 9 17l-5-5"/>'; line1 = `${autor} importou <em>${escapeHtml(String(ev.count || 0))}</em> pessoa(s)`; break;
      case 'delete': iconClass = 'h-ban'; iconSvg = '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'; line1 = `${autor} <em style="color:#e05252">removeu</em> ${alvo}`; break;
      case 'nick': iconClass = 'h-tags'; iconSvg = '<path d="M20 6 9 17l-5-5"/>'; line1 = 'trocou o apelido para <em>@' + escapeHtml(ev.nick || '') + '</em>'; break;
      case 'rename': iconClass = 'h-tags'; iconSvg = '<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.2"/>'; line1 = `${autor} definiu o nome de ${alvo} como <em>${escapeHtml(ev.name || '')}</em>`; break;
      case 'pin_set': iconClass = 'h-tags'; iconSvg = '<path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4"/>'; line1 = `alterou o próprio PIN`; break;
      case 'pin_reset': iconClass = 'h-tags'; iconSvg = '<path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2zm10-10V7a4 4 0 0 0-8 0v4"/>'; line1 = `${autor} redefiniu o PIN de ${alvo}`; break;
      case 'reset_user': iconClass = 'h-tags'; iconSvg = '<path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/>'; line1 = `${autor} <em style="color:#fbbf24">resetou</em> ${alvo}`; break;
      case 'reset_all': iconClass = 'h-tags'; iconSvg = '<path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/>'; line1 = `${autor} <em style="color:#fbbf24">resetou TODOS</em> (${escapeHtml(String(ev.count || 0))} pessoa(s))`; break;
      case 'sanitize_all': iconClass = 'h-tags'; iconSvg = '<path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9"/>'; line1 = `${autor} <em style="color:#60a5fa">sanitizou</em> ${escapeHtml(String(ev.modified || 0))}/${escapeHtml(String(ev.count || 0))} usuário(s)`; break;
      default: line1 = escapeHtml(ev.type || '?');
    }
    let line2Str = escapeHtml(fmtDate(ev.ts));
    if (ev.target && ev.type !== 'kill_all' && ev.type !== 'import' && ev.type !== 'reset_all' && ev.type !== 'sanitize_all') line2Str += ` · Alvo: <span class="hist-email">${escapeHtml(ev.target)}</span>`;
    else if (emailParam && ev.type !== 'kill_all') line2Str += ` · <span class="hist-email">${escapeHtml(emailParam)}</span>`;
    row.innerHTML = `
      <div class="hist-icon ${iconClass}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${iconSvg}</svg>
      </div>
      <div class="hist-body">
        <div class="hist-line1">${line1}</div>
        <div class="hist-line2">${line2Str}</div>
      </div>`;
    return row;
  }
  async function loadKills() {
    const list = document.getElementById('kill-pending-list');
    if (!list) return;
    list.innerHTML = '<div class="admin-empty">carregando…</div>';
    try {
      const r = await adminCall('admin:listKills');
      const kills = r.kills || [];
      list.innerHTML = '';
      if (!kills.length) { list.innerHTML = '<div class="admin-empty">nenhum pendente.</div>'; return; }
      for (const k of kills) {
        const row = document.createElement('div'); row.className = 'kill-row';
        const modeLabel = k.mode === 'hard' ? 'deslogar' : (k.mode === 'soft' ? 'fechar' : 'fechar todos');
        row.innerHTML = '<div class="kill-row-meta"><div class="kill-row-email">' + escapeHtml(k.email) + '</div><div class="kill-row-sub">' + escapeHtml(fmtRelative(k.ts)) + '</div></div><span class="kill-row-mode ' + escapeHtml(k.mode) + '">' + modeLabel + '</span>';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kill-row-btn';
        btn.textContent = 'limpar';
        btn.addEventListener('click', async () => {
          if (btn.dataset.busy === '1') return;
          btn.dataset.busy = '1';
          const isHardRecord = k.mode === 'hard' || k.mode === 'killAll';
          const doClear = async (adminPin) => {
            try {
              const payload = { email: k.email };
              if (adminPin) payload.adminPin = adminPin;
              await adminCall('admin:clearKill', payload);
              await loadKills();
            } catch (e) { toast(e.message, true); }
            finally { delete btn.dataset.busy; }
          };
          if (isHardRecord && currentUser && currentUser.hasPin) {
            openPinModal('Autorização', 'Digite seu PIN de admin para limpar o desligamento permanente.', 'login', async (adminPin) => {
              closePinModal(); await doClear(adminPin);
            });
          } else { await doClear(null); }
        });
        row.appendChild(btn);
        list.appendChild(row);
      }
    } catch (e) { list.innerHTML = '<div class="admin-empty">falha: ' + escapeHtml(e.message) + '</div>'; }
  }
  wireTabs();
  let pollTimer = null; let knownTags = new Set();
  async function _post(payload) {
    try {
      const r = await window.fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      try { return await r.json(); } catch { return null; }
    } catch { return null; }
  }
  function fadeIn(el) {
    el.style.opacity = '0'; el.style.transform = 'translateY(12px)';
    requestAnimationFrame(() => {
      el.style.transition = 'opacity .4s cubic-bezier(.2,.8,.2,1), transform .4s cubic-bezier(.2,.8,.2,1)';
      el.style.opacity = '1'; el.style.transform = 'none';
    });
  }
  async function pollTick() {
    const jwt = sessionStorage.getItem(SESSION_KEY);
    if (!jwt) return;
    const data = await _post({ jwt, action: 'checkState' });
    if (!data) return;
    if (data.ok === false) {
      if (data.error === 'banned') showBannedScreen(data.roomAdmin);
      else if (data.error === 'deleted') showDeletedScreen(data.roomAdmin);
      else if (data.error === 'no_jwt' || data.error === 'bad_jwt' || data.error === 'not_found' || data.error === 'expired') showExpiredScreen();
      return;
    }
    if (data.banned) { showBannedScreen(data.roomAdmin); return; }
    if (data.kill) {
      try { await _post({ jwt, action: 'ackKill' }); } catch {}
      if (data.kill.mode === 'soft') { stopPolling(); document.documentElement.innerHTML = ''; window.close(); setTimeout(() => { window.location.replace('about:blank'); window.close(); }, 500); }
      else if (data.kill.mode === 'hard') { showKilledScreen(data.roomAdmin); }
      else if (data.kill.mode === 'killAll') { showClosedScreen(); }
      return;
    }
    if (data.theme) applyTheme(data.theme);
    if (data.name !== undefined && currentUser) { currentUser.name = data.name; who.textContent = displayName(currentUser); }
    if (data.nick !== undefined && currentUser) { currentUser.nick = data.nick; who.textContent = displayName(currentUser); }
    if (data.hasPin !== undefined && currentUser) { currentUser.hasPin = !!data.hasPin; }
    if (data.isAdmin !== undefined && currentUser) {
      const oldAdmin = currentUser.isAdmin, oldMod = currentUser.isMod;
      currentUser.isAdmin = !!data.isAdmin;
      currentUser.isMod = !!data.isMod;
      if (oldAdmin !== currentUser.isAdmin || oldMod !== currentUser.isMod) {
        if (!currentUser.isAdmin && !currentUser.isMod) {
          const tab = document.getElementById('tab-acesso');
          if (tab) tab.remove();
          const panel = document.querySelector('.area-panel[data-panel="acesso"]');
          if (panel) panel.remove();
          if (location.pathname === '/area' && document.querySelector('.area-tab[data-tab="acesso"]')?.classList.contains('selected')) selectTab('perfil');
        } else {
          if (adminMounted) {
            mountAdminUI();
            if (adminData) loadAdmin();
            if (!document.querySelector('.area-tab.selected')) selectTab('perfil');
          }
        }
      }
    }
    applyBlocksDiff(data.blocks || []);
  }
  function startPolling() {
    stopPolling();
    if (!currentUser) return;
    knownTags = new Set((currentUser.blocks || []).map(b => b.tag));
    pollTimer = setInterval(pollTick, 5000);
    document.addEventListener('visibilitychange', onVisibilityForPoll);
  }
  function onVisibilityForPoll() { if (document.visibilityState === 'visible') pollTick(); }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } document.removeEventListener('visibilitychange', onVisibilityForPoll); }
  function route() {
    if (currentUser && !currentUser.termsAccepted) return;
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/area') {
      if (!currentUser) { showView('login'); return; }
      if (!viewArea.classList.contains('hidden')) { renderArea(); return; }
      openArea();
    } else {
      if (!currentUser) { showView('login'); return; }
      if (!viewSite.classList.contains('hidden')) return;
      showView('site'); playSiteEntrance();
    }
  }
  window.addEventListener('popstate', route);
  document.getElementById('btn-area').addEventListener('click', () => { if (location.pathname !== '/area') history.pushState({}, '', '/area'); openArea(); });
  document.getElementById('btn-home').addEventListener('click', () => { if (location.pathname !== '/') history.pushState({}, '', '/'); backHome(); });
  document.getElementById('btn-back').addEventListener('click', () => { if (location.pathname !== '/') history.pushState({}, '', '/'); backHome(); });
  function kill() {
    stopPolling();
    try { window.__guardKill && window.__guardKill('app_kill'); }
    catch { try { location.replace('about:blank'); } catch {} }
  }
  ['btn-logout','btn-logout-2','btn-logout-3'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', () => {
      stopPolling();
      sessionStorage.removeItem(SESSION_KEY);
      try { if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect(); } catch {}
      window.close();
      setTimeout(() => { window.location.replace('/'); }, 150);
    });
  });
  tryRestore();
  document.querySelectorAll('[data-action="lynx-new"]').forEach(el => el.addEventListener('click', () => startLynxExec('new')));
  document.querySelectorAll('[data-action="lynx-old"]').forEach(el => el.addEventListener('click', () => startLynxExec('old')));
  document.querySelectorAll('[data-action="identify-guide"]').forEach(el => el.addEventListener('click', (event) => { event.preventDefault(); window.showIdentifyGuide(); }));
  document.querySelectorAll('[data-action="close-lynx-version"]').forEach(el => el.addEventListener('click', () => document.getElementById('lynx-version-overlay').classList.add('hidden')));
  document.querySelectorAll('[data-action="reload-page"]').forEach(el => el.addEventListener('click', () => window.location.reload()));

})();
