/**
 * rpg-fixes.js — Ultimate Enterprise Edition v3.3
 * [FIX] D-Pad Classic: Раздельные кнопки с зажатием вместо свайпов
 * [FIX] Audio OGG Enforcer: Обход ошибки отсутствующих .m4a на iOS
 */
(() => {
  if (window.__RPG_FIXES_ULTIMATE_V33__) return;
  window.__RPG_FIXES_ULTIMATE_V33__ = true;

  const API_TOKEN = document.querySelector('meta[name="api-token"]')?.content || 'SuperSecretKey123';
  const CLOUD_BASE = '/api/saves';
  const CLOUD_INIT_GRACE_MS = 1800;
  const CLOUD_RETRY_MAX = 3;

  // =========================
  // 1) BROWSER STUBS
  // =========================
  window.require = function (m) {
    if (m === 'path') return { dirname: p => p.replace(/[/\\][^/\\]*$/, '') || '.', join: (...a) => a.join('/'), basename: p => p.split(/[/\\]/).pop(), extname: p => { const b = p.split(/[/\\]/).pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; } };
    if (m === 'fs') return { readFileSync: () => '', writeFileSync: () => {}, mkdirSync: () => {}, existsSync: () => false, readdirSync: () => [], unlinkSync: () => {}, statSync: () => ({ isDirectory: () => false }) };
    if (m === 'nw.gui' || m === 'nw') return { Window: { get: () => ({ on() {}, maximize() {}, restore() {}, removeAllListeners() {}, close() {} }) }, App: { quit() {}, argv: [], manifest: {} }, Screen: { Init() {}, on() {} }, Shell: { openExternal: url => window.open(url, '_blank') } };
    return {};
  };
  window.process = { platform: 'browser', env: {}, mainModule: { filename: '' } };
  window.nw = window.require('nw');

  // =========================
  // 2) MODERN VIEWPORT
  // =========================
  (function setupModernViewport() {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; document.head.appendChild(meta); }
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

    const style = document.createElement('style');
    style.textContent = `
      html, body { margin:0!important; padding:0!important; width:100vw!important; height:100dvh!important; background:#000!important; overflow:hidden!important; touch-action:none!important; overscroll-behavior: none; -webkit-text-size-adjust: none; }
      #GameCanvas, canvas { display:block!important; position:absolute!important; top:50%!important; left:50%!important; transform-origin:center center!important; margin:0!important; padding:0!important; image-rendering:pixelated; will-change: transform; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
    `;
    document.head.appendChild(style);

    let isStretched = false; let targetCanvas = null;
    window.__toggleRpgStretch = () => { isStretched = !isStretched; forceScaleUpdate(); };

    const resizeObserver = new ResizeObserver(() => { if (targetCanvas) requestAnimationFrame(applyScale); });

    function applyScale() {
      if (!targetCanvas || !targetCanvas.width) return;
      targetCanvas.style.setProperty('width', targetCanvas.width + 'px', 'important'); targetCanvas.style.setProperty('height', targetCanvas.height + 'px', 'important');
      let scaleX = window.innerWidth / targetCanvas.width; let scaleY = window.innerHeight / targetCanvas.height;
      if (!isStretched) { const scale = Math.min(scaleX, scaleY); scaleX = scaleY = scale; }
      targetCanvas.style.setProperty('transform', `translate(-50%, -50%) scale(${scaleX}, ${scaleY})`, 'important');
    }
    function forceScaleUpdate() { if (targetCanvas) requestAnimationFrame(applyScale); }

    const domObserver = new MutationObserver((mutations, obs) => {
      const c = document.getElementById('GameCanvas') || document.querySelector('canvas');
      if (c) {
        targetCanvas = c; resizeObserver.observe(document.body); forceScaleUpdate();
        if (typeof Graphics !== 'undefined') {
          Graphics.pageToCanvasX = function (x) { if (!this._canvas) return 0; const rect = this._canvas.getBoundingClientRect(); return Math.round((x - rect.left) * (this._canvas.width / rect.width)); };
          Graphics.pageToCanvasY = function (y) { if (!this._canvas) return 0; const rect = this._canvas.getBoundingClientRect(); return Math.round((y - rect.top) * (this._canvas.height / rect.height)); };
        }
        obs.disconnect();
      }
    });
    domObserver.observe(document.body, { childList: true, subtree: true });

    const forceModeTimer = setInterval(() => {
      if (typeof Utils !== 'undefined') { Utils.isNwjs = () => false; Utils.isLocal = () => false; clearInterval(forceModeTimer); }
    }, 50);
    setTimeout(() => clearInterval(forceModeTimer), 10000);
  })();

  // =========================
  // 3) CLOUD SAVES
  // =========================
  window.addEventListener('load', () => {
    if (typeof StorageManager !== 'undefined') StorageManager.isLocalMode = () => false;
    if (typeof DataManager !== 'undefined') { if (!DataManager.setAutoSaveFileId) DataManager.setAutoSaveFileId = () => {}; if (!DataManager.autoSaveFileId) DataManager.autoSaveFileId = () => 1; }
  });

  (function setupCloudSaves() {
    function resolveGameId() { const parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent); return parts.length ? parts[0].replace(/[^a-zA-Z0-9._\-а-яА-Я]/g, '_') : 'unknown'; }
    const gameId = resolveGameId(); let pulledSaves = {}; let cloudReady = false; let cloudFetchFailed = false; const cloudInitStartedAt = Date.now();

    const syncDiv = document.createElement('div');
    syncDiv.id = '_cloud_sync_ui';
    syncDiv.style.cssText = 'display:none; position:fixed; top:15px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.85); color:#fff; padding:6px 20px; border-radius:20px; z-index:999999; font-size:13px; font-family:sans-serif; font-weight:bold; border:1px solid rgba(255,255,255,0.2); pointer-events:none; box-shadow:0 4px 10px rgba(0,0,0,0.5); transition:background 0.3s;';
    document.body.appendChild(syncDiv);

    let syncCount = 0;
    function showSync(active, ok = true) {
      if (!syncDiv) return;
      if (active) { syncCount++; syncDiv.textContent = '☁️ Синхронизация...'; syncDiv.style.background = 'rgba(0,0,0,0.85)'; syncDiv.style.display = 'block'; } 
      else { syncCount--; if (syncCount <= 0) { syncCount = 0; syncDiv.textContent = ok ? '✅ Сохранено' : '⚠️ Ошибка сервера'; syncDiv.style.background = ok ? 'rgba(40,140,40,0.9)' : 'rgba(170,60,60,0.9)'; setTimeout(() => { if (syncCount === 0) syncDiv.style.display = 'none'; }, 1500); } }
    }

    async function retryFetch(url, init, retries = CLOUD_RETRY_MAX) {
      let lastErr;
      for (let i = 0; i <= retries; i++) { try { return await fetch(url, init); } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 250 * Math.pow(2, i))); } }
      throw lastErr;
    }

    function normalizeCloudPayload(raw) {
      const out = {}; if (!raw || typeof raw !== 'object') return out;
      for (const k of Object.keys(raw)) {
        const v = raw[k];
        out[k] = (v && typeof v === 'object' && 'value' in v) ? { value: String(v.value ?? ''), updatedAt: Number(v.updatedAt || 0) } : { value: String(v ?? ''), updatedAt: 0 };
      }
      return out;
    }

    function chooseNewer(a, b) { if (!a) return b; if (!b) return a; return (b.updatedAt || 0) >= (a.updatedAt || 0) ? b : a; }
    function getEntry(key) { return pulledSaves[key]; } function hasEntry(key) { return pulledSaves[key] !== undefined; }

    async function fetchCloudSaves() {
      try {
        const res = await retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}?_t=${Date.now()}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'x-api-token': API_TOKEN } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const normalized = normalizeCloudPayload(await res.json());
        for (const k of Object.keys(normalized)) pulledSaves[k] = chooseNewer(pulledSaves[k], normalized[k]);
        cloudReady = true; cloudFetchFailed = false;
        try { const sc = (typeof SceneManager !== 'undefined' && SceneManager._scene) ? SceneManager._scene : null; if (sc?.refresh) sc.refresh(); if (sc?._listWindow?.refresh) sc._listWindow.refresh(); } catch (_) {}
      } catch (e) { cloudFetchFailed = true; cloudReady = true; console.warn('[CloudSave] Fallback to local:', e); }
    }

    function uploadToCloud(key, value) {
      const payload = { value: String(value), updatedAt: Date.now() };
      pulledSaves[key] = chooseNewer(pulledSaves[key], payload);
      showSync(true);
      retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}/${encodeURIComponent(key)}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'x-api-token': API_TOKEN }, body: JSON.stringify(payload) }).then(r => showSync(false, r.ok)).catch(err => { showSync(false, false); });
    }

    function deleteFromCloud(key) {
      delete pulledSaves[key]; showSync(true);
      retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}/${encodeURIComponent(key)}`, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store', headers: { 'x-api-token': API_TOKEN } }).then(r => showSync(false, r.ok)).catch(err => { showSync(false, false); });
    }

    function canOptimisticallyShowExists(localExists) {
      if (cloudReady) return false;
      return ((Date.now() - cloudInitStartedAt) <= CLOUD_INIT_GRACE_MS) ? true : !!localExists;
    }

    function injectMZEngine() {
      const _saveToForage = StorageManager.saveToForage; StorageManager.saveToForage = function(saveName, zip) { uploadToCloud(`MZ_${saveName}`, zip); return _saveToForage.apply(this, arguments); };
      const _loadFromForage = StorageManager.loadFromForage; StorageManager.loadFromForage = function(saveName) { const key = `MZ_${saveName}`; if (cloudReady && hasEntry(key)) return Promise.resolve(getEntry(key).value); return _loadFromForage.apply(this, arguments); };
      const _removeForage = StorageManager.removeForage; StorageManager.removeForage = function(saveName) { deleteFromCloud(`MZ_${saveName}`); return _removeForage.apply(this, arguments); };
      const _forageExists = StorageManager.forageExists; StorageManager.forageExists = function(saveName) { const local = _forageExists.apply(this, arguments); if (!cloudReady) return canOptimisticallyShowExists(local); return hasEntry(`MZ_${saveName}`) || local; };
    }

    function injectMVEngine() {
      const _loadFromWebStorage = StorageManager.loadFromWebStorage; StorageManager.loadFromWebStorage = function(saveFileId) { const key = this.webStorageKey(saveFileId); if (cloudReady && hasEntry(key)) return getEntry(key).value; return _loadFromWebStorage.apply(this, arguments); };
      if (StorageManager.webStorageExists) { const _webStorageExists = StorageManager.webStorageExists; StorageManager.webStorageExists = function(saveFileId) { const local = _webStorageExists.apply(this, arguments); if (!cloudReady) return canOptimisticallyShowExists(local); return hasEntry(this.webStorageKey(saveFileId)) || local; }; }
      const _saveToWebStorage = StorageManager.saveToWebStorage; StorageManager.saveToWebStorage = function(saveFileId, json) { uploadToCloud(this.webStorageKey(saveFileId), json); return _saveToWebStorage.apply(this, arguments); };
      const _removeWebStorage = StorageManager.removeWebStorage; StorageManager.removeWebStorage = function(saveFileId) { deleteFromCloud(this.webStorageKey(saveFileId)); return _removeWebStorage.apply(this, arguments); };
    }

    fetchCloudSaves();
    const hookTimer = setInterval(() => {
      if (typeof StorageManager === 'undefined') return;
      if (StorageManager.saveToForage) { clearInterval(hookTimer); injectMZEngine(); } else if (StorageManager.saveToWebStorage) { clearInterval(hookTimer); injectMVEngine(); }
    }, 100);
    setTimeout(() => clearInterval(hookTimer), 15000);
    window.addEventListener('pageshow', () => { if (cloudFetchFailed) fetchCloudSaves(); });
  })();

  // =========================
  // 4) AUDIO FIXES (Sync Unlock & OGG Enforcer)
  // =========================
  (function setupSecureAudio() {
    if (typeof AudioManager !== 'undefined' && !AudioManager.__PatchedCheck) {
      AudioManager.__PatchedCheck = true; const orig = AudioManager.checkErrors; AudioManager.checkErrors = function () { try { if (orig) orig.apply(this, arguments); } catch (e) { console.warn('[Audio]', e); } };
    }

    let unlocked = false;

    function syncUnlockAudio() {
      if (unlocked) return;
      const contexts = [];
      if (typeof WebAudio !== 'undefined' && WebAudio._context) contexts.push(WebAudio._context);
      if (!window.__globalIOSAudioContext) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) window.__globalIOSAudioContext = new AC();
      }
      if (window.__globalIOSAudioContext) contexts.push(window.__globalIOSAudioContext);

      let anyResumed = false;
      contexts.forEach(ctx => {
        if (ctx.state === 'suspended') ctx.resume();
        try {
          const buffer = ctx.createBuffer(1, 1, 22050);
          const source = ctx.createBufferSource();
          source.buffer = buffer; source.connect(ctx.destination); source.start(0);
          anyResumed = true;
        } catch (e) {}
      });

      if (anyResumed) {
        unlocked = true;
        ['pointerdown', 'touchstart', 'touchend', 'click'].forEach(e => document.removeEventListener(e, syncUnlockAudio, true));
      }
    }

    ['pointerdown', 'touchstart', 'touchend', 'click'].forEach(e => document.addEventListener(e, syncUnlockAudio, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { unlocked = false; syncUnlockAudio(); } });
  })();

  // =========================
  // 5) VIRTUAL GAMEPAD (Classic D-Pad + Key Spammer)
  // =========================
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('_mob_ctrl')) return;
    const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (!isMobile) return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const style = document.createElement('style');
    style.textContent = `
      #_fs_btn, #_stretch_btn { position:fixed; top:12px; z-index:9999; width:40px; height:40px; background:rgba(0,0,0,0.6); border:1px solid rgba(255,255,255,0.25); border-radius:8px; display:flex; align-items:center; justify-content:center; touch-action:none; -webkit-touch-callout:none; -webkit-user-select:none; }
      #_fs_btn { right:12px; } #_stretch_btn { right:${isIOS ? '12px' : '60px'}; }
      #_fs_btn svg, #_stretch_btn svg { width:22px; fill:#fff; pointer-events:none; }
      #_mob_ctrl { position:fixed; bottom:0; left:0; right:0; z-index:9998; pointer-events:none; padding:16px; height:220px; touch-action:none; -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; }
      #_dpad { position:absolute; bottom:20px; left:20px; width:190px; height:190px; pointer-events:auto; touch-action:none; }
      ._dpad_btn { position:absolute; width:58px; height:58px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.3); border-radius:10px; display:flex; align-items:center; justify-content:center; }
      ._dpad_btn._on { background:rgba(255,255,255,0.6); }
      ._dpad_btn svg { width:24px; fill:rgba(255,255,255,0.95); pointer-events:none; }
      #_d_up { top:0; left:66px; } #_d_down { bottom:0; left:66px; } #_d_left { top:66px; left:0; } #_d_right { top:66px; right:0; }
      #_act_btns { position:absolute; bottom:20px; right:20px; display:grid; grid-template-columns:1fr 1fr; gap:12px; pointer-events:auto; touch-action:none; }
      ._act_btn { width:70px; height:70px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; color:#fff; border:1.5px solid rgba(255,255,255,0.3); }
      ._act_btn._on { filter:brightness(1.5); }
      #_a_ok { background:rgba(40,160,40,0.6); } #_a_esc { background:rgba(200,40,40,0.6); }
      #_a_menu { background:rgba(40,100,200,0.6); } #_a_shift { background:rgba(180,140,20,0.6); }
    `;
    document.head.appendChild(style);

    const fsBtn = isIOS ? '' : '<div id="_fs_btn" title="Fullscreen"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></div>';
    const ui = document.createElement('div');
    ui.innerHTML = fsBtn +
      '<div id="_stretch_btn" title="Stretch Screen"><svg viewBox="0 0 24 24"><path d="M10 21v-2H6.41l4.5-4.5-1.41-1.41-4.5 4.5V14H3v7h7zm11-7h-2v3.59l-4.5-4.5-1.41 1.41 4.5 4.5H14v2h7v-7zM3 3v7h2V6.41l4.5 4.5 1.41-1.41-4.5-4.5H10V3H3zm11 0v2h3.59l-4.5 4.5 1.41 1.41 4.5-4.5V10h2V3h-7z"/></svg></div>' +
      '<div id="_mob_ctrl"><div id="_dpad"><div class="_dpad_btn" id="_d_up"><svg viewBox="0 0 24 24"><path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/></svg></div><div class="_dpad_btn" id="_d_down"><svg viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg></div><div class="_dpad_btn" id="_d_left"><svg viewBox="0 0 24 24"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/></svg></div><div class="_dpad_btn" id="_d_right"><svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg></div></div>' +
      '<div id="_act_btns"><div class="_act_btn" id="_a_shift">SHIFT</div><div class="_act_btn" id="_a_ok">OK</div><div class="_act_btn" id="_a_menu">MENU</div><div class="_act_btn" id="_a_esc">ESC</div></div></div>';
    document.body.appendChild(ui);

    document.addEventListener('contextmenu', e => { if (e.target.closest('#_mob_ctrl') || e.target.closest('#_fs_btn') || e.target.closest('#_stretch_btn')) e.preventDefault(); });
    document.getElementById('_mob_ctrl').addEventListener('pointerdown', e => e.stopPropagation(), { passive: false });
    document.getElementById('_stretch_btn')?.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); window.__toggleRpgStretch(); }, { passive: false });
    
    if (!isIOS) {
      document.getElementById('_fs_btn')?.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); const el = document.documentElement;
        (!document.fullscreenElement) ? (el.requestFullscreen || el.webkitRequestFullscreen).call(el).catch(()=>{}) : (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      }, { passive: false });
    }

    const keyMap = {
      _d_up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }, _d_down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
      _d_left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }, _d_right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      _a_ok: { key: 'Enter', code: 'Enter', keyCode: 13 }, _a_esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
      _a_menu: { key: 'x', code: 'KeyX', keyCode: 88 }, _a_shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 }
    };

    function fireKey(type, m) {
      const ev = new KeyboardEvent(type, { key: m.key, code: m.code, bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'keyCode', { get: () => m.keyCode }); Object.defineProperty(ev, 'which', { get: () => m.keyCode });
      document.dispatchEvent(ev);
    }

    // ⚡ ЭМУЛЯТОР ЗАЖАТИЯ (Auto-Repeat / Key Spammer)
    const keyIntervals = {};
    function holdKeyStart(id) {
      if (keyIntervals[id]) return;
      fireKey('keydown', keyMap[id]);
      keyIntervals[id] = setInterval(() => fireKey('keydown', keyMap[id]), 40); // 25 нажатий в секунду
    }
    function holdKeyStop(id) {
      if (keyIntervals[id]) { clearInterval(keyIntervals[id]); delete keyIntervals[id]; }
      fireKey('keyup', keyMap[id]);
    }

    // Привязываем логику ко ВСЕМ кнопкам сразу (и крестовина, и действия)
    const allButtons = ['_a_ok', '_a_esc', '_a_menu', '_a_shift', '_d_up', '_d_down', '_d_left', '_d_right'];
    allButtons.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;

      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation(); el.classList.add('_on');
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        holdKeyStart(id);
      });

      const onUp = (e) => {
        e.preventDefault(); e.stopPropagation(); el.classList.remove('_on');
        try { if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); } catch (_) {}
        holdKeyStop(id);
      };

      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  });

  // =========================
  // 6) TICKER OPTIMIZATIONS
  // =========================
  (function runtimeOptimizations() {
    const t = setInterval(() => {
      if (typeof PIXI === 'undefined') return;
      if (PIXI.Ticker?.shared) PIXI.Ticker.shared.maxFPS = 60;
      if (typeof Graphics !== 'undefined' && Graphics.app?.ticker) Graphics.app.ticker.maxFPS = 60;
      if (typeof Bitmap !== 'undefined' && Bitmap.prototype?.drawText && !Bitmap.prototype.__PatchedAlign) {
        Bitmap.prototype.__PatchedAlign = true; const orig = Bitmap.prototype.drawText;
        Bitmap.prototype.drawText = function(text, x, y, maxWidth, lineHeight, align) { return orig.call(this, text, x, y, maxWidth, lineHeight, align || 'left'); };
      }
      clearInterval(t);
    }, 400);
    setTimeout(() => clearInterval(t), 10000);
  })();
})();