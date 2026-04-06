/**
 * rpg-fixes.js — Облегчённый, стабильный и оптимизированный фикс
 * Без авто-увеличения текста. Пиксель-перфект графика. Защита от утечек памяти.
 */
(() => {
  if (window.__RPG_FIXES_V2_APPLIED__) return;
  window.__RPG_FIXES_V2_APPLIED__ = true;

  // =========================
  // 1) Browser stubs (anti-crash)
  // =========================
  window.require = function (m) {
    if (m === 'path') {
      return {
        dirname: p => p.replace(/[/\\][^/\\]*$/, '') || '.',
        join: (...a) => a.join('/'),
        basename: p => p.split(/[/\\]/).pop(),
        extname: p => {
          const b = p.split(/[/\\]/).pop();
          const i = b.lastIndexOf('.');
          return i > 0 ? b.slice(i) : '';
        }
      };
    }
    if (m === 'fs') {
      return {
        readFileSync: () => '',
        writeFileSync: () => {},
        mkdirSync: () => {},
        existsSync: () => false,
        readdirSync: () => [],
        unlinkSync: () => {},
        statSync: () => ({ isDirectory: () => false })
      };
    }
    if (m === 'nw.gui' || m === 'nw') {
      return {
        Window: { get: () => ({ on() {}, maximize() {}, restore() {}, removeAllListeners() {}, close() {} }) },
        App: { quit() {}, argv: [], manifest: {} },
        Screen: { Init() {}, on() {} },
        Shell: { openExternal: url => window.open(url, '_blank') }
      };
    }
    return {};
  };

  window.process = { platform: 'browser', env: {}, mainModule: { filename: '' } };
  window.nw = window.require('nw');

  function forceWebMode() {
    if (typeof Utils !== 'undefined') {
      Utils.isNwjs = () => false;
      Utils.isLocal = () => false;
      return true;
    }
    return false;
  }

  if (!forceWebMode()) {
    const t = setInterval(() => {
      if (forceWebMode()) clearInterval(t);
    }, 200);
    setTimeout(() => clearInterval(t), 10000);
  }

  // =========================
  // 2) Viewport + GPU Scaling + Mouse Sync
  // =========================
  (function setupViewportAndScale() {
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'viewport';
      document.head.appendChild(meta);
    }
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

    const style = document.createElement('style');
    style.textContent = [
      'html, body { margin:0!important; padding:0!important; width:100vw!important; height:100dvh!important; background:#000!important; overflow:hidden!important; touch-action:none!important; }',
      '#GameCanvas, canvas { display:block!important; position:absolute!important; top:50%!important; left:50%!important; transform-origin:center center!important; margin:0!important; padding:0!important; image-rendering:pixelated; }'
    ].join('\n');
    document.head.appendChild(style);

    // ⚡ ГЛОБАЛЬНАЯ ПЕРЕМЕННАЯ И ФУНКЦИЯ ДЛЯ КНОПКИ
    let isStretched = false;
    window.__toggleRpgStretch = function() {
      isStretched = !isStretched;
      scheduleScale();
    };

    function updateScale() {
      const c = document.getElementById('GameCanvas') || document.querySelector('canvas');
      if (!c || !c.width || !c.height) return;

      c.style.setProperty('width', c.width + 'px', 'important');
      c.style.setProperty('height', c.height + 'px', 'important');

      let scaleX = window.innerWidth / c.width;
      let scaleY = window.innerHeight / c.height;

      // Если режим растягивания ВЫКЛЮЧЕН - сохраняем оригинальные пропорции
      if (!isStretched) {
        const scale = Math.min(scaleX, scaleY);
        scaleX = scale;
        scaleY = scale;
      }

      // Применяем X и Y масштаб через GPU
      c.style.setProperty('transform', `translate(-50%, -50%) scale(${scaleX}, ${scaleY})`, 'important');
    }

    let rafPending = false;
    function scheduleScale() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        updateScale();
      });
    }

    window.addEventListener('load', scheduleScale);
    window.addEventListener('resize', scheduleScale);
    window.addEventListener('orientationchange', () => setTimeout(scheduleScale, 250));

    const bootTimer = setInterval(() => {
      const c = document.getElementById('GameCanvas') || document.querySelector('canvas');
      if (c && c.width) {
        scheduleScale();
        if (typeof SceneManager !== 'undefined' && SceneManager._scene) clearInterval(bootTimer);
      }
    }, 100);
    setTimeout(() => clearInterval(bootTimer), 5000);

    function patchMouseCoords() {
      if (typeof Graphics === 'undefined' || !Graphics.pageToCanvasX) return false;
      Graphics.pageToCanvasX = function (x) {
        if (!this._canvas) return 0;
        const rect = this._canvas.getBoundingClientRect();
        return Math.round((x - rect.left) * (this._canvas.width / rect.width));
      };
      Graphics.pageToCanvasY = function (y) {
        if (!this._canvas) return 0;
        const rect = this._canvas.getBoundingClientRect();
        return Math.round((y - rect.top) * (this._canvas.height / rect.height));
      };
      return true;
    }

    if (!patchMouseCoords()) {
      const mouseTimer = setInterval(() => {
        if (patchMouseCoords()) clearInterval(mouseTimer);
      }, 200);
      setTimeout(() => clearInterval(mouseTimer), 10000);
    }

    function patchPixi() {
      if (typeof PIXI === 'undefined') return false;
      try {
        if (PIXI.settings && PIXI.SCALE_MODES) PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST;
        else if (PIXI.scaleModes) PIXI.scaleModes.DEFAULT = PIXI.scaleModes.NEAREST;
      } catch (_) {}
      return true;
    }

    if (!patchPixi()) {
      const pixiTimer = setInterval(() => {
        if (patchPixi()) clearInterval(pixiTimer);
      }, 300);
      setTimeout(() => clearInterval(pixiTimer), 10000);
    }
  })();

  // =========================
  // 3) Cloud saves (Ultimate Engine-Level Injection v2)
  // =========================
  window.addEventListener('load', function () {
    if (typeof StorageManager !== 'undefined') StorageManager.isLocalMode = () => false;
    if (typeof DataManager !== 'undefined') {
      if (!DataManager.setAutoSaveFileId) DataManager.setAutoSaveFileId = function () {};
      if (!DataManager.autoSaveFileId) DataManager.autoSaveFileId = function () { return 1; };
    }
  });

  (function setupCloudSaves() {
    function resolveGameId() {
      const parts = location.pathname.split('/').filter(Boolean).map(p => decodeURIComponent(p));
      if (!parts.length) return 'unknown';
      return parts[0].replace(/[^a-zA-Z0-9._\-а-яА-Я]/g, '_');
    }

    const gameId = resolveGameId();
    let pulledSaves = {};

    // 🔥 УЛУЧШЕННЫЙ UI ИНДИКАТОР (Зеленый/Красный)
    const syncDiv = document.createElement('div');
    syncDiv.id = '_cloud_sync_ui';
    syncDiv.style.cssText = 'display:none; position:fixed; top:15px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.85); color:#fff; padding:6px 20px; border-radius:20px; z-index:999999; font-size:13px; font-family:sans-serif; font-weight:bold; border:1px solid rgba(255,255,255,0.2); pointer-events:none; box-shadow: 0 4px 10px rgba(0,0,0,0.5); transition: background 0.3s;';
    document.body.appendChild(syncDiv);

    let syncCount = 0;
    function startSync() {
      syncCount++;
      const ui = document.getElementById('_cloud_sync_ui');
      ui.innerHTML = '☁️ Синхронизация...';
      ui.style.background = 'rgba(0,0,0,0.85)';
      ui.style.display = 'block';
    }
    function endSync(ok = true) {
      syncCount--;
      if (syncCount <= 0) {
        syncCount = 0;
        const ui = document.getElementById('_cloud_sync_ui');
        ui.innerHTML = ok ? '✅ Сохранено' : '⚠️ Ошибка сервера';
        ui.style.background = ok ? 'rgba(40,140,40,0.9)' : 'rgba(170,60,60,0.9)';
        setTimeout(() => { if (syncCount === 0) ui.style.display = 'none'; }, 2000);
      }
    }

    function uploadToCloud(key, value) {
      startSync();
      fetch('/api/saves/' + encodeURIComponent(gameId) + '/' + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-token': 'SuperSecretKey123' }, // ⚡ ВАШ ТОКЕН
        body: JSON.stringify({ value: String(value) })
      }).then(r => endSync(r.ok)).catch(e => { console.error('[Cloud] Upload Error:', e); endSync(false); });
    }

    function deleteFromCloud(key) {
      startSync();
      fetch('/api/saves/' + encodeURIComponent(gameId) + '/' + encodeURIComponent(key), {
        method: 'DELETE',
        headers: { 'x-api-token': 'SuperSecretKey123' } // ⚡ ВАШ ТОКЕН
      }).then(r => endSync(r.ok)).catch(e => { console.error('[Cloud] Delete Error:', e); endSync(false); });
    }

    // 1) Скачиваем сейвы с сервера ДО старта движка
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/api/saves/' + encodeURIComponent(gameId), false);
      xhr.send(null);
      if (xhr.status === 200) {
        pulledSaves = JSON.parse(xhr.responseText || '{}');
        console.log(`[CloudSave] ☁️ Скачано с сервера: ${Object.keys(pulledSaves).length} файлов.`);
      }
    } catch (e) {}

    // Внедряемся в ядро движка
    const hookTimer = setInterval(() => {
      if (typeof StorageManager !== 'undefined') {
        if (StorageManager.saveToForage) {
          clearInterval(hookTimer);
          injectMZEngine();
        } else if (StorageManager.saveToWebStorage) {
          clearInterval(hookTimer);
          injectMVEngine();
        }
      }
    }, 150);

    // ==========================================
    // ИНЪЕКЦИЯ ДЛЯ НОВЫХ ИГР (MZ / VisuStella)
    // ==========================================
    function injectMZEngine() {
      console.log('[CloudSave] ☁️ Инъекция в ядро MZ активирована!');

      const _saveToForage = StorageManager.saveToForage;
      StorageManager.saveToForage = function(saveName, zip) {
        const cloudKey = 'MZ_' + saveName;
        pulledSaves[cloudKey] = zip;
        uploadToCloud(cloudKey, zip);
        return _saveToForage.apply(this, arguments);
      };

      const _loadFromForage = StorageManager.loadFromForage;
      StorageManager.loadFromForage = function(saveName) {
        const cloudKey = 'MZ_' + saveName;
        if (pulledSaves[cloudKey] !== undefined) {
          return Promise.resolve(pulledSaves[cloudKey]);
        }
        return _loadFromForage.apply(this, arguments);
      };

      const _removeForage = StorageManager.removeForage;
      StorageManager.removeForage = function(saveName) {
        const cloudKey = 'MZ_' + saveName;
        delete pulledSaves[cloudKey];
        deleteFromCloud(cloudKey);
        return _removeForage.apply(this, arguments);
      };

      // ⚡ ГЕНИАЛЬНЫЙ ФИКС (ВМЕСТО updateForageKeys)
      // Просто перехватываем проверку "Существует ли файл?"
      // Это на 100% отвязывает нас от $dataSystem и спасает от крашей!
      const _forageExists = StorageManager.forageExists;
      StorageManager.forageExists = function(saveName) {
        const cloudKey = 'MZ_' + saveName;
        if (pulledSaves[cloudKey] !== undefined) {
          return true; // Обманываем игру, говоря что файл есть!
        }
        return _forageExists.apply(this, arguments);
      };
    }

    // ==========================================
    // ИНЪЕКЦИЯ ДЛЯ СТАРЫХ ИГР (MV)
    // ==========================================
    function injectMVEngine() {
      console.log('[CloudSave] ☁️ Инъекция в ядро MV активирована!');
      
      Object.keys(pulledSaves).forEach(key => {
        if (key.startsWith('RPG ')) {
          try { localStorage.setItem(key, pulledSaves[key]); } catch (e) {}
        }
      });

      const _saveToWebStorage = StorageManager.saveToWebStorage;
      StorageManager.saveToWebStorage = function(saveFileId, json) {
        const key = this.webStorageKey(saveFileId);
        pulledSaves[key] = json;
        uploadToCloud(key, json);
        return _saveToWebStorage.apply(this, arguments);
      };

      const _removeWebStorage = StorageManager.removeWebStorage;
      StorageManager.removeWebStorage = function(saveFileId) {
        const key = this.webStorageKey(saveFileId);
        delete pulledSaves[key];
        deleteFromCloud(key);
        return _removeWebStorage.apply(this, arguments);
      };
    }
  })();

  // =========================
  // 4) Audio fixes
  // =========================
  function patchAudio() {
    if (typeof AudioManager !== 'undefined') AudioManager.checkErrors = function () {};
    if (typeof WebAudio !== 'undefined' && WebAudio.prototype && !WebAudio.prototype.__patchedOnError) {
      WebAudio.prototype.__patchedOnError = true;
      WebAudio.prototype._onError = function () {
        this._isError = false;
        this._hasError = false;
      };
    }
  }
  patchAudio();
  const audioPatchTimer = setInterval(() => {
    patchAudio();
    if (typeof AudioManager !== 'undefined' && typeof WebAudio !== 'undefined') clearInterval(audioPatchTimer);
  }, 400);
  setTimeout(() => clearInterval(audioPatchTimer), 10000);

  (function unlockAudioOnGesture() {
    let unlocked = false;
    function unlock() {
      if (unlocked) return;
      try {
        if (typeof WebAudio !== 'undefined' && WebAudio._context) {
          if (WebAudio._context.state === 'suspended') {
            WebAudio._context.resume().then(() => { unlocked = true; cleanup(); });
            return;
          }
          unlocked = true;
          cleanup();
          return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          const ctx = new AC();
          const buffer = ctx.createBuffer(1, 1, 22050);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.start ? source.start(0) : source.noteOn(0);
          ctx.resume().then(() => { unlocked = true; cleanup(); });
        }
      } catch (_) {}
    }
    function cleanup() {
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('touchend', unlock);
      document.removeEventListener('click', unlock);
    }
    document.addEventListener('touchstart', unlock, { passive: true });
    document.addEventListener('touchend', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  })();

  // =========================
  // 5) Mobile improvements (NO font scaling)
  // =========================
  (function mobileInputFixes() {
    const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (!isMobile) return;

    const timer = setInterval(() => {
      if (typeof Scene_Map !== 'undefined' && Scene_Map.prototype.processMapTouch) {
        Scene_Map.prototype.processMapTouch = function () {};
      }
      if (typeof TouchInput !== 'undefined') {
        TouchInput.isPressed = () => false;
        TouchInput.isTriggered = () => false;
        TouchInput.isMoved = () => false;
        TouchInput.isReleased = () => false;
      }

      if (typeof Window_Base !== 'undefined' && typeof Scene_Map !== 'undefined') {
        clearInterval(timer);
      }
    }, 500);

    setTimeout(() => clearInterval(timer), 10000);
  })();

  // =========================
  // 6) Virtual gamepad + fullscreen + stretch toggle
  // =========================
  document.addEventListener('DOMContentLoaded', function () {
    if (document.getElementById('_mob_ctrl')) return; // Защита от двойного создания

    // ⚡ НАДЕЖНОЕ ОПРЕДЕЛЕНИЕ iOS (iPhone, iPod, iPad)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const style = document.createElement('style');
    style.textContent = [
      '#_fs_btn { position:fixed; top:12px; right:12px; z-index:9999; width:40px; height:40px; background:rgba(0,0,0,0.6); border:1px solid rgba(255,255,255,0.25); border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background 0.2s; -webkit-tap-highlight-color:transparent; }',
      '#_fs_btn svg { width:20px; height:20px; fill:white; }',
      
      // Сдвигаем кнопку растягивания вправо, если кнопки Fullscreen нет!
      `#_stretch_btn { position:fixed; top:12px; right:${isIOS ? '12px' : '60px'}; z-index:9999; width:40px; height:40px; background:rgba(0,0,0,0.6); border:1px solid rgba(255,255,255,0.25); border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background 0.2s; -webkit-tap-highlight-color:transparent; }`,
      '#_stretch_btn svg { width:22px; height:22px; fill:white; }',
      
      '#_mob_ctrl { display:none; position:fixed; bottom:0; left:0; right:0; z-index:9998; pointer-events:none; padding:16px; height:220px; }',
      '@media (pointer:coarse) { #_mob_ctrl { display:block; } }',
      '#_dpad { position:absolute; bottom:20px; left:20px; width:190px; height:190px; pointer-events:all; }',
      '._dpad_btn { position:absolute; width:58px; height:58px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.3); border-radius:10px; display:flex; align-items:center; justify-content:center; -webkit-tap-highlight-color:transparent; user-select:none; touch-action:none; }',
      '._dpad_btn:active, ._dpad_btn._on { background:rgba(255,255,255,0.6); }',
      '._dpad_btn svg { width:24px; height:24px; fill:rgba(255,255,255,0.95); }',
      '#_d_up { top:0; left:66px; }',
      '#_d_down { bottom:0; left:66px; }',
      '#_d_left { top:66px; left:0; }',
      '#_d_right { top:66px; right:0; }',
      '#_d_mid { position:absolute; top:66px; left:66px; width:58px; height:58px; background:rgba(255,255,255,0.05); border-radius:10px; }',
      '#_act_btns { position:absolute; bottom:20px; right:20px; display:grid; grid-template-columns:1fr 1fr; gap:12px; pointer-events:all; }',
      '._act_btn { width:70px; height:70px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:13px; font-family:sans-serif; font-weight:700; color:white; -webkit-tap-highlight-color:transparent; user-select:none; touch-action:none; border:1.5px solid rgba(255,255,255,0.3); }',
      '._act_btn:active, ._act_btn._on { filter:brightness(1.5); }',
      '#_a_ok { background:rgba(40,160,40,0.6); }',
      '#_a_esc { background:rgba(200,40,40,0.6); }',
      '#_a_menu { background:rgba(40,100,200,0.6); }',
      '#_a_shift { background:rgba(180,140,20,0.6); }'
    ].join('\n');
    document.head.appendChild(style);

    // Генерируем кнопку Fullscreen только если это НЕ iOS
    const fsBtnHtml = isIOS ? '' : '<div id="_fs_btn" title="Fullscreen"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></div>';

    const pad = document.createElement('div');
    pad.innerHTML =
      fsBtnHtml + 
      '<div id="_stretch_btn" title="Stretch Screen"><svg viewBox="0 0 24 24"><path d="M10 21v-2H6.41l4.5-4.5-1.41-1.41-4.5 4.5V14H3v7h7zm11-7h-2v3.59l-4.5-4.5-1.41 1.41 4.5 4.5H14v2h7v-7zM3 3v7h2V6.41l4.5 4.5 1.41-1.41-4.5-4.5H10V3H3zm11 0v2h3.59l-4.5 4.5 1.41 1.41 4.5-4.5V10h2V3h-7z"/></svg></div>' +
      '<div id="_mob_ctrl">' +
      '<div id="_dpad"><div class="_dpad_btn" id="_d_up"><svg viewBox="0 0 24 24"><path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/></svg></div><div class="_dpad_btn" id="_d_down"><svg viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg></div><div class="_dpad_btn" id="_d_left"><svg viewBox="0 0 24 24"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/></svg></div><div class="_dpad_btn" id="_d_right"><svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg></div><div id="_d_mid"></div></div>' +
      '<div id="_act_btns"><div class="_act_btn" id="_a_shift">SHIFT</div><div class="_act_btn" id="_a_ok">OK</div><div class="_act_btn" id="_a_menu">MENU</div><div class="_act_btn" id="_a_esc">ESC</div></div>' +
      '</div>';
    document.body.appendChild(pad);

    // Умный биндинг
    function bindUiButton(id, action) {
      const btn = document.getElementById(id);
      if (!btn) return; // Если кнопки нет (как _fs_btn на iOS), ошибки не будет!
      let lastTrigger = 0;
      function handler(e) {
        if (e.cancelable) e.preventDefault();
        const now = Date.now();
        if (now - lastTrigger < 300) return;
        lastTrigger = now;
        action(e);
      }
      btn.addEventListener('touchstart', handler, { passive: false });
      btn.addEventListener('click', handler);
    }

    // Биндим кнопки
    bindUiButton('_fs_btn', function () {
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
      if (req) {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
          if (exit) exit.call(document);
        } else {
          req.call(el).catch(() => console.log("Фулскрин заблокирован."));
        }
      }
    });

    bindUiButton('_stretch_btn', function () {
      if (window.__toggleRpgStretch) window.__toggleRpgStretch();
    });

    // ----------------------------------------------------
    // Ниже остается твой старый код геймпада
    const keyMap = {
      _d_up: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
      _d_down: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
      _d_left: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
      _d_right: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
      _a_ok: { key: 'Enter', code: 'Enter', keyCode: 13 },
      _a_esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
      _a_menu: { key: 'x', code: 'KeyX', keyCode: 88 },
      _a_shift: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 }
    };

    function fireKey(type, m) {
      const ev = new KeyboardEvent(type, { key: m.key, code: m.code, bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'keyCode', { get: () => m.keyCode });
      Object.defineProperty(ev, 'which', { get: () => m.keyCode });
      document.dispatchEvent(ev);
    }

    const held = {};
    Object.keys(keyMap).forEach(id => {
      const el = document.getElementById(id);
      const m = keyMap[id];
      function dn(e) { if (e.cancelable) e.preventDefault(); if (held[id]) return; held[id] = true; el.classList.add('_on'); fireKey('keydown', m); }
      function up(e) { if (e.cancelable) e.preventDefault(); if (!held[id]) return; held[id] = false; el.classList.remove('_on'); fireKey('keyup', m); }
      if (el) {
        el.addEventListener('touchstart', dn, { passive: false });
        el.addEventListener('touchend', up, { passive: false });
        el.addEventListener('touchcancel', up, { passive: false });
      }
    });

    let sx = null, sy = null, sa = null;

    document.addEventListener('touchstart', function (e) {
      if (e.target.closest('#_mob_ctrl') || e.target.closest('#_fs_btn')) return;
      const t = e.touches[0];
      if (!t || t.clientX > window.innerWidth / 2) return;
      sx = t.clientX; sy = t.clientY;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (sx == null) return;
      if (e.cancelable) e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      let dir = null;

      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 20) dir = '_d_right';
        else if (dx < -20) dir = '_d_left';
      } else {
        if (dy > 20) dir = '_d_down';
        else if (dy < -20) dir = '_d_up';
      }

      if (dir && dir !== sa) {
        if (sa) {
          held[sa] = false;
          fireKey('keyup', keyMap[sa]);
          document.getElementById(sa).classList.remove('_on');
        }
        sa = dir;
        held[dir] = true;
        document.getElementById(dir).classList.add('_on');
        fireKey('keydown', keyMap[dir]);
      }
    }, { passive: false });

    document.addEventListener('touchend', function () {
      if (sa) {
        held[sa] = false;
        fireKey('keyup', keyMap[sa]);
        document.getElementById(sa).classList.remove('_on');
        sa = null;
      }
      sx = sy = null;
    }, { passive: true });
  });
})();

// =========================
  // 7) MZ CanvasTextAlign Bugfix
  // =========================
  (function fixMZCanvasSpam() {
    const timer = setInterval(() => {
      if (typeof Bitmap !== 'undefined' && Bitmap.prototype && Bitmap.prototype.drawText) {
        const origDrawText = Bitmap.prototype.drawText;
        Bitmap.prototype.drawText = function(text, x, y, maxWidth, lineHeight, align) {
          // Если игра забыла передать align, подставляем 'left' по умолчанию
          return origDrawText.call(this, text, x, y, maxWidth, lineHeight, align || 'left');
        };
        clearInterval(timer);
        console.log('[Fix] 🛠️ Устранен спам CanvasTextAlign');
      }
    }, 500);
    setTimeout(() => clearInterval(timer), 10000);
  })();