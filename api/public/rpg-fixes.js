// ============================================================================
// 1. АБСОЛЮТНАЯ ИМИТАЦИЯ ANDROID И СИСТЕМНЫХ API (УБИЙЦА ОШИБОК)
// ============================================================================
window.process = window.process || {};
window.process.platform = window.process.platform || 'browser';
window.process.cwd = function() { return '/'; };

// ============================================================================
// --- ВЗЛОМЩИК STEAM  И АЧИВОК ---
// ============================================================================
window.CycloneSteam = {
    isSteamRunning: true,
    active: true,
    isSubscribedApp: function(appId) { 
        return true; // <-- Вот эта строчка ломает антипиратскую защиту
    },
    registerAchievement: function(){},
    getAchievement: function(){ return false; },
    setAchievement: function(){},
    clearAchievement: function(){}
};
window.Greenworks = { initAPI: function(){ return true; } };

// ВОТ ЭТА СТРОЧКА СПАСЕТ ОТ КРАША process.argv[0]
window.process.argv = window.process.argv || ['/']; 

const mockPath = window.location.pathname || '/';
window.process.mainModule = { 
    filename: mockPath.endsWith('index.html') ? mockPath : mockPath + 'index.html' 
};
window.process.versions = window.process.versions || {};

// Бронежилет для process.env
let _env = { USER: 'Player' };
Object.defineProperty(window.process, 'env', {
    get: function() { return _env; },
    set: function(val) { _env = Object.assign(_env, val || {}); _env.USER = 'Player'; },
    configurable: true
});

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
// 0b. ADV_System stub — до загрузки TS_ADVsystem.js
// TS_ADVsystem.js строка 9: if(ADV_System == null) — без typeof!
// ============================================================================
if (typeof ADV_System === 'undefined') {
    window.ADV_System = null;
}



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
                    // Список вредных и дев-плагинов, которые нужно заблокировать
                    var blockedPlugins = [
                        'auramz/mobile', 'toggle_save_dir', 'elimz_mobilecontrols', 
                        'cyclone-steam', 'drs_alldataextractor', 'ge_devonlymessageskipkey'
                    ];
                    
                    if (blockedPlugins.some(function(p) { return lowerVal.indexOf(p) > -1; })) {
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

    // Надписи меню и кнопок — на языке, выбранном в библиотеке. Библиотека хранит его
    // в localStorage (rpg_lang), а игры в проде открываются с того же адреса, так что
    // выбор виден и здесь. В dev игры живут на другом порту со своим localStorage —
    // туда язык приходит в адресе: ?lang=en
    const UI_TEXT = {
        ru: {
            settings: 'Настройки', home: 'В библиотеку', turbo: 'Турбо ×3', cheats: 'Чит-меню',
            stretch: 'Растянуть экран', smooth: 'Сглаживание', fullscreen: 'На весь экран',
            keys_zx: 'Кнопки A и B как Z и X', touch: 'Касания по игре',
            fps: 'Счётчик кадров', spikes: 'Журнал подтормаживаний',
            stick: 'Джойстик', prev: 'Предыдущий (Q)', next: 'Следующий (W)',
            skip: 'Пропуск', skip_hint: 'Пропуск текста (Ctrl)', dash: 'Бег', dash_hint: 'Бег (Shift)',
            back: 'назад', back_hint: 'Назад, меню', ok: 'ок', ok_hint: 'ОК',
            sync_busy: '☁️ Синхронизация…', sync_ok: '✅ Сохранено',
            sync_offline: '📡 Ждём сеть (сохранено локально)',
            sync_lost: '⚠️ Нет связи с сервером, а в браузере нет места — не закрывайте игру, пока не вернётся сеть',
            sync_error: '⚠️ Ошибка сервера',
            fps_frame: 'кадр', fps_spikes: 'спайки',
            spikes_total: 'всего', spikes_clear: 'Очистить', spikes_cleared: '— Лог очищен —',
        },
        en: {
            settings: 'Settings', home: 'Back to library', turbo: 'Turbo ×3', cheats: 'Cheat menu',
            stretch: 'Stretch to screen', smooth: 'Smoothing', fullscreen: 'Full screen',
            keys_zx: 'A and B as Z and X', touch: 'Touch input in game',
            fps: 'FPS counter', spikes: 'Stutter log',
            stick: 'Joystick', prev: 'Previous (Q)', next: 'Next (W)',
            skip: 'Skip', skip_hint: 'Skip text (Ctrl)', dash: 'Run', dash_hint: 'Run (Shift)',
            back: 'back', back_hint: 'Back, menu', ok: 'ok', ok_hint: 'OK',
            sync_busy: '☁️ Syncing…', sync_ok: '✅ Saved',
            sync_offline: '📡 Waiting for network (saved locally)',
            sync_lost: '⚠️ No connection to the server and no space left in the browser — keep the game open until the network is back',
            sync_error: '⚠️ Server error',
            fps_frame: 'frame', fps_spikes: 'spikes',
            spikes_total: 'total', spikes_clear: 'Clear', spikes_cleared: '— Log cleared —',
        },
        de: {
            settings: 'Einstellungen', home: 'Zur Bibliothek', turbo: 'Turbo ×3', cheats: 'Cheat-Menü',
            stretch: 'Bild strecken', smooth: 'Glättung', fullscreen: 'Vollbild',
            keys_zx: 'A und B als Z und X', touch: 'Touch-Eingabe im Spiel',
            fps: 'FPS-Anzeige', spikes: 'Ruckel-Protokoll',
            stick: 'Joystick', prev: 'Vorheriger (Q)', next: 'Nächster (W)',
            skip: 'Vorspulen', skip_hint: 'Text vorspulen (Strg)', dash: 'Rennen', dash_hint: 'Rennen (Umschalt)',
            back: 'zurück', back_hint: 'Zurück, Menü', ok: 'ok', ok_hint: 'OK',
            sync_busy: '☁️ Synchronisiere…', sync_ok: '✅ Gespeichert',
            sync_offline: '📡 Warte auf Netz (lokal gespeichert)',
            sync_lost: '⚠️ Keine Verbindung zum Server und kein Platz im Browser — Spiel nicht schließen, bis das Netz zurück ist',
            sync_error: '⚠️ Serverfehler',
            fps_frame: 'Frame', fps_spikes: 'Ruckler',
            spikes_total: 'gesamt', spikes_clear: 'Leeren', spikes_cleared: '— Protokoll geleert —',
        },
    };
    const T = UI_TEXT[(() => {
        const known = (v) => Object.keys(UI_TEXT).includes(v);
        let lang = null;
        try { lang = new URLSearchParams(location.search).get('lang'); } catch (_) {}
        if (!known(lang)) try { lang = localStorage.getItem('rpg_lang'); } catch (_) {}
        return known(lang) ? lang : 'ru';   // 'ru' — как и в самой библиотеке по умолчанию
    })()];

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
                    var safeValue = (value === 'undefined' || !value) ? 'left' : String(value).toLowerCase();
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
        // ====================================================================
        // ФИКС КРАША СНИМКОВ ЭКРАНА (getImageData non-finite / type 'long')
        // ====================================================================
        var origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {
            // Строгая проверка: если это Бесконечность (Infinity) или NaN -> превращаем в 0
            var x = (isFinite(sx) && !isNaN(sx)) ? Math.round(sx) : 0;
            var y = (isFinite(sy) && !isNaN(sy)) ? Math.round(sy) : 0;
            var w = (isFinite(sw) && !isNaN(sw)) ? Math.round(sw) : 1;
            var h = (isFinite(sh) && !isNaN(sh)) ? Math.round(sh) : 1;
            
            // Canvas ненавидит нулевую ширину или высоту
            if (w === 0) w = 1;
            if (h === 0) h = 1;

            try {
                // Пытаемся сделать снимок с отфильтрованными координатами
                return origGetImageData.call(this, x, y, w, h);
            } catch (e) {
                // Если Canvas всё равно недоволен, отдаем пустой прозрачный квадрат
                console.warn('[RPG Fixes] 🛡️ Перехвачен краш getImageData:', e.message);
                return this.createImageData(Math.abs(w) || 1, Math.abs(h) || 1);
            }
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
            // Кэш для fs: файлы игры во время игры не меняются, повторно не спрашиваем
            const fsCache = new Map();
            window.require = function (m) {
                if (m === 'path') return { 
                    dirname: p => p ? p.replace(/[/\\][^/\\]*$/, '') || '.' : '.', 
                    join: (...a) => a.join('/'), 
                    basename: p => p ? p.split(/[/\\]/).pop() : '', 
                    extname: p => { const b = (p||'').split(/[/\\]/).pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; },
                    resolve: function() { return Array.prototype.slice.call(arguments).join('/').replace(/\\/g, '/').replace(/\/+/g, '/'); },
                    // 👇 ВОТ ЭТА СТРОЧКА СПАСЕТ DKTools 👇
                    normalize: p => p ? p.replace(/\\/g, '/').replace(/\/+/g, '/') : '' 
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
                if (m === 'fs') {
                    // Читаем файлы игры с сервера синхронным запросом — так же синхронно, как fs.*Sync
                    // в NW.js. Относительный путь считается от папки игры (адреса страницы).
                    // Нужно плагинам, которые читают свои файлы через fs (Hendrix_Localization: game_messages.csv).
                    const fetchSync = (p, method) => {
                        const key = method + ' ' + p;
                        if (fsCache.has(key)) return fsCache.get(key);
                        let result = { status: 0, text: '' };
                        try {
                            const xhr = new XMLHttpRequest();
                            xhr.open(method, String(p).replace(/\\/g, '/'), false);
                            xhr.overrideMimeType('text/plain; charset=utf-8');
                            xhr.send();
                            result = { status: xhr.status, text: xhr.responseText };
                        } catch (e) {}
                        fsCache.set(key, result);
                        return result;
                    };
                    return {
                        // Файла нет — по-прежнему '[]': на это рассчитывают старые плагины
                        readFileSync: p => { const r = fetchSync(p, 'GET'); return r.status === 200 ? r.text : '[]'; },
                        existsSync: p => fetchSync(p, 'HEAD').status === 200,
                        writeFileSync: () => {}, mkdirSync: () => {},
                        readdirSync: () => [], unlinkSync: () => {},
                        statSync: () => ({ isDirectory: () => false })
                    };
                }
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
        // Настоящую плотность запоминаем до подмены: по ней масштабирование решает,
        // чёткими пикселями рисовать картинку или со сглаживанием (см. applyScale)
        window.__realDevicePixelRatio = window.devicePixelRatio;
        try { Object.defineProperty(window, 'devicePixelRatio', { get: () => TARGET, configurable: true }); } catch(e) {}
        const pixi_t = setInterval(() => {
            if (typeof PIXI === 'undefined') return;
            clearInterval(pixi_t);
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
            #GameCanvas, canvas { display:block!important; position:absolute!important; top:50%!important; left:50%!important; transform-origin:center center!important; margin:0!important; padding:0!important; will-change: transform; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
        `;
        document.head.appendChild(style);

        let isStretched = false; let targetCanvas = null;
        window.__toggleRpgStretch = () => { isStretched = !isStretched; forceScaleUpdate(); };
        window.__rpgIsStretched = () => isStretched;

        // Сглаживание при растягивании. Раньше картинка всегда растягивалась без него
        // (image-rendering: pixelated), и при дробном увеличении — 1,5 на экране 1080p —
        // каждый второй пиксель игры становился двойным: буквы разной толщины, края
        // лесенкой. Теперь «auto»: чёткие пиксели, только когда увеличение целое
        // (×2, ×3 — там они ровные), иначе плавно. «off» — всегда чёткие, как раньше.
        // Выбор общий для всех игр: они открываются с одного адреса
        const SMOOTH_KEY = 'rpgfix_smoothing';
        let smoothMode = 'auto';
        try { if (localStorage.getItem(SMOOTH_KEY) === 'off') smoothMode = 'off'; } catch(e) {}
        window.__rpgSmoothing = () => smoothMode;
        window.__toggleRpgSmoothing = () => {
            smoothMode = smoothMode === 'auto' ? 'off' : 'auto';
            try { localStorage.setItem(SMOOTH_KEY, smoothMode); } catch(e) {}
            forceScaleUpdate();
            return smoothMode;
        };

        // Вырез, «островок» и скруглённые углы iPhone. Страница растянута на весь экран
        // (viewport-fit=cover), и раньше картинка игры считалась по всему экрану: растянутая,
        // она уходила под вырез — на iPhone 13 лёжа по 47 px с каждой стороны. Теперь игра
        // встаёт в безопасную зону. Снизу отступ не берём: там только тонкая полоска «домой»,
        // а игра на телефоне лёжа из-за неё стала бы мельче
        const safeProbe = document.createElement('div');
        safeProbe.id = '_safe_area_probe';
        safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);';
        document.documentElement.appendChild(safeProbe);
        function safeInsets() {
            const cs = getComputedStyle(safeProbe);
            return { left: parseFloat(cs.paddingLeft) || 0, right: parseFloat(cs.paddingRight) || 0, top: parseFloat(cs.paddingTop) || 0 };
        }

        // Где сейчас холст: сдвиг и масштаб. Нужно, чтобы поставить поверх него видео
        const placed = { left: 0, top: 0, sx: 1, sy: 1 };

        const resizeObserver = new ResizeObserver(() => { if (targetCanvas) requestAnimationFrame(applyScale); });
        function applyScale() {
            if (!targetCanvas || !targetCanvas.width) return;
            const w = targetCanvas.width, h = targetCanvas.height;
            targetCanvas.style.setProperty('width', w + 'px', 'important');
            targetCanvas.style.setProperty('height', h + 'px', 'important');
            const safe = safeInsets();
            const areaW = window.innerWidth - safe.left - safe.right, areaH = window.innerHeight - safe.top;
            let scaleX = areaW / w; let scaleY = areaH / h;
            if (!isStretched) { const scale = Math.min(scaleX, scaleY); scaleX = scaleY = scale; }

            // Считаем в настоящих пикселях экрана: на iPhone и ноутбуке с масштабом 125%
            // один пиксель CSS — это 3 и 1,25 физических. На iPhone devicePixelRatio
            // подменён на 1 (fixDevicePixelRatio), поэтому берём сохранённый
            const dpr = window.__realDevicePixelRatio || window.devicePixelRatio || 1;
            const whole = (v) => v >= 1 && Math.abs(v - Math.round(v)) < 0.01;
            const crisp = smoothMode === 'off' || (whole(scaleX * dpr) && whole(scaleY * dpr));
            targetCanvas.style.setProperty('image-rendering', crisp ? 'pixelated' : 'auto', 'important');

            // По центру, но с точностью до пикселя экрана: при центровке через 50% холст
            // на нечётной ширине окна вставал на полпикселя, и даже при ×2 пиксели выходили неровными
            const left = Math.round((safe.left + (areaW - w * scaleX) / 2) * dpr) / dpr;
            const top = Math.round((safe.top + (areaH - h * scaleY) / 2) * dpr) / dpr;
            targetCanvas.style.setProperty('left', '0px', 'important');
            targetCanvas.style.setProperty('top', '0px', 'important');
            targetCanvas.style.setProperty('transform-origin', '0 0', 'important');
            targetCanvas.style.setProperty('transform', `translate(${left}px, ${top}px) scale(${scaleX}, ${scaleY})`, 'important');
            Object.assign(placed, { left, top, sx: scaleX, sy: scaleY });
            placeVideo();
        }
        function forceScaleUpdate() { if (targetCanvas) requestAnimationFrame(applyScale); }

        // Видео движка — поверх картинки игры. Движок (и плагины вроде MovieManager) ставит
        // его по своей схеме: картинка игры по центру окна в масштабе Graphics._realScale.
        // А холст ставит rpg-fixes — со своим масштабом, растяжением и отступом от выреза.
        // Переводим положение видео из одной схемы в другую. Раньше ролик стоял мимо
        // картинки, а на телефоне — в исходном размере, срезанный краем экрана
        let watchedVideo = null;
        function placeVideo() {
            const v = (typeof Graphics !== 'undefined' && Graphics._video) || (typeof Video !== 'undefined' && Video._element);
            if (!v || !targetCanvas || !targetCanvas.width) return;
            if (watchedVideo !== v) {
                watchedVideo = v;
                // Движок и плагины двигают видео и сами — тогда пересчитываем
                new MutationObserver(placeVideo).observe(v, { attributes: true, attributeFilter: ['style', 'width', 'height'] });
                v.addEventListener('loadedmetadata', placeVideo);
            }
            const rs = (typeof Graphics !== 'undefined' && Graphics._realScale) || 1;
            const engineX = (window.innerWidth - targetCanvas.width * rs) / 2;
            const engineY = (window.innerHeight - targetCanvas.height * rs) / 2;
            let L = 0, T = 0;
            for (let e = v; e; e = e.offsetParent) { L += e.offsetLeft; T += e.offsetTop; }
            const kx = placed.sx / rs, ky = placed.sy / rs;
            const x = placed.left + (L - engineX) * kx, y = placed.top + (T - engineY) * ky;
            const t = `translate(${x - L}px, ${y - T}px) scale(${kx}, ${ky})`;
            // Сравниваем со своим прошлым значением, а не со style.transform: браузер
            // записывает его по-своему, и наблюдатель крутился бы бесконечно
            if (v.__rpgTransform !== t) {
                v.__rpgTransform = t;
                v.style.transformOrigin = '0 0';
                v.style.transform = t;
            }
        }

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
                        // Холсты ставит rpg-fixes (applyScale). Всё остальное — видео, окно ошибки —
                        // движок ставит сам, как привык. Раньше отключалось и это, и ролик
                        // оставался там, где оказался при создании
                        if (Graphics._centerElement && !Graphics._centerElement.__rpg) {
                            const center = Graphics._centerElement;
                            Graphics._centerElement = function(el) {
                                if (el && el.tagName === 'CANVAS') return;
                                return center.apply(this, arguments);
                            };
                            Graphics._centerElement.__rpg = true;
                        }
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
            if (typeof PIXI === 'undefined' || typeof SceneManager === 'undefined') return;
            if (PIXI.settings) PIXI.settings.GC_MODE = PIXI.GC_MODES.MANUAL; 
            if (!SceneManager.__gcPatched) {
                SceneManager.__gcPatched = true;
                const origChangeScene = SceneManager.changeScene;
                SceneManager.changeScene = function() {
                    origChangeScene.call(this);
                    if (Graphics?._renderer?.textureGC) Graphics._renderer.textureGC.run();
                };
            }
            clearInterval(initTimer);
        }, 200);
        setTimeout(() => clearInterval(initTimer), 10000);

        // ====================================================================
        // 🔥 ФИКС СНА (БЛОКИРОВКИ ЭКРАНА И СВОРАЧИВАНИЯ) 🔥
        // ====================================================================
        if (!window.__abortShieldInstalled) {
            window.__abortShieldInstalled = true;
            
            // 1. Глушим экран ошибки Karryn's Prison
            const origAddListener = window.addEventListener;
            window.addEventListener = function(type, listener, options) {
                if (type === 'unhandledrejection' || type === 'error') {
                    const safeListener = function(event) {
                        const err = event.reason || event.error || event;
                        if (err && (err.name === 'AbortError' || (err.message && err.message.toLowerCase().includes('aborted')))) {
                            event.preventDefault(); event.stopPropagation(); return;
                        }
                        if (typeof listener === 'function') return listener.apply(this, arguments);
                        if (listener && typeof listener.handleEvent === 'function') return listener.handleEvent(event);
                    };
                    return origAddListener.call(this, type, safeListener, options);
                }
                return origAddListener.call(this, type, listener, options);
            };

            // 2. Бронируем декодер (Умный авто-повтор после сна)
            if (typeof Image !== 'undefined' && Image.prototype.decode && !Image.prototype.__safeDecode) {
                Image.prototype.__safeDecode = true;
                const origDecode = Image.prototype.decode;
                Image.prototype.decode = function() {
                    return origDecode.call(this).catch(e => {
                        if (e.name === 'AbortError' || (e.message && e.message.toLowerCase().includes('aborted'))) {
                            // Не зависаем вечно! Ждем включения экрана и пробуем загрузить картинку снова
                            return new Promise(resolve => {
                                const retry = () => resolve(origDecode.call(this).catch(()=>{}));
                                if (document.hidden) {
                                    const handler = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', handler); retry(); } };
                                    document.addEventListener('visibilitychange', handler);
                                } else {
                                    setTimeout(retry, 100);
                                }
                            });
                        }
                        throw e;
                    });
                };
            }
        }
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
        // localStorage один на все игры библиотеки и всего около 5 МБ, а сейв большой
        // игры — мегабайт. Не влезло — не повод срывать сохранение: отправка на сервер
        // всё равно уходит. Раньше исключение отсюда прерывало сохранение ещё до отправки
        function saveQueue(q) {
            try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); return true; }
            catch (e) { return false; }
        }
        // То, что не влезло в очередь, держим в памяти вкладки: вернётся сеть — отправим
        const memQueue = {};

        const syncDiv = document.createElement('div');
        syncDiv.id = '_cloud_sync_ui';
        syncDiv.style.cssText = 'display:none; position:fixed; top:15px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.85); color:#fff; padding:6px 20px; border-radius:20px; z-index:2147483647; font-size:13px; font-family:sans-serif; font-weight:bold; border:1px solid rgba(255,255,255,0.2); pointer-events:none; box-shadow:0 4px 10px rgba(0,0,0,0.5); transition:background 0.3s;';
        document.body.appendChild(syncDiv);

        let syncCount = 0;
        function showSync(active, status = 'ok') {
            if (!syncDiv) return;
            if (active) { 
                syncCount++; syncDiv.textContent = T.sync_busy; syncDiv.style.background = 'rgba(0,0,0,0.85)'; syncDiv.style.display = 'block'; 
            } else { 
                syncCount--; 
                if (syncCount <= 0) { 
                    syncCount = 0; 
                    if (status === 'ok') { syncDiv.textContent = T.sync_ok; syncDiv.style.background = 'rgba(40,140,40,0.9)'; }
                    else if (status === 'offline') { syncDiv.textContent = T.sync_offline; syncDiv.style.background = 'rgba(200,140,20,0.9)'; }
                    else if (status === 'lost') { syncDiv.textContent = T.sync_lost; syncDiv.style.background = 'rgba(170,60,60,0.95)'; }
                    else { syncDiv.textContent = T.sync_error; syncDiv.style.background = 'rgba(170,60,60,0.9)'; }
                    // Предупреждение о несохранённом висит дольше: его нельзя пропустить
                    setTimeout(() => { if (syncCount === 0) syncDiv.style.display = 'none'; }, status === 'lost' ? 8000 : 2000); 
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
            const pending = { ...q };
            for (const k of Object.keys(memQueue)) pending[k] = chooseNewer(pending[k], memQueue[k]);
            const keys = Object.keys(pending);
            if (keys.length === 0) return;

            showSync(true);
            let allOk = true;

            for (const key of keys) {
                try {
                    const res = await retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}/${encodeURIComponent(key)}`, { 
                        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending[key]) 
                    });
                    if (res.ok) {
                        delete q[key];
                        if (memQueue[key] && memQueue[key].updatedAt <= pending[key].updatedAt) delete memQueue[key];
                    } else allOk = false;
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
            const q = getQueue(); q[key] = payload;
            // Не влезло в localStorage — сейв держится в памяти, пока вкладка открыта
            const queued = saveQueue(q);
            if (queued) delete memQueue[key]; else memQueue[key] = payload;
            showSync(true);
            if (!navigator.onLine) { showSync(false, queued ? 'offline' : 'lost'); return; }

            retryFetch(`${CLOUD_BASE}/${encodeURIComponent(gameId)}/${encodeURIComponent(key)}`, { 
                method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) 
            }).then(r => {
                if (r.ok) {
                    const qNew = getQueue(); delete qNew[key]; saveQueue(qNew);
                    if (memQueue[key] === payload) delete memQueue[key];
                    showSync(false, 'ok');
                } else showSync(false, queued ? 'error' : 'lost');
            }).catch(() => showSync(false, queued ? 'offline' : 'lost'));
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
            // Копия в браузере — запасная: сейв уже ушёл на сервер (или в очередь).
            // localStorage один на все игры и быстро кончается: у MV-игр ключи общие
            // («RPG File1»), а слот большой игры весит мегабайт. Раньше переполнение здесь
            // бросало исключение, движок считал сохранение проваленным и в блоке спасения
            // удалял слот — вместе с его копией на сервере
            const _saveToWebStorage = StorageManager.saveToWebStorage; 
            StorageManager.saveToWebStorage = function(saveFileId, json) {
                uploadToCloud(this.webStorageKey(saveFileId), json);
                try { return _saveToWebStorage.apply(this, arguments); }
                catch (e) { console.warn('[RPG Fixes] Копия сейва в браузере не записана (нет места), на сервере он есть:', e && e.name); }
            };
            // Резервная копия слота перед записью — тоже только в браузере и тоже не повод
            // срывать сохранение
            if (StorageManager.backup) {
                const _backup = StorageManager.backup;
                StorageManager.backup = function() {
                    try { return _backup.apply(this, arguments); }
                    catch (e) { console.warn('[RPG Fixes] Резервная копия слота в браузере не записана:', e && e.name); }
                };
            }

            // Если сохранение всё же упало (например, ошибка плагина), MV в блоке спасения
            // удаляет слот и возвращает резервную копию. Это удаление на сервер не пускаем:
            // там лежит предыдущий, целый сейв этого слота. Обёртку ставим и сейчас, и
            // после загрузки плагинов — плагин мог заменить saveGame своей версией
            let saving = 0;
            const guardSaveGame = () => {
                if (typeof DataManager === 'undefined' || !DataManager.saveGame || DataManager.saveGame.__rpgGuarded) return;
                const _saveGame = DataManager.saveGame;
                DataManager.saveGame = function() {
                    saving++;
                    try { return _saveGame.apply(this, arguments); } finally { saving--; }
                };
                DataManager.saveGame.__rpgGuarded = true;
            };
            guardSaveGame();
            const guardTimer = setInterval(guardSaveGame, 500);
            setTimeout(() => clearInterval(guardTimer), 30000);

            const _removeWebStorage = StorageManager.removeWebStorage; 
            StorageManager.removeWebStorage = function(saveFileId) {
                if (!saving) deleteFromCloud(this.webStorageKey(saveFileId));
                return _removeWebStorage.apply(this, arguments);
            };
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
    // 5. ИНТЕРФЕЙС: МЕНЮ ⚙ И ЭКРАННОЕ УПРАВЛЕНИЕ
    // ============================================================================
    const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || IS_IOS;

    // Значки одной тонкой линией, цвет берут от текста. Раньше у каждого пункта был
    // свой смайлик: на каждой платформе они рисуются по-своему и выглядели случайными
    const ICONS = {
        gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
        home: '<path d="M3 11l9-7 9 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
        fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
        stretch: '<path d="M3 12h18"/><path d="M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
        smooth: '<path d="M3 15c3-6 6-6 9 0s6 6 9 0"/>',
        turbo: '<path d="M4 6l7 6-7 6zM13 6l7 6-7 6z"/>',
        tap: '<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="7"/>',
        keys: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 11h.01M11 11h.01M15 11h.01M8 14h8"/>',
        wand: '<path d="M4 20L15 9"/><path d="M15 3v3M18.5 5.5l-2 2M21 9h-3M18.5 12.5l-2-2"/>',
        fps: '<path d="M4 20h16M7 16v-4M12 16V8M17 16v-6"/>',
        pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
        chevron: '<path d="M7 14.5l5-5 5 5"/>',
        prev: '<path d="M14.5 6l-6 6 6 6"/>',
        next: '<path d="M9.5 6l6 6-6 6"/>',
    };
    const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

    // Нажатие — когда палец отпустили там же, где коснулись. Раньше пункт срабатывал
    // в момент касания: лёжа на телефоне меню не влезает по высоте, и, листая его,
    // человек включал всё, до чего дотронулся. Сдвинул палец — это прокрутка, не нажатие
    function onTap(el, fn) {
        let start = null;
        el.addEventListener('pointerdown', (e) => {
            start = e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
        });
        el.addEventListener('pointermove', (e) => {
            if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) start = null;
        });
        // Браузер начал прокрутку — касание уже не наше
        el.addEventListener('pointercancel', () => { start = null; });
        el.addEventListener('pointerup', (e) => {
            if (!start || e.pointerId !== start.id) return;
            start = null;
            fn();
        });
    }

    // Пункты меню приходят из разных частей файла (экран, управление, диагностика,
    // читы), а рисуются здесь, по разделам и всегда в одном порядке. Разделы собраны
    // в две колонки: на высоком экране они идут одна под другой, на низком (телефон
    // лёжа) — рядом, и листать меню не нужно
    const MENU_COLUMNS = [['nav', 'game', 'screen'], ['controls', 'debug']];
    const menuItems = [];
    function addMenuItem(item) { menuItems.push(item); renderMenu(); }
    function closeMenu() {
        document.getElementById('_sys_panel')?.classList.remove('_open');
        document.getElementById('_sys_btn')?.classList.remove('_open');
    }
    function menuButton(item) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = '_sys_item';
        el.id = item.id;
        el.innerHTML = `<span class="_sys_ico">${icon(item.icon)}</span><span class="_sys_label">${item.label}</span>` + (item.isOn ? '<span class="_sys_switch"></span>' : '');
        if (item.isOn) el.classList.toggle('_on', !!item.isOn());
        onTap(el, () => {
            item.onClick();
            if (item.isOn) el.classList.toggle('_on', !!item.isOn());
            else closeMenu();
        });
        return el;
    }
    function renderMenu() {
        const panel = document.getElementById('_sys_panel');
        if (!panel) return;
        panel.innerHTML = '';
        for (const sections of MENU_COLUMNS) {
            const col = document.createElement('div');
            col.className = '_sys_col';
            for (const section of sections) {
                const items = menuItems.filter(i => i.section === section);
                if (!items.length) continue;
                const group = document.createElement('div');
                group.className = '_sys_group';
                items.forEach(item => group.appendChild(menuButton(item)));
                col.appendChild(group);
            }
            if (col.childElementCount) panel.appendChild(col);
        }
    }

    function setupUIAndGamepad() {
        document.addEventListener('DOMContentLoaded', () => {
            if (document.getElementById('_sys_menu_container')) return;

            const style = document.createElement('style');
            style.textContent = `
                #_sys_menu_container, #_mob_ctrl { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
                #_sys_menu_container svg, #_mob_ctrl svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

                #_sys_menu_container { position: fixed; top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; font-size: 14px; font-weight: 500; touch-action: manipulation; }
                #_sys_btn { width: 40px; height: 40px; padding: 0; border-radius: 50%; border: 1px solid rgba(255,255,255,0.22); background: rgba(14,14,18,0.45); color: rgba(255,255,255,0.9); display: flex; align-items: center; justify-content: center; cursor: pointer; opacity: 0.65; transition: opacity .2s, background .2s; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
                #_sys_btn svg { width: 20px; height: 20px; }
                #_sys_btn._open, #_sys_btn:hover { opacity: 1; background: rgba(14,14,18,0.7); }
                #_sys_panel { display: none; margin-top: 8px; min-width: 250px; max-height: calc(100vh - 80px); max-height: calc(100dvh - 80px); overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y; padding: 6px; border-radius: 14px; background: rgba(14,14,18,0.88); border: 1px solid rgba(255,255,255,0.12); box-shadow: 0 16px 40px rgba(0,0,0,0.5); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
                #_sys_panel._open { display: block; }
                ._sys_item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px; border: 0; border-radius: 9px; background: transparent; color: rgba(255,255,255,0.9); font: inherit; text-align: left; cursor: pointer; }
                ._sys_item:active { background: rgba(255,255,255,0.12); }
                @media (hover: hover) { ._sys_item:hover { background: rgba(255,255,255,0.07); } }
                ._sys_ico { display: flex; flex-shrink: 0; color: rgba(255,255,255,0.55); }
                ._sys_ico svg { width: 20px; height: 20px; }
                ._sys_label { flex: 1; white-space: nowrap; }
                ._sys_switch { position: relative; flex-shrink: 0; width: 30px; height: 18px; border-radius: 9px; background: rgba(255,255,255,0.16); transition: background .2s; }
                ._sys_switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: rgba(255,255,255,0.75); transition: transform .2s; }
                ._sys_item._on ._sys_switch { background: #d9b45e; }
                ._sys_item._on ._sys_switch::after { transform: translateX(12px); background: #fff; }
                ._sys_group + ._sys_group::before, ._sys_col + ._sys_col::before { content: ''; display: block; height: 1px; margin: 5px 8px; background: rgba(255,255,255,0.08); }
                /* Лёжа на телефоне меню в одну колонку не влезает по высоте — колонки встают рядом */
                @media (max-height: 500px) and (min-width: 560px) {
                    #_sys_panel._open { display: grid; grid-template-columns: 1fr 1fr; }
                    ._sys_col + ._sys_col { margin-left: 5px; padding-left: 5px; border-left: 1px solid rgba(255,255,255,0.08); }
                    ._sys_col + ._sys_col::before { display: none; }
                    ._sys_item { padding: 8px 10px; }
                }

                /* Экранное управление. Единица --u — от короткой стороны экрана: на телефоне
                   кнопки не закрывают полэкрана, на планшете не теряются в углу */
                #_mob_ctrl { --u: clamp(42px, 11vmin, 62px); position: fixed; left: 0; right: 0; bottom: 0; height: 0; z-index: 2147483646; pointer-events: none; touch-action: none; opacity: 0.92; transition: opacity .4s; }
                /* Без касаний управление гаснет, чтобы не закрывать текст диалогов */
                #_mob_ctrl._idle { opacity: 0.38; }
                ._glass { background: rgba(14,14,18,0.3); border: 1.5px solid rgba(255,255,255,0.26); color: rgba(255,255,255,0.92); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }

                #_stick { position: fixed; left: calc(max(14px, env(safe-area-inset-left)) + 6px); bottom: calc(max(14px, env(safe-area-inset-bottom)) + 6px); width: calc(var(--u) * 2.55); height: calc(var(--u) * 2.55); border-radius: 50%; pointer-events: auto; touch-action: none; }
                ._stick_dir { position: absolute; width: 22%; height: 22%; color: rgba(255,255,255,0.4); transition: color .12s; }
                ._stick_dir svg { display: block; width: 100%; height: 100%; }
                ._stick_dir[data-dir="up"] { top: 3%; left: 39%; }
                ._stick_dir[data-dir="down"] { bottom: 3%; left: 39%; transform: rotate(180deg); }
                ._stick_dir[data-dir="left"] { left: 3%; top: 39%; transform: rotate(-90deg); }
                ._stick_dir[data-dir="right"] { right: 3%; top: 39%; transform: rotate(90deg); }
                ._stick_dir._on { color: #fff; }
                #_stick_knob { position: absolute; left: 29%; top: 29%; width: 42%; height: 42%; border-radius: 50%; background: rgba(255,255,255,0.18); border: 1.5px solid rgba(255,255,255,0.5); box-shadow: 0 2px 10px rgba(0,0,0,0.35); transition: transform .14s ease-out; }
                #_stick._drag #_stick_knob { transition: none; background: rgba(255,255,255,0.28); }

                #_pad { position: fixed; right: calc(max(14px, env(safe-area-inset-right)) + 6px); bottom: calc(max(14px, env(safe-area-inset-bottom)) + 6px); width: calc(var(--u) * 2.7); height: calc(var(--u) * 3.35); pointer-events: none; }
                ._btn { position: absolute; padding: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font: 600 calc(var(--u) * 0.42) -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; pointer-events: auto; touch-action: none; transition: transform .08s, background .08s; }
                ._btn._on { transform: scale(0.93); background: rgba(255,255,255,0.3); }
                /* A и B по диагонали, как на Game Boy: A выше и правее, под большой палец */
                #_btn_a { right: 0; bottom: calc(var(--u) * 0.6); width: calc(var(--u) * 1.3); height: calc(var(--u) * 1.3); border-color: rgba(255,255,255,0.42); }
                #_btn_b { right: calc(var(--u) * 1.48); bottom: calc(var(--u) * 0.06); width: calc(var(--u) * 1.08); height: calc(var(--u) * 1.08); font-size: calc(var(--u) * 0.36); }
                ._cap { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); margin-top: 3px; font-size: 10px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,0.6); white-space: nowrap; pointer-events: none; }
                ._pills { position: absolute; right: 0; display: flex; gap: 8px; pointer-events: none; }
                ._pills._row1 { bottom: calc(var(--u) * 2.1); }
                ._pills._row2 { bottom: calc(var(--u) * 2.76); }
                ._pill { display: flex; align-items: center; justify-content: center; height: calc(var(--u) * 0.56); min-width: calc(var(--u) * 0.56); padding: 0 calc(var(--u) * 0.26); border-radius: 999px; font: 600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; letter-spacing: .06em; text-transform: uppercase; pointer-events: auto; touch-action: none; transition: transform .08s, background .12s, color .12s; }
                ._pill svg { width: 16px; height: 16px; }
                ._pill._on { transform: scale(0.93); }
                /* «Бег» и «Пропуск» — переключатели: включённый видно издалека */
                ._pill._latched { background: rgba(255,255,255,0.9); color: #141414; border-color: transparent; }

                @media (pointer: fine) { #_mob_ctrl { display: none !important; } }
            `;
            document.head.appendChild(style);

            // --- Меню ⚙ ---
            const menu = document.createElement('div');
            menu.id = '_sys_menu_container';
            menu.innerHTML = `<button type="button" id="_sys_btn" aria-label="${T.settings}" title="${T.settings}">${icon('gear')}</button><div id="_sys_panel" role="menu"></div>`;
            document.body.appendChild(menu);
            const sysBtn = document.getElementById('_sys_btn');
            const sysPanel = document.getElementById('_sys_panel');
            onTap(sysBtn, () => {
                const open = !sysPanel.classList.contains('_open');
                sysPanel.classList.toggle('_open', open);
                sysBtn.classList.toggle('_open', open);
                if (open) renderMenu();   // состояние переключателей могло поменяться с клавиатуры
            });
            // Касания и прокрутка меню — не игре: иначе MV принял бы их за касание экрана,
            // а MZ отменял бы прокрутку колесом. mousedown без действия по умолчанию —
            // чтобы кнопка не забирала фокус: иначе пробел в игре снова нажимал бы её
            ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup',
             'touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel', 'click', 'contextmenu'].forEach(t => menu.addEventListener(t, (e) => {
                e.stopPropagation();
                if (t === 'contextmenu' || t === 'mousedown') e.preventDefault();
            }, { passive: !(t === 'contextmenu' || t === 'mousedown') }));
            document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) closeMenu(); });

            addMenuItem({ id: '_sys_home', section: 'nav', icon: 'home', label: T.home, onClick: () => { window.location.href = '/'; } });

            window.__rpgTurbo = false;
            addMenuItem({
                id: '_sys_turbo', section: 'game', icon: 'turbo', label: T.turbo,
                isOn: () => window.__rpgTurbo,
                onClick: () => {
                    window.__rpgTurbo = !window.__rpgTurbo;
                    if (window.__turboHookInjected) return;
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
                },
            });

            addMenuItem({
                id: '_sys_stretch', section: 'screen', icon: 'stretch', label: T.stretch,
                isOn: () => !!(window.__rpgIsStretched && window.__rpgIsStretched()),
                onClick: () => window.__toggleRpgStretch && window.__toggleRpgStretch(),
            });
            // Сглаживание: «вкл» — плавно при дробном увеличении и чётко при целом,
            // «выкл» — всегда чёткие пиксели. Выбор запоминается (см. setupModernViewport)
            addMenuItem({
                id: '_sys_smooth', section: 'screen', icon: 'smooth', label: T.smooth,
                isOn: () => !window.__rpgSmoothing || window.__rpgSmoothing() === 'auto',
                onClick: () => window.__toggleRpgSmoothing && window.__toggleRpgSmoothing(),
            });
            if (!IS_IOS) {
                const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
                addMenuItem({
                    id: '_sys_fs', section: 'screen', icon: 'fullscreen', label: T.fullscreen,
                    isOn: isFull,
                    onClick: () => {
                        const el = document.documentElement;
                        const p = !isFull() ? (el.requestFullscreen || el.webkitRequestFullscreen).call(el) : (document.exitFullscreen || document.webkitExitFullscreen).call(document);
                        if (p && p.catch) p.catch(() => {});
                    },
                });
                document.addEventListener('fullscreenchange', renderMenu);
                document.addEventListener('webkitfullscreenchange', renderMenu);
            }

            if (IS_MOBILE) setupTouchControls();
        });
    }

    // Экранное управление для телефона и планшета. Крестовина из четырёх отдельных
    // кнопок не давала вести пальцем: чтобы свернуть за угол, надо было отпустить одну
    // кнопку и попасть в другую. Теперь это джойстик: направление меняется скольжением,
    // а на выходе — четыре направления, как и ждут игры RPG Maker
    function setupTouchControls() {
        const KEYS = {
            up:       { kn: 'up',       kc: 38, key: 'ArrowUp',    code: 'ArrowUp' },
            down:     { kn: 'down',     kc: 40, key: 'ArrowDown',  code: 'ArrowDown' },
            left:     { kn: 'left',     kc: 37, key: 'ArrowLeft',  code: 'ArrowLeft' },
            right:    { kn: 'right',    kc: 39, key: 'ArrowRight', code: 'ArrowRight' },
            ok:       { kn: 'ok',       kc: 32, key: ' ',          code: 'Space' },
            cancel:   { kn: 'escape',   kc: 27, key: 'Escape',     code: 'Escape' },
            dash:     { kn: 'shift',    kc: 16, key: 'Shift',      code: 'ShiftLeft' },
            // Ctrl: во многих играх «держать — пропускать текст». Раньше эта кнопка
            // называлась MENU, хотя меню не открывала
            skip:     { kn: 'control',  kc: 17, key: 'Control',    code: 'ControlLeft' },
            pageup:   { kn: 'pageup',   kc: 81, key: 'q',          code: 'KeyQ' },
            pagedown: { kn: 'pagedown', kc: 87, key: 'w',          code: 'KeyW' },
        };
        // Часть игр слушает только Z и X, а не пробел и Esc
        const ZX = {
            ok:     { kn: 'ok',     kc: 90, key: 'z', code: 'KeyZ' },
            cancel: { kn: 'escape', kc: 88, key: 'x', code: 'KeyX' },
        };
        let useZX = false;
        const held = new Set();      // нажатые прямо сейчас
        const latched = new Set();   // включённые переключатели «Бег» и «Пропуск»

        function sendKey(name, isDown) {
            const k = (useZX && ZX[name]) || KEYS[name];
            if (!k) return;
            if (isDown) held.add(name); else held.delete(name);
            if (typeof Input !== 'undefined') {
                if (Input._currentState) Input._currentState[k.kn] = isDown;
                if (Input.currentState) Input.currentState[k.kn] = isDown;
            }
            const ev = new KeyboardEvent(isDown ? 'keydown' : 'keyup', { bubbles: true, cancelable: true, key: k.key, code: k.code });
            Object.defineProperty(ev, 'keyCode', { get: () => k.kc });
            Object.defineProperty(ev, 'which', { get: () => k.kc });
            document.dispatchEvent(ev);
        }

        const root = document.createElement('div');
        root.id = '_mob_ctrl';
        root.innerHTML = `
            <div id="_stick" class="_glass" role="application" aria-label="${T.stick}">
                ${['up', 'down', 'left', 'right'].map(d => `<i class="_stick_dir" data-dir="${d}">${icon('chevron')}</i>`).join('')}
                <div id="_stick_knob"></div>
            </div>
            <div id="_pad">
                <div class="_pills _row2">
                    <button type="button" class="_pill _glass" data-key="pageup" aria-label="${T.prev}">${icon('prev')}</button>
                    <button type="button" class="_pill _glass" data-key="pagedown" aria-label="${T.next}">${icon('next')}</button>
                </div>
                <div class="_pills _row1">
                    <button type="button" class="_pill _glass" data-key="skip" data-latch="1" aria-label="${T.skip_hint}">${T.skip}</button>
                    <button type="button" class="_pill _glass" data-key="dash" data-latch="1" aria-label="${T.dash_hint}">${T.dash}</button>
                </div>
                <button type="button" id="_btn_b" class="_btn _glass" data-key="cancel" aria-label="${T.back_hint}">B<span class="_cap">${T.back}</span></button>
                <button type="button" id="_btn_a" class="_btn _glass" data-key="ok" aria-label="${T.ok_hint}">A<span class="_cap">${T.ok}</span></button>
            </div>`;
        document.body.appendChild(root);

        // Касания по управлению — не игре: иначе MV увидел бы их как касание экрана
        ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'click', 'contextmenu'].forEach(t => {
            root.addEventListener(t, (e) => { e.stopPropagation(); if (t === 'contextmenu') e.preventDefault(); }, { passive: false });
        });

        // Без касаний управление гаснет — меньше закрывает текст
        let idleTimer = 0;
        const wake = () => { root.classList.remove('_idle'); clearTimeout(idleTimer); };
        const sleepSoon = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => { if (!held.size) root.classList.add('_idle'); }, 3500);
        };
        sleepSoon();

        // --- Джойстик ---
        const stick = document.getElementById('_stick');
        const knob = document.getElementById('_stick_knob');
        const dirEls = {};
        stick.querySelectorAll('._stick_dir').forEach(el => { dirEls[el.dataset.dir] = el; });
        let stickId = null, stickDir = null;

        // Ось меняется, только когда другая явно перевешивает: у диагонали направление
        // иначе дрожало бы между двумя, и герой шёл бы рывками
        function pickDir(dx, dy, current) {
            const ax = Math.abs(dx), ay = Math.abs(dy);
            const horiz = dx > 0 ? 'right' : 'left', vert = dy > 0 ? 'down' : 'up';
            if (current === horiz) return ay > ax * 1.25 ? vert : horiz;
            if (current === vert) return ax > ay * 1.25 ? horiz : vert;
            return ax >= ay ? horiz : vert;
        }
        function setStickDir(dir) {
            if (dir === stickDir) return;
            if (stickDir) { sendKey(stickDir, false); dirEls[stickDir].classList.remove('_on'); }
            stickDir = dir;
            if (dir) { sendKey(dir, true); dirEls[dir].classList.add('_on'); }
        }
        function moveStick(e) {
            const r = stick.getBoundingClientRect();
            const radius = r.width / 2;
            const dx = e.clientX - (r.left + radius), dy = e.clientY - (r.top + radius);
            const dist = Math.hypot(dx, dy), travel = radius * 0.42;
            const k = dist > travel ? travel / dist : 1;
            knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
            // Мёртвая зона в центре: палец, просто лежащий на джойстике, героя не двигает
            setStickDir(dist < radius * 0.22 ? null : pickDir(dx, dy, stickDir));
        }
        function releaseStick() {
            stickId = null;
            stick.classList.remove('_drag');
            knob.style.transform = '';
            setStickDir(null);
        }
        stick.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            stickId = e.pointerId;
            try { stick.setPointerCapture(e.pointerId); } catch (_) {}
            stick.classList.add('_drag');
            wake();
            moveStick(e);
        }, { passive: false });
        stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) { e.preventDefault(); moveStick(e); } }, { passive: false });
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => stick.addEventListener(t, (e) => {
            if (e.pointerId !== stickId) return;
            releaseStick();
            sleepSoon();
        }));

        // --- Кнопки ---
        root.querySelectorAll('[data-key]').forEach((btn) => {
            const name = btn.dataset.key;
            const latch = btn.dataset.latch === '1';
            let pid = null;
            btn.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                wake();
                if (latch) {
                    // Держать «Бег» пальцем нельзя — большой палец нужен на A. Поэтому
                    // «Бег» и «Пропуск» включаются касанием и выключаются следующим
                    const on = !latched.has(name);
                    if (on) latched.add(name); else latched.delete(name);
                    btn.classList.toggle('_latched', on);
                    sendKey(name, on);
                    btn.classList.add('_on');
                    setTimeout(() => btn.classList.remove('_on'), 120);
                    sleepSoon();
                    return;
                }
                if (pid !== null) return;
                pid = e.pointerId;
                try { btn.setPointerCapture(e.pointerId); } catch (_) {}
                btn.classList.add('_on');
                sendKey(name, true);
            }, { passive: false });
            if (latch) return;
            ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => btn.addEventListener(t, (e) => {
                if (e.pointerId !== pid) return;
                pid = null;
                btn.classList.remove('_on');
                sendKey(name, false);
                sleepSoon();
            }));
        });

        // Свернули игру или заблокировали экран — отпускаем всё, что было зажато, иначе
        // герой продолжил бы идти. Движок при потере фокуса сбрасывает свои клавиши, так
        // что включённые «Бег» и «Пропуск» по возвращении нажимаем заново
        function releaseHeld() {
            releaseStick();
            root.querySelectorAll('._btn._on, ._pill._on').forEach(b => b.classList.remove('_on'));
            for (const name of [...held]) if (!latched.has(name)) sendKey(name, false);
        }
        const restoreLatched = () => { for (const name of latched) sendKey(name, true); };
        document.addEventListener('visibilitychange', () => { if (document.hidden) releaseHeld(); else restoreLatched(); });
        window.addEventListener('blur', releaseHeld);
        window.addEventListener('focus', restoreLatched);

        addMenuItem({
            id: '_sys_keys', section: 'controls', icon: 'keys', label: T.keys_zx,
            isOn: () => useZX,
            onClick: () => { releaseHeld(); useZX = !useZX; },
        });
    }

    // --- 6. ДИАГНОСТИКА, ТАЧ-РЕЖИМ, МОНИТОРЫ ---
    // Счётчик кадров считает, только пока он на экране. Раньше он и журнал ниже
    // работали на каждом кадре всю игру, даже скрытые, — лишняя работа для телефона
    function setupFpsMonitor() {
        let visible = false;
        let raf = 0;

        const monitor = document.createElement('div');
        monitor.id = '_fps_monitor';
        monitor.style.cssText = `display: none; position: fixed; top: max(64px, env(safe-area-inset-top) + 48px); right: max(16px, env(safe-area-inset-right)); z-index: 2147483647; background: rgba(0,0,0,0.75); color: #0f0; font-family: 'Courier New', monospace; font-size: 11px; line-height: 1.5; padding: 8px 10px; border-radius: 8px; min-width: 130px; pointer-events: none; border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(4px);`;
        document.body.appendChild(monitor);

        const HISTORY = 60;
        let fpsHistory, frameTimes, lastFrame, frameCount, lastFpsUpdate, lagSpikes;
        function reset() {
            fpsHistory = new Array(HISTORY).fill(60);
            frameTimes = []; lastFrame = performance.now(); frameCount = 0; lastFpsUpdate = performance.now(); lagSpikes = 0;
        }

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

                const avgFps = Math.round(fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length);
                const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
                const color = getColor(currentFps);
                monitor.innerHTML = `
                    <span style="color:${color};font-size:16px;font-weight:bold">${currentFps} FPS</span><br>
                    <span style="color:#aaa">${T.fps_frame}: ${avgFrameTime.toFixed(1)}ms</span><br>
                    <span style="color:#888">min:${Math.min(...fpsHistory)} avg:${avgFps} max:${Math.max(...fpsHistory)}</span><br>
                    <span style="color:#f44;font-size:10px">${T.fps_spikes}: ${lagSpikes}</span><br>
                    <span style="color:${color};letter-spacing:0;font-size:10px">${sparkline(fpsHistory)}</span>
                `;
            }
            if (visible) raf = requestAnimationFrame(tick);
        }

        function setVisible(v) {
            visible = v;
            monitor.style.display = v ? 'block' : 'none';
            cancelAnimationFrame(raf);
            raf = 0;
            if (v) { reset(); raf = requestAnimationFrame(tick); }
        }
        window.__toggleFpsMonitor = () => setVisible(!visible);

        addMenuItem({ id: '_sys_fps', section: 'debug', icon: 'fps', label: T.fps, isOn: () => visible, onClick: () => setVisible(!visible) });
        if (location.search.includes('fps') || location.search.includes('dev')) setVisible(true);
    }

    // Журнал подтормаживаний пишет, пока открыт
    function setupSpikeDiagnostics() {
        const SPIKE_THRESHOLD_MS = 40;
        const MAX_LOG = 30;
        const log = [];
        let lastFrameTime = performance.now();
        const sessionStart = performance.now();
        let recording = false;
        let raf = 0;
        window.__spikeLog = log;

        const panel = document.createElement('div');
        // id нужен перехватчику касаний на телефоне: без него он глотал нажатия
        // по этой панели, и кнопка «Очистить» не работала
        panel.id = '_spike_panel';
        panel.style.cssText = `display: none; position: fixed; bottom: 10px; left: 10px; right: 10px; max-height: 45vh; background: rgba(0,0,0,0.92); border: 1px solid rgba(255,100,0,0.4); border-radius: 10px; z-index: 2147483647; font-family: 'Courier New', monospace; font-size: 10px; color: #ddd; overflow-y: auto; -webkit-overflow-scrolling: touch; pointer-events: auto;`;
        panel.innerHTML = `<div style="position:sticky;top:0;background:rgba(0,0,0,0.95);padding:6px 10px;border-bottom:1px solid rgba(255,100,0,0.3);display:flex;justify-content:space-between;align-items:center;"><span style="color:#f80;font-weight:bold">${T.spikes}</span><span id="_spike_count" style="color:#f44">${T.spikes_total}: 0</span><button id="_spike_clear" style="background:rgba(255,80,0,0.3);border:1px solid rgba(255,80,0,0.5);border-radius:4px;color:#fff;padding:2px 8px;font-size:10px;">${T.spikes_clear}</button></div><div id="_spike_log_body" style="padding:6px 10px;"></div>`;
        document.body.appendChild(panel);
        // Касания и прокрутка журнала — не игре: иначе на карте герой шёл бы туда, где нажали «Очистить»
        ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'wheel', 'click'].forEach(t => {
            panel.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
        });

        onTap(document.getElementById('_spike_clear'), () => {
            log.length = 0;
            document.getElementById('_spike_log_body').innerHTML = `<span style="color:#666">${T.spikes_cleared}</span>`;
            document.getElementById('_spike_count').textContent = `${T.spikes_total}: 0`;
        });

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
                const body = document.getElementById('_spike_log_body');
                if (body) body.innerHTML = log.map((s, i) => `<div style="border-bottom:1px solid rgba(255,255,255,0.05);padding:3px 0"><span style="color:#666">#${i+1} +${s.t}s</span><span style="color:${s.ms > 80 ? '#f44' : s.ms > 60 ? '#f80' : '#ff0'};font-weight:bold"> ${s.ms}ms</span><span style="color:#aaa"> ${s.scene || '?'}</span> ${s.parallelEvents > 0 ? `<span style="color:#f44"> ⚠️ parallel:${s.parallelEvents}</span>` : ''} ${s.textures > 200 ? `<span style="color:#f44"> tex:${s.textures}⚠️</span>` : (s.textures ? ` tex:${s.textures}` : '')}</div>`).join('');
                const countEl = document.getElementById('_spike_count');
                if (countEl) countEl.textContent = `${T.spikes_total}: ${log.length}`;
            }
            if (recording) raf = requestAnimationFrame(detectLoop);
        }

        function setOpen(open) {
            recording = open;
            panel.style.display = open ? 'block' : 'none';
            cancelAnimationFrame(raf);
            raf = 0;
            if (open) { lastFrameTime = performance.now(); raf = requestAnimationFrame(detectLoop); }
        }

        addMenuItem({ id: '_sys_spikes', section: 'debug', icon: 'pulse', label: T.spikes, isOn: () => recording, onClick: () => setOpen(!recording) });
        if (location.search.includes('dev')) setOpen(true);
    }

    function setupTouchModeToggle() {
        if (!IS_MOBILE) return;

        window.__rpgTouchEnabled = false;

        const interceptor = (e) => {
            // Касание мимо меню ⚙ закрывает его. Проверка здесь, а не только в обработчике
            // на document: перехватчик глотает касание раньше, и меню оставалось открытым
            if ((e.type === 'pointerdown' || e.type === 'touchstart') && !(e.target && e.target.closest && e.target.closest('#_sys_menu_container'))) closeMenu();
            if (window.__rpgTouchEnabled) return;
            if (e.target && e.target.closest && (
                e.target.closest('#_sys_menu_container') ||
                e.target.closest('#_mob_ctrl') ||
                e.target.closest('#_fps_monitor') ||
                e.target.closest('#_spike_panel') ||
                // Окно чит-меню: без этого на телефоне его нельзя было нажать пальцем
                e.target.closest('#cheat_menu') ||
                e.target.closest('#cheat_menu_text')
            )) return;
            e.stopPropagation();
            e.stopImmediatePropagation();
        };

        ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup', 'pointerdown', 'pointermove', 'pointerup'].forEach(ev => {
            window.addEventListener(ev, interceptor, { capture: true, passive: false });
        });

        window.__toggleRpgTouchMode = function() { window.__rpgTouchEnabled = !window.__rpgTouchEnabled; };
        addMenuItem({ id: '_sys_touch', section: 'controls', icon: 'tap', label: T.touch, isOn: () => window.__rpgTouchEnabled, onClick: () => window.__toggleRpgTouchMode() });
    }

    // Чит-меню (56 КБ) раньше загружалось в каждую игру сразу, даже если им не
    // пользовались. Теперь — при первом нажатии пункта в меню ⚙
    function injectEmeraldCheatMenu() {
        let state = 'idle';   // idle → loading → ready

        function openCheats() {
            if (!window.Cheat_Menu) return;
            // Открывается оно только в самой игре: на титульном экране ещё нет героев
            if (typeof $gameActors === 'undefined' || !$gameActors || !$gameActors._data) {
                console.warn('[RPG Fixes] Чит-меню открывается после начала игры');
                return;
            }
            window.Cheat_Menu.overlay_openable = true;
            const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: '1', code: 'Digit1' });
            Object.defineProperty(ev, 'keyCode', { get: () => 49 });
            Object.defineProperty(ev, 'which', { get: () => 49 });
            document.dispatchEvent(ev);
        }

        addMenuItem({
            id: '_sys_cheat', section: 'game', icon: 'wand', label: T.cheats,
            onClick: () => {
                if (state === 'ready') { openCheats(); return; }
                if (state === 'loading') return;
                state = 'loading';
                const css = document.createElement('link');
                css.rel = 'stylesheet';
                css.href = '/Cheat_Menu.css';
                document.head.appendChild(css);
                const script = document.createElement('script');
                script.src = '/Cheat_Menu.js';
                script.onload = () => { state = 'ready'; openCheats(); };
                script.onerror = () => { state = 'idle'; console.warn('[RPG Fixes] Чит-меню не загрузилось'); };
                document.body.appendChild(script);
            },
        });
    }

    // ============================================================================
    // 7. ЧИСТОЕ АУДИО + AUTO-FALLBACK + ЗАЩИТА ОТ АВТО-МУТА ПРИ СНЕ
    // ============================================================================
    // Для проверки, умеет ли браузер Ogg (см. ниже): 100 мс тишины, Vorbis 8 кГц моно.
    // Короче нельзя: из одного пакета Vorbis звука не получается, и Chromium отвечает
    // «не могу декодировать», хотя Ogg умеет
    const OGG_PROBE = 'T2dnUwACAAAAAAAAAAAAAAAAAAAAAOEUWLYBHgF2b3JiaXMAAAAAAUAfAAAAAAAAgFcAAAAAAACZAU9nZ1MAAAAAAAAAAAAAAAAAAAEAAADSMjkZCzD///////////+1A3ZvcmJpcwYAAABmZm1wZWcBAAAAFgAAAGVuY29kZXI9TGF2YyBsaWJ2b3JiaXMBBXZvcmJpcxJCQ1YBAAABAAxSFCElGVNKYwiVUlIpBR1jUFtHHWPUOUYhZBBTiEkZpXtPKpVYSsgRUlgpRR1TTFNJlVKWKUUdYxRTSCFT1jFloXMUS4ZJCSVsTa50FkvomWOWMUYdY85aSp1j1jFFHWNSUkmhcxg6ZiVkFDpGxehifDA6laJCKL7H3lLpLYWKW4q91xpT6y2EGEtpwQhhc+211dxKasUYY4wxxsXiUyiC0JBVAAABAABABAFCQ1YBAAoAAMJQDEVRgNCQVQBABgCAABRFcRTHcRxHkiTLAkJDVgEAQAAAAgAAKI7hKJIjSZJkWZZlWZameZaouaov+64u667t6roOhIasBADIAAAYhiGH3knMkFOQSSYpVcw5CKH1DjnlFGTSUsaYYoxRzpBTDDEFMYbQKYUQ1E45pQwiCENInWTOIEs96OBi5zgQGrIiAIgCAACMQYwhxpBzDEoGIXKOScggRM45KZ2UTEoorbSWSQktldYi55yUTkompbQWUsuklNZCKwUAAAQ4AAAEWAiFhqwIAKIAABCDkFJIKcSUYk4xh5RSjinHkFLMOcWYcowx6CBUzDHIHIRIKcUYc0455iBkDCrmHIQMMgEAAAEOAAABFkKhISsCgDgBAIMkaZqlaaJoaZooeqaoqqIoqqrleabpmaaqeqKpqqaquq6pqq5seZ5peqaoqp4pqqqpqq5rqqrriqpqy6ar2rbpqrbsyrJuu7Ks256qyrapurJuqq5tu7Js664s27rkearqmabreqbpuqrr2rLqurLtmabriqor26bryrLryratyrKua6bpuqKr2q6purLtyq5tu7Ks+6br6rbqyrquyrLu27au+7KtC7vourauyq6uq7Ks67It67Zs20LJ81TVM03X9UzTdVXXtW3VdW1bM03XNV1XlkXVdWXVlXVddWVb90zTdU1XlWXTVWVZlWXddmVXl0XXtW1Vln1ddWVfl23d92VZ133TdXVblWXbV2VZ92Vd94VZt33dU1VbN11X103X1X1b131htm3fF11X11XZ1oVVlnXf1n1lmHWdMLqurqu27OuqLOu+ruvGMOu6MKy6bfyurQvDq+vGseu+rty+j2rbvvDqtjG8um4cu7Abv+37xrGpqm2brqvrpivrumzrvm/runGMrqvrqiz7uurKvm/ruvDrvi8Mo+vquirLurDasq/Lui4Mu64bw2rbwu7aunDMsi4Mt+8rx68LQ9W2heHVdaOr28ZvC8PSN3a+AACAAQcAgAATykChISsCgDgBAAYhCBVjECrGIIQQUgohpFQxBiFjDkrGHJQQSkkhlNIqxiBkjknIHJMQSmiplNBKKKWlUEpLoZTWUmotptRaDKG0FEpprZTSWmopttRSbBVjEDLnpGSOSSiltFZKaSlzTErGoKQOQiqlpNJKSa1lzknJoKPSOUippNJSSam1UEproZTWSkqxpdJKba3FGkppLaTSWkmptdRSba21WiPGIGSMQcmck1JKSamU0lrmnJQOOiqZg5JKKamVklKsmJPSQSglg4xKSaW1kkoroZTWSkqxhVJaa63VmFJLNZSSWkmpxVBKa621GlMrNYVQUgultBZKaa21VmtqLbZQQmuhpBZLKjG1FmNtrcUYSmmtpBJbKanFFluNrbVYU0s1lpJibK3V2EotOdZaa0ot1tJSjK21mFtMucVYaw0ltBZKaa2U0lpKrcXWWq2hlNZKKrGVklpsrdXYWow1lNJiKSm1kEpsrbVYW2w1ppZibLHVWFKLMcZYc0u11ZRai621WEsrNcYYa2415VIAAMCAAwBAgAlloNCQlQBAFAAAYAxjjEFoFHLMOSmNUs45JyVzDkIIKWXOQQghpc45CKW01DkHoZSUQikppRRbKCWl1losAACgwAEAIMAGTYnFAQoNWQkARAEAIMYoxRiExiClGIPQGKMUYxAqpRhzDkKlFGPOQcgYc85BKRljzkEnJYQQQimlhBBCKKWUAgAAChwAAAJs0JRYHKDQkBUBQBQAAGAMYgwxhiB0UjopEYRMSielkRJaCylllkqKJcbMWomtxNhICa2F1jJrJcbSYkatxFhiKgAA7MABAOzAQig0ZCUAkAcAQBijFGPOOWcQYsw5CCE0CDHmHIQQKsaccw5CCBVjzjkHIYTOOecghBBC55xzEEIIoYMQQgillNJBCCGEUkrpIIQQQimldBBCCKGUUgoAACpwAAAIsFFkc4KRoEJDVgIAeQAAgDFKOSclpUYpxiCkFFujFGMQUmqtYgxCSq3FWDEGIaXWYuwgpNRajLV2EFJqLcZaQ0qtxVhrziGl1mKsNdfUWoy15tx7ai3GWnPOuQAA3AUHALADG0U2JxgJKjRkJQCQBwBAIKQUY4w5h5RijDHnnENKMcaYc84pxhhzzjnnFGOMOeecc4wx55xzzjnGmHPOOeecc84556CDkDnnnHPQQeicc845CCF0zjnnHIQQCgAAKnAAAAiwUWRzgpGgQkNWAgDhAACAMZRSSimllFJKqKOUUkoppZRSAiGllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimVUkoppZRSSimllFJKKaUAIN8KBwD/BxtnWEk6KxwNLjRkJQAQDgAAGMMYhIw5JyWlhjEIpXROSkklNYxBKKVzElJKKYPQWmqlpNJSShmElGILIZWUWgqltFZrKam1lFIoKcUaS0qppdYy5ySkklpLrbaYOQelpNZaaq3FEEJKsbXWUmuxdVJSSa211lptLaSUWmstxtZibCWlllprqcXWWkyptRZbSy3G1mJLrcXYYosxxhoLAOBucACASLBxhpWks8LR4EJDVgIAIQEABDJKOeecgxBCCCFSijHnoIMQQgghREox5pyDEEIIIYSMMecghBBCCKGUkDHmHIQQQgghhFI65yCEUEoJpZRSSucchBBCCKWUUkoJIYQQQiillFJKKSGEEEoppZRSSiklhBBCKKWUUkoppYQQQiillFJKKaWUEEIopZRSSimllBJCCKGUUkoppZRSQgillFJKKaWUUkooIYRSSimllFJKCSWUUkoppZRSSikhlFJKKaWUUkoppQAAgAMHAIAAI+gko8oibDThwgMQAAAAAgACTACBAYKCUQgChBEIAAAAAAAIAPgAAEgKgIiIaOYMDhASFBYYGhweICIkAAAAAAAAAAAAAAAABE9nZ1MABCADAAAAAAAAAAAAAAIAAAB1uGc9BQEBAQEBAAAAAAA=';

    function setupSecureAudio() {
        if (typeof AudioManager !== 'undefined' && !AudioManager.__SafeCheckPatched) {
            AudioManager.__SafeCheckPatched = true; 
            const orig = AudioManager.checkErrors; 
            AudioManager.checkErrors = function () { try { if (orig) orig.apply(this, arguments); } catch (e) {} };
        }

        // Блок decTimer отсюда удален, чтобы не ломать картинки!

        // --- Формат звука: Ogg или m4a ---
        // Звук в играх — Ogg. Safari научился его играть только в iOS 18.4, и «умею» от
        // тега <audio> ещё не значит, что умеет Web Audio, через который звучат игры.
        // Поэтому проверяем по-настоящему: декодируем крошечный Ogg (2,6 КБ тишины).
        // Это миллисекунды — проверка заканчивается раньше, чем игра попросит первый звук.
        // Умеет — игра получает свой Ogg как есть. Не умеет (iPhone до iOS 18.4, старые Mac):
        // MV просит .m4a (сервер отдаст готовый или перекодирует), а MZ разбирает Ogg
        // своим встроенным декодером. Раньше формат угадывал сервер по User-Agent: iPhone
        // всегда получал перекодированный m4a — каждая мелодия в первый раз ждала FFmpeg,
        // а MZ на старых iOS получал m4a вместо Ogg для своего декодера и молчал
        const oggAudio = { ok: false };
        try { oggAudio.ok = !!document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"'); } catch (_) {}
        if (oggAudio.ok) {
            try {
                const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
                const bytes = Uint8Array.from(atob(OGG_PROBE), (c) => c.charCodeAt(0));
                const fail = () => { oggAudio.ok = false; };
                const p = new OAC(1, 1, 22050).decodeAudioData(bytes.buffer, () => {}, fail);
                if (p && p.catch) p.catch(fail);
            } catch (_) { oggAudio.ok = false; }
        }
        window.__rpgOggAudio = oggAudio;

        const formatTimer = setInterval(() => {
            if (typeof WebAudio !== 'undefined' && typeof AudioManager !== 'undefined') {
                if (typeof Utils !== 'undefined' && Utils.RPGMAKER_NAME === 'MZ') {
                    // MZ всегда просит .ogg и сам решает, декодировать ли его своим декодером
                    Utils.canPlayOgg = () => oggAudio.ok;
                } else {
                    // MV на телефонах по умолчанию просит .m4a, а в сборках для Windows
                    // его обычно нет — поэтому Ogg всегда, когда браузер его умеет
                    WebAudio.canPlayOgg = () => oggAudio.ok;
                    AudioManager.audioFileExt = () => (oggAudio.ok ? '.ogg' : '.m4a');
                }
                clearInterval(formatTimer);
            }
        }, 50);

        // 🔥 ОТКЛЮЧАЕМ ВСТРОЕННЫЙ АВТО-МУТ ДВИЖКА ПРИ СВОРАЧИВАНИИ
        // Игра больше не будет пытаться плавно затушить звук (из-за чего он ломался после сна)
        const blurTimer = setInterval(() => {
            if (typeof WebAudio !== 'undefined') {
                if (WebAudio._onHide) WebAudio._onHide = function() {}; 
                if (WebAudio._onShow) WebAudio._onShow = function() {}; 
                if (WebAudio._shouldMuteOnHide) WebAudio._shouldMuteOnHide = function() { return false; }; 
                if (typeof AudioManager !== 'undefined' && AudioManager.shouldMuteOnFocus) {
                    AudioManager.shouldMuteOnFocus = function() { return false; };
                }
                clearInterval(blurTimer);
            }
        }, 50);

        // 4) УМНЫЙ АВТО-FALLBACK (С ожиданием пробуждения)
        const fallbackTimer = setInterval(() => {
            if (typeof WebAudio !== 'undefined') {
                clearInterval(fallbackTimer);
                
                if (window.fetch && !window.__fetchAudioPatched) {
                    window.__fetchAudioPatched = true;
                    const origFetch = window.fetch;
                    window.fetch = async function(...args) {
                        let res;
                        try {
                            res = await origFetch(...args);
                        } catch (e) {
                            if (e.name === 'AbortError' || (e.message && e.message.toLowerCase().includes('aborted'))) {
                                await new Promise(resolve => {
                                    const handler = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', handler); resolve(); } };
                                    if (document.hidden) document.addEventListener('visibilitychange', handler); else resolve();
                                });
                                return window.fetch(...args);
                            }
                            throw e;
                        }
                        
                        if (!res.ok && typeof args[0] === 'string' && args[0].match(/\.(ogg|rpgmvo)$/i)) {
                            const fbUrl = args[0].replace(/\.ogg$/i, '.m4a').replace(/\.rpgmvo$/i, '.rpgmvm');
                            try { const fbRes = await origFetch(fbUrl, args[1]); if (fbRes.ok) return fbRes; } catch(e) {}
                        }
                        return res;
                    };
                }

                if (WebAudio.prototype._load && !WebAudio.prototype.__loadPatched) {
                    WebAudio.prototype.__loadPatched = true;
                    WebAudio.prototype._load = function(url) {
                        const self = this;
                        const encrypted = typeof Decrypter !== 'undefined' && Decrypter.hasEncryptedAudio;
                        // Шифрованный звук для браузера без Ogg просим обычным .m4a: сервер
                        // сам расшифрует и перекодирует. Раньше просили .rpgmvm, которого
                        // в сборках для Windows нет, — и на старых iPhone было тихо
                        const plainM4a = encrypted && !oggAudio.ok && /\.m4a$/i.test(url);
                        const finalUrl = encrypted && !plainM4a ? Decrypter.extToEncryptExt(url) : url;
                        const onLoad = (x) => {
                            if (!plainM4a) return self._onXhrLoad(x);
                            // Ответ уже расшифрован. _onXhrLoad смотрит на флаг сразу, ещё до
                            // декодирования, — на это время его и снимаем
                            Decrypter.hasEncryptedAudio = false;
                            try { self._onXhrLoad(x); } finally { Decrypter.hasEncryptedAudio = true; }
                        };
                        const xhr = new XMLHttpRequest();
                        xhr.open('GET', finalUrl);
                        xhr.responseType = 'arraybuffer';
                        xhr.onload = function() {
                            if (xhr.status < 400) {
                                onLoad(xhr);
                            } else if (finalUrl.match(/\.(ogg|rpgmvo)$/i)) {
                                const fbUrl = finalUrl.replace(/\.ogg$/i, '.m4a').replace(/\.rpgmvo$/i, '.rpgmvm');
                                const xhr2 = new XMLHttpRequest();
                                xhr2.open('GET', fbUrl); xhr2.responseType = 'arraybuffer';
                                xhr2.onload = function() { if (xhr2.status < 400) self._onXhrLoad(xhr2); else self._isError = true; };
                                xhr2.onerror = function() { self._isError = true; }; xhr2.send();
                            } else { self._isError = true; }
                        };
                        xhr.onerror = function() { self._isError = true; };
                        xhr.send();
                    };
                }
            }
        }, 50);

        // 5) ЗВУК ВКЛЮЧАЕТСЯ С ПЕРВОГО КАСАНИЯ
        // Браузер не пускает звук, пока человек не коснулся страницы, а iPhone засчитывает
        // только конец касания — touchend или click, начало (touchstart) не считается.
        // Движок включает звук сам, но на телефоне касания по экрану до него не доходят:
        // их перехватывает setupTouchModeToggle. Поэтому включаем здесь, на window в фазе
        // захвата: этот слушатель ставится раньше перехватчика и раньше экранных кнопок.
        // Раньше тут слушались только touchstart и pointerdown, а пауза в 500 мс после
        // них отбрасывала click того же касания, — на iPhone звук не появлялся, пока
        // не нажмёшь экранную кнопку
        function forceAudioWakeUp() {
            const ctx = (typeof WebAudio !== 'undefined' && WebAudio._context) ? WebAudio._context : null;
            // 'interrupted' — iOS: звонок, Siri, выключенный экран
            if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
            try {
                ctx.resume().catch(() => {});
                // Пустой звук — старый способ отпереть его на iOS, для движков постарше
                const src = ctx.createBufferSource();
                src.buffer = ctx.createBuffer(1, 1, 22050);
                src.connect(ctx.destination);
                src.start(0);
            } catch (err) {}
        }

        ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'click', 'keydown'].forEach(ev => {
            window.addEventListener(ev, forceAudioWakeUp, { capture: true, passive: true });
        });

        // Видео со звуком iPhone тоже запускает только из касания. Но разрешение даётся
        // плееру, а не ролику: стоит один раз запустить плеер в касании — дальше он играет
        // сам. Плеер у движка один на все ролики, его и «разрешаем» первым касанием. Ролик,
        // который уже идёт без звука (начался до касания), этим касанием получает звук.
        // Только конец касания, клик и клавиша: начало касания iPhone не засчитывает
        function unlockVideo(e) {
            if (!e.isTrusted) return;
            // Ролики, которые начались до касания и идут без звука, получают звук. Каждым
            // касанием, а не только первым: плагины заводят для роликов свои плееры, и
            // каждому новому iPhone заново не даёт звук
            for (const muted of mutedVideos) muted.muted = false;
            mutedVideos.clear();
            const v = (typeof Graphics !== 'undefined' && Graphics._video) || (typeof Video !== 'undefined' && Video._element);
            if (!v || v.__rpgUnlocked || !v.paused) return;
            v.__rpgUnlocked = true;
            try {
                const p = _originalVideoPlay.call(v);
                if (p && p.catch) p.catch(() => {});
                v.pause();
            } catch (_) {}
        }
        ['touchend', 'click', 'keydown'].forEach(ev => {
            window.addEventListener(ev, unlockVideo, { capture: true, passive: true });
        });

        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) setTimeout(forceAudioWakeUp, 100);
        });
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

    // ============================================================================
    // ФИКС КРАША СНИМКОВ ЭКРАНА (Броня на уровне движка RPG Maker)
    // ============================================================================
    const bitmapShieldTimer = setInterval(() => {
        // Ждем, пока движок загрузит класс Bitmap
        if (typeof Bitmap !== 'undefined' && Bitmap.prototype && Bitmap.prototype.getPixel) {
            clearInterval(bitmapShieldTimer);
            
            // 1. Защита функции getPixel (Часто ломается при определении клика по картинке)
            const origGetPixel = Bitmap.prototype.getPixel;
            Bitmap.prototype.getPixel = function(x, y) {
                x = (isFinite(x) && !isNaN(x)) ? Math.round(x) : 0;
                y = (isFinite(y) && !isNaN(y)) ? Math.round(y) : 0;
                try {
                    return origGetPixel.call(this, x, y);
                } catch(e) {
                    return '#000000'; // Возвращаем черный цвет при ошибке
                }
            };

            // 2. Защита функции getAlphaPixel (Проверка прозрачности)
            const origGetAlphaPixel = Bitmap.prototype.getAlphaPixel;
            Bitmap.prototype.getAlphaPixel = function(x, y) {
                x = (isFinite(x) && !isNaN(x)) ? Math.round(x) : 0;
                y = (isFinite(y) && !isNaN(y)) ? Math.round(y) : 0;
                try {
                    return origGetAlphaPixel.call(this, x, y);
                } catch(e) {
                    return 0; // Возвращаем полную прозрачность при ошибке
                }
            };
            
            // 3. Защита функции clearRect (Очистка экрана)
            const origClearRect = Bitmap.prototype.clearRect;
            Bitmap.prototype.clearRect = function(x, y, width, height) {
                x = (isFinite(x) && !isNaN(x)) ? Math.round(x) : 0;
                y = (isFinite(y) && !isNaN(y)) ? Math.round(y) : 0;
                width = (isFinite(width) && !isNaN(width)) ? Math.round(width) : 1;
                height = (isFinite(height) && !isNaN(height)) ? Math.round(height) : 1;
                try {
                    origClearRect.call(this, x, y, width, height);
                } catch(e) {}
            };

            console.log('[RPG Fixes] 🛡️ Броня Bitmap (getPixel/clearRect) активирована!');
        }
    }, 100);

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
    // 9. АБСОЛЮТНАЯ БРОНЯ ДЛЯ СПРАЙТОВ (Защита от reading 'width')
    // ============================================================================
    function setupSpriteArmor() {
        const spriteArmorTimer = setInterval(() => {
            if (typeof Sprite_Picture !== 'undefined' && typeof Sprite_Character !== 'undefined') {
                clearInterval(spriteArmorTimer);
                
                const safeBitmap = typeof Bitmap !== 'undefined' ? new Bitmap(1, 1) : { width: 1, height: 1, isReady: () => true };
                
                const origPicUpdate = Sprite_Picture.prototype.update;
                Sprite_Picture.prototype.update = function() {
                    if (!this.bitmap) this.bitmap = safeBitmap;
                    try { origPicUpdate.call(this); } catch(e) { console.warn('[RPG Fixes] Перехвачен краш картинки:', e); }
                };

                const origCharUpdate = Sprite_Character.prototype.update;
                Sprite_Character.prototype.update = function() {
                    if (!this.bitmap) this.bitmap = safeBitmap;
                    try { origCharUpdate.call(this); } catch(e) { console.warn('[RPG Fixes] Перехвачен краш персонажа:', e); }
                };
                
                console.log('[RPG Fixes] 🛡️ Броня спрайтов активирована!');
            }
        }, 100);
    }

    // ============================================================================
    // 10. СОВРЕМЕННЫЙ ДЕШИФРАТОР (Идеальный фикс загрузки .rpgmvp)
    // ============================================================================
    function setupModernDecrypter() {
        var decrypterPatchTimer = setInterval(function() {
            if (typeof Decrypter === 'undefined' || !Decrypter.decryptImg) return;
            clearInterval(decrypterPatchTimer);

            Decrypter.decryptImg = function(url, bitmap) {
                var self = this;
                var encUrl = this.extToEncryptExt(url);

                fetch(encUrl, { cache: 'no-store' })
                    .then(function(response) {
                        if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + encUrl);
                        return response.arrayBuffer();
                    })
                    .then(function(arrayBuffer) {
                        var decrypted = self.decryptArrayBuffer(arrayBuffer);
                        var blob      = new Blob([decrypted], { type: 'image/png' });
                        var blobUrl   = URL.createObjectURL(blob);

                        var freshImage = new Image();

                        freshImage.onload = function() {
                            bitmap._image.onload = function() {
                                if (bitmap._baseTexture) {
                                    bitmap._baseTexture.hasLoaded = true;
                                    bitmap._baseTexture.width  = bitmap._image.naturalWidth  || bitmap._image.width  || 1;
                                    bitmap._baseTexture.height = bitmap._image.naturalHeight || bitmap._image.height || 1;
                                    bitmap._baseTexture.source = bitmap._image;
                                    bitmap._baseTexture.dirty();
                                    if (bitmap._baseTexture.emit) {
                                        bitmap._baseTexture.emit('loaded', bitmap._baseTexture);
                                    }
                                }
                                bitmap._url       = url;
                                bitmap._isLoading = false;
                                bitmap.width  = bitmap._image.naturalWidth  || bitmap._image.width  || 1;
                                bitmap.height = bitmap._image.naturalHeight || bitmap._image.height || 1;

                                if (Array.isArray(bitmap._loadListeners)) {
                                    var listeners = bitmap._loadListeners.slice();
                                    bitmap._loadListeners = [];
                                    for (var li = 0; li < listeners.length; li++) {
                                        try { listeners[li](bitmap); } catch(e) {}
                                    }
                                }
                                if (typeof bitmap._onLoad === 'function') {
                                    try { bitmap._onLoad(); } catch(e) {}
                                }
                                setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 5000);
                            };
                            bitmap._image.onerror = function() {
                                console.warn('[RPG Fixes] Blob onerror:', url);
                                bitmap._isLoading = false;
                                if (Array.isArray(bitmap._loadListeners)) bitmap._loadListeners = [];
                                if (typeof bitmap._onError === 'function') { try { bitmap._onError(); } catch(e) {} }
                            };
                            bitmap._image.src = blobUrl;
                            if (bitmap._image.complete && bitmap._image.naturalWidth > 0) {
                                bitmap._image.onload();
                            }
                        };
                        freshImage.onerror = function() {
                            console.warn('[RPG Fixes] Blob freshImage error:', url);
                            bitmap._isLoading = false;
                            if (Array.isArray(bitmap._loadListeners)) bitmap._loadListeners = [];
                        };
                        freshImage.src = blobUrl;
                        if (freshImage.complete && freshImage.naturalWidth > 0) {
                            freshImage.onload();
                        }
                    })
                    .catch(function(e) {
                        console.warn('[RPG Fixes] Decrypter fetch error:', url, e);
                        bitmap._isLoading = false;
                        if (Array.isArray(bitmap._loadListeners)) bitmap._loadListeners = [];
                        if (typeof bitmap._onError === 'function') { try { bitmap._onError(); } catch(e2) {} }
                    });
            };
            console.log('[RPG Fixes] Bulletproof Decrypter MV 1.5.1 activated!');
        }, 100);
        setTimeout(function() { clearInterval(decrypterPatchTimer); }, 15000);
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
        //setupGlobalCrashProtection();
        //setupSpriteArmor();
        console.log('✅ RPG-Fixes Ultimate v4.1 успешно загружен!');
    }

    // ============================================================================
    // ПАТЧ ДЛЯ ПЛАГИНА TS_ADVsystem / TS_Decode (ПРАВИЛЬНЫЙ PROTOTYPE)
    // ============================================================================
    var aggressiveAdvPatch = setInterval(function() {
        if (typeof ADV_System === 'undefined' || !ADV_System || !ADV_System.prototype) return;
        clearInterval(aggressiveAdvPatch);
        console.log('[RPG Fixes] ADV_System.prototype patch activated!');

        // 1. localFileDirectoryPath — всегда возвращает 'scenario/'
        Object.defineProperty(ADV_System.prototype, 'localFileDirectoryPath', {
            value: function() { return 'scenario/'; },
            writable: false,
            configurable: false
        });

        // 2. УМНЫЙ fileLoad: перебор расширений, XHR и XOR-дешифровка
        ADV_System.prototype.fileLoad = function(filename) {
            // На веб-серверах важен регистр и точное расширение
            var variants = [
                'scenario/' + filename + '.txt',
                'scenario/' + filename + '.sl',
                'Scenario/' + filename + '.txt',
                'Scenario/' + filename + '.sl'
            ];
            
            var file_data = '';
            var successUrl = '';
            
            // Пробуем найти файл по всем вариантам путей
            for (var i = 0; i < variants.length; i++) {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', variants[i], false); 
                xhr.overrideMimeType('text/plain; charset=utf-8');
                try {
                    xhr.send();
                    // Сервер по IPv4 может вернуть статус 200 (ОК) или 0 (если CORS/локалка)
                    if (xhr.status === 200 || xhr.status === 0) {
                        if (xhr.responseText) {
                            file_data = xhr.responseText;
                            successUrl = variants[i];
                            break; // Файл найден!
                        }
                    }
                } catch(e) { }
            }
            
            if (!file_data) {
                console.error('[RPG Fixes] 🔴 Сценарий не найден (404) ни в одном из форматов:', filename);
                return '';
            }
            
            console.log('[RPG Fixes] 🟢 Сценарий скачан:', successUrl);
            
            // Восстанавливаем логику TS_Decode.js для расшифровки текста!
            if (typeof PluginManager !== 'undefined') {
                var parameters = PluginManager.parameters('TS_Decode');
                var argTsDecodeDebug = eval(parameters['Decode'] || 'false');
                var argTsDecodeKey = parseInt(parameters['Key'] || '255');
                
                if (argTsDecodeDebug) {
                    var text_ary = file_data.split('');
                    for (var j = 0; j < text_ary.length; j++) {
                        text_ary[j] = String.fromCharCode(text_ary[j].charCodeAt(0) ^ argTsDecodeKey);
                    }
                    file_data = text_ary.join('');
                    console.log('[RPG Fixes] 🔓 Текст сценария успешно расшифрован!');
                }
            }
            
            return file_data;
        };
        console.log('[RPG Fixes] ADV_System.fileLoad + localFileDirectoryPath patched!');
    }, 10);
    setTimeout(function() { clearInterval(aggressiveAdvPatch); }, 15000);

    // ============================================================================
    // --- УЛЬТИМАТИВНЫЙ ФИКС ВИДЕО ДЛЯ IOS ---
    // ============================================================================

    // 1. Перехватываем само рождение видео-элемента (самый надежный способ для iPhone)
    const _origCreateElement = document.createElement;
    document.createElement = function(tagName, options) {
        const el = _origCreateElement.call(this, tagName, options);
        if (tagName && tagName.toLowerCase() === 'video') {
            // Намертво прибиваем атрибуты до того, как Safari о них узнает
            el.setAttribute('playsinline', 'playsinline');
            el.setAttribute('webkit-playsinline', 'playsinline');
            el.setAttribute('disablePictureInPicture', 'true');
            el.controls = false; // Отключаем элементы управления плеера
        }
        return el;
    };

    // 2. Запуск ролика. Движок включает ролик из игрового цикла, а не из касания, и iPhone
    //    отказывал ролику со звуком — rpg-fixes тогда имитировал конец, и ролик пропускался.
    //    Теперь ролик, начатый до первого касания, идёт без звука, а касание возвращает звук
    //    (unlockVideo в setupSecureAudio); после первого касания плеер играет со звуком сам
    const _originalVideoPlay = HTMLVideoElement.prototype.play;
    const mutedVideos = new Set();   // заглушены нами: звук им вернёт следующее касание
    HTMLVideoElement.prototype.play = function() {
        // Дублируем защиту на всякий случай
        this.setAttribute('playsinline', 'playsinline');
        this.setAttribute('webkit-playsinline', 'playsinline');

        const promise = _originalVideoPlay.apply(this, arguments);

        if (promise !== undefined) {
            promise.catch(error => {
                // Запуск прервали паузой или следующим роликом — это не отказ. Раньше и тут
                // имитировался конец, и мог оборваться уже следующий ролик
                if (error && error.name === 'AbortError') return;
                if (error && error.name === 'NotAllowedError' && !this.muted) {
                    this.muted = true;
                    mutedVideos.add(this);
                    const retry = _originalVideoPlay.call(this);
                    if (retry && retry.catch) retry.catch(() => this.dispatchEvent(new Event('ended')));
                    return;
                }
                console.warn('[RPG-Fixes] Видео не запустилось:', error);
                // Совсем не играет — имитируем конец, чтобы игра не зависла
                setTimeout(() => {
                    this.dispatchEvent(new Event('ended'));
                }, 100);
            });
        }
        return promise;
    };

    // 3. MV на телефонах всегда просит ролик в .mp4, а в сборках для Windows ролики только
    //    .webm — на iPhone каждый ролик MV упирался в 404 и пропускался. Safari играет WebM
    //    с iOS 17.4, так что просим .webm всегда, когда браузер его умеет. MZ так и делает сам
    let canWebm = false;
    try { canWebm = !!_origCreateElement.call(document, 'video').canPlayType('video/webm'); } catch (_) {}
    const videoExtTimer = setInterval(() => {
        if (typeof Game_Interpreter === 'undefined' || typeof Utils === 'undefined') return;
        clearInterval(videoExtTimer);
        if (Utils.RPGMAKER_NAME === 'MZ') return;
        Game_Interpreter.prototype.videoFileExt = () => (canWebm ? '.webm' : '.mp4');
    }, 50);
    setTimeout(() => clearInterval(videoExtTimer), 30000);

    // 4. Библиотека iphone-inline-video из MV нужна была iPhone до iOS 10, где видео внутри
    //    страницы не играло: она подменяет плееру play() и сама листает кадры. Старый iPhone
    //    она узнаёт по признаку, который есть только у Safari, — у любого другого браузера
    //    с iPhone в User-Agent она включается зря и ломает ролик. Где браузер играет видео
    //    внутри страницы сам, отключаем её
    if ('playsInline' in HTMLVideoElement.prototype) {
        const inlineVideoTimer = setInterval(() => {
            if (typeof window.makeVideoPlayableInline !== 'function') return;
            clearInterval(inlineVideoTimer);
            window.makeVideoPlayableInline = function() {};
        }, 20);
        setTimeout(() => clearInterval(inlineVideoTimer), 30000);
    }

   // ============================================================================
    // 🛡️ БРОНЯ ОТ ПОВРЕЖДЕННЫХ СЕЙВОВ И ОШИБОК ПЛАГИНОВ (V5 HYPER-SPEED)
    // ============================================================================
    const saveFixInterval = setInterval(() => {
        
        // 1. Лечим ядро StorageManager (global -> array)
        if (window.StorageManager && window.StorageManager.loadObject && !window.StorageManager.loadObject._isSafe) {
            const origLoad = window.StorageManager.loadObject;
            window.StorageManager.loadObject = function(saveName) {
                return origLoad.apply(this, arguments).then(contents => {
                    if (saveName === 'global') return (contents && Array.isArray(contents)) ? contents : [];
                    return contents || {}; 
                }).catch(e => {
                    return saveName === 'global' ? [] : {};
                });
            };
            window.StorageManager.loadObject._isSafe = true;
            console.log('[RPG Fixes] 🛡️ Ядро StorageManager защищено (global -> array)');
        }

        // 2. Лечим плагин UTA_CommonSaveMZ
        if (window.utakata && window.utakata.CommonSave && !window.utakata.CommonSave._isSafe) {
            const origLoadS = window.utakata.CommonSave.loadCommonSaveSwitches;
            window.utakata.CommonSave.loadCommonSaveSwitches = function(contents) {
                if (!contents) return;
                return origLoadS.apply(this, arguments);
            };
            const origLoadV = window.utakata.CommonSave.loadCommonSaveVariables;
            window.utakata.CommonSave.loadCommonSaveVariables = function(contents) {
                if (!contents) return;
                return origLoadV.apply(this, arguments);
            };
            window.utakata.CommonSave._isSafe = true;
            console.log('[RPG Fixes] 🛡️ Плагин UTA_CommonSaveMZ вылечен');
        }

        // 3. Железобетонная защита от краша NUUN_SaveScreen (Восстанавливающийся щит)
        if (window.DataManager && window.DataManager.loadBackground && !window.DataManager.loadBackground._isSafe) {
            const origLoadBg = window.DataManager.loadBackground;
            window.DataManager.loadBackground = function(savefileId) {
                if (!this._globalInfo || !this._globalInfo[savefileId]) return null;
                try { return origLoadBg.apply(this, arguments); } catch(e) { return null; }
            };
            window.DataManager.loadBackground._isSafe = true;
            console.log('[RPG Fixes] 🛡️ DataManager.loadBackground (NUUN) вылечен');
        }

        // Патчим отрисовку фона
        if (window.Scene_File && window.Scene_File.prototype.createBackground && !window.Scene_File.prototype.createBackground._isSafe) {
            const origCreateBg = window.Scene_File.prototype.createBackground;
            window.Scene_File.prototype.createBackground = function() {
                try {
                    origCreateBg.apply(this, arguments);
                } catch(e) {
                    console.warn('[RPG Fixes] 🛡️ Предотвращен краш фона меню сохранений:', e);
                    if (!this._backgroundSprite) {
                        this._backgroundSprite = new window.Sprite(); 
                        this.addChild(this._backgroundSprite);
                    }
                }
            };
            window.Scene_File.prototype.createBackground._isSafe = true;
            console.log('[RPG Fixes] 🛡️ Scene_File.createBackground защищен');
        }

        // 4. Шрифты MV: не ждать вечно шрифт, который не загрузится (нет файла, битый), и не
        //    бросать медленный. Раньше через секунду любой недогрузившийся шрифт считался
        //    «мёртвым»: у Karryn's Prison он весит 7,5 МБ, и на телефоне меню титула
        //    рисовалось запасным шрифтом. Теперь смотрим, что с ним на самом деле:
        //    загрузился — дальше, ошибка или его вовсе нет — дальше без него,
        //    грузится — ждём, но не дольше 20 секунд
        if (window.Graphics && typeof window.Graphics.isFontLoaded === 'function' && !window.Graphics._fontPatchActive) {
            const _origIsFontLoaded = window.Graphics.isFontLoaded;
            const fontWaitStart = Date.now();
            const skipped = new Set();
            const fontState = (name) => {
                const want = String(name).replace(/["']/g, '').toLowerCase();
                const faces = [];
                try {
                    document.fonts.forEach(f => { if (f.family.replace(/["']/g, '').toLowerCase() === want) faces.push(f); });
                } catch (_) { return 'unknown'; }
                if (!faces.length) return 'missing';
                if (faces.some(f => f.status === 'loaded')) return 'loaded';
                if (faces.every(f => f.status === 'error')) return 'error';
                // Объявлен, но никто его ещё не попросил — просим сами, иначе ждали бы зря
                faces.forEach(f => { if (f.status === 'unloaded') f.load().catch(() => {}); });
                return 'loading';
            };
            const skip = (name, why) => {
                if (!skipped.has(name)) {
                    skipped.add(name);
                    console.warn(`[RPG Fixes] 🛡️ Шрифт ${name}: ${why} — игра стартует без него`);
                }
                return true;
            };

            window.Graphics.isFontLoaded = function(name) {
                if (_origIsFontLoaded.apply(this, arguments)) return true;
                const state = fontState(name);
                if (state === 'loaded') return true;
                if (state === 'error') return skip(name, 'файл не загрузился');
                if (state === 'missing') return skip(name, 'игра его не объявила');
                if (Date.now() - fontWaitStart > 20000) return skip(name, 'не догрузился за 20 секунд');
                return false;
            };
            window.Graphics._fontPatchActive = true;
            console.log('[RPG Fixes] 🛡️ Защита шрифтов (MV) активирована');
        }

        // 5. Защита от вечной загрузки при пропавших шрифтах (Для новых игр MZ)
        if (window.FontManager && window.FontManager.startLoading && !window.FontManager._fontPatchActive) {
            const _origStartLoading = window.FontManager.startLoading;
            window.FontManager.startLoading = function(family, url) {
                const source = "url(" + url + ")";
                const font = new FontFace(family, source);
                this._urls[family] = url;
                this._states[family] = "loading";
                font.load()
                    .then(() => {
                        document.fonts.add(font);
                        this._states[family] = "loaded";
                    })
                    .catch((e) => {
                        console.warn(`[RPG Fixes] 🛡️ Пропущен сломанный шрифт: ${url}`);
                        this._states[family] = "loaded"; // Обманываем движок MZ
                    });
            };
            window.FontManager._fontPatchActive = true;
            console.log('[RPG Fixes] 🛡️ Защита от вечной загрузки шрифтов (MZ) активирована');
        }

    }, 5); // Часто — чтобы успеть до первого использования этих функций при загрузке игры
    // ...но только пока игра загружается. Раньше проверка крутилась 200 раз в секунду
    // до самого закрытия вкладки и не давала процессору телефона отдыхать. Всё, что
    // она латает, появляется при загрузке ядра и плагинов — за первые секунды
    setTimeout(() => clearInterval(saveFixInterval), 15000);

    // ============================================================================
    // 🛡️ БРОНЯ ОТ КРИВЫХ ПЛАГИНОВ (ГЛОБАЛЬНЫЙ ПАТЧ JSON.parse - ТИХИЙ РЕЖИМ)
    // ============================================================================
    if (!window._jsonPatchActive) {
        const _origJSONParse = JSON.parse;
        JSON.parse = function(text, reviver) {
            try {
                return _origJSONParse.apply(this, arguments);
            } catch (e) {
                if (typeof text === 'string') {
                    const trimmed = text.trim();
                    
                    // 1. Игнорируем пустые строки (возвращаем оригинальную ошибку, чтобы плагины сами ее тихо обработали)
                    if (trimmed === '') {
                        return text; 
                    }
                    
                    // 2. Спасаем математические формулы (типа "816 / 1000")
                    if (/^[\d\s\.\/\*\+\-\(\)]+$/.test(trimmed) && trimmed.length > 0) {
                        try {
                            const result = eval(trimmed);
                            console.warn(`[RPG Fixes] 🛡️ Спасен JSON (формула): "${text}" -> ${result}`);
                            return result;
                        } catch (err) {}
                    }
                }
                throw e; // Если это реально сломанный объект, кидаем ошибку дальше
            }
        };
        window._jsonPatchActive = true;
        console.log('[RPG Fixes] 🛡️ Глобальная защита JSON.parse активирована (Тихий режим)');
    }

    initUltimateFixes();

})();
