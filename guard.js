(function () {
  'use strict';
  const NATIVE = { fetch: window.fetch, toString: Function.prototype.toString, xhrOpen: window.XMLHttpRequest && window.XMLHttpRequest.prototype.open, xhrSend: window.XMLHttpRequest && window.XMLHttpRequest.prototype.send, defineProp: Object.defineProperty, freeze: Object.freeze, locReplace: window.location.replace.bind(window.location) };
  let killed = false;
  // F-18: anti-debugging is NOT a security boundary — server-side authorization is.
  // Storage cleanup is narrowed to application-owned keys only so it cannot
  // destroy unrelated same-origin data for legitimate browser extensions or other apps.
  const APP_STORAGE_KEYS = ['auth_jwt'];
  function hardKill(reason) {
    if (killed) return; killed = true;
    // F-19: only remove application-owned storage keys, not every key in the origin
    try { APP_STORAGE_KEYS.forEach(k => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {} }); } catch {}
    // The application does not set any script-visible cookies, so no cookie sweep is needed.
    // If a named application cookie is added in future, remove it here by name only.
    try { document.documentElement.innerHTML = ''; } catch {}
    try { NATIVE.locReplace('about:blank'); window.close(); } catch { try { window.location.href = 'about:blank'; window.close(); } catch {} }
  }
  window.__guardKill = hardKill;
  try {
    const _noop = function () {};
    const methods = ['log','info','warn','error','debug','trace','dir','dirxml','table','group','groupCollapsed','groupEnd','count','countReset','assert','clear','time','timeEnd','timeLog','profile','profileEnd','timeStamp'];
    for (const m of methods) { try { NATIVE.defineProp(console, m, { value: _noop, writable: false, configurable: false, enumerable: false }); } catch {} }
    try { NATIVE.freeze(console); } catch {}
  } catch {}
  try { NATIVE.defineProp(Function.prototype, 'toString', { value: NATIVE.toString, writable: false, configurable: false }); } catch {}
  try { if (window.XMLHttpRequest) { NATIVE.defineProp(window.XMLHttpRequest.prototype, 'open', { value: NATIVE.xhrOpen, writable: false, configurable: false }); NATIVE.defineProp(window.XMLHttpRequest.prototype, 'send', { value: NATIVE.xhrSend, writable: false, configurable: false }); } } catch {}
  function isNative(fn) { if (typeof fn !== 'function') return false; try { return NATIVE.toString.call(fn).indexOf('[native code]') !== -1; } catch { return false; } }
  function devtoolsOpen() { try { const wDiff = window.outerWidth - window.innerWidth; const hDiff = window.outerHeight - window.innerHeight; return wDiff > 220 || hDiff > 220; } catch { return false; } }
  function checkIntegrity() {
    if (killed) return;
    if (window.fetch !== NATIVE.fetch) return hardKill('fetch_replaced');
    if (!isNative(window.fetch)) return hardKill('fetch_not_native');
    if (Function.prototype.toString !== NATIVE.toString) return hardKill('fptostring_replaced');
    if (!isNative(Function.prototype.toString)) return hardKill('fptostring_not_native');
    if (window.XMLHttpRequest) { if (!isNative(window.XMLHttpRequest.prototype.open)) return hardKill('xhr_open_patched'); if (!isNative(window.XMLHttpRequest.prototype.send)) return hardKill('xhr_send_patched'); }
    if (Object.defineProperty !== NATIVE.defineProp) return hardKill('defineprop_replaced');
    if (Object.freeze !== NATIVE.freeze) return hardKill('freeze_replaced');
    const gm = ['unsafeWindow','GM_info','GM','GM_setValue','GM_getValue','GM_deleteValue','GM_listValues','GM_xmlhttpRequest','GM_addStyle','GM_registerMenuCommand','GM_notification','GM_openInTab','GM_setClipboard','GM_download','GM_getResourceText','GM_addElement','VM','VM_info'];
    for (const g of gm) if (g in window) return hardKill('userscript_global:' + g);
    if (devtoolsOpen()) return hardKill('devtools_open');
  }
  function swallow(e) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); return false; }
  function blockShortcuts(e) { const k = (e.key || '').toLowerCase(); if (k === 'f12') return swallow(e); if (e.ctrlKey && e.shiftKey && ['i','j','c','k','e','m','p'].includes(k)) return swallow(e); if (e.ctrlKey && !e.shiftKey && ['u','s','p'].includes(k)) return swallow(e); }
  window.addEventListener('keydown', blockShortcuts, true); window.addEventListener('keyup', blockShortcuts, true);
  setInterval(checkIntegrity, 900); window.addEventListener('resize', checkIntegrity); window.addEventListener('focus', checkIntegrity); document.addEventListener('visibilitychange', checkIntegrity);
  try { checkIntegrity(); } catch {}
})();
