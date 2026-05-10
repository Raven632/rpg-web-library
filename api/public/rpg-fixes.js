// ============================================================================
// 1. АБСОЛЮТНАЯ ИМИТАЦИЯ ANDROID И СИСТЕМНЫХ API (УБИЙЦА ОШИБОК)
// ============================================================================
window.process = window.process || {};
window.process.env = window.process.env || {};
window.process.env.USER = 'Player';
window.process.platform = window.process.platform || 'browser';
window.process.mainModule = { filename: '' };
window.process.versions = {};

// Подавляем ошибку Firefox/Chrome при выходе из полноэкранного режима
if (typeof document !== 'undefined') {
    const origExit = document.exitFullscreen;
    if (origExit) {
        document.exitFullscreen = function() {
            if (!document.fullscreenElement) return Promise.resolve();
            return origExit.call(this);
        };
    }
    const origMoz = document.mozCancelFullScreen;
    if (origMoz) {
        document.mozCancelFullScreen = function() {
            if (!document.mozFullScreenElement) return Promise.resolve();
            return origMoz.call(this);
        };
    }
    const origWebkit = document.webkitExitFullscreen;
    if (origWebkit) {
        document.webkitExitFullscreen = function() {
            if (!document.webkitFullscreenElement) return Promise.resolve();
            return origWebkit.call(this);
        };
    }
}

window.ExternalStorage = {
    _reply: function(cbId, res) {
        setTimeout(function() {
            if (window.AuraMZ && window.AuraMZ.Mobile && window.AuraMZ.Mobile.callbacks && window.AuraMZ.Mobile.callbacks[cbId]) {
                window.AuraMZ.Mobile.callbacks[cbId](res);
            }
        }, 10);
    },
    existsFile: function(id) { this._reply(id, "false"); return false; },
    saveFile: function(id) { this._reply(id, "true"); return false; },
    loadFile: function(id) { this._reply(id, ""); return false; },
    readFile: function(id) { this._reply(id, ""); return false; },
    removeFile: function(id) { this._reply(id, "true"); return false; },
    listFiles: function(id) { this._reply(id, "[]"); return false; },
    makeDir: function(id) { this._reply(id, "true"); return false; },
    selectExternalStorageDirectory: function(id) { this._reply(id, "null"); return false; },
    removeExternalStorageDirectory: function(id) { this._reply(id, "true"); return false; },
    writeFile: function(id) { this._reply(id, "true"); return false; }
};
window.Android = { showToast: function(){}, getVersion: function(){return "1.0";} };

// ============================================================================
// 2. БЛОКИРОВЩИК ПЛАГИНОВ И ЛЕКАРЬ ПРОМИСОВ (Перехватчик)
// ============================================================================
if (!window.__rpgPluginHookInstalled) {
    window.__rpgPluginHookInstalled = true;
    
    var _origSrc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
    if (_origSrc) {
        Object.defineProperty(HTMLScriptElement.prototype, 'src', {
            set: function(val) {
                if (val && typeof val === 'string') {
                    var lowerVal = val.toLowerCase();
                    if (lowerVal.indexOf('auramz/mobile') > -1 || lowerVal.indexOf('toggle_save_dir') > -1 || lowerVal.indexOf('elimz_mobilecontrols') > -1) {
                        console.log('[RPG Fixes] 🛑 Заблокирован конфликтный плагин: ' + val);
                        val = 'data:application/javascript,console.log("Blocked by RPG-Fixes!");';
                    }
                    
                    if (val.indexOf('js/plugins/') > -1) {
                        if (window.Scene_Boot && window.Scene_Boot.prototype && !window.__bootPromiseFixed) {
                            window.__bootPromiseFixed = true;
                            var _origBootLoad = window.Scene_Boot.prototype.loadPlayerData;
                            window.Scene_Boot.prototype.loadPlayerData = function() {
                                var res = _origBootLoad ? _origBootLoad.apply(this, arguments) : undefined;
                                return (res && typeof res.then === 'function') ? res : Promise.resolve(res);
                            };
                        }
                        
                        if (window.DataManager && window.DataManager.savefileExists && !window.__saveFilePromiseFixed) {
                            window.__saveFilePromiseFixed = true;
                            var _origSaveExists = window.DataManager.savefileExists;
                            window.DataManager.savefileExists = function() {
                                var res = _origSaveExists.apply(this, arguments);
                                return (res && typeof res.then === 'function') ? res : Promise.resolve(res);
                            };
                        }

                        if (window.StorageManager && window.StorageManager.exists && !window.__storagePromiseFixed) {
                            window.__storagePromiseFixed = true;
                            var _origStorageExists = window.StorageManager.exists;
                            window.StorageManager.exists = function() {
                                var res = _origStorageExists.apply(this, arguments);
                                return (res && typeof res.then === 'function') ? res : Promise.resolve(res || false);
                            };
                        }
                    }
                }
                
                if (_origSrc.set) {
                    return _origSrc.set.call(this, val);
                } else {
                    return this.setAttribute('src', val);
                }
            },
            get: function() { 
                if (_origSrc.get) {
                    return _origSrc.get.call(this); 
                } else {
                    return this.getAttribute('src');
                }
            }
        });
    }
}

// ============================================================================
// 3. ОСНОВНОЙ КОД RPG-FIXES (Ultimate v4.0 - Fullscreen Bulletproof)
// ============================================================================
(() => {
    if (window.__RPG_FIXES_ULTIMATE__) return;
    window.__RPG_FIXES_ULTIMATE__ = true;

    function applyConsoleFixes() {
        function applyCanvasReadFrequently(proto) {
            if (!proto || !proto.getContext) return;
            var originalGetContext = proto.getContext;
            proto.getContext = function(type, attributes) {
                if (type === '2d') {
                    var newAttributes = Object.assign({}, attributes || {});
                    newAttributes.willReadFrequently = true;
                    return originalGetContext.call(this, type, newAttributes);
                }
                return originalGetContext.call(this, type, attributes);
            };
        }
        applyCanvasReadFrequently(HTMLCanvasElement.prototype);
        if (typeof OffscreenCanvas !== 'undefined') applyCanvasReadFrequently(OffscreenCanvas.prototype);

        var orgSetTextAlign = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'textAlign');
        if (orgSetTextAlign && orgSetTextAlign.set) {
            Object.defineProperty(CanvasRenderingContext2D.prototype, 'textAlign', {
                set: function(value) {
                    var safeValue = (value === 'undefined' || !value) ? 'left' : value;
                    orgSetTextAlign.set.call(this, safeValue);
                }
            });
        }

        var orgWarn = console.warn;
        console.warn = function() {
            if (arguments[0] && typeof arguments[0] === 'string') {
                if (arguments[0].indexOf('Unsupported skeleton data') > -1) return;
            }
            orgWarn.apply(console, arguments);
        };
    }

    function applyCoreEnginePatches() {
        const pmTimer = setInterval(() => {
            if (window.PluginManager && typeof PluginManager.setup === 'function' && !window.__pmHooked) {
                window.__pmHooked = true;
                
                // 🛑 Глушим плагин AudioStreaming еще до его запуска!
                if (!PluginManager._parameters) PluginManager._parameters = {};
                PluginManager._parameters['audiostreaming'] = { mode: "00" };

                const origSetup = PluginManager.setup;
                PluginManager.setup = function(plugins) {
                    if (Array.isArray(plugins)) {
                        plugins = plugins.filter(p => !['EliMZ_MobileControls', 'ToggleSaveDirectory', 'Mobile', 'AudioStreaming'].includes(p.name));
                    }
                    origSetup.call(this, plugins);
                };
                clearInterval(pmTimer);
            }
        }, 10);
    }

    function setupBrowserStubs() {
        if (typeof window.Logger === 'undefined') {
            const dummyLog = function() {};
            window.Logger = {
                createDefaultLogger: function() { return { info: dummyLog, warn: dummyLog, error: dummyLog, debug: dummyLog, fatal: dummyLog, trace: dummyLog }; },
                default: { createDefaultLogger: function() { return { info: dummyLog, warn: dummyLog, error: dummyLog, debug: dummyLog, fatal: dummyLog, trace: dummyLog }; } }
            };
        }
        
        window.__import_meta = { url: location.href, env: {} };

        if (typeof require === 'undefined') {
            window.require = function (m) {
                if (m === 'path') return { 
                    dirname: p => p ? p.replace(/[/\\][^/\\]*$/, '') || '.' : '.', 
                    join: (...a) => a.join('/'), 
                    basename: p => p ? p.split(/[/\\]/).pop() : '', 
                    extname: p => { const b = (p||'').split(/[/\\]/).pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
                    resolve: function() { return Array.prototype.slice.call(arguments).join('/').replace(/\\/g, '/').replace(/\/+/g, '/'); }
                };
                if (m === 'util') return {
                    promisify: function(fn) { 
                        return function(...args) { 
                            return new Promise((resolve, reject) => { 
                                fn(...args, (err, res) => err ? reject(err) : resolve(res)); 
                            }); 
                        }; 
                    }
                };
                if (m === 'fs') return { 
                    readFileSync: () => '', writeFileSync: () => {}, mkdirSync: () => {}, 
                    existsSync: () => false, readdirSync: () => [], unlinkSync: () => {}, 
                    statSync: () => ({ isDirectory: () => false }) 
                };
                if (m === 'nw.gui' || m === 'nw') return { 
                    Window: { get: () => ({ on() {}, maximize() {}, restore() {}, removeAllListeners() {}, close() {} }) }, 
                    App: { quit() {}, argv: [], manifest: {} }, 
                    Screen: { Init() {}, on() {} }, 
                    Shell: { openExternal: url => window.open(url, '_blank') } 
                };
                if (m.includes('greenworks')) return {
                    initAPI: () => false, isSteamRunning: () => false, getAppId: () => 0,
                    getSteamId: () => ({ accountId: 0, screenName: 'Player' }), activateAchievement: () => {}, on: () => {}
                };
                return {};
            };
            window.nw = window.require('nw');
        }
    }

    function fixDevicePixelRatio() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (!isIOS) return;
        const TARGET = 1;
        try { Object.defineProperty(window, 'devicePixelRatio', { get: () => TARGET, configurable: true }); } catch(e) {}
        const pixi_t = setInterval(() => {
            if (typeof PIXI === 'undefined') return;
            clearInterval(pixi_t);
            try { PIXI.settings.RESOLUTION = TARGET; PIXI.settings.GC_MAX_IDLE = 60; PIXI.settings.GC_MAX_CHECK_COUNT = 20; PIXI.settings.SPRITE_MAX_TEXTURES = 16; } catch(e) {}
            const gfx_t = setInterval(() => {
                if (typeof Graphics === 'undefined') return;
                const r = (Graphics._app && Graphics._app.renderer) || Graphics._renderer;
                if (!r) return;
                clearInterval(gfx_t);
                if (r.resolution === TARGET) return; 
                const logW = r.width  / r.resolution; const logH = r.height / r.resolution; r.resolution = TARGET;
                try { r.resize(logW, logH); } catch(e) {}
                try { if (r.plugins && r.plugins.interaction) r.plugins.interaction.resolution = TARGET; } catch(e) {}
            }, 100);
            setTimeout(() => clearInterval(gfx_t), 15000);
        }, 50);
        setTimeout(() => clearInterval(pixi_t), 15000);
    }

    function setupModernViewport() {
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
            let scaleX = window.innerWidth / targetCanvas.width; let scaleY = window.innerHeight / targetCanvas.height;
            if (!isStretched) { const scale = Math.min(scaleX, scaleY); scaleX = scaleY = scale; }
            targetCanvas.style.setProperty('transform', `translate(-50%, -50%) scale(${scaleX}, ${scaleY})`, 'important');
        }
        function forceScaleUpdate() { if (targetCanvas) requestAnimationFrame(applyScale); }

        const domObserver = new MutationObserver((mutations, obs) => {
            const c = document.getElementById('GameCanvas') || document.querySelector('canvas');
            if (c) {
                targetCanvas = c; resizeObserver.observe(document.body); window.addEventListener('resize', forceScaleUpdate);
                const canvasObserver = new MutationObserver(() => forceScaleUpdate());
                canvasObserver.observe(targetCanvas, { attributes: true, attributeFilter: ['width', 'height'] });
                const hookTimer = setInterval(() => {
                    if (typeof Graphics !== 'undefined') {
                        Graphics.pageToCanvasX = function (x) { if (!this._canvas) return 0; const rect = this._canvas.getBoundingClientRect(); return Math.round((x - rect.left) * (this._canvas.width / rect.width)); };
                        Graphics.pageToCanvasY = function (y) { if (!this._canvas) return 0; const rect = this._canvas.getBoundingClientRect(); return Math.round((y - rect.top) * (this._canvas.height / rect.height)); };
                        if (Graphics._centerElement) Graphics._centerElement = function() {};
                        clearInterval(hookTimer);
                    }
                }, 100);
                setTimeout(() => clearInterval(hookTimer), 5000);
                let bootTicks = 0;
                const bootTimer = setInterval(() => { forceScaleUpdate(); if (++bootTicks > 20) clearInterval(bootTimer); }, 100);
                obs.disconnect();
            }
        });
        domObserver.observe(document.body, { childList: true, subtree: true });
        const forceModeTimer = setInterval(() => { if (typeof Utils !== 'undefined') { Utils.isNwjs = () => false; Utils.isLocal = () => false; clearInterval(forceModeTimer); } }, 50);
        setTimeout(() => clearInterval(forceModeTimer), 10000);
    }

    function applyPerformanceOptimizations() {
        const initTimer = setInterval(() => {
            if (typeof PIXI === 'undefined' || typeof ImageManager === 'undefined' || typeof SceneManager === 'undefined') return;
            if (ImageManager && ImageManager.cache) ImageManager.cache.limit = 20 * 1000 * 1000;
            if (PIXI.settings) PIXI.settings.GC_MODE = PIXI.GC_MODES.MANUAL; 
            if (!SceneManager.__gcPatched) {
                SceneManager.__gcPatched = true;
                const origChangeScene = SceneManager.changeScene;
                SceneManager.changeScene = function() {
                    origChangeScene.call(this);
                    if (Graphics && Graphics._renderer && Graphics._renderer.textureGC) Graphics._renderer.textureGC.run();
                };
            }
            document.addEventListener('visibilitychange', () => {
                if (typeof AudioManager === 'undefined') return;
                if (document.hidden && SceneManager._scene) SceneManager._scene.pause = true;
                else if (!document.hidden && SceneManager._scene) SceneManager._scene.pause = false;
            });
            clearInterval(initTimer);
        }, 200);
        setTimeout(() => clearInterval(initTimer), 10000);

        const patchTimer = setInterval(() => {
            if (typeof Tilemap !== 'undefined' && typeof Sprite_Character !== 'undefined') {
                const origTilemapUpdate = Tilemap.prototype.updateTransform;
                Tilemap.prototype.updateTransform = function() { this.x = Math.round(this.x); this.y = Math.round(this.y); origTilemapUpdate.call(this); };
                const origSpriteUpdate = Sprite_Character.prototype.updatePosition;
                Sprite_Character.prototype.updatePosition = function() { origSpriteUpdate.call(this); this.x = Math.round(this.x); this.y = Math.round(this.y); };
                clearInterval(patchTimer);
            }
        }, 200);
        setTimeout(() => clearInterval(patchTimer), 10000);

        const attachWebGLRecovery = () => {
            const canvas = document.getElementById('GameCanvas') || document.querySelector('canvas');
            if (!canvas) return;
            canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('🔴 [WebGL] Контекст потерян!'); }, false);
            canvas.addEventListener('webglcontextrestored', () => {
                console.warn('🟢 [WebGL] Контекст восстановлен!');
                try { if (typeof SceneManager !== 'undefined' && SceneManager._scene) SceneManager.goto(SceneManager._scene.constructor); } catch(err) {}
            }, false);
        };
        document.addEventListener('DOMContentLoaded', attachWebGLRecovery);
        window.addEventListener('load', attachWebGLRecovery);
        setTimeout(attachWebGLRecovery, 3000);
    }

    // ============================================================================
    // 4. СИСТЕМА ОБЛАЧНЫХ СОХРАНЕНИЙ
    // ============================================================================
    function setupCloudSaves() {
        const CLOUD_BASE = '/api/saves';
        const CLOUD_INIT_GRACE_MS = 1800;
        const CLOUD_RETRY_MAX = 3;

        const fastCoreTimer = setInterval(() => {
            if (typeof StorageManager !== 'undefined') StorageManager.isLocalMode = () => false;
            if (typeof DataManager !== 'undefined') { 
                if (!DataManager.setAutoSaveFileId) DataManager.setAutoSaveFileId = () => {}; 
                if (!DataManager.autoSaveFileId) DataManager.autoSaveFileId = () => 1; 
                clearInterval(fastCoreTimer);
            }
        }, 5);
        setTimeout(() => clearInterval(fastCoreTimer), 10000);

        function resolveGameId() { 
            const parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent); 
            return parts.length ? parts[0].replace(/[^a-zA-Z0-9._\-а-яА-Я]/g, '_') : 'unknown'; 
        }

        const gameId = resolveGameId(); 
        let pulledSaves = {}; 
        let cloudReady = false; 
        let cloudFetchFailed = false; 
        const cloudInitStartedAt = Date.now();

        const QUEUE_KEY = `_rpg_offline_queue_${gameId}`;
        function getQueue() { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '{}'); } catch(e) { return {}; } }
        function saveQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }

        const syncDiv = document.createElement('div');
        syncDiv.id = '_cloud_sync_ui';
        syncDiv.style.cssText = 'display:none; position:fixed; top:15px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.85); color:#fff; padding:6px 20px; border-radius:20px; z-index:2147483647; font-size:13px; font-family:sans-serif; font-weight:bold; border:1px solid rgba(255,255,255,0.2); pointer-events:none; box-shadow:0 4px 10px rgba(0,0,0,0.5); transition:background 0.3s;';
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
            for (let i = 0; i <= retries; i++) { 
                try { return await fetch(url, init); } 
                catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 250 * Math.pow(2, i))); } 
            }
            throw lastErr;
        }

        function normalizeCloudPayload(raw) {
            const out = {}; 
            if (!raw || typeof raw !== 'object') return out;
            for (const k of Object.keys(raw)) {
                const v = raw[k];
                out[k] = (v && typeof v === 'object' && 'value' in v) ? { value: String(v.value ?? ''), updatedAt: Number(v.updatedAt || 0) } : { value: String(v ?? ''), updatedAt: 0 };
            }
            return out;
        }

        function chooseNewer(a, b) { if (!a) return b; if (!b) return a; return (b.updatedAt || 0) >= (a.updatedAt || 0) ? b : a; }
        function getEntry(key) { return pulledSaves[key]; } 
        function hasEntry(key) { return pulledSaves[key] !== undefined; }

        async function processOfflineQueue() {
            if (!navigator.onLine) return;
            const q = getQueue();
            const keys = Object.keys(q);
            if (keys.length === 0) return;

            showSync(true);
            let allOk = true;

            for (const key of keys) {
                try {
                    const res = await retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}/${encodeURIComponent(key)}`, { 
                        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q[key]) 
                    });
                    if (res.ok) delete q[key]; else allOk = false;
                } catch(e) { allOk = false; }
            }
            saveQueue(q);
            showSync(false, allOk ? 'ok' : 'error');
        }

        window.addEventListener('online', processOfflineQueue);

        async function fetchCloudSaves() {
            try {
                const res = await retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}?_t=${Date.now()}`, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
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
                const localQueue = getQueue();
                for (const k of Object.keys(localQueue)) pulledSaves[k] = chooseNewer(pulledSaves[k], localQueue[k]);
            }
        }

        function uploadToCloud(key, value) {
            const payload = { value: String(value), updatedAt: Date.now() };
            pulledSaves[key] = chooseNewer(pulledSaves[key], payload); 
            const q = getQueue(); q[key] = payload; saveQueue(q);
            showSync(true);
            if (!navigator.onLine) { showSync(false, 'offline'); return; }

            retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}/${encodeURIComponent(key)}`, { 
                method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) 
            }).then(r => {
                if (r.ok) { const qNew = getQueue(); delete qNew[key]; saveQueue(qNew); showSync(false, 'ok'); } else showSync(false, 'error');
            }).catch(() => showSync(false, 'offline'));
        }

        function deleteFromCloud(key) {
            delete pulledSaves[key]; 
            const q = getQueue(); delete q[key]; saveQueue(q);
            showSync(true);
            if (!navigator.onLine) { showSync(false, 'offline'); return; }

            retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}/${encodeURIComponent(key)}`, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' })
                .then(r => showSync(false, r.ok ? 'ok' : 'error')).catch(() => showSync(false, 'offline'));
        }

        function canOptimisticallyShowExists(localExists) {
            if (cloudReady) return false;
            return ((Date.now() - cloudInitStartedAt) <= CLOUD_INIT_GRACE_MS) ? true : !!localExists;
        }

        function injectMZEngine() {
            const _saveToForage = StorageManager.saveToForage; 
            StorageManager.saveToForage = function(saveName, zip) { uploadToCloud(`MZ_${saveName}`, zip); return _saveToForage.apply(this, arguments); };
            const _loadFromForage = StorageManager.loadFromForage; 
            StorageManager.loadFromForage = function(saveName) { const key = `MZ_${saveName}`; if (cloudReady && hasEntry(key)) return Promise.resolve(getEntry(key).value); return _loadFromForage.apply(this, arguments); };
            const _removeForage = StorageManager.removeForage; 
            StorageManager.removeForage = function(saveName) { deleteFromCloud(`MZ_${saveName}`); return _removeForage.apply(this, arguments); };
            const _forageExists = StorageManager.forageExists; 
            StorageManager.forageExists = function(saveName) { const local = _forageExists.apply(this, arguments); if (!cloudReady) return canOptimisticallyShowExists(local); return hasEntry(`MZ_${saveName}`) || local; };
        }

        function injectMVEngine() {
            const _loadFromWebStorage = StorageManager.loadFromWebStorage; 
            StorageManager.loadFromWebStorage = function(saveFileId) { 
                const key = this.webStorageKey(saveFileId); 
                if (cloudReady && hasEntry(key)) {
                    let val = getEntry(key).value;
                    if (val && typeof val === 'string' && !val.trim().startsWith('{') && !val.trim().startsWith('[')) {
                        try { if (typeof LZString !== 'undefined') { const decompressed = LZString.decompressFromBase64(val); if (decompressed) val = decompressed; } } catch(e) {}
                    }
                    return val;
                }
                return _loadFromWebStorage.apply(this, arguments); 
            };
            if (StorageManager.webStorageExists) { 
                const _webStorageExists = StorageManager.webStorageExists; 
                StorageManager.webStorageExists = function(saveFileId) { const local = _webStorageExists.apply(this, arguments); if (!cloudReady) return canOptimisticallyShowExists(local); return hasEntry(this.webStorageKey(saveFileId)) || local; }; 
            }
            const _saveToWebStorage = StorageManager.saveToWebStorage; 
            StorageManager.saveToWebStorage = function(saveFileId, json) { uploadToCloud(this.webStorageKey(saveFileId), json); return _saveToWebStorage.apply(this, arguments); };
            const _removeWebStorage = StorageManager.removeWebStorage; 
            StorageManager.removeWebStorage = function(saveFileId) { deleteFromCloud(this.webStorageKey(saveFileId)); return _removeWebStorage.apply(this, arguments); };
        }

        fetchCloudSaves();
        const hookTimer = setInterval(() => {
            if (typeof StorageManager === 'undefined') return;
            if (StorageManager.saveToForage) { clearInterval(hookTimer); injectMZEngine(); } 
            else if (StorageManager.saveToWebStorage) { clearInterval(hookTimer); injectMVEngine(); }
        }, 100);
        setTimeout(() => clearInterval(hookTimer), 15000);
        window.addEventListener('pageshow', () => { if (cloudFetchFailed) fetchCloudSaves(); });
    }

    // ============================================================================
    // 5. ИНТЕРФЕЙС, ЭКРАННЫЕ КНОПКИ И ГЕЙМПАД
    // ============================================================================
    function setupUIAndGamepad() {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.getElementById('_sys_menu_container')) return;
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || isIOS;
            
            const style = document.createElement('style');
            style.textContent = `
                #_sys_menu_container { position: fixed; top: max(16px, env(safe-area-inset-top)); right: max(16px, env(safe-area-inset-right)); z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; touch-action: none; -webkit-touch-callout: none; -webkit-user-select: none; }
                #_sys_btn { width: 44px; height: 44px; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.25); border-radius: 50%; display: flex; justify-content: center; align-items: center; font-size: 24px; color: white; cursor: pointer; transition: background 0.2s; }
                #_sys_btn:active { background: rgba(255,255,255,0.2); }
                #_sys_panel { display: none; background: rgba(0,0,0,0.85); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; margin-top: 8px; padding: 6px; flex-direction: column; gap: 4px; box-shadow: 0 8px 16px rgba(0,0,0,0.5); backdrop-filter: blur(4px); }
                #_sys_panel._open { display: flex; }
                ._sys_item { padding: 12px 16px; color: #fff; font-family: sans-serif; font-size: 14px; font-weight: 600; background: rgba(255,255,255,0.05); border-radius: 8px; white-space: nowrap; transition: background 0.2s; display: flex; align-items: center; gap: 8px; }
                ._sys_item:active { background: rgba(255,255,255,0.2); }
                ._sys_item._active { background: rgba(200, 150, 40, 0.4); border: 1px solid rgba(200, 150, 40, 0.8); }

                #_layout_toggle { position: fixed; top: max(16px, env(safe-area-inset-top)); left: max(16px, env(safe-area-inset-left)); z-index: 2147483647; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; color: white; padding: 8px 12px; font-family: sans-serif; font-size: 14px; font-weight: bold; cursor: pointer; touch-action: none; user-select: none; transition: background 0.2s; }
                #_layout_toggle:active { background: rgba(255,255,255,0.2); }

                #_mob_ctrl { position:fixed; bottom:0; left:0; right:0; z-index:2147483646; pointer-events:none; padding:16px; height:220px; touch-action:none; -webkit-touch-callout:none; -webkit-user-select:none; user-select:none; }
                #_dpad { position:absolute; bottom:20px; left:20px; width:190px; height:190px; pointer-events:auto; touch-action:none; }
                #_d_center { position:absolute; top:75px; left:75px; width:40px; height:40px; background:rgba(255,255,255,0.05); border-radius:50%; pointer-events:none; }
                ._dpad_btn { position:absolute; width:58px; height:58px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.3); border-radius:10px; display:flex; align-items:center; justify-content:center; }
                ._dpad_btn._on { background:rgba(255,255,255,0.6); }
                ._dpad_btn svg { width:24px; fill:rgba(255,255,255,0.95); pointer-events:none; }
                #_d_up { top:0; left:66px; } #_d_down { bottom:0; left:66px; } #_d_left { top:66px; left:0; } #_d_right { top:66px; right:0; }
                #_act_btns { position:absolute; bottom:20px; right:20px; display:grid; grid-template-columns:1fr 1fr; gap:12px; pointer-events:auto; touch-action:none; }
                ._act_btn { width:70px; height:70px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:700; color:#fff; border:1.5px solid rgba(255,255,255,0.3); }
                ._act_btn._on { filter:brightness(1.5); }
                #_a_ok { background:rgba(40,160,40,0.6); } #_a_esc { background:rgba(200,40,40,0.6); }
                #_a_menu { background:rgba(40,100,200,0.6); } #_a_shift { background:rgba(180,140,20,0.6); }
                
                @media (pointer: fine) { 
                    #_mob_ctrl, #_layout_toggle, #_touch_mode_item { display: none !important; } 
                }
            `;
            document.head.appendChild(style);

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

            const layoutToggleHtml = isMobile ? `<div id="_layout_toggle">🔄 Раскладка: Стандарт</div>` : '';

            const ui = document.createElement('div');
            ui.innerHTML = layoutToggleHtml + sysMenuHtml + (isMobile ? mobCtrlHtml : '');
            document.body.appendChild(ui);

            // Обработчики меню
            const sysBtn = document.getElementById('_sys_btn');
            const sysPanel = document.getElementById('_sys_panel');

            sysBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); sysPanel.classList.toggle('_open'); }, { passive: false });
            document.getElementById('_sys_home').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); window.location.href = '/'; }, { passive: false });
            document.getElementById('_sys_stretch').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); window.__toggleRpgStretch(); sysPanel.classList.remove('_open'); }, { passive: false });

            if (!isIOS) {
                document.getElementById('_sys_fs')?.addEventListener('pointerdown', (e) => {
                    e.preventDefault(); e.stopPropagation(); sysPanel.classList.remove('_open');
                    const el = document.documentElement;
                    (!document.fullscreenElement) ? (el.requestFullscreen || el.webkitRequestFullscreen).call(el).catch(()=>{}) : (document.exitFullscreen || document.webkitExitFullscreen).call(document);
                }, { passive: false });
            }

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
                                    for (let i = 0; i < 2; i++) { 
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

            document.addEventListener('pointerdown', (e) => {
                if (!sysPanel.contains(e.target) && e.target !== sysBtn) sysPanel.classList.remove('_open');
            });
            document.addEventListener('contextmenu', e => {
                if (e.target.closest('#_mob_ctrl') || e.target.closest('#_sys_menu_container')) e.preventDefault();
            });
            
            if (isMobile) {
                document.getElementById('_mob_ctrl').addEventListener('pointerdown', e => e.stopPropagation(), { passive: false });
                ['touchstart', 'touchmove', 'touchend', 'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup'].forEach(ev => {
                    document.getElementById('_mob_ctrl').addEventListener(ev, e => e.stopPropagation(), { passive: false });
                });
            }

            // Динамические раскладки кнопок
            let currentLayout = 0;
            const layouts = [
                {
                    name: 'Стандарт',
                    keys: {
                        _a_ok: { kn: 'ok', kc: 32, key: ' ', code: 'Space', label: 'OK' },
                        _a_esc: { kn: 'escape', kc: 27, key: 'Escape', code: 'Escape', label: 'ESC' },
                        _a_menu: { kn: 'control', kc: 17, key: 'Control', code: 'ControlLeft', label: 'MENU' },
                        _a_shift: { kn: 'shift', kc: 16, key: 'Shift', code: 'ShiftLeft', label: 'SHIFT' }
                    }
                },
                {
                    name: 'Z/X/Q/W',
                    keys: {
                        _a_ok: { kn: 'ok', kc: 90, key: 'z', code: 'KeyZ', label: 'Z' },
                        _a_esc: { kn: 'escape', kc: 88, key: 'x', code: 'KeyX', label: 'X' },
                        _a_menu: { kn: 'pageup', kc: 81, key: 'q', code: 'KeyQ', label: 'Q' },
                        _a_shift: { kn: 'pagedown', kc: 87, key: 'w', code: 'KeyW', label: 'W' }
                    }
                }
            ];

            const updateLabels = () => {
                if (!isMobile) return;
                document.getElementById('_a_ok').innerText = layouts[currentLayout].keys._a_ok.label;
                document.getElementById('_a_esc').innerText = layouts[currentLayout].keys._a_esc.label;
                document.getElementById('_a_menu').innerText = layouts[currentLayout].keys._a_menu.label;
                document.getElementById('_a_shift').innerText = layouts[currentLayout].keys._a_shift.label;
                document.getElementById('_layout_toggle').innerText = `🔄 Раскладка: ${layouts[currentLayout].name}`;
            };

            if (isMobile) {
                document.getElementById('_layout_toggle').addEventListener('pointerdown', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    currentLayout = currentLayout === 0 ? 1 : 0;
                    updateLabels();
                }, { passive: false });
            }

            updateLabels();

            const dpadMap = { 
                _d_up: {kn:'up',kc:38,key:'ArrowUp'}, 
                _d_down: {kn:'down',kc:40,key:'ArrowDown'}, 
                _d_left: {kn:'left',kc:37,key:'ArrowLeft'}, 
                _d_right: {kn:'right',kc:39,key:'ArrowRight'} 
            };

            const triggerKey = (id, isDown) => {
                const type = isDown ? 'keydown' : 'keyup';
                let config;
                if (id.startsWith('_d_')) {
                    config = dpadMap[id];
                    config.code = config.key;
                } else {
                    config = layouts[currentLayout].keys[id];
                }
                if (!config) return;

                if (typeof Input !== 'undefined') {
                    if (Input._currentState) Input._currentState[config.kn] = isDown;
                    if (Input.currentState)  Input.currentState[config.kn]  = isDown;
                }

                const ev = new KeyboardEvent(type, { bubbles: true, cancelable: true, key: config.key, code: config.code, keyCode: config.kc, which: config.kc });
                Object.defineProperty(ev, 'keyCode', { get: () => config.kc });
                Object.defineProperty(ev, 'which', { get: () => config.kc });
                document.dispatchEvent(ev);
            };

            const allBtnIds = ['_d_up', '_d_down', '_d_left', '_d_right', '_a_ok', '_a_esc', '_a_menu', '_a_shift'];

            allBtnIds.forEach(id => {
                const el = document.getElementById(id);
                if (!el) return;
                const press = e => { e.preventDefault(); e.stopPropagation(); if (el.dataset.active) return; el.dataset.active = "true"; el.classList.add('_on'); triggerKey(id, true); };
                const release = e => { e.preventDefault(); e.stopPropagation(); if (!el.dataset.active) return; el.dataset.active = ""; el.classList.remove('_on'); triggerKey(id, false); };

                el.addEventListener('touchstart', press, { passive: false });
                el.addEventListener('touchend', release, { passive: false });
                el.addEventListener('touchcancel', release, { passive: false });
                el.addEventListener('pointerdown', press);
                el.addEventListener('pointerup', release);
                el.addEventListener('pointercancel', release);
            });
        });
    }

    // --- 6. ДИАГНОСТИКА, ТАЧ-РЕЖИМ, МОНИТОРЫ ---
    function setupFpsMonitor() {
        const showByDefault = location.search.includes('fps') || location.search.includes('dev');
        window.__fpsMonitorVisible = showByDefault;
        
        const monitor = document.createElement('div');
        monitor.id = '_fps_monitor';
        monitor.style.cssText = `display: ${showByDefault ? 'block' : 'none'}; position: fixed; top: max(64px, env(safe-area-inset-top) + 48px); right: max(16px, env(safe-area-inset-right)); z-index: 2147483647; background: rgba(0,0,0,0.75); color: #0f0; font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.5; padding: 8px 10px; border-radius: 8px; min-width: 130px; pointer-events: none; border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(4px);`;
        document.body.appendChild(monitor);

        window.__toggleFpsMonitor = function() {
            window.__fpsMonitorVisible = !window.__fpsMonitorVisible;
            monitor.style.display = window.__fpsMonitorVisible ? 'block' : 'none';
        };

        const menuTimer = setInterval(() => {
            const panel = document.getElementById('_sys_panel');
            if (!panel) return;
            clearInterval(menuTimer);
            const btn = document.createElement('div');
            btn.className = '_sys_item';
            btn.innerHTML = '📊 FPS Монитор';
            panel.appendChild(btn);
            btn.addEventListener('pointerdown', (e) => {
                e.preventDefault(); e.stopPropagation();
                window.__toggleFpsMonitor();
                btn.classList.toggle('_active', window.__fpsMonitorVisible);
                document.getElementById('_sys_panel').classList.remove('_open');
            }, { passive: false });
        }, 300);

        const HISTORY = 60;
        const fpsHistory = new Array(HISTORY).fill(60);
        let frameTimes = [], lastFrame = performance.now(), frameCount = 0, lastFpsUpdate = performance.now();
        let lagSpikes = 0;

        function sparkline(data) {
            const bars = ['▁','▂','▃','▄','▅','▆','▇','█'];
            const min = Math.min(...data), max = Math.max(...data) || 1;
            return data.slice(-20).map(v => bars[Math.max(0, Math.min(Math.round(((v - min) / (max - min)) * (bars.length - 1)), bars.length - 1))]).join('');
        }

        function getColor(fps) { return fps >= 55 ? '#0f0' : fps >= 40 ? '#ff0' : fps >= 25 ? '#f80' : '#f00'; }

        function tick() {
            const now = performance.now(), frameTime = now - lastFrame;
            lastFrame = now;
            frameCount++; frameTimes.push(frameTime);
            
            if (frameTimes.length > HISTORY) frameTimes.shift();
            if (frameTime > 50) lagSpikes++;

            if (now - lastFpsUpdate >= 500) {
                const currentFps = Math.round(frameCount / ((now - lastFpsUpdate) / 1000));
                frameCount = 0; lastFpsUpdate = now;
                
                fpsHistory.push(currentFps);
                if (fpsHistory.length > HISTORY) fpsHistory.shift();

                if (window.__fpsMonitorVisible) {
                    const avgFps = Math.round(fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length);
                    const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
                    const color = getColor(currentFps);
                    monitor.innerHTML = `
                        <span style="color:${color};font-size:16px;font-weight:bold">${currentFps} FPS</span><br>
                        <span style="color:#aaa">кадр: ${avgFrameTime.toFixed(1)}ms</span><br>
                        <span style="color:#888">min:${Math.min(...fpsHistory)} avg:${avgFps} max:${Math.max(...fpsHistory)}</span><br>
                        <span style="color:#f44;font-size:10px">спайки: ${lagSpikes}</span><br>
                        <span style="color:${color};letter-spacing:0;font-size:10px">${sparkline(fpsHistory)}</span>
                    `;
                }
            }
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function setupSpikeDiagnostics() {
        const SPIKE_THRESHOLD_MS = 40; 
        const MAX_LOG = 30;            
        const log = [];
        let lastFrameTime = performance.now();
        let sessionStart = performance.now();
        window.__spikeLog = log;

        const panel = document.createElement('div');
        panel.style.cssText = `display: none; position: fixed; bottom: 10px; left: 10px; right: 10px; max-height: 45vh; background: rgba(0,0,0,0.92); border: 1px solid rgba(255,100,0,0.4); border-radius: 10px; z-index: 2147483647; font-family: 'Courier New', monospace; font-size: 10px; color: #ddd; overflow-y: auto; -webkit-overflow-scrolling: touch; pointer-events: auto;`;
        panel.innerHTML = `<div style="position:sticky;top:0;background:rgba(0,0,0,0.95);padding:6px 10px;border-bottom:1px solid rgba(255,100,0,0.3);display:flex;justify-content:space-between;align-items:center;"><span style="color:#f80;font-weight:bold">⚡ Spike Log</span><span id="_spike_count" style="color:#f44">0 спайков</span><button id="_spike_clear" style="background:rgba(255,80,0,0.3);border:1px solid rgba(255,80,0,0.5);border-radius:4px;color:#fff;padding:2px 8px;font-size:10px;">Очистить</button></div><div id="_spike_log_body" style="padding:6px 10px;"></div>`;
        document.body.appendChild(panel);

        document.getElementById('_spike_clear')?.addEventListener('pointerdown', (e) => {
            e.stopPropagation(); log.length = 0;
            document.getElementById('_spike_log_body').innerHTML = '<span style="color:#666">— Лог очищен —</span>';
            document.getElementById('_spike_count').textContent = '0 спайков';
        });

        const menuTimer = setInterval(() => {
            const sysPanel = document.getElementById('_sys_panel');
            if (!sysPanel) return;
            clearInterval(menuTimer);
            const btn = document.createElement('div');
            btn.className = '_sys_item';
            btn.textContent = '🔍 Spike Log';
            sysPanel.appendChild(btn);
            btn.addEventListener('pointerdown', (e) => {
                e.preventDefault(); e.stopPropagation();
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
                sysPanel.classList.remove('_open');
            }, { passive: false });
        }, 500);

        function getGameState(frameMs) {
            const state = { ms: frameMs.toFixed(1), t: ((performance.now() - sessionStart) / 1000).toFixed(1) };
            try {
                const sm = window.SceneManager;
                if (!sm) return state;
                state.scene = sm._scene?.constructor?.name || '?';
                if (window.$gameMap) {
                    state.map = $gameMap._mapId || 0;
                    const events = $gameMap._events?.filter(Boolean) || [];
                    state.events = events.length;
                    state.parallelEvents = events.filter(e => e?._trigger === 4 && e?._interpreter?.isRunning?.()).length;
                    state.runningEvents = events.filter(e => e?._interpreter?.isRunning?.()).length;
                }
                if (window.$gameMessage) state.msg = $gameMessage.isBusy() ? 'ДА' : 'нет';
                if (window.$gameScreen) state.pics = ($gameScreen._pictures?.filter(Boolean) || []).length;
                if (window.PIXI?.utils?.TextureCache) state.textures = Object.keys(PIXI.utils.TextureCache).length;
                if (window.FilterController !== undefined) state.fc = FilterController.enabledAll ? 'ON' : 'off';
            } catch(e) {}
            return state;
        }

        function detectLoop() {
            const now = performance.now();
            const delta = now - lastFrameTime;
            lastFrameTime = now;

            if (delta > SPIKE_THRESHOLD_MS) {
                log.unshift(getGameState(delta));
                if (log.length > MAX_LOG) log.pop();
                if (panel.style.display !== 'none') {
                    const body = document.getElementById('_spike_log_body');
                    if (body) body.innerHTML = log.map((s, i) => `<div style="border-bottom:1px solid rgba(255,255,255,0.05);padding:3px 0"><span style="color:#666">#${i+1} +${s.t}s</span><span style="color:${s.ms > 80 ? '#f44' : s.ms > 60 ? '#f80' : '#ff0'};font-weight:bold"> ${s.ms}ms</span><span style="color:#aaa"> ${s.scene || '?'}</span> ${s.parallelEvents > 0 ? `<span style="color:#f44"> ⚠️ parallel:${s.parallelEvents}</span>` : ''} ${s.textures > 200 ? `<span style="color:#f44"> tex:${s.textures}⚠️</span>` : (s.textures ? ` tex:${s.textures}` : '')}</div>`).join('');
                }
                const countEl = document.getElementById('_spike_count');
                if (countEl) countEl.textContent = `${log.length} спайков`;
            }
            requestAnimationFrame(detectLoop);
        }
        requestAnimationFrame(detectLoop);
    }

    function setupTouchModeToggle() {
        const _isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
            (/iPad|iPhone|iPod/.test(navigator.userAgent)) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (!_isMobile) return; 

        window.__rpgTouchEnabled = false; 

        const interceptor = (e) => {
            if (window.__rpgTouchEnabled) return; 
            if (e.target && e.target.closest && (
                e.target.closest('#_sys_menu_container') || 
                e.target.closest('#_mob_ctrl') || 
                e.target.closest('#_fps_monitor') || 
                e.target.closest('#_spike_panel') ||
                e.target.closest('#_layout_toggle') 
            )) return;
            e.stopPropagation();
            e.stopImmediatePropagation();
        };

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
            document.getElementById('_sys_panel')?.classList.remove('_open');
        };

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
                    item.addEventListener('pointerdown', (e) => { e.stopPropagation(); window.__toggleRpgTouchMode(); });
                }
            }, 150);
        });
    }

    function injectEmeraldCheatMenu() {
        const waitTimer = setInterval(() => {
            if (typeof DataManager !== 'undefined' && typeof SceneManager !== 'undefined') {
                clearInterval(waitTimer);
                const script = document.createElement('script');
                script.src = '/Cheat_Menu.js';
                document.body.appendChild(script);

                const cssLink = document.createElement('link');
                cssLink.rel = 'stylesheet';
                cssLink.href = '/Cheat_Menu.css';
                document.head.appendChild(cssLink);
            }
        }, 100);
        
        const initObserver = setInterval(() => {
            const sysPanel = document.getElementById('_sys_panel');
            if (!sysPanel) return; 
            clearInterval(initObserver);

            if (document.getElementById('_sys_cheat_mod')) return; 

            const cheatBtn = document.createElement('div');
            cheatBtn.id = '_sys_cheat_mod';
            cheatBtn.className = '_sys_item';
            cheatBtn.innerHTML = '💉 Открыть Чит-Меню';
            sysPanel.appendChild(cheatBtn);
            
            cheatBtn.addEventListener('pointerdown', (e) => {
                e.preventDefault(); e.stopPropagation();
                if (window.Cheat_Menu) {
                    window.Cheat_Menu.overlay_openable = true;
                    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, keyCode: 49, which: 49, key: '1' }));
                } else {
                    console.warn('[RPG Fixes] Плагин читов еще не загрузился в память.');
                }
                sysPanel.classList.remove('_open');
            }, { passive: false });
        }, 300);
    }

    // ============================================================================
    // 7. СВЕРХНАДЕЖНОЕ АУДИО (ЧИСТЫЙ ДВИЖОК + M4A)
    // ============================================================================
    function setupSecureAudio() {
        // 1) Безопасный перехват ошибок
        if (typeof AudioManager !== 'undefined' && !AudioManager.__PatchedCheck) {
            AudioManager.__PatchedCheck = true; 
            const orig = AudioManager.checkErrors; 
            AudioManager.checkErrors = function () { try { if (orig) orig.apply(this, arguments); } catch (e) {} };
        }
        if (typeof WebAudio !== 'undefined' && WebAudio.prototype && !WebAudio.prototype.__PatchedErr) {
            WebAudio.prototype.__PatchedErr = true; 
            const origErr = WebAudio.prototype._onError; 
            WebAudio.prototype._onError = function () { try { if (origErr) origErr.apply(this, arguments); } catch(e) {} };
        }

        const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        // 2) Умный декриптер - пропускаем чистый M4A от сервера
        const decTimer = setInterval(() => {
            if (typeof Decrypter !== 'undefined' && !Decrypter.__smartPatched) {
                Decrypter.__smartPatched = true;
                const _decrypt = Decrypter.decryptArrayBuffer;
                Decrypter.decryptArrayBuffer = function(arrayBuffer, ...rest) {
                    try {
                        if (!arrayBuffer || arrayBuffer.byteLength < 4) return arrayBuffer;
                        const header = new Uint8Array(arrayBuffer, 0, 4);
                        if (header[0] !== 0x52 || header[1] !== 0x50 || header[2] !== 0x47 || header[3] !== 0x4D) return arrayBuffer;
                    } catch (e) {}
                    return _decrypt.call(this, arrayBuffer, ...rest);
                };
                clearInterval(decTimer);
            }
        }, 50);

        // 3) Принудительно включаем M4A, для iOS строго запрещаем OGG
        // Это полностью убирает зависание сервера (FFMPEG), так как iOS скачает родной формат.
        const formatTimer = setInterval(() => {
            if (typeof WebAudio !== 'undefined' && typeof AudioManager !== 'undefined') {
                WebAudio.canPlayM4a = function() { return true; };
                if (isIOS) {
                    WebAudio.canPlayOgg = function() { return false; };
                    AudioManager.audioFileExt = function() { return '.m4a'; };
                }
                clearInterval(formatTimer);
            }
        }, 50);

        if (isIOS) {
            // 4) Мягкое затухание на уровне движка (Без хака ядра браузера)
            const iosFadeTimer = setInterval(() => {
                if (typeof WebAudio !== 'undefined' && WebAudio.prototype && !WebAudio.prototype.__iosSafeFade) {
                    WebAudio.prototype.__iosSafeFade = true;
                    
                    // Safari зависает, если звук падает в абсолютный ноль. Используем безопасные 0.01
                    WebAudio.prototype.fadeIn = function(duration) {
                        if (this._gainNode && this._gainNode.gain) {
                            const gain = this._gainNode.gain;
                            const ct = WebAudio._context.currentTime;
                            gain.cancelScheduledValues(ct);
                            gain.setValueAtTime(0.01, ct);
                            gain.linearRampToValueAtTime(this._volume, ct + duration);
                            this._autoPlay = true;
                        }
                    };
                    WebAudio.prototype.fadeOut = function(duration) {
                        if (this._gainNode && this._gainNode.gain) {
                            const gain = this._gainNode.gain;
                            const ct = WebAudio._context.currentTime;
                            gain.cancelScheduledValues(ct);
                            gain.setValueAtTime(gain.value, ct);
                            gain.linearRampToValueAtTime(0.01, ct + duration);
                        }
                    };
                    clearInterval(iosFadeTimer);
                }
            }, 50);

            // 5) Нейтрализуем пилу 60FPS от AudioSource.js
            const asTimer = setInterval(() => {
                if (typeof AudioManager !== 'undefined' && AudioManager.updateSeParameters && !AudioManager.__asPatched) {
                    AudioManager.__asPatched = true;
                    const _update = AudioManager.updateSeParameters;
                    AudioManager.updateSeParameters = function(buffer, se) {
                        if (buffer && buffer._gainNode && buffer._gainNode.gain) {
                            buffer._gainNode.gain.value = buffer.volume || 1.0;
                            return;
                        }
                        return _update.call(this, buffer, se);
                    };
                    clearInterval(asTimer);
                }
            }, 50);
        }

        // 6) Надежный Unlock (Снятие блокировки звука на смартфонах)
        let _audioUnlocked = false;
        function unlock() {
            if (_audioUnlocked || typeof WebAudio === 'undefined' || !WebAudio._context) return;
            try {
                const ctx = WebAudio._context;
                if (ctx.state !== "suspended" && ctx.state !== "interrupted") {
                    _audioUnlocked = true;
                    return;
                }
                ctx.resume().then(() => {
                    const buffer = ctx.createBuffer(1, 1, 22050);
                    const src = ctx.createBufferSource();
                    src.buffer = buffer;
                    src.connect(ctx.destination);
                    src.start(0);
                    _audioUnlocked = true;
                    window.removeEventListener("touchstart", unlock, true);
                    window.removeEventListener("click", unlock, true);
                }).catch(() => {});
            } catch (e) {}
        }
        window.addEventListener("touchstart", unlock, { passive: true, capture: true });
        window.addEventListener("click", unlock, { passive: true, capture: true });
        
        // 7) Автоплей-политика HTML5 (убираем ошибки в логах)
        if (typeof HTMLAudioElement !== 'undefined' && !HTMLAudioElement.prototype.__SafePlayPatched) {
            HTMLAudioElement.prototype.__SafePlayPatched = true;
            const origPlay = HTMLAudioElement.prototype.play;
            HTMLAudioElement.prototype.play = function () {
                try {
                    const p = origPlay.call(this);
                    if (p && typeof p.catch === 'function') p.catch(() => {});
                    return p;
                } catch (e) {}
            };
        }
    }

    // ============================================================================
    // 8. ГЛОБАЛЬНЫЙ ЩИТ И ФИКСЫ ПЛАГИНОВ (MV/MZ)
    // ============================================================================
    function setupGlobalCrashProtection() {
        const coreTimer = setInterval(() => {
            if (typeof SceneManager !== 'undefined') {
                clearInterval(coreTimer);
                if (!SceneManager.__gacePatched) {
                    SceneManager.__gacePatched = true;
                    const origCatchException = SceneManager.catchException;
                    SceneManager.catchException = function(e) {
                        if (e instanceof Error) {
                            console.warn(`🛡️ [GACE] Ошибка перехвачена:`, e.message);
                            if (typeof SoundManager !== 'undefined') SoundManager.playBuzzer();
                            return; 
                        }
                        origCatchException.call(this, e);
                    };
                }
            }
        }, 100);

        // ВОССТАНОВЛЕНО: Безопасный патч для SceneGlossary.js
        const pluginTimer = setInterval(() => {
            if (typeof Game_Party !== 'undefined' && Game_Party.prototype.getAllGlossaryCategory && !Game_Party.prototype.__gaceGlossaryPatched) {
                Game_Party.prototype.__gaceGlossaryPatched = true;
                const origGlossaryCat = Game_Party.prototype.getAllGlossaryCategory;
                Game_Party.prototype.getAllGlossaryCategory = function() {
                    try {
                        const categories = origGlossaryCat.apply(this, arguments);
                        return categories ? categories.filter(Boolean) : [];
                    } catch (e) { return ['Все']; }
                };
                clearInterval(pluginTimer);
                console.log('✅ [GACE] Асинхронный патч для SceneGlossary.js успешно применен!');
            }
        }, 500);

        setTimeout(() => clearInterval(pluginTimer), 15000);
    }

    // ВОССТАНОВЛЕНО: Отдельный и надежный анти-спам фильтр
    function setupNetworkAntiSpam() {
        const patchTimer = setInterval(() => {
            if (typeof ImageManager !== 'undefined' && !ImageManager.__spamHooked) {
                ImageManager.__spamHooked = true;
                const origLoadBitmap = ImageManager.loadBitmap;
                
                // Перехватываем только запросы картинок с названиями null/undefined
                ImageManager.loadBitmap = function(folder, filename) {
                    if (filename && (String(filename).toLowerCase().includes('null') || String(filename).toLowerCase().includes('undefined'))) {
                        if (!this.__dummyBitmap) this.__dummyBitmap = typeof Bitmap !== 'undefined' ? new Bitmap(1, 1) : {};
                        return this.__dummyBitmap;
                    }
                    return origLoadBitmap.apply(this, arguments);
                };

                clearInterval(patchTimer);
            }
        }, 100);
        setTimeout(() => clearInterval(patchTimer), 10000);
    }

    // ============================================================================
    // ИНИЦИАЛИЗАЦИЯ
    // ============================================================================

    function initUltimateFixes() {
        applyConsoleFixes();
        applyCoreEnginePatches();
        setupBrowserStubs();
        fixDevicePixelRatio();
        setupModernViewport();
        applyPerformanceOptimizations();
        setupSecureAudio(); 
        setupCloudSaves();
        setupUIAndGamepad();
        setupFpsMonitor();
        setupSpikeDiagnostics();
        setupTouchModeToggle();
        injectEmeraldCheatMenu();
        
        // Наши восстановленные функции
        setupGlobalCrashProtection();
        setupNetworkAntiSpam();
        
        console.log('✅ RPG-Fixes Ultimate v4.1 успешно загружен!');
    }

    initUltimateFixes();

})();