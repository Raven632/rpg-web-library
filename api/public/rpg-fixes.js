/**
 * rpg-fixes.js — Ultimate Enterprise Edition v3.4
 * [NEW] Unified System Menu (FAB)
 * [NEW] Return to Library Button
 * [NEW] Turbo Mode (3x Speedhack) Integration
 */
(() => {
  if (window.__RPG_FIXES_ULTIMATE_V34__) return;
  window.__RPG_FIXES_ULTIMATE_V34__ = true;

  // =========================
  // 0) DEVICE PIXEL RATIO FIX
  // =========================
  (function fixDevicePixelRatio() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!isIOS) return;

    const TARGET = 1; // 1 = нативные пиксели, без 3x апскейла

    // Шаг 1: Перехватываем DPR до загрузки PIXI
    try {
      Object.defineProperty(window, 'devicePixelRatio', {
        get: () => TARGET,
        configurable: true
      });
    } catch(e) {}

    // Шаг 2: PIXI.settings — страховка если PIXI уже загрузился раньше нас
    const pixi_t = setInterval(() => {
      if (typeof PIXI === 'undefined') return;
      clearInterval(pixi_t);
      try { PIXI.settings.RESOLUTION = TARGET; } catch(e) {}

      // Шаг 3: Патчим уже запущенный рендерер (MV: Graphics._renderer, MZ: Graphics._app.renderer)
      const gfx_t = setInterval(() => {
        if (typeof Graphics === 'undefined') return;
        // MZ
        const rMZ = Graphics._app && Graphics._app.renderer;
        // MV
        const rMV = Graphics._renderer;
        const r = rMZ || rMV;
        if (!r) return;
        clearInterval(gfx_t);
        if (r.resolution === TARGET) return; // уже правильно
        const logW = r.width  / r.resolution;
        const logH = r.height / r.resolution;
        r.resolution = TARGET;
        try { r.resize(logW, logH); } catch(e) {}
        // MZ: обновляем interaction plugin
        try { if (r.plugins && r.plugins.interaction) r.plugins.interaction.resolution = TARGET; } catch(e) {}
        console.log('[DPR Fix] Renderer resolution -> 1x, canvas:', r.width, 'x', r.height);
      }, 100);
      setTimeout(() => clearInterval(gfx_t), 15000);
    }, 50);
    setTimeout(() => clearInterval(pixi_t), 15000);
  })();

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
  // 2) MODERN VIEWPORT & AUTO-SCALE FIX
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
      targetCanvas.style.setProperty('width', targetCanvas.width + 'px', 'important');
      targetCanvas.style.setProperty('height', targetCanvas.height + 'px', 'important');
      let scaleX = window.innerWidth / targetCanvas.width;
      let scaleY = window.innerHeight / targetCanvas.height;
      if (!isStretched) { const scale = Math.min(scaleX, scaleY); scaleX = scaleY = scale; }
      targetCanvas.style.setProperty('transform', `translate(-50%, -50%) scale(${scaleX}, ${scaleY})`, 'important');
    }
    function forceScaleUpdate() { if (targetCanvas) requestAnimationFrame(applyScale); }

    const domObserver = new MutationObserver((mutations, obs) => {
      const c = document.getElementById('GameCanvas') || document.querySelector('canvas');
      if (c) {
        targetCanvas = c;
        resizeObserver.observe(document.body);
        window.addEventListener('resize', forceScaleUpdate);

        // ⚡ НОВОЕ: Следим за попытками игры изменить размер холста
        const canvasObserver = new MutationObserver(() => forceScaleUpdate());
        canvasObserver.observe(targetCanvas, { attributes: true, attributeFilter: ['width', 'height'] });

        // Перехватываем внутренние координаты для тапов и отключаем конфликты
        const hookTimer = setInterval(() => {
            if (typeof Graphics !== 'undefined') {
                Graphics.pageToCanvasX = function (x) { if (!this._canvas) return 0; const rect = this._canvas.getBoundingClientRect(); return Math.round((x - rect.left) * (this._canvas.width / rect.width)); };
                Graphics.pageToCanvasY = function (y) { if (!this._canvas) return 0; const rect = this._canvas.getBoundingClientRect(); return Math.round((y - rect.top) * (this._canvas.height / rect.height)); };
                
                // ⚡ Убиваем родную центровку движка, чтобы не сбивала наш CSS
                if (Graphics._centerElement) Graphics._centerElement = function() {};
                clearInterval(hookTimer);
            }
        }, 100);
        setTimeout(() => clearInterval(hookTimer), 5000);

        // Принудительно центрируем при старте несколько раз, пока грузятся тяжелые плагины
        let bootTicks = 0;
        const bootTimer = setInterval(() => {
            forceScaleUpdate();
            if (++bootTicks > 20) clearInterval(bootTimer); // Работает первые 2 секунды
        }, 100);

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
  // 3) CLOUD SAVES (v2)
  // =========================
  window.addEventListener('load', () => {
    if (typeof StorageManager !== 'undefined') StorageManager.isLocalMode = () => false;
    if (typeof DataManager !== 'undefined') { if (!DataManager.setAutoSaveFileId) DataManager.setAutoSaveFileId = () => {}; if (!DataManager.autoSaveFileId) DataManager.autoSaveFileId = () => 1; }
  });

  (function setupCloudSaves() {
    function resolveGameId() { const parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent); return parts.length ? parts[0].replace(/[^a-zA-Z0-9._\-а-яА-Я]/g, '_') : 'unknown'; }
    const gameId = resolveGameId(); 
    let pulledSaves = {}; 
    let cloudReady = false; 
    let cloudFetchFailed = false; 
    const cloudInitStartedAt = Date.now();

    // ⚡ OFFLINE QUEUE: Буфер для сохранений без интернета
    const QUEUE_KEY = `_rpg_offline_queue_${gameId}`;
    function getQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}'); } catch(e) { return {}; } }
    function saveQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

    const syncDiv = document.createElement('div');
    syncDiv.id = '_cloud_sync_ui';
    syncDiv.style.cssText = 'display:none; position:fixed; top:15px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.85); color:#fff; padding:6px 20px; border-radius:20px; z-index:999999; font-size:13px; font-family:sans-serif; font-weight:bold; border:1px solid rgba(255,255,255,0.2); pointer-events:none; box-shadow:0 4px 10px rgba(0,0,0,0.5); transition:background 0.3s;';
    document.body.appendChild(syncDiv);

    let syncCount = 0;
    function showSync(active, status = 'ok') {
      if (!syncDiv) return;
      if (active) { 
          syncCount++; syncDiv.textContent = '☁️ Синхронизация...'; syncDiv.style.background = 'rgba(0,0,0,0.85)'; syncDiv.style.display = 'block'; 
      } else { 
          syncCount--; 
          if (syncCount <= 0) { 
              syncCount = 0; 
              if (status === 'ok') { syncDiv.textContent = '✅ Сохранено'; syncDiv.style.background = 'rgba(40,140,40,0.9)'; }
              else if (status === 'offline') { syncDiv.textContent = '📡 Ждем сеть (сохранено локально)'; syncDiv.style.background = 'rgba(200,140,20,0.9)'; }
              else { syncDiv.textContent = '⚠️ Ошибка сервера'; syncDiv.style.background = 'rgba(170,60,60,0.9)'; }
              setTimeout(() => { if (syncCount === 0) syncDiv.style.display = 'none'; }, 2000); 
          } 
      }
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

    // ⚡ ФОНОВАЯ СИНХРОНИЗАЦИЯ ОЧЕРЕДИ
    async function processOfflineQueue() {
      if (!navigator.onLine) return;
      const q = getQueue();
      const keys = Object.keys(q);
      if (keys.length === 0) return;

      console.log(`[CloudSave] 🚀 Сеть найдена! Выгружаем ${keys.length} сохранений из очереди...`);
      showSync(true);
      let allOk = true;

      for (const key of keys) {
        try {
          const payload = q[key];
          const res = await retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}/${encodeURIComponent(key)}`, { 
              method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'x-api-token': API_TOKEN }, body: JSON.stringify(payload) 
          });
          if (res.ok) delete q[key]; 
          else allOk = false;
        } catch(e) { allOk = false; }
      }
      saveQueue(q);
      showSync(false, allOk ? 'ok' : 'error');
    }

    window.addEventListener('online', processOfflineQueue);

    async function fetchCloudSaves() {
      try {
        const res = await retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}?_t=${Date.now()}`, { 
            method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'x-api-token': API_TOKEN } 
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        
        const cloudData = normalizeCloudPayload(await res.json());
        const localQueue = getQueue();
        
        for (const k of Object.keys(cloudData)) pulledSaves[k] = chooseNewer(pulledSaves[k], cloudData[k]);
        for (const k of Object.keys(localQueue)) pulledSaves[k] = chooseNewer(pulledSaves[k], localQueue[k]);

        cloudReady = true; cloudFetchFailed = false;
        try { const sc = (typeof SceneManager !== 'undefined' && SceneManager._scene) ? SceneManager._scene : null; if (sc?.refresh) sc.refresh(); if (sc?._listWindow?.refresh) sc._listWindow.refresh(); } catch (_) {}
        
        processOfflineQueue();
      } catch (e) { 
          cloudFetchFailed = true; cloudReady = true; 
          console.warn('[CloudSave] Fallback to local:', e); 
          const localQueue = getQueue();
          for (const k of Object.keys(localQueue)) pulledSaves[k] = chooseNewer(pulledSaves[k], localQueue[k]);
      }
    }

    function uploadToCloud(key, value) {
      const payload = { value: String(value), updatedAt: Date.now() };
      pulledSaves[key] = chooseNewer(pulledSaves[key], payload); 

      const q = getQueue();
      q[key] = payload;
      saveQueue(q);

      showSync(true);
      if (!navigator.onLine) {
          showSync(false, 'offline');
          return;
      }

      retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}/${encodeURIComponent(key)}`, { 
          method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'x-api-token': API_TOKEN }, body: JSON.stringify(payload) 
      }).then(r => {
          if (r.ok) {
              const qNew = getQueue(); delete qNew[key]; saveQueue(qNew);
              showSync(false, 'ok');
          } else showSync(false, 'error');
      }).catch(err => { 
          showSync(false, 'offline'); 
      });
    }

    function deleteFromCloud(key) {
      delete pulledSaves[key]; 
      const q = getQueue(); delete q[key]; saveQueue(q);
      
      showSync(true);
      if (!navigator.onLine) { showSync(false, 'offline'); return; }

      retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}/${encodeURIComponent(key)}`, { 
          method: 'DELETE', credentials: 'same-origin', cache: 'no-store', headers: { 'x-api-token': API_TOKEN } 
      }).then(r => showSync(false, r.ok ? 'ok' : 'error')).catch(err => showSync(false, 'offline'));
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
  // 4) AUDIO FIXES (UNIVERSAL & GAPLESS)
  // =========================
  (function setupSecureAudio() {
    if (typeof AudioManager !== 'undefined' && !AudioManager.__PatchedCheck) {
      AudioManager.__PatchedCheck = true; const orig = AudioManager.checkErrors; AudioManager.checkErrors = function () { try { if (orig) orig.apply(this, arguments); } catch (e) {} };
    }
    if (typeof WebAudio !== 'undefined' && WebAudio.prototype && !WebAudio.prototype.__PatchedErr) {
      WebAudio.prototype.__PatchedErr = true; const origErr = WebAudio.prototype._onError; WebAudio.prototype._onError = function () { if (origErr) return origErr.apply(this, arguments); };
    }

    const audioInitTimer = setInterval(() => {
        if (typeof AudioManager !== 'undefined') {
            AudioManager.shouldUseHtml5Audio = function() { return false; };
            if (AudioManager._audioBuffers) AudioManager._audioBuffers = []; 
            clearInterval(audioInitTimer);
        }
    }, 100);
    setTimeout(() => clearInterval(audioInitTimer), 5000);

    let unlocked = false;
    function syncUnlockAudio() {
      if (unlocked) return;
      const contexts = [];
      
      // ИСПРАВЛЕНО: Защита от создания лишних AudioContext на iOS
      if (typeof WebAudio !== 'undefined' && WebAudio._context) {
          contexts.push(WebAudio._context);
      } else {
          if (!window.__globalIOSAudioContext) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (AC) window.__globalIOSAudioContext = new AC();
          }
          if (window.__globalIOSAudioContext) contexts.push(window.__globalIOSAudioContext);
      }

      let anyResumed = false;
      contexts.forEach(ctx => {
        if (ctx && ctx.state === 'suspended') {
            try { ctx.resume(); } catch (e) {}
        }
        try {
          const buffer = ctx.createBuffer(1, 1, 22050);
          const source = ctx.createBufferSource();
          source.buffer = buffer; source.connect(ctx.destination); source.start(0);
          anyResumed = true;
        } catch (e) {}
      });

      if (anyResumed) {
        unlocked = true;
        // ИСПРАВЛЕНО: Заменено document на window
        ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'].forEach(e => window.removeEventListener(e, syncUnlockAudio, true));
        console.log('[Audio Engine] 🎵 Universal WebAudio API аппаратно разблокирован!');
      }
    }
    
    // ИСПРАВЛЕНО: Заменено document на window для обхода Touch Mode
    ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'].forEach(e => window.addEventListener(e, syncUnlockAudio, { passive: true, capture: true }));
    
    document.addEventListener('visibilitychange', () => { 
        if (!document.hidden) { 
            unlocked = false; 
            syncUnlockAudio(); 
            if (typeof WebAudio !== 'undefined' && WebAudio._context && WebAudio._context.state === 'suspended') {
                try { WebAudio._context.resume(); } catch(e) {}
            }
        } 
    });
  })();

  // =========================
  // 5) VIRTUAL GAMEPAD & SYSTEM MENU
  // =========================
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('_sys_menu_container')) return;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    // ⚡ Стили для Системного Меню и Геймпада
    const style = document.createElement('style');
    style.textContent = `
      #_sys_menu_container { position: fixed; top: max(16px, env(safe-area-inset-top));  right: max(16px, env(safe-area-inset-right)); z-index: 9999; display: flex; flex-direction: column; align-items: flex-end; touch-action: none; -webkit-touch-callout: none; -webkit-user-select: none; }
      #_sys_btn { width: 44px; height: 44px; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.25); border-radius: 50%; display: flex; justify-content: center; align-items: center; font-size: 24px; color: white; cursor: pointer; transition: background 0.2s; }
      #_sys_btn:active { background: rgba(255,255,255,0.2); }
      #_sys_panel { display: none; background: rgba(0,0,0,0.85); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; margin-top: 8px; padding: 6px; flex-direction: column; gap: 4px; box-shadow: 0 8px 16px rgba(0,0,0,0.5); backdrop-filter: blur(4px); }
      #_sys_panel._open { display: flex; }
      ._sys_item { padding: 12px 16px; color: #fff; font-family: sans-serif; font-size: 14px; font-weight: 600; background: rgba(255,255,255,0.05); border-radius: 8px; white-space: nowrap; transition: background 0.2s; display: flex; align-items: center; gap: 8px; }
      ._sys_item:active { background: rgba(255,255,255,0.2); }
      ._sys_item._active { background: rgba(200, 150, 40, 0.4); border: 1px solid rgba(200, 150, 40, 0.8); }

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
      
      @media (pointer: fine) { #_mob_ctrl { display: none; } }
    `;
    document.head.appendChild(style);

    // ⚡ Генерируем единое системное меню
    const sysMenuHtml = `
      <div id="_sys_menu_container">
        <div id="_sys_btn">⚙️</div>
        <div id="_sys_panel">
          <div class="_sys_item" id="_sys_home">🏠 В библиотеку</div>
          <div class="_sys_item" id="_sys_stretch">📺 Растянуть экран</div>
          <div class="_sys_item" id="_sys_turbo">⏩ Турбо-режим (3x)</div>
          ${isIOS ? '' : '<div class="_sys_item" id="_sys_fs">⛶ На весь экран</div>'}
        </div>
      </div>
    `;

    const mobCtrlHtml = `
      <div id="_mob_ctrl">
        <div id="_dpad">
          <div class="_dpad_btn" id="_d_up"><svg viewBox="0 0 24 24"><path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/></svg></div>
          <div class="_dpad_btn" id="_d_down"><svg viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg></div>
          <div class="_dpad_btn" id="_d_left"><svg viewBox="0 0 24 24"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/></svg></div>
          <div class="_dpad_btn" id="_d_right"><svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg></div>
        </div>
        <div id="_act_btns">
          <div class="_act_btn" id="_a_shift">SHIFT</div><div class="_act_btn" id="_a_ok">OK</div>
          <div class="_act_btn" id="_a_menu">MENU</div><div class="_act_btn" id="_a_esc">ESC</div>
        </div>
      </div>
    `;

    const ui = document.createElement('div');
    ui.innerHTML = sysMenuHtml + mobCtrlHtml;
    document.body.appendChild(ui);

    // Логика Системного Меню
    const sysBtn = document.getElementById('_sys_btn');
    const sysPanel = document.getElementById('_sys_panel');

    sysBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); sysPanel.classList.toggle('_open'); }, { passive: false });
    
    // Возврат в библиотеку
    document.getElementById('_sys_home').addEventListener('pointerdown', (e) => { 
      e.preventDefault(); e.stopPropagation(); 
      window.location.href = '/'; 
    }, { passive: false });

    // Растягивание экрана
    document.getElementById('_sys_stretch').addEventListener('pointerdown', (e) => { 
      e.preventDefault(); e.stopPropagation(); 
      window.__toggleRpgStretch(); 
      sysPanel.classList.remove('_open'); 
    }, { passive: false });

    // Фулскрин (для ПК/Android)
    if (!isIOS) {
      document.getElementById('_sys_fs')?.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        sysPanel.classList.remove('_open');
        const el = document.documentElement;
        (!document.fullscreenElement) ? (el.requestFullscreen || el.webkitRequestFullscreen).call(el).catch(()=>{}) : (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      }, { passive: false });
    }

    // ⚡ ТУРБО РЕЖИМ (Спидхак)
    window.__rpgTurbo = false;
    document.getElementById('_sys_turbo').addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      window.__rpgTurbo = !window.__rpgTurbo;
      e.currentTarget.classList.toggle('_active', window.__rpgTurbo);
      sysPanel.classList.remove('_open');

      if (!window.__turboHookInjected) {
        window.__turboHookInjected = true;
        const turboHook = setInterval(() => {
          if (typeof SceneManager !== 'undefined' && SceneManager.updateMain && !SceneManager.__turboPatched) {
            SceneManager.__turboPatched = true;
            const origUpdate = SceneManager.updateMain;
            SceneManager.updateMain = function() {
              origUpdate.call(this);
              if (window.__rpgTurbo) {
                for (let i = 0; i < 2; i++) { // Ускоряем в 3 раза
                  if (this.updateInputData) this.updateInputData();
                  if (this.updateManagers) this.updateManagers();
                  if (this.updateScene) this.updateScene();
                }
              }
            };
            clearInterval(turboHook);
          }
        }, 500);
      }
    }, { passive: false });

    // Закрытие меню при клике мимо него
    document.addEventListener('pointerdown', (e) => {
      if (!sysPanel.contains(e.target) && e.target !== sysBtn) {
        sysPanel.classList.remove('_open');
      }
    });

    // Запрет выделения текста на кнопках
    document.addEventListener('contextmenu', e => {
      if (e.target.closest('#_mob_ctrl') || e.target.closest('#_sys_menu_container')) e.preventDefault();
    });
    document.getElementById('_mob_ctrl').addEventListener('pointerdown', e => e.stopPropagation(), { passive: false });

    // Прямая связка с внутренним API RPG Maker (без фейковых событий и setInterval!)
    const rpgKeyMap = {
      _d_up: 'up', _d_down: 'down', _d_left: 'left', _d_right: 'right',
      _a_ok: 'ok', _a_esc: 'escape', _a_menu: 'control', _a_shift: 'shift'
    };

    const allButtons = Object.keys(rpgKeyMap);
    allButtons.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;

      const press = (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.add('_on');
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        
        // Моментальная запись в память движка! 0 спайков процессора.
        if (typeof Input !== 'undefined') {
            Input._currentState[rpgKeyMap[id]] = true;
        }
      };

      const release = (e) => {
        e.preventDefault(); e.stopPropagation();
        el.classList.remove('_on');
        try { if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); } catch (_) {}
        
        if (typeof Input !== 'undefined') {
            Input._currentState[rpgKeyMap[id]] = false;
        }
      };

      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
    });
  }); // Конец обработчика DOMContentLoaded 5-го блока


  // =========================
  // 5) FPS MONITOR (DEV OVERLAY)
  // =========================
  (function setupFpsMonitor() {
    // Показывать только если в URL есть ?fps или ?dev
    const showByDefault = location.search.includes('fps') || location.search.includes('dev');

    window.__fpsMonitorVisible = showByDefault;
    window.__toggleFpsMonitor = function() {
      window.__fpsMonitorVisible = !window.__fpsMonitorVisible;
      monitor.style.display = window.__fpsMonitorVisible ? 'block' : 'none';
    };

    // Создаём оверлей
    const monitor = document.createElement('div');
    monitor.id = '_fps_monitor';
    monitor.style.cssText = `
      display: ${showByDefault ? 'block' : 'none'};
      position: fixed;
      top: max(64px, env(safe-area-inset-top) + 48px);
      right: max(16px, env(safe-area-inset-right));
      z-index: 9998;
      background: rgba(0,0,0,0.75);
      color: #0f0;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.5;
      padding: 8px 10px;
      border-radius: 8px;
      min-width: 130px;
      pointer-events: none;
      border: 1px solid rgba(255,255,255,0.1);
      backdrop-filter: blur(4px);
    `;
    document.body.appendChild(monitor);

    // Добавляем кнопку в системное меню — ждём пока оно появится
    const menuTimer = setInterval(() => {
      const panel = document.getElementById('_sys_panel');
      if (!panel) return;
      clearInterval(menuTimer);
      const btn = document.createElement('div');
      btn.className = '_sys_item';
      btn.id = '_sys_fpsmon';
      btn.textContent = '📊 FPS Монитор';
      panel.appendChild(btn);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        window.__toggleFpsMonitor();
        btn.classList.toggle('_active', window.__fpsMonitorVisible);
        document.getElementById('_sys_panel').classList.remove('_open');
      }, { passive: false });
    }, 300);

    // Данные для графика
    const HISTORY = 60; // 60 точек = ~1 секунда истории
    const fpsHistory = new Array(HISTORY).fill(60);
    let frameTimes = [];
    let lastFrame = performance.now();
    let frameCount = 0;
    let lastFpsUpdate = performance.now();
    let currentFps = 60;
    let minFps = 60;
    let maxFps = 60;
    let avgFps = 60;
    let lagSpikes = 0; // кадры дольше 50ms

    // Мини-график (ASCII sparkline)
    function sparkline(data) {
      const bars = ['▁','▂','▃','▄','▅','▆','▇','█'];
      const min = Math.min(...data);
      const max = Math.max(...data) || 1;
      return data.slice(-20).map(v => {
        const idx = Math.round(((v - min) / (max - min)) * (bars.length - 1));
        return bars[Math.max(0, Math.min(idx, bars.length - 1))];
      }).join('');
    }

    function getColor(fps) {
      if (fps >= 55) return '#0f0';       // зелёный — норм
      if (fps >= 40) return '#ff0';       // жёлтый — подтупливает
      if (fps >= 25) return '#f80';       // оранжевый — лагает
      return '#f00';                       // красный — всё плохо
    }

    function tick() {
      const now = performance.now();
      const frameTime = now - lastFrame;
      lastFrame = now;

      frameCount++;
      frameTimes.push(frameTime);
      if (frameTimes.length > HISTORY) frameTimes.shift();

      // Считаем спайки (кадр > 50ms = подвис на 1+ кадр)
      if (frameTime > 50) lagSpikes++;

      // Обновляем FPS каждые 500ms
      if (now - lastFpsUpdate >= 500) {
        const elapsed = (now - lastFpsUpdate) / 1000;
        currentFps = Math.round(frameCount / elapsed);
        frameCount = 0;
        lastFpsUpdate = now;

        fpsHistory.push(currentFps);
        if (fpsHistory.length > HISTORY) fpsHistory.shift();

        minFps = Math.min(...fpsHistory);
        maxFps = Math.max(...fpsHistory);
        const sum = fpsHistory.reduce((a, b) => a + b, 0);
        avgFps = Math.round(sum / fpsHistory.length);

        // Среднее время кадра
        const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;

        if (window.__fpsMonitorVisible) {
          const color = getColor(currentFps);
          monitor.innerHTML = `
            <span style="color:${color};font-size:16px;font-weight:bold">${currentFps} FPS</span><br>
            <span style="color:#aaa">кадр: ${avgFrameTime.toFixed(1)}ms</span><br>
            <span style="color:#888">min:${minFps} avg:${avgFps} max:${maxFps}</span><br>
            <span style="color:#f44;font-size:10px">спайки: ${lagSpikes}</span><br>
            <span style="color:${color};letter-spacing:0;font-size:10px">${sparkline(fpsHistory)}</span>
          `;
        }
      }

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  })();

  // =========================
  // 6) SPIKE DIAGNOSTICS — Детектор причин лагов
  // =========================
  (function setupSpikeDiagnostics() {
    const SPIKE_THRESHOLD_MS = 40; // кадр дольше 40ms = спайк
    const MAX_LOG = 30;            // хранить последние 30 спайков

    const log = [];
    let lastFrameTime = performance.now();
    let sessionStart = performance.now();
    window.__spikeLog = log;

    // --- UI ---
    const panel = document.createElement('div');
    panel.id = '_spike_panel';
    panel.style.cssText = `
      display: none;
      position: fixed;
      bottom: 10px; left: 10px; right: 10px;
      max-height: 45vh;
      background: rgba(0,0,0,0.92);
      border: 1px solid rgba(255,100,0,0.4);
      border-radius: 10px;
      z-index: 9997;
      font-family: 'Courier New', monospace;
      font-size: 10px;
      color: #ddd;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      pointer-events: auto;
    `;
    panel.innerHTML = `
      <div style="position:sticky;top:0;background:rgba(0,0,0,0.95);padding:6px 10px;border-bottom:1px solid rgba(255,100,0,0.3);display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#f80;font-weight:bold">⚡ Spike Log</span>
        <span id="_spike_count" style="color:#f44">0 спайков</span>
        <button id="_spike_clear" style="background:rgba(255,80,0,0.3);border:1px solid rgba(255,80,0,0.5);border-radius:4px;color:#fff;padding:2px 8px;font-size:10px;">Очистить</button>
      </div>
      <div id="_spike_log_body" style="padding:6px 10px;"></div>
    `;
    document.body.appendChild(panel);
    window.__spikePanelEl = panel;

    document.getElementById('_spike_clear')?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      log.length = 0;
      document.getElementById('_spike_log_body').innerHTML = '<span style="color:#666">— Лог очищен —</span>';
      document.getElementById('_spike_count').textContent = '0 спайков';
    });

    // Кнопка в системном меню
    const menuTimer = setInterval(() => {
      const sysPanel = document.getElementById('_sys_panel');
      if (!sysPanel) return;
      clearInterval(menuTimer);
      const btn = document.createElement('div');
      btn.className = '_sys_item';
      btn.id = '_sys_spikes';
      btn.textContent = '🔍 Spike Log';
      sysPanel.appendChild(btn);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
        sysPanel.classList.remove('_open');
      }, { passive: false });
    }, 500);

    // --- Сбор данных о спайке ---
    function getGameState(frameMs) {
      const state = { ms: frameMs.toFixed(1), t: ((performance.now() - sessionStart) / 1000).toFixed(1) };
      try {
        const sm = window.SceneManager;
        if (!sm) return state;

        // Сцена
        state.scene = sm._scene?.constructor?.name || '?';

        // Карта
        if (window.$gameMap) {
          state.map = $gameMap._mapId || 0;
          // Все события на карте
          const events = $gameMap._events?.filter(Boolean) || [];
          state.events = events.length;
          // Активные параллельные события (самая частая причина спайков)
          state.parallelEvents = events.filter(e => e?._trigger === 4 && e?._interpreter?.isRunning?.()).length;
          // Запущенные события
          state.runningEvents = events.filter(e => e?._interpreter?.isRunning?.()).length;
        }

        // Сообщение
        if (window.$gameMessage) {
          state.msg = $gameMessage.isBusy() ? 'ДА' : 'нет';
        }

        // Картинки
        if (window.$gameScreen) {
          const pics = $gameScreen._pictures?.filter(Boolean) || [];
          state.pics = pics.length;
        }

        // PIXI: кол-во текстур в VRAM (главная причина утечки памяти и спайков GC)
        if (window.PIXI?.utils?.TextureCache) {
          state.textures = Object.keys(PIXI.utils.TextureCache).length;
        }

        // FilterController — включён ли
        if (window.FilterController !== undefined) {
          state.fc = FilterController.enabledAll ? 'ON' : 'off';
        }

        // Спрайты на карте
        if (sm._scene?._spriteset?._characterSprites) {
          state.sprites = sm._scene._spriteset._characterSprites.length;
        }

      } catch(e) {}
      return state;
    }

    function formatEntry(s, idx) {
      const msColor = s.ms > 80 ? '#f44' : s.ms > 60 ? '#f80' : '#ff0';
      const parallelWarn = s.parallelEvents > 0
        ? `<span style="color:#f44"> ⚠️ parallel:${s.parallelEvents}</span>` : '';
      const fcWarn = s.fc === 'ON'
        ? `<span style="color:#f80"> FC:ON</span>` : '';
      const texWarn = s.textures > 200
        ? `<span style="color:#f44"> tex:${s.textures}⚠️</span>` : (s.textures ? ` tex:${s.textures}` : '');

      return `<div style="border-bottom:1px solid rgba(255,255,255,0.05);padding:3px 0">
        <span style="color:#666">#${idx+1} +${s.t}s</span>
        <span style="color:${msColor};font-weight:bold"> ${s.ms}ms</span>
        <span style="color:#aaa"> ${s.scene || '?'}</span>
        ${s.map !== undefined ? `<span style="color:#888"> map:${s.map}</span>` : ''}
        ${s.events !== undefined ? ` ev:${s.events}` : ''}
        ${s.runningEvents ? `<span style="color:#ffa"> run:${s.runningEvents}</span>` : ''}
        ${parallelWarn}
        ${s.pics !== undefined ? ` pic:${s.pics}` : ''}
        ${texWarn}
        ${s.msg !== undefined ? ` msg:${s.msg}` : ''}
        ${fcWarn}
      </div>`;
    }

    function addSpike(state) {
      log.unshift(state); // новые сверху
      if (log.length > MAX_LOG) log.pop();

      // Обновляем UI если панель видна
      if (panel.style.display !== 'none') {
        renderLog();
      }
      const countEl = document.getElementById('_spike_count');
      if (countEl) countEl.textContent = `${log.length} спайков`;
    }

    function renderLog() {
      const body = document.getElementById('_spike_log_body');
      if (!body) return;
      if (log.length === 0) {
        body.innerHTML = '<span style="color:#0f0">— Спайков нет, всё гладко —</span>';
        return;
      }
      body.innerHTML = log.map((s, i) => formatEntry(s, i)).join('');
    }

    // --- Главный цикл детектора (отдельный RAF, не зависит от игрового) ---
    function detectLoop() {
      const now = performance.now();
      const delta = now - lastFrameTime;
      lastFrameTime = now;

      if (delta > SPIKE_THRESHOLD_MS) {
        const state = getGameState(delta);
        addSpike(state);
      }

      requestAnimationFrame(detectLoop);
    }

    requestAnimationFrame(detectLoop);

    console.log('[Spike Diag] 🔍 Детектор спайков активен (порог: ' + SPIKE_THRESHOLD_MS + 'ms)');
  })();

  // =========================
  // 7) TOUCH MODE TOGGLE (ИСПРАВЛЕНО)
  // =========================
  //  OFF (default) — жестко перехватываем все тапы, работает только геймпад
  //  ON            — пропускаем тапы в ядро RPG Maker
  (function setupTouchMode() {
    window.__rpgTouchEnabled = false; // Выключен по умолчанию

    // Перехватчик на уровне ядра браузера (до того, как его увидит RPG Maker)
    const interceptor = (e) => {
      if (window.__rpgTouchEnabled) return; // Если включен - пропускаем в игру

      // Разрешаем клики по нашим интерфейсам (меню, геймпад, твои мониторы)
      if (e.target && e.target.closest && (
          e.target.closest('#_sys_menu_container') || 
          e.target.closest('#_mob_ctrl') || 
          e.target.closest('#_fps_monitor') || 
          e.target.closest('#_spike_panel')
      )) {
          return;
      }

      // Блокируем тап, чтобы RPG Maker о нем даже не узнал!
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    // Вешаем слушатели на фазу capture (погружение) — они срабатывают самыми первыми
    ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'pointerdown', 'pointermove', 'pointerup'].forEach(ev => {
        window.addEventListener(ev, interceptor, { capture: true, passive: false });
    });

    window.__toggleRpgTouchMode = function() {
      window.__rpgTouchEnabled = !window.__rpgTouchEnabled;
      
      const item = document.getElementById('_touch_mode_item');
      if (item) {
        item.innerHTML = (window.__rpgTouchEnabled ? '✅' : '👆') + ' Touch Mode';
        item.classList.toggle('_active', window.__rpgTouchEnabled);
      }

      const panel = document.getElementById('_sys_panel');
      if (panel) panel.classList.remove('_open');
    };

    // Создаем кнопку в системном меню
    document.addEventListener('DOMContentLoaded', () => {
      const panelTimer = setInterval(() => {
        const panel = document.getElementById('_sys_panel');
        if (!panel) return;
        clearInterval(panelTimer);
        
        if (!document.getElementById('_touch_mode_item')) {
          const item = document.createElement('div');
          item.id = '_touch_mode_item';
          item.className = '_sys_item';
          item.innerHTML = '👆 Touch Mode';
          item.style.cursor = 'pointer';
          panel.appendChild(item);
          item.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            window.__toggleRpgTouchMode();
          });
        }
      }, 150);
    });
  })();

  // =========================
  // 8) NATIVE MEMORY & GC FIX (SPIKE KILLER)
  // =========================
  (function applyNativeOptimizations() {
    const initTimer = setInterval(() => {
      if (typeof PIXI === 'undefined' || typeof ImageManager === 'undefined' || typeof SceneManager === 'undefined') return;

      // Оптимальный кэш (~80 МБ ОЗУ). Защита от перегрева
      // Обернуто в проверку на случай старых версий RPG Maker, где объекта cache нет
      if (ImageManager && ImageManager.cache) {
          ImageManager.cache.limit = 20 * 1000 * 1000;
      }

      // ФИКС СПАЙКОВ: Отключаем авто-очистку VRAM
      if (PIXI.settings) {
          PIXI.settings.GC_MODE = PIXI.GC_MODES.MANUAL; 
      }

      // Ручной вынос мусора ТОЛЬКО во время смены локаций (черный экран)
      if (!SceneManager.__gcPatched) {
          SceneManager.__gcPatched = true;
          const origChangeScene = SceneManager.changeScene;
          SceneManager.changeScene = function() {
              origChangeScene.call(this);
              if (Graphics && Graphics._renderer && Graphics._renderer.textureGC) {
                  Graphics._renderer.textureGC.run();
              }
          };
      }

      // Охлаждение процессора при свернутом браузере
      document.addEventListener('visibilitychange', () => {
          if (document.hidden && typeof AudioManager !== 'undefined') {
              if (SceneManager._scene) SceneManager._scene.pause = true;
          } else if (!document.hidden && typeof AudioManager !== 'undefined') {
              if (SceneManager._scene) SceneManager._scene.pause = false;
          }
      });

      // Снижение нагрузки на шину VRAM при выводе текста
      if (typeof Window_Message !== 'undefined' && !Window_Message.prototype.__textOptimized) {
          Window_Message.prototype.__textOptimized = true;
          const origUpdate = Window_Message.prototype.update;
          let frameCounter = 0;
          Window_Message.prototype.update = function() {
              frameCounter++;
              if (frameCounter % 2 === 0) origUpdate.call(this);
          };
      }

      console.log('[RPG Fixes] 🔧 Память оптимизирована (Auto-GC отключен)!');
      clearInterval(initTimer);
    }, 200);

    setTimeout(() => clearInterval(initTimer), 10000);
  })();

  // =========================
  // 9) ANTI-LAG: SUBPIXEL SCROLL & DASH FIX
  // =========================
  (function fixSubpixelScroll() {
    const patchTimer = setInterval(() => {
      if (typeof Tilemap !== 'undefined' && typeof Sprite_Character !== 'undefined') {
        
        // Лечим камеру: Округляем координаты скроллинга карты
        const origTilemapUpdate = Tilemap.prototype.updateTransform;
        Tilemap.prototype.updateTransform = function() {
            this.x = Math.round(this.x);
            this.y = Math.round(this.y);
            origTilemapUpdate.call(this);
        };

        // Лечим персонажей: Округляем координаты спрайтов
        const origSpriteUpdate = Sprite_Character.prototype.updatePosition;
        Sprite_Character.prototype.updatePosition = function() {
            origSpriteUpdate.call(this);
            this.x = Math.round(this.x);
            this.y = Math.round(this.y);
        };

        console.log('[RPG Fixes] 🏃‍♂️ Субпиксельный рендер и бег оптимизированы!');
        clearInterval(patchTimer);
      }
    }, 200);
    setTimeout(() => clearInterval(patchTimer), 10000);
  })();

})();