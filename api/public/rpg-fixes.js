/**
 * rpg-fixes.js — УЛЬТИМАТИВНЫЙ УНИВЕРСАЛЬНЫЙ ФИКС ДЛЯ RPG MAKER MV/MZ
 * Содержит: Защиту от вылетов, облачные сохранения, мобильный геймпад, 
 * идеальное масштабирование UI и фикс рассинхрона мыши на ПК.
 */

// ══════════════════════════════════════════════
// 1. ЗАГЛУШКИ ДЛЯ БРАУЗЕРА (Анти-краш)
// ОПИСАНИЕ: Игры RPG Maker часто ищут ПК-файлы или пытаются открыть внешние ссылки (Discord, Patreon) через ПК-движок NW.js.
// Этот код притворяется ПК-движком, чтобы игра не зависала и не выдавала черный экран при клике на ссылки.
// ══════════════════════════════════════════════
window.require = function(m) {
    if (m === 'path') return { dirname: function(p){return p.replace(/[/\\][^/\\]*$/, '')||'.';}, join: function(){return Array.from(arguments).join('/');}, basename: function(p){return p.split(/[/\\]/).pop();}, extname: function(p){var b=p.split(/[/\\]/).pop();var i=b.lastIndexOf('.');return i>0?b.slice(i):'';} };
    if (m === 'fs') return { readFileSync: function(){return '';}, writeFileSync: function(){}, mkdirSync: function(){}, existsSync: function(){return false;}, readdirSync: function(){return [];}, unlinkSync: function(){}, statSync: function(){return {isDirectory: function(){return false;}};} };
    if (m === 'nw.gui' || m === 'nw') return { Window: { get: function(){return {on: function(){}, maximize: function(){}, restore: function(){}, removeAllListeners: function(){}, close: function(){}};} }, App: { quit: function(){}, argv: [], manifest: {} }, Screen: { Init: function(){}, on: function(){} }, Shell: { openExternal: function(url){window.open(url, '_blank');} } };
    return {};
};
window.process = { platform: 'browser', env: {}, mainModule: { filename: '' } };
window.nw = window.require('nw');

// Форсируем WEB-режим: заставляем игру скачивать звуки и картинки по http, а не искать их на жестком диске.
setInterval(function() {
    if (typeof Utils !== 'undefined') { Utils.isNwjs = function(){return false;}; Utils.isLocal = function(){return false;}; }
}, 50);

// ══════════════════════════════════════════════
// 2. ИДЕАЛЬНОЕ МАСШТАБИРОВАНИЕ И ФИКС МЫШИ
// ОПИСАНИЕ: Замораживает попытки самой игры менять разрешение экрана (чтобы не ломались плагины UI).
// Затем CSS-лупой растягивает картинку под экран, а скрипт пересчитывает координаты мыши, чтобы она не мазала на ПК.
// ══════════════════════════════════════════════
(function() {
    var meta = document.querySelector('meta[name="viewport"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'viewport'; document.head.appendChild(meta); }
    meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';

    var style = document.createElement('style');
    style.textContent = [
        'html, body { margin: 0 !important; padding: 0 !important; width: 100vw !important; height: 100dvh !important; background: #000 !important; overflow: hidden !important; touch-action: none !important; }',
        '#GameCanvas, canvas { display: block !important; position: absolute !important; top: 50% !important; left: 50% !important; transform: translate(-50%, -50%) !important; margin: 0 !important; padding: 0 !important; image-rendering: auto; }'
    ].join('\n');
    document.addEventListener('DOMContentLoaded', function() { document.head.appendChild(style); });

    // Замораживаем изменение холста плагинами игры
    var _freezeTimer = setInterval(function() {
        if (typeof Graphics !== 'undefined') {
            if (Graphics._updateCanvas) Graphics._updateCanvas = function() {}; 
            if (Graphics._centerElement) Graphics._centerElement = function() {}; 
            if (Graphics._onWindowResize) Graphics._onWindowResize = function() {};
            clearInterval(_freezeTimer);
        }
    }, 50);

    // Математический подгон холста под экран
    function updateScale() {
        var c = document.getElementById('GameCanvas') || document.querySelector('canvas');
        if (!c || c.width === 0) return;
        var scale = Math.min(window.innerWidth / c.width, window.innerHeight / c.height);
        c.style.setProperty('width', Math.floor(c.width * scale) + 'px', 'important');
        c.style.setProperty('height', Math.floor(c.height * scale) + 'px', 'important');
    }
    window.addEventListener('load', function() { updateScale(); setInterval(updateScale, 100); });
    window.addEventListener('resize', updateScale);
    window.addEventListener('orientationchange', function() { setTimeout(updateScale, 300); });

    // Супер-фикс: пересчет координат курсора мыши для ПК
    var _mousePatchTimer = setInterval(function() {
        if (typeof Graphics !== 'undefined' && Graphics.pageToCanvasX) {
            clearInterval(_mousePatchTimer);
            Graphics.pageToCanvasX = function(x) {
                if (this._canvas) {
                    var rect = this._canvas.getBoundingClientRect();
                    return Math.round((x - rect.left) * (this._canvas.width / rect.width));
                }
                return 0;
            };
            Graphics.pageToCanvasY = function(y) {
                if (this._canvas) {
                    var rect = this._canvas.getBoundingClientRect();
                    return Math.round((y - rect.top) * (this._canvas.height / rect.height));
                }
                return 0;
            };
        }
    }, 100);

    // Сглаживание пикселей для красивых аниме-артов
    // Сглаживание пикселей для красивых аниме-артов (Без спама в консоль)
    var _pixiTimer = setInterval(function() {
        if (typeof PIXI !== 'undefined') {
            clearInterval(_pixiTimer); // Останавливаем таймер, выполняем только один раз!
            
            // Временно "глушим" консоль, чтобы скрыть системные ворчания PIXI
            var _originalWarn = console.warn;
            console.warn = function() {};
            
            try {
                if (PIXI.settings && PIXI.SCALE_MODES) {
                    PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.LINEAR;
                } else if (PIXI.scaleModes) {
                    PIXI.scaleModes.DEFAULT = PIXI.scaleModes.LINEAR;
                }
            } catch(e) {}
            
            // Возвращаем консоль в нормальное состояние
            console.warn = _originalWarn;
        }
    }, 100);
})();

// ══════════════════════════════════════════════
// 3. СИНХРОНИЗАЦИЯ: ОБЛАЧНЫЕ СОХРАНЕНИЯ (СЕРВЕР)
// ОПИСАНИЕ: Сохраняет прогресс игры не только в браузер (откуда он может удалиться), 
// но и отправляет JSON-копию на твой сервер Node.js.
// ══════════════════════════════════════════════
window.addEventListener('load', function() {
    if (typeof StorageManager !== 'undefined') StorageManager.isLocalMode = function() { return false; };
    if (typeof DataManager !== 'undefined') {
        if (!DataManager.setAutoSaveFileId) DataManager.setAutoSaveFileId = function() {};
        if (!DataManager.autoSaveFileId)    DataManager.autoSaveFileId    = function() { return 1; };
    }
});

(function() {
    var gameId = location.pathname.split('/').filter(Boolean)[0] || 'unknown';
    try {
        // Подтягиваем сохранения с сервера при запуске
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/saves/' + encodeURIComponent(gameId), false);
        xhr.send(null);
        if (xhr.status === 200) {
            var saves = JSON.parse(xhr.responseText);
            Object.keys(saves).forEach(function(key) {
                Storage.prototype.setItem.call(localStorage, key, saves[key]);
            });
            console.log('☁️ Облачные сохранения успешно подтянуты с сервера!');
        }
    } catch(e) {}

    // Отправляем сохранения на сервер в момент записи
    var originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
        originalSetItem.call(this, key, value); 
        if (key.indexOf('RPG ') === 0) { 
            fetch('/api/saves/' + encodeURIComponent(gameId) + '/' + encodeURIComponent(key), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-token': 'SuperSecretKey123' },
                body: JSON.stringify({ value: value })
            }).catch(function(e) {});
        }
    };

    // Удаляем сохранения с сервера, если они удалены в игре
    var originalRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function(key) {
        originalRemoveItem.call(this, key);
        if (key.indexOf('RPG ') === 0) {
            fetch('/api/saves/' + encodeURIComponent(gameId) + '/' + encodeURIComponent(key), {
                method: 'DELETE',
                headers: { 'x-api-token': 'SuperSecretKey123' }
            }).catch(function(e) {});
        }
    };
})();

// ══════════════════════════════════════════════
// 4. ОПТИМИЗАЦИЯ АУДИО (IOS И ЗАГЛУШКИ ОШИБОК)
// ОПИСАНИЕ: 1) Убирает черный экран с ошибкой "Failed to load audio", если разработчик забыл звук.
// 2) Принудительно "будит" звуковую карту на iPhone при первом тапе.
// ══════════════════════════════════════════════
setInterval(function() {
    if (typeof AudioManager !== 'undefined') AudioManager.checkErrors = function() {};
    if (typeof WebAudio !== 'undefined') {
        var _orig = WebAudio.prototype._onError;
        WebAudio.prototype._onError = function() { this._isError = false; this._hasError = false; };
    }
}, 500);

(function() {
    var audioUnlocked = false;
    function unlockAudio() {
        if (audioUnlocked) return;
        if (typeof WebAudio !== 'undefined' && WebAudio._context) {
            if (WebAudio._context.state === 'suspended') {
                WebAudio._context.resume().then(function() { audioUnlocked = true; });
            } else { audioUnlocked = true; }
        }
        var AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext && !audioUnlocked) {
            var ctx = new AudioContext();
            var buffer = ctx.createBuffer(1, 1, 22050);
            var source = ctx.createBufferSource();
            source.buffer = buffer; source.connect(ctx.destination);
            if (source.start) source.start(0); else source.noteOn(0);
            ctx.resume().then(function() { audioUnlocked = true; });
        }
        if (audioUnlocked) {
            document.removeEventListener('touchstart', unlockAudio);
            document.removeEventListener('touchend', unlockAudio);
            document.removeEventListener('click', unlockAudio);
        }
    }
    document.addEventListener('touchstart', unlockAudio, { passive: true });
    document.addEventListener('touchend',   unlockAudio, { passive: true });
    document.addEventListener('click', unlockAudio, { passive: true });
})();

// ══════════════════════════════════════════════
// 5. МОБИЛЬНЫЕ УЛУЧШЕНИЯ: ШРИФТЫ И БЛОКИРОВКА ТАЧА
// ОПИСАНИЕ: Делает текст на телефоне читаемым (+35%).
// Отключает беготню персонажа за пальцем, чтобы играть можно было только с джойстика.
// ══════════════════════════════════════════════
setInterval(function() {
    var isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    
    // Блокируем тач-клики и беготню по карте (если мы на мобилке)
    if (isMobile) {
        if (typeof Scene_Map !== 'undefined') Scene_Map.prototype.processMapTouch = function() {};
        if (typeof TouchInput !== 'undefined') {
            TouchInput.isPressed = function() { return false; };
            TouchInput.isTriggered = function() { return false; };
            TouchInput.isMoved = function() { return false; };
            TouchInput.isReleased = function() { return false; };
        }
    }

    // Увеличение шрифтов на 35% для мобилок
    if (isMobile && typeof Window_Base !== 'undefined' && typeof Window_Base.prototype.standardFontSize === 'function') {
        var scale = 1.35; 
        var _origMV = Window_Base.prototype.standardFontSize;
        Window_Base.prototype.standardFontSize = function() { return Math.floor(_origMV.call(this) * scale); };
        if (typeof Window_Base.prototype.systemFontSize === 'function') {
            var _origMZ = Window_Base.prototype.systemFontSize;
            Window_Base.prototype.systemFontSize = function() { return Math.floor(_origMZ.call(this) * scale); };
        }
    }
}, 1000);

// ══════════════════════════════════════════════
// 6. ВИРТУАЛЬНЫЙ ГЕЙМПАД И FULLSCREEN
// ОПИСАНИЕ: Отрисовывает поверх игры D-Pad (со свайпами) и 4 кнопки действия (Shift, OK, Menu, Esc).
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('_fs_btn')) return;

    var style = document.createElement('style');
    style.textContent = [
        '#_fs_btn { position:fixed; top:12px; right:12px; z-index:9999; width:40px; height:40px; background:rgba(0,0,0,0.6); border:1px solid rgba(255,255,255,0.25); border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:background 0.2s; -webkit-tap-highlight-color:transparent; }',
        '#_fs_btn svg { width:20px; height:20px; fill:white; }',
        '#_mob_ctrl { display:none; position:fixed; bottom:0; left:0; right:0; z-index:9998; pointer-events:none; padding:16px; height:220px; }',
        '@media (pointer:coarse) { #_mob_ctrl { display:block; } }',
        '#_dpad { position:absolute; bottom:20px; left:20px; width:190px; height:190px; pointer-events:all; }',
        '._dpad_btn { position:absolute; width:58px; height:58px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.3); border-radius:10px; display:flex; align-items:center; justify-content:center; -webkit-tap-highlight-color:transparent; user-select:none; touch-action:none; }',
        '._dpad_btn:active, ._dpad_btn._on { background:rgba(255,255,255,0.6); }',
        '._dpad_btn svg { width:24px; height:24px; fill:rgba(255,255,255,0.95); }',
        '#_d_up    { top:0;    left:66px; }',
        '#_d_down  { bottom:0; left:66px; }',
        '#_d_left  { top:66px; left:0; }',
        '#_d_right { top:66px; right:0; }',
        '#_d_mid   { position:absolute; top:66px; left:66px; width:58px; height:58px; background:rgba(255,255,255,0.05); border-radius:10px; }',
        '#_act_btns { position:absolute; bottom:20px; right:20px; display:grid; grid-template-columns:1fr 1fr; gap:12px; pointer-events:all; }',
        '._act_btn { width:70px; height:70px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:13px; font-family:sans-serif; font-weight:700; color:white; -webkit-tap-highlight-color:transparent; user-select:none; touch-action:none; border:1.5px solid rgba(255,255,255,0.3); }',
        '._act_btn:active, ._act_btn._on { filter:brightness(1.5); }',
        '#_a_ok    { background:rgba(40,160,40,0.6); }',
        '#_a_esc   { background:rgba(200,40,40,0.6); }',
        '#_a_menu  { background:rgba(40,100,200,0.6); }',
        '#_a_shift { background:rgba(180,140,20,0.6); }',
    ].join('\n');
    document.head.appendChild(style);

    var pad = document.createElement('div');
    pad.innerHTML =
        '<div id="_fs_btn" title="Fullscreen"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></div>' +
        '<div id="_mob_ctrl">' +
            '<div id="_dpad"><div class="_dpad_btn" id="_d_up"><svg viewBox="0 0 24 24"><path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/></svg></div><div class="_dpad_btn" id="_d_down"><svg viewBox="0 0 24 24"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg></div><div class="_dpad_btn" id="_d_left"><svg viewBox="0 0 24 24"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6z"/></svg></div><div class="_dpad_btn" id="_d_right"><svg viewBox="0 0 24 24"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg></div><div id="_d_mid"></div></div>' +
            '<div id="_act_btns"><div class="_act_btn" id="_a_shift">SHIFT</div><div class="_act_btn" id="_a_ok">OK</div><div class="_act_btn" id="_a_menu">MENU</div><div class="_act_btn" id="_a_esc">ESC</div></div>' +
        '</div>';
    document.body.appendChild(pad);

    document.getElementById('_fs_btn').addEventListener('click', function() {
        var el = document.documentElement;
        var canFs = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!canFs) return;
        if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } 
        else { canFs.call(el); }
    });

    var keyMap = {
        '_d_up': {key:'ArrowUp', code:'ArrowUp', keyCode:38}, '_d_down': {key:'ArrowDown', code:'ArrowDown', keyCode:40},
        '_d_left': {key:'ArrowLeft', code:'ArrowLeft', keyCode:37}, '_d_right': {key:'ArrowRight', code:'ArrowRight', keyCode:39},
        '_a_ok': {key:'Enter', code:'Enter', keyCode:13}, '_a_esc': {key:'Escape', code:'Escape', keyCode:27},
        '_a_menu': {key:'x', code:'KeyX', keyCode:88}, '_a_shift': {key:'Shift', code:'ShiftLeft', keyCode:16}
    };

    function fireKey(type, m) {
        var ev = new KeyboardEvent(type, { key:m.key, code:m.code, bubbles:true, cancelable:true });
        Object.defineProperty(ev, 'keyCode', { get: function() { return m.keyCode; } });
        Object.defineProperty(ev, 'which',   { get: function() { return m.keyCode; } });
        document.dispatchEvent(ev);
    }

    var held = {};
    Object.keys(keyMap).forEach(function(id) {
        var el = document.getElementById(id);
        var m = keyMap[id];
        function dn(e) { if(e.cancelable) e.preventDefault(); if (held[id]) return; held[id]=true; el.classList.add('_on'); fireKey('keydown',m); }
        function up(e) { if(e.cancelable) e.preventDefault(); if (!held[id]) return; held[id]=false; el.classList.remove('_on'); fireKey('keyup',m); }
        if (el) { el.addEventListener('touchstart', dn, {passive:false}); el.addEventListener('touchend', up, {passive:false}); el.addEventListener('touchcancel', up, {passive:false}); }
    });

    var sx, sy, sa = null;
    document.addEventListener('touchstart', function(e) {
        if (e.target.closest('#_mob_ctrl') || e.target.closest('#_fs_btn')) return;
        var t = e.touches[0]; if (t.clientX > window.innerWidth / 2) return;
        sx = t.clientX; sy = t.clientY;
    }, {passive:true});
    
    document.addEventListener('touchmove', function(e) {
        if (sx == null) return;
        if (e.cancelable) e.preventDefault();
        var t = e.touches[0], dx = t.clientX-sx, dy = t.clientY-sy, dir = null;
        if (Math.abs(dx) > Math.abs(dy)) { if (dx>20) dir='_d_right'; else if (dx<-20) dir='_d_left'; }
        else                             { if (dy>20) dir='_d_down';  else if (dy<-20) dir='_d_up'; }
        if (dir && dir !== sa) {
            if (sa) { held[sa]=false; fireKey('keyup',keyMap[sa]); document.getElementById(sa).classList.remove('_on'); }
            sa=dir; held[dir]=true; document.getElementById(dir).classList.add('_on'); fireKey('keydown',keyMap[dir]);
        }
    }, {passive:false});
    
    document.addEventListener('touchend', function() {
        if (sa) { held[sa]=false; fireKey('keyup',keyMap[sa]); document.getElementById(sa).classList.remove('_on'); sa=null; }
        sx = sy = null;
    }, {passive:true});
});