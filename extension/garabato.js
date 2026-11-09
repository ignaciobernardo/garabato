/* Garabato — scribble on any web page while you record it: tab + camera + mic,
   drawings on top and comments pinned to the page, stamped with their time in the video.
   Works as an injected content script (the extension) or as a plain <script>.
   https://github.com/ignaciobernardo/garabato · MIT */
(() => {
  'use strict';

  const HOST_ID = 'garabato-host';
  const prev = document.getElementById(HOST_ID);
  if (prev) { prev.dispatchEvent(new CustomEvent('garabato:toggle')); return; }

  // ───────────────────────────── utils
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (ms) => { const s = Math.max(0, Math.floor((ms || 0) / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const vttTime = (ms) => { const d = new Date(Math.max(0, ms)); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}.${String(d.getUTCMilliseconds()).padStart(3, '0')}`; };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const now = () => performance.now();
  let ttPolicy = null;
  try { if (window.trustedTypes?.createPolicy) ttPolicy = window.trustedTypes.createPolicy('garabato-' + Math.random().toString(36).slice(2, 8), { createHTML: (s) => s }); } catch { /* no Trusted Types */ }
  const setHTML = (el, s) => { el.innerHTML = ttPolicy ? ttPolicy.createHTML(s) : s; };
  // inside the extension the review video plays in our own page (sidesteps the site's CSP)
  const PLAYER = (() => { try { return globalThis.chrome?.runtime?.id ? chrome.runtime.getURL('player.html') : null; } catch { return null; } })();
  const isEditable = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

  // ───────────────────────────── i18n: English, or Spanish when the browser is in Spanish
  const LANG = /^es\b/i.test(navigator.language || '') ? 'es' : 'en';
  const T = {
    en: {
      red: 'Red', orange: 'Orange', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple', black: 'Black', white: 'White',
      cursor: 'Cursor', pen: 'Pen', marker: 'Highlighter', arrow: 'Arrow', rect: 'Rectangle', comment: 'Comment',
      size: 'Size', move: 'Move', record: 'Record', recordTab: 'Record tab', pause: 'Pause', resume: 'Resume', color: 'Color',
      fadeTip: 'Fading ink: strokes disappear on their own (F)', undoTip: 'Undo (⌘Z)', clearTip: 'Clear drawings',
      camera: 'Camera', mic: 'Microphone', comments: 'Comments', commentsKey: 'Comments (L)', hide: 'Hide Garabato', clickToCancel: 'Click to cancel',
      nothingToUndo: 'Nothing to undo', noDrawings: 'No drawings yet',
      placeholder: 'Write a comment…', del: 'Delete', cancel: 'Cancel', save: 'Save', close: 'Close',
      copyMd: 'Copy as Markdown', downloadMd: 'Download .md', noText: 'no text', copied: 'Comments copied',
      emptyPanel: 'Pick <b>Comment</b> <kbd>C</kbd> and click anywhere on the page.<br>While recording, every comment is stamped with its time in the video.',
      nComments: (n) => `${n} comment${n === 1 ? '' : 's'}`, video: 'video', page: 'page', take: 'R',
      micBlocked: 'Microphone blocked: check the site permission', micFailed: "Couldn't open the microphone",
      camBlocked: (h) => `Chrome blocked the camera on ${h || 'this page'}: click the camera icon in the address bar and allow it`,
      camBusy: 'The camera is busy in another app (Zoom, Meet, FaceTime…). Close it and try again',
      camNone: 'No camera found', camFailed: "Couldn't open the camera: ", camHttps: "This page can't use the camera (it needs https)",
      camLost: 'Lost the camera signal', camOffToast: "Camera off: you won't be in the video",
      camTurnOff: 'Turn camera off', camAuto: 'Camera: turns on when you record (click to see it now)', camMuted: "Camera off: you won't be in the video (click to turn it on)",
      micMute: 'Mute microphone', micUnmute: 'Unmute microphone',
      noScreen: "This browser can't record the screen here", recCancelled: 'Recording cancelled', captureFailed: "Couldn't capture the tab: ",
      recError: 'Recording error: ', unknown: 'unknown',
      recIdle: 'Record this tab with camera and microphone', choosing: 'Choose…', getReady: 'Ready…', saving: 'Saving…', stop: 'Stop recording',
      ready: 'Recording ready', recording: 'Recording', downloadVideo: 'Download video', mdBtn: 'Comments .md', vttBtn: 'Subtitles .vtt',
      copyBtn: 'Copy comments', discard: 'Discard', discardSure: 'Discard without downloading? Click again', notSaved: "You haven't downloaded the video yet",
      fadeOn: 'Fading ink: strokes clear themselves', fadeOff: 'Permanent ink', fadeShort: 'Fading ink',
      stopFirst: 'Stop recording before hiding', hello: 'Garabato is ready · C comments · P draws · Record captures this tab',
    },
    es: {
      red: 'Rojo', orange: 'Naranjo', yellow: 'Amarillo', green: 'Verde', blue: 'Azul', purple: 'Morado', black: 'Negro', white: 'Blanco',
      cursor: 'Cursor', pen: 'Lápiz', marker: 'Destacador', arrow: 'Flecha', rect: 'Rectángulo', comment: 'Comentario',
      size: 'Tamaño', move: 'Mover', record: 'Grabar', recordTab: 'Grabar pestaña', pause: 'Pausar', resume: 'Reanudar', color: 'Color',
      fadeTip: 'Tinta efímera: los trazos se desvanecen (F)', undoTip: 'Deshacer (⌘Z)', clearTip: 'Borrar dibujos',
      camera: 'Cámara', mic: 'Micrófono', comments: 'Comentarios', commentsKey: 'Comentarios (L)', hide: 'Ocultar Garabato', clickToCancel: 'Clic para cancelar',
      nothingToUndo: 'Nada que deshacer', noDrawings: 'No hay dibujos',
      placeholder: 'Escribe un comentario…', del: 'Eliminar', cancel: 'Cancelar', save: 'Guardar', close: 'Cerrar',
      copyMd: 'Copiar como Markdown', downloadMd: 'Descargar .md', noText: 'sin texto', copied: 'Comentarios copiados',
      emptyPanel: 'Elige <b>Comentario</b> <kbd>C</kbd> y haz clic en cualquier parte de la página.<br>Si estás grabando, cada comentario queda marcado con su minuto.',
      nComments: (n) => `${n} comentario${n === 1 ? '' : 's'}`, video: 'video', page: 'pagina', take: 'G',
      micBlocked: 'Micrófono bloqueado: revisa el permiso del sitio', micFailed: 'No pude abrir el micrófono',
      camBlocked: (h) => `Chrome bloqueó la cámara en ${h || 'esta página'}: haz clic en el ícono de cámara de la barra de direcciones y permítela`,
      camBusy: 'La cámara está ocupada por otra app (Zoom, Meet, FaceTime…). Ciérrala y vuelve a intentar',
      camNone: 'No encontré ninguna cámara conectada', camFailed: 'No pude abrir la cámara: ', camHttps: 'Esta página no permite usar la cámara (necesita https)',
      camLost: 'Se perdió la señal de la cámara', camOffToast: 'Cámara apagada: no saldrá en el video',
      camTurnOff: 'Apagar cámara', camAuto: 'Cámara: se enciende al grabar (clic para verla ahora)', camMuted: 'Cámara apagada: no saldrá en el video (clic para encender)',
      micMute: 'Silenciar micrófono', micUnmute: 'Activar micrófono',
      noScreen: 'Este navegador no permite grabar la pantalla aquí', recCancelled: 'Grabación cancelada', captureFailed: 'No pude capturar la pestaña: ',
      recError: 'Error de grabación: ', unknown: 'desconocido',
      recIdle: 'Grabar pestaña con cámara y micrófono', choosing: 'Elige…', getReady: 'Listo…', saving: 'Guardando…', stop: 'Detener grabación',
      ready: 'Grabación lista', recording: 'Grabación', downloadVideo: 'Descargar video', mdBtn: 'Comentarios .md', vttBtn: 'Subtítulos .vtt',
      copyBtn: 'Copiar comentarios', discard: 'Descartar', discardSure: '¿Descartar sin descargar? Clic otra vez', notSaved: 'El video no se ha descargado todavía',
      fadeOn: 'Tinta efímera: los trazos se borran solos', fadeOff: 'Tinta fija', fadeShort: 'Tinta efímera',
      stopFirst: 'Detén la grabación antes de ocultar', hello: 'Garabato listo · C comenta · P dibuja · Grabar captura esta pestaña',
    },
  }[LANG];

  // ───────────────────────────── icons (24×24, stroke)
  const P = {
    cursor: '<path d="M5 3.5l13.5 6.2-5.6 1.9-2 5.7z"/><path d="M13 11.7l5 5"/>',
    pen: '<path d="M4 20l1.2-4.6L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="M13.5 7l3.5 3.5"/>',
    marker: '<path d="M9.5 12.5l-5 5V20h6.5l2.5-2.5"/><path d="M20.5 11.5l-5 5a1.4 1.4 0 0 1-2 0L8.5 11.5a1.4 1.4 0 0 1 0-2l5-5"/>',
    arrow: '<path d="M5 19L18.5 5.5"/><path d="M9 5h10v10"/>',
    rect: '<rect x="4" y="5.5" width="16" height="13" rx="2.5"/>',
    comment: '<path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19.5l1.4-4.6A7.5 7.5 0 1 1 20 11.5z"/>',
    fade: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.2 2.2M9.5 2.5h5"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7"/>',
    cam: '<rect x="3" y="6.5" width="12.5" height="11" rx="2.5"/><path d="M15.5 10.5l5-3v9l-5-3"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    slash: '<path d="M3.5 3.5l17 17"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.5" cy="6.5" r=".6"/><circle cx="4.5" cy="12" r=".6"/><circle cx="4.5" cy="17.5" r=".6"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    pause: '<path d="M9 5.5v13M15 5.5v13"/>',
    play: '<path d="M7.5 5.5l11 6.5-11 6.5z"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>',
    resize: '<path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5"/>',
  };
  const icon = (n, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}${extra}</svg>`;
  const grip = '<svg viewBox="0 0 8 16" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="3" r="1.2"/><circle cx="6" cy="3" r="1.2"/><circle cx="2" cy="8" r="1.2"/><circle cx="6" cy="8" r="1.2"/><circle cx="2" cy="13" r="1.2"/><circle cx="6" cy="13" r="1.2"/></g></svg>';

  // ───────────────────────────── config / state
  const COLORS = [
    { c: '#FF3B30', fg: '#fff', name: T.red },
    { c: '#FF9500', fg: '#fff', name: T.orange },
    { c: '#FFD60A', fg: '#1d1d1f', name: T.yellow },
    { c: '#30D158', fg: '#06210d', name: T.green },
    { c: '#0A84FF', fg: '#fff', name: T.blue },
    { c: '#BF5AF2', fg: '#fff', name: T.purple },
    { c: '#1D1D1F', fg: '#fff', name: T.black },
    { c: '#FFFFFF', fg: '#1d1d1f', name: T.white },
  ];
  const TOOLS = [
    { id: 'cursor', key: 'v', label: T.cursor, icon: 'cursor' },
    { id: 'pen', key: 'p', label: T.pen, icon: 'pen' },
    { id: 'marker', key: 'h', label: T.marker, icon: 'marker' },
    { id: 'arrow', key: 'a', label: T.arrow, icon: 'arrow' },
    { id: 'rect', key: 'r', label: T.rect, icon: 'rect' },
    { id: 'comment', key: 'c', label: T.comment, icon: 'comment' },
  ];
  const DRAW = new Set(['pen', 'marker', 'arrow', 'rect']);
  const WIDTH = { pen: 4, marker: 22, arrow: 4.5, rect: 3.5 };
  const FADE_DELAY = 2600, FADE_DUR = 700;
  const CAM_SIZES = [140, 200, 280];

  const state = {
    visible: true,
    tool: 'cursor',
    color: COLORS[0],
    fade: false,
    micOn: true,
    camOn: false,
    camWanted: true, // the camera turns on by itself when recording, unless you switch it off
    camSize: 1,
    strokes: [],
    comments: [],
    history: [],
    panelOpen: false,
    recCount: 0,
  };
  let uid = 0;

  // ───────────────────────────── host + shadow
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-garabato', '');
  // CSS custom properties inherit into the Shadow DOM: pin ours so the page can't override them
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;'
    + '--c:#FF3B30;--fg:#fff;--s:200px;--lvl:0;--ar:16 / 10;--ring:#1d1d1f;--accent:#0A84FF;';
  const shadow = host.attachShadow({ mode: 'open' });
  const $ = (sel) => shadow.querySelector(sel);

  const STYLE = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }
  .ui { font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1d1d1f; -webkit-font-smoothing: antialiased; letter-spacing: -0.005em; }
  button { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; cursor: pointer; }
  svg { width: 18px; height: 18px; display: block; }
  .hidden { display: none !important; }

  /* ink + pins */
  canvas.ink { position: fixed; left: 0; top: 0; pointer-events: none; touch-action: none; }
  canvas.ink.live { pointer-events: auto; cursor: crosshair; }
  canvas.ink.comment { cursor: copy; }
  .pins { position: fixed; left: 0; top: 0; width: 0; height: 0; will-change: transform; }
  .pin { position: absolute; width: 28px; height: 28px; margin-top: -28px; pointer-events: auto; cursor: pointer;
    border-radius: 14px 14px 14px 3px; background: var(--c); color: var(--fg);
    font: 600 12px/28px -apple-system, BlinkMacSystemFont, "Inter", sans-serif; text-align: center; font-variant-numeric: tabular-nums;
    box-shadow: 0 0 0 2px #fff, 0 6px 16px rgba(0,0,0,.28); transform-origin: 0 100%;
    animation: garabato-pop .32s cubic-bezier(.2,1.5,.4,1); user-select: none; }
  .pin:hover { transform: scale(1.08); }
  .pin.flash { animation: garabato-flash .9s ease 2; }
  .pin .tip { position: absolute; left: 38px; top: -2px; width: max-content; max-width: 260px; min-width: 120px;
    background: #fff; color: #1d1d1f; border-radius: 10px; padding: 8px 11px 9px; text-align: left;
    font: 400 13px/1.4 -apple-system, BlinkMacSystemFont, "Inter", sans-serif; white-space: pre-wrap; word-break: break-word;
    box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 10px 30px rgba(0,0,0,.18); opacity: 0; transform: translateX(-4px);
    transition: opacity .15s, transform .15s; pointer-events: none; }
  .pin .tip:empty { display: none; }
  .pin:hover .tip, .pin.show .tip { opacity: 1; transform: none; }
  @keyframes garabato-pop { from { transform: scale(.2); opacity: 0; } }
  @keyframes garabato-flash { 50% { box-shadow: 0 0 0 2px #fff, 0 0 0 10px color-mix(in srgb, var(--c) 35%, transparent); } }

  /* pointer halo (tab capture doesn't include the cursor) */
  .halo { position: fixed; left: 0; top: 0; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%;
    border: 2px solid var(--c); opacity: 0; transition: opacity .2s, width .15s, height .15s, margin .15s; pointer-events: none; }
  .halo::before { content: ""; position: absolute; inset: 0; border-radius: 50%; background: var(--c); opacity: .18; }
  .halo.on { opacity: .9; }
  .halo.small { width: 16px; height: 16px; margin: -8px 0 0 -8px; }
  .ripple { position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; border: 2px solid var(--c);
    pointer-events: none; animation: garabato-ripple .55s ease-out forwards; }
  @keyframes garabato-ripple { from { transform: scale(.5); opacity: .9; } to { transform: scale(2.1); opacity: 0; } }

  /* camera bubble */
  .cam { position: fixed; left: 24px; bottom: 24px; width: var(--s); height: var(--s); border-radius: 50%; overflow: hidden;
    pointer-events: auto; cursor: grab; background: #1d1d1f; touch-action: none;
    box-shadow: 0 0 0 3px #fff, 0 14px 40px rgba(0,0,0,.32); transition: width .2s, height .2s; }
  .cam.dragging { cursor: grabbing; transition: none; }
  .cam video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); display: block; }
  .cam .cam-tools { position: absolute; left: 50%; bottom: 12%; transform: translateX(-50%); display: flex; gap: 4px; opacity: 0; transition: opacity .15s; }
  .cam:hover .cam-tools { opacity: 1; }
  .cam .cam-tools button { width: 28px; height: 28px; border-radius: 50%; background: rgba(0,0,0,.55); color: #fff; display: grid; place-items: center; backdrop-filter: blur(6px); }
  .cam .cam-tools svg { width: 14px; height: 14px; }

  /* toolbar */
  .bar { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); display: flex; align-items: center; gap: 2px;
    padding: 5px; border-radius: 14px; pointer-events: auto; user-select: none;
    background: rgba(255,255,255,.94); backdrop-filter: blur(16px) saturate(1.6); -webkit-backdrop-filter: blur(16px) saturate(1.6);
    box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 10px 34px rgba(0,0,0,.18), 0 2px 6px rgba(0,0,0,.06); }
  .bar.placed { transform: none; }
  .grip { width: 16px; height: 34px; display: grid; place-items: center; color: #b0b0b5; cursor: grab; touch-action: none; }
  .grip svg { width: 8px; height: 16px; }
  .sep { width: 1px; height: 20px; background: rgba(0,0,0,.1); margin: 0 4px; }
  .ib { position: relative; width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; color: #3a3a3c; transition: background .12s, color .12s; }
  .ib:hover { background: rgba(0,0,0,.06); color: #1d1d1f; }
  .ib.on { background: #1d1d1f; color: #fff; }
  .ib.toggled { color: #0A84FF; background: rgba(10,132,255,.12); }
  .ib.off { color: #a1a1a6; }
  .ib:disabled { opacity: .35; pointer-events: none; }
  .ib .sw { width: 18px; height: 18px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0,0,0,.15), 0 0 0 2px #fff, 0 0 0 3px rgba(0,0,0,.12); }
  .ib .badge { position: absolute; top: 3px; right: 2px; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 8px; background: #FF3B30; color: #fff;
    font: 600 10px/15px -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; font-variant-numeric: tabular-nums; }
  .ib .badge:empty { display: none; }
  .ib.mic::after { content: ""; position: absolute; left: 9px; right: 9px; bottom: 4px; height: 2px; border-radius: 1px; background: #30D158;
    transform: scaleX(var(--lvl, 0)); transform-origin: left; transition: transform .08s; }
  .rec { height: 34px; padding: 0 12px 0 10px; border-radius: 9px; display: flex; align-items: center; gap: 8px; font-weight: 600; color: #1d1d1f; }
  .rec:hover { background: rgba(255,59,48,.08); }
  .rec .dot { width: 12px; height: 12px; border-radius: 50%; background: #FF3B30; box-shadow: 0 0 0 3px rgba(255,59,48,.18); }
  .rec .t { font-variant-numeric: tabular-nums; }
  .rec.live { background: #FF3B30; color: #fff; }
  .rec.live .dot { width: 10px; height: 10px; border-radius: 2px; background: #fff; box-shadow: none; }
  .rec.live:hover { background: #e2342a; }
  .rec.paused { background: #fff2f1; color: #FF3B30; }
  .rec.paused .dot { width: 10px; height: 10px; border-radius: 2px; background: #FF3B30; box-shadow: none; }
  .rec.busy { opacity: .6; pointer-events: none; }
  .bar.recording .rec.live .dot { animation: garabato-blink 1.2s infinite; }
  @keyframes garabato-blink { 50% { opacity: .35; } }

  .colors { position: fixed; display: flex; gap: 6px; padding: 8px; border-radius: 12px; pointer-events: auto; background: #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 10px 30px rgba(0,0,0,.18); }
  .colors button { width: 22px; height: 22px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0,0,0,.15); }
  .colors button.on { box-shadow: inset 0 0 0 1px rgba(0,0,0,.15), 0 0 0 2px #fff, 0 0 0 4px var(--ring, #1d1d1f); }

  /* comment editor */
  .editor { position: fixed; width: 290px; pointer-events: auto; background: #fff; border-radius: 12px; padding: 10px;
    box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 16px 40px rgba(0,0,0,.22); animation: garabato-in .16s ease-out; }
  @keyframes garabato-in { from { opacity: 0; transform: translateY(4px); } }
  .ed-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 12px; color: #6e6e73; min-width: 0; }
  .ed-n { width: 20px; height: 20px; border-radius: 10px 10px 10px 3px; background: var(--c); color: var(--fg); font-weight: 600; font-size: 11px; display: grid; place-items: center; flex: none; }
  .chip { padding: 2px 6px; border-radius: 6px; background: #f2f2f7; font-variant-numeric: tabular-nums; flex: none; }
  .chip.red { background: #fff0ef; color: #d70015; }
  .ed-el { font: 11px/1.3 ui-monospace, "SF Mono", Menlo, monospace; color: #8e8e93; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .editor textarea { width: 100%; min-height: 76px; max-height: 220px; resize: vertical; border: 0; outline: 0; border-radius: 8px; padding: 9px 10px;
    background: #f5f5f7; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Inter", sans-serif; color: #1d1d1f; }
  .editor textarea:focus { background: #f0f0f3; box-shadow: inset 0 0 0 1.5px var(--c); }
  .ed-foot { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
  .sp { flex: 1; }
  .btn { height: 30px; padding: 0 11px; border-radius: 8px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .btn svg { width: 15px; height: 15px; }
  .btn.ghost { color: #3a3a3c; } .btn.ghost:hover { background: #f2f2f7; }
  .btn.danger { color: #d70015; } .btn.danger:hover { background: #fff0ef; }
  .btn.primary { background: #1d1d1f; color: #fff; } .btn.primary:hover { background: #000; }
  kbd { font: 11px ui-monospace, "SF Mono", Menlo, monospace; opacity: .6; }

  /* comments panel */
  .panel { position: fixed; right: 16px; top: 16px; width: 330px; max-height: calc(100vh - 120px); display: flex; flex-direction: column;
    pointer-events: auto; background: rgba(255,255,255,.97); border-radius: 14px; overflow: hidden;
    box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 16px 40px rgba(0,0,0,.2); animation: garabato-in .16s ease-out; }
  .p-head { display: flex; align-items: center; gap: 6px; padding: 10px 8px 10px 14px; border-bottom: 1px solid rgba(0,0,0,.07); }
  .p-head b { font-weight: 600; font-size: 14px; }
  .p-head .ib { width: 30px; height: 30px; }
  .p-head .ib svg { width: 16px; height: 16px; }
  .p-list { overflow: auto; padding: 6px; }
  .item { display: flex; gap: 10px; width: 100%; padding: 8px; border-radius: 10px; text-align: left; align-items: flex-start; }
  .item:hover { background: #f5f5f7; }
  .item .ed-n { margin-top: 1px; }
  .item .meta { display: flex; gap: 6px; align-items: center; font-size: 11px; color: #8e8e93; margin-bottom: 2px; min-width: 0; }
  .item .txt { white-space: pre-wrap; word-break: break-word; }
  .item .txt.empty { color: #a1a1a6; font-style: italic; }
  .item > div { min-width: 0; flex: 1; }
  .empty-state { padding: 22px 18px 24px; color: #6e6e73; text-align: center; line-height: 1.5; }
  .empty-state kbd { padding: 1px 5px; border-radius: 4px; background: #f2f2f7; opacity: 1; }

  /* countdown */
  .countdown { position: fixed; inset: 0; display: grid; place-items: center; pointer-events: auto; cursor: pointer; background: rgba(0,0,0,.18); }
  .countdown .num { width: 150px; height: 150px; border-radius: 50%; display: grid; place-items: center; background: rgba(29,29,31,.88); color: #fff;
    font: 600 64px/1 -apple-system, BlinkMacSystemFont, "Inter", sans-serif; font-variant-numeric: tabular-nums; box-shadow: 0 20px 60px rgba(0,0,0,.35); }
  .countdown .hint { position: absolute; top: calc(50% + 100px); color: #fff; font-size: 13px; text-shadow: 0 1px 6px rgba(0,0,0,.5); }

  /* toast */
  .toast { position: fixed; left: 50%; bottom: 84px; transform: translateX(-50%) translateY(8px); padding: 9px 14px; border-radius: 10px;
    background: rgba(29,29,31,.92); color: #fff; opacity: 0; transition: opacity .2s, transform .2s; pointer-events: none; max-width: min(520px, 90vw); text-align: center; }
  .toast.on { opacity: 1; transform: translateX(-50%); }

  /* review */
  .review { position: fixed; inset: 0; display: grid; place-items: center; padding: 24px; pointer-events: auto; background: rgba(0,0,0,.5); animation: garabato-fade .2s; }
  @keyframes garabato-fade { from { opacity: 0; } }
  .rv-card { width: min(980px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; background: #fff; border-radius: 16px; overflow: hidden;
    box-shadow: 0 30px 80px rgba(0,0,0,.4); }
  .rv-head { display: flex; align-items: center; gap: 10px; padding: 12px 10px 12px 18px; }
  .rv-head b { font-size: 15px; font-weight: 600; }
  .muted { color: #8e8e93; font-variant-numeric: tabular-nums; }
  .rv-body { display: grid; grid-template-columns: 1fr 280px; min-height: 0; flex: 1; border-top: 1px solid rgba(0,0,0,.07); }
  .rv-body.solo { grid-template-columns: 1fr; }
  .rv-main { background: #0b0b0c; display: flex; flex-direction: column; min-height: 0; }
  .rv-main .player { width: 100%; aspect-ratio: var(--ar, 16 / 10); max-height: calc(100vh - 230px); background: #000; display: block; border: 0; }
  .rv-track { position: relative; height: 22px; margin: 0 14px 10px; }
  .rv-track::before { content: ""; position: absolute; left: 0; right: 0; top: 10px; height: 2px; border-radius: 1px; background: rgba(255,255,255,.18); }
  .rv-track .mk { position: absolute; top: 2px; width: 18px; height: 18px; margin-left: -9px; border-radius: 9px 9px 9px 2px; background: var(--c); color: var(--fg);
    font: 600 10px/18px -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; box-shadow: 0 0 0 1.5px #0b0b0c; }
  .rv-track .mk:hover { transform: scale(1.15); }
  .rv-side { border-left: 1px solid rgba(0,0,0,.07); overflow: auto; padding: 6px; }
  .rv-side .item .chip { cursor: pointer; }
  .rv-foot { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-top: 1px solid rgba(0,0,0,.07); flex-wrap: wrap; }
  `;

  try { const s = new CSSStyleSheet(); s.replaceSync(STYLE); shadow.adoptedStyleSheets = [s]; }
  catch { const st = document.createElement('style'); st.textContent = STYLE; shadow.appendChild(st); }

  // ───────────────────────────── DOM
  const toolBtns = TOOLS.map((t) => `<button class="ib tool" data-tool="${t.id}" title="${t.label} (${t.key.toUpperCase()})">${icon(t.icon)}</button>`).join('');
  const root = document.createElement('div');
  setHTML(root, `
    <canvas class="ink"></canvas>
    <div class="pins"></div>
    <div class="halo"></div>
    <div class="cam hidden"><video autoplay muted playsinline></video>
      <div class="cam-tools"><button data-cam="size" title="${T.size}">${icon('resize')}</button><button data-cam="off" title="${T.camTurnOff}">${icon('close')}</button></div>
    </div>
    <div class="bar ui" role="toolbar" aria-label="Garabato">
      <div class="grip" title="${T.move}">${grip}</div>
      <button class="rec" data-act="rec" title="${T.recordTab}"><span class="dot"></span><span class="t">${T.record}</span></button>
      <button class="ib hidden" data-act="pause" title="${T.pause}">${icon('pause')}</button>
      <span class="sep"></span>
      ${toolBtns}
      <span class="sep"></span>
      <button class="ib" data-act="color" title="${T.color}"><span class="sw"></span></button>
      <button class="ib" data-act="fade" title="${T.fadeTip}">${icon('fade')}</button>
      <button class="ib" data-act="undo" title="${T.undoTip}">${icon('undo')}</button>
      <button class="ib" data-act="clear" title="${T.clearTip}">${icon('trash')}</button>
      <span class="sep"></span>
      <button class="ib" data-act="cam" title="${T.camera}"></button>
      <button class="ib mic" data-act="mic" title="${T.mic}"></button>
      <button class="ib" data-act="list" title="${T.commentsKey}">${icon('list')}<span class="badge"></span></button>
      <button class="ib" data-act="close" title="${T.hide}">${icon('close')}</button>
    </div>
    <div class="colors ui hidden">${COLORS.map((c, i) => `<button data-color="${i}" title="${c.name}" style="--c:${c.c}"></button>`).join('')}</div>
    <div class="editor ui hidden"></div>
    <div class="panel ui hidden"></div>
    <div class="countdown ui hidden"><div class="num">3</div><div class="hint">${T.clickToCancel}</div></div>
    <div class="toast ui"></div>
    <div class="review ui hidden"></div>
  `);
  shadow.appendChild(root);
  (document.documentElement || document.body).appendChild(host);

  const canvas = $('canvas.ink');
  const ctx = canvas.getContext('2d');
  const pinsEl = $('.pins');
  const halo = $('.halo');
  const camEl = $('.cam');
  const camVideo = $('.cam video');
  const bar = $('.bar');
  const colorsEl = $('.colors');
  const editor = $('.editor');
  const panel = $('.panel');
  const cdEl = $('.countdown');
  const toastEl = $('.toast');
  const reviewEl = $('.review');

  // ───────────────────────────── toast
  let toastT = 0;
  function toast(msg, ms = 2600) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('on'), ms);
  }

  // ───────────────────────────── canvas sizing + render
  let W = 0, H = 0, dpr = 1, raf = 0;
  function viewport() {
    const de = document.documentElement;
    const std = document.compatMode === 'CSS1Compat';
    return { w: (std && de.clientWidth) || window.innerWidth, h: (std && de.clientHeight) || window.innerHeight };
  }
  function resize() {
    const v = viewport();
    dpr = window.devicePixelRatio || 1;
    W = v.w; H = v.h;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    dirty();
  }
  function dirty() { if (!raf) raf = requestAnimationFrame(render); }

  function render(t) {
    raf = 0;
    const sx = window.scrollX, sy = window.scrollY;
    pinsEl.style.transform = `translate(${-sx}px, ${-sy}px)`;
    if (editorFor) placeEditor();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(-sx, -sy);
    let animating = false;
    for (const s of state.strokes) {
      let a = 1;
      if (s.fadeAt) {
        const k = (t - s.fadeAt) / FADE_DUR;
        if (k >= 1) { s.dead = true; continue; }
        if (k > 0) a = 1 - k;
        animating = true;
      }
      drawStroke(s, a);
    }
    if (state.strokes.some((s) => s.dead)) state.strokes = state.strokes.filter((s) => !s.dead);
    if (animating) dirty();
  }

  function drawStroke(s, a) {
    const pts = s.pts;
    if (!pts.length) return;
    ctx.save();
    ctx.globalAlpha = a * (s.tool === 'marker' ? 0.38 : 1);
    ctx.strokeStyle = ctx.fillStyle = s.color;
    ctx.lineWidth = s.w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.tool === 'pen' || s.tool === 'marker') {
      if (pts.length === 1) {
        ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, s.w / 2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        const l = pts[pts.length - 1];
        ctx.lineTo(l.x, l.y);
        ctx.stroke();
      }
    } else if (s.tool === 'arrow') {
      const [p, q] = pts;
      const ang = Math.atan2(q.y - p.y, q.x - p.x);
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const head = Math.min(len * 0.6, Math.max(16, s.w * 4));
      const bx = q.x - Math.cos(ang) * head * 0.8, by = q.y - Math.sin(ang) * head * 0.8;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(bx, by); ctx.stroke();
      const spread = 0.48;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - Math.cos(ang - spread) * head, q.y - Math.sin(ang - spread) * head);
      ctx.lineTo(q.x - Math.cos(ang + spread) * head, q.y - Math.sin(ang + spread) * head);
      ctx.closePath();
      ctx.lineWidth = s.w * 0.6;
      ctx.fill(); ctx.stroke();
    } else if (s.tool === 'rect') {
      const [p, q] = pts;
      const x = Math.min(p.x, q.x), y = Math.min(p.y, q.y), w = Math.abs(q.x - p.x), h = Math.abs(q.y - p.y);
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(8, w / 2, h / 2)); else ctx.rect(x, y, w, h);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ───────────────────────────── drawing input
  let cur = null;
  const docPt = (e) => ({ x: e.clientX + window.scrollX, y: e.clientY + window.scrollY });
  function constrain(s, p, shift) {
    if (!shift) return p;
    const o = s.pts[0];
    const dx = p.x - o.x, dy = p.y - o.y;
    if (s.tool === 'rect') { const m = Math.max(Math.abs(dx), Math.abs(dy)); return { x: o.x + Math.sign(dx || 1) * m, y: o.y + Math.sign(dy || 1) * m }; }
    const step = Math.PI / 12, ang = Math.round(Math.atan2(dy, dx) / step) * step, len = Math.hypot(dx, dy);
    return { x: o.x + Math.cos(ang) * len, y: o.y + Math.sin(ang) * len };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    closePopovers();
    if (state.tool === 'comment') { e.preventDefault(); addCommentAt(e.clientX, e.clientY); return; }
    if (!DRAW.has(state.tool)) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = docPt(e);
    cur = { id: ++uid, tool: state.tool, color: state.color.c, w: WIDTH[state.tool], pts: state.tool === 'pen' || state.tool === 'marker' ? [p] : [p, { ...p }] };
    state.strokes.push(cur);
    dirty();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cur) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (cur.tool === 'pen' || cur.tool === 'marker') {
      for (const ev of (evs.length ? evs : [e])) {
        const p = docPt(ev), l = cur.pts[cur.pts.length - 1];
        if (Math.hypot(p.x - l.x, p.y - l.y) > 0.8) cur.pts.push(p);
      }
    } else {
      cur.pts[1] = constrain(cur, docPt(e), e.shiftKey);
    }
    dirty();
  });
  const endStroke = () => {
    if (!cur) return;
    const s = cur; cur = null;
    if ((s.tool === 'arrow' || s.tool === 'rect') && Math.hypot(s.pts[1].x - s.pts[0].x, s.pts[1].y - s.pts[0].y) < 5) {
      state.strokes = state.strokes.filter((x) => x !== s);
    } else {
      state.history.push({ type: 'stroke', ref: s });
      if (state.fade) s.fadeAt = now() + FADE_DELAY;
    }
    dirty();
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  function undo() {
    while (state.history.length) {
      const h = state.history.pop();
      if (h.type === 'stroke') {
        if (state.strokes.includes(h.ref)) { state.strokes = state.strokes.filter((s) => s !== h.ref); dirty(); return; }
      } else if (h.type === 'comment') {
        if (state.comments.includes(h.ref)) { removeComment(h.ref); return; }
      }
    }
    toast(T.nothingToUndo, 1400);
  }
  function clearInk() {
    if (!state.strokes.length) return toast(T.noDrawings, 1400);
    state.strokes = [];
    state.history = state.history.filter((h) => h.type !== 'stroke');
    dirty();
  }

  // ───────────────────────────── comments
  function elementAt(cx, cy) {
    const list = document.elementsFromPoint(cx, cy);
    return list.find((el) => el !== host && el !== document.documentElement && el !== document.body) || null;
  }
  function describe(el) {
    if (!el) return '';
    const parts = [];
    let e = el, depth = 0;
    while (e && e.nodeType === 1 && e !== document.documentElement && e !== document.body && depth < 4) {
      let s = e.tagName.toLowerCase();
      if (e.id && !/\d{3,}/.test(e.id)) { parts.unshift(s + '#' + CSS.escape(e.id)); break; }
      const cls = [...e.classList].filter((c) => c.length < 28 && !/^(css-|sc-|jsx-|_|svelte-|astro-)|[0-9a-f]{5,}/i.test(c)).slice(0, 2);
      if (cls.length) s += '.' + cls.map((c) => CSS.escape(c)).join('.');
      parts.unshift(s);
      e = e.parentElement; depth++;
    }
    return parts.join(' > ');
  }
  function snippet(el) {
    if (!el) return '';
    const txt = (el.getAttribute?.('aria-label') || el.alt || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return txt.length > 70 ? txt.slice(0, 68) + '…' : txt;
  }
  const isRec = () => rec.status === 'recording' || rec.status === 'paused';
  const numberOf = (c) => state.comments.indexOf(c) + 1;
  const colorOf = (c) => COLORS.find((x) => x.c === c.color) || COLORS[0];
  const timeLabel = (c) => (c.t == null ? '' : (state.recCount > 1 ? `${T.take}${c.rec} · ` : '') + fmt(c.t));

  function addCommentAt(cx, cy) {
    const el = elementAt(cx, cy);
    const c = {
      id: ++uid, x: cx + window.scrollX, y: cy + window.scrollY, text: '', color: state.color.c,
      t: isRec() ? elapsed() : null, rec: isRec() ? state.recCount : null,
      url: location.href, target: describe(el), snippet: snippet(el), createdAt: Date.now(), fresh: true,
    };
    state.comments.push(c);
    renderPins();
    openEditor(c);
  }
  function removeComment(c) {
    state.comments = state.comments.filter((x) => x !== c);
    if (editorFor === c) closeEditor(false);
    renderPins(); renderPanel(); updateBar();
  }
  function renderPins() {
    const frag = document.createDocumentFragment();
    for (const c of state.comments) {
      const col = colorOf(c);
      const pin = document.createElement('div');
      pin.className = 'pin';
      pin.dataset.id = c.id;
      pin.style.cssText = `left:${c.x}px;top:${c.y}px;--c:${col.c};--fg:${col.fg}`;
      pin.textContent = numberOf(c);
      const tip = document.createElement('div');
      tip.className = 'tip';
      tip.textContent = c.text;
      pin.appendChild(tip);
      pin.addEventListener('pointerdown', (e) => e.stopPropagation());
      pin.addEventListener('click', (e) => { e.stopPropagation(); openEditor(c); });
      frag.appendChild(pin);
    }
    pinsEl.replaceChildren(frag);
    dirty();
  }
  const pinEl = (c) => pinsEl.querySelector(`.pin[data-id="${c.id}"]`);
  function flashPin(c, cls = 'flash', ms = 1800) {
    const p = pinEl(c); if (!p) return;
    p.classList.remove(cls); void p.offsetWidth; p.classList.add(cls);
    setTimeout(() => p.classList.remove(cls), ms);
  }

  // editor
  let editorFor = null;
  function openEditor(c) {
    if (editorFor && editorFor !== c) closeEditor(true);
    editorFor = c;
    const col = colorOf(c);
    editor.style.setProperty('--c', col.c);
    editor.style.setProperty('--fg', col.fg);
    setHTML(editor, `
      <div class="ed-head"><span class="ed-n">${numberOf(c)}</span>
        ${c.t != null ? `<span class="chip red">● ${esc(timeLabel(c))}</span>` : ''}
        <span class="ed-el" title="${esc(c.target)}">${esc(c.target || '')}</span></div>
      <textarea placeholder="${T.placeholder}" spellcheck="true"></textarea>
      <div class="ed-foot">
        ${c.fresh ? '' : `<button class="btn danger" data-ed="del">${T.del}</button>`}
        <span class="sp"></span>
        <button class="btn ghost" data-ed="cancel">${T.cancel}</button>
        <button class="btn primary" data-ed="save">${T.save} <kbd>⌘↵</kbd></button>
      </div>`);
    const ta = editor.querySelector('textarea');
    ta.value = c.text;
    editor.classList.remove('hidden');
    placeEditor();
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
  }
  function placeEditor() {
    const c = editorFor; if (!c) return;
    const px = c.x - window.scrollX, py = c.y - window.scrollY;
    const ew = 290, eh = editor.offsetHeight || 170;
    let left = px + 38, top = py - 30;
    if (left + ew > W - 12) left = px - ew - 10;
    left = clamp(left, 12, W - ew - 12);
    top = clamp(top, 12, H - eh - 12);
    editor.style.left = left + 'px';
    editor.style.top = top + 'px';
  }
  function closeEditor(save) {
    const c = editorFor; if (!c) return;
    editorFor = null;
    const ta = editor.querySelector('textarea');
    const text = ta ? ta.value.trim() : c.text;
    ta?.blur(); // a hidden textarea that keeps focus would swallow the next shortcuts
    editor.classList.add('hidden');
    if (save) {
      if (!text && c.fresh) { state.comments = state.comments.filter((x) => x !== c); }
      else if (text) {
        if (c.fresh) state.history.push({ type: 'comment', ref: c });
        c.text = text; c.fresh = false;
      }
    } else if (c.fresh) {
      state.comments = state.comments.filter((x) => x !== c);
    }
    renderPins(); renderPanel(); updateBar();
    if (save && text && state.comments.includes(c)) flashPin(c, 'show', 4000);
  }
  editor.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ed]'); if (!b) return;
    const a = b.dataset.ed;
    if (a === 'save') closeEditor(true);
    else if (a === 'cancel') closeEditor(false);
    else if (a === 'del') { const c = editorFor; editorFor = null; editor.querySelector('textarea')?.blur(); editor.classList.add('hidden'); removeComment(c); }
  });
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); closeEditor(true); }
    else if (e.key === 'Escape') { e.preventDefault(); closeEditor(false); }
  });

  // panel
  function renderPanel() {
    if (!state.panelOpen) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const items = state.comments.filter((c) => !c.fresh);
    setHTML(panel, `
      <div class="p-head"><b>${T.comments}</b><span class="muted">${items.length}</span><span class="sp"></span>
        <button class="ib" data-p="copy" title="${T.copyMd}">${icon('copy')}</button>
        <button class="ib" data-p="md" title="${T.downloadMd}">${icon('download')}</button>
        <button class="ib" data-p="close" title="${T.close}">${icon('close')}</button></div>
      <div class="p-list">${items.length ? items.map((c) => itemHTML(c)).join('') :
        `<div class="empty-state">${T.emptyPanel}</div>`}</div>`);
  }
  function itemHTML(c, opts = {}) {
    const col = colorOf(c);
    return `<button class="item" data-id="${c.id}">
      <span class="ed-n" style="--c:${col.c};--fg:${col.fg}">${numberOf(c)}</span>
      <div><div class="meta">${c.t != null ? `<span class="chip red" ${opts.seek ? 'data-seek' : ''}>● ${esc(timeLabel(c))}</span>` : ''}<span class="ed-el">${esc(c.target)}</span></div>
      <div class="txt ${c.text ? '' : 'empty'}">${esc(c.text || T.noText)}</div></div></button>`;
  }
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (b) {
      const a = b.dataset.p;
      if (a === 'close') { state.panelOpen = false; renderPanel(); updateBar(); }
      else if (a === 'copy') copyText(toMarkdown()).then(() => toast(T.copied));
      else if (a === 'md') downloadText(toMarkdown(), `${baseName()}.md`, 'text/markdown');
      return;
    }
    const it = e.target.closest('.item');
    if (it) {
      const c = state.comments.find((x) => String(x.id) === it.dataset.id);
      if (!c) return;
      window.scrollTo({ top: c.y - window.innerHeight / 2, left: Math.max(0, c.x - window.innerWidth / 2), behavior: 'smooth' });
      setTimeout(() => flashPin(c), 350);
    }
  });

  // ───────────────────────────── export
  function baseName() {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const h = (location.hostname || T.page).replace(/^www\./, '').replace(/[^a-z0-9.-]+/gi, '-');
    return `garabato-${h}-${stamp}`;
  }
  function toMarkdown(onlyRec = null, durMs = null) {
    const list = state.comments.filter((c) => !c.fresh);
    const lines = [`# ${T.comments} · ${document.title || location.hostname}`, '', `${location.href}`, ''];
    const meta = [new Date().toLocaleString(), T.nComments(list.length)];
    if (durMs != null) meta.push(`${T.video} ${fmt(durMs)}`);
    lines.push(meta.join(' · '), '');
    list.forEach((c) => {
      const tm = c.t != null && (onlyRec == null || c.rec === onlyRec) ? `**[${fmt(c.t)}]** ` : '';
      lines.push(`${numberOf(c)}. ${tm}${c.text.replace(/\n/g, '\n   ')}`);
      const where = [c.target && `\`${c.target}\``, c.snippet && `“${c.snippet}”`].filter(Boolean).join(' — ');
      if (where) lines.push(`   ${where}`);
      if (c.url !== location.href) lines.push(`   ${c.url}`);
    });
    return lines.join('\n') + '\n';
  }
  function toVTT(recN, durMs) {
    const list = state.comments.filter((c) => !c.fresh && c.rec === recN && c.t != null).sort((a, b) => a.t - b.t);
    const out = ['WEBVTT', ''];
    list.forEach((c, i) => {
      const end = Math.min(c.t + 4500, durMs || c.t + 4500);
      out.push(String(i + 1), `${vttTime(c.t)} --> ${vttTime(Math.max(end, c.t + 800))}`, `${numberOf(c)} · ${c.text}`, '');
    });
    return out.join('\n');
  }
  function downloadURL(url, name) {
    const a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    shadow.appendChild(a); a.click(); a.remove();
  }
  function downloadText(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
    downloadURL(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      shadow.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
  }

  // ───────────────────────────── media: camera + mic
  const media = { cam: null, mic: null };
  let AC = null, micSrc = null, analyser = null, meterT = 0;
  const audioCtx = () => { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume().catch(() => {}); return AC; };
  const live = (s) => !!s && s.getTracks().some((t) => t.readyState === 'live');

  function attachMic(stream) {
    media.mic = stream;
    const ac = audioCtx();
    micSrc = ac.createMediaStreamSource(stream);
    analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    micSrc.connect(analyser);
    if (rec.dest) connectMicToRec();
    clearInterval(meterT);
    const buf = new Float32Array(analyser.fftSize);
    const btn = bar.querySelector('[data-act="mic"]');
    meterT = setInterval(() => {
      if (!analyser || !state.micOn) { btn.style.setProperty('--lvl', 0); return; }
      analyser.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      btn.style.setProperty('--lvl', Math.min(1, Math.sqrt(sum / buf.length) * 6).toFixed(2));
    }, 90);
  }
  function releaseMic() {
    clearInterval(meterT);
    bar.querySelector('[data-act="mic"]').style.setProperty('--lvl', 0);
    try { micSrc?.disconnect(); } catch { }
    micSrc = null; analyser = null;
    media.mic?.getTracks().forEach((t) => t.stop());
    media.mic = null;
    if (rec.micGain) { try { rec.micGain.disconnect(); } catch { } rec.micGain = null; }
  }
  async function ensureMic() {
    if (live(media.mic)) return true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      attachMic(s);
      return true;
    } catch (e) {
      state.micOn = false; updateBar();
      toast(e.name === 'NotAllowedError' ? T.micBlocked : T.micFailed);
      return false;
    }
  }
  const CAM_VIDEO = { width: { ideal: 720 }, height: { ideal: 720 }, facingMode: 'user', frameRate: { ideal: 30 } };
  const camError = (e) => ({
    NotAllowedError: T.camBlocked(location.hostname),
    NotReadableError: T.camBusy,
    NotFoundError: T.camNone,
    OverconstrainedError: T.camNone,
  }[e.name] || T.camFailed + (e.message || e.name));
  async function camOn() {
    if (live(media.cam)) return true;
    if (!navigator.mediaDevices?.getUserMedia) { toast(T.camHttps, 4000); return false; }
    const wantMic = state.micOn && !live(media.mic);
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: CAM_VIDEO, audio: wantMic ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false });
    } catch (e) {
      // if it was the mic that failed, at least open the camera on its own
      if (wantMic) { try { s = await navigator.mediaDevices.getUserMedia({ video: CAM_VIDEO }); } catch (e2) { e = e2; } }
      if (!s) { toast(camError(e), 5000); state.camOn = false; updateBar(); return false; }
    }
    media.cam = new MediaStream(s.getVideoTracks());
    if (s.getAudioTracks().length) {
      if (live(media.mic)) s.getAudioTracks().forEach((t) => t.stop()); else attachMic(new MediaStream(s.getAudioTracks()));
    }
    media.cam.getVideoTracks()[0]?.addEventListener('ended', () => { if (state.camOn) { camOff(); toast(T.camLost); } });
    camVideo.srcObject = media.cam;
    camVideo.play().catch(() => {});
    state.camOn = true;
    camEl.classList.remove('hidden');
    updateBar();
    return true;
  }
  function camOff() {
    media.cam?.getTracks().forEach((t) => t.stop());
    media.cam = null;
    camVideo.srcObject = null;
    state.camOn = false;
    camEl.classList.add('hidden');
    if (!isRec() && rec.status !== 'starting') releaseMic();
    updateBar();
  }
  function setCamSize(i) { state.camSize = i; camEl.style.setProperty('--s', CAM_SIZES[i] + 'px'); keepInView(camEl); }
  setCamSize(1);

  // ───────────────────────────── recording
  const rec = { status: 'idle', recorder: null, chunks: [], display: null, dest: null, tabSrc: null, micGain: null, startedAt: 0, pausedAt: 0, pausedTotal: 0, mime: '', tick: 0, cancelled: false, duration: 0 };
  function elapsed() {
    if (rec.status === 'recording') return now() - rec.startedAt - rec.pausedTotal;
    if (rec.status === 'paused') return rec.pausedAt - rec.startedAt - rec.pausedTotal;
    return 0;
  }
  function pickMime() {
    const list = [
      'video/mp4;codecs=avc1.640033,mp4a.40.2',
      'video/mp4;codecs=avc1.4d0033,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    return list.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  }
  function connectMicToRec() {
    if (!rec.dest || !micSrc) return;
    if (!rec.micGain) { rec.micGain = AC.createGain(); micSrc.connect(rec.micGain); rec.micGain.connect(rec.dest); }
    rec.micGain.gain.value = state.micOn ? 1 : 0;
  }

  async function startRecording() {
    if (rec.status !== 'idle') return;
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) { toast(T.noScreen); return; }
    closePopovers();
    rec.status = 'starting'; rec.cancelled = false; updateBar();
    const ac = audioCtx(); // while we still have the user gesture
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 30 }, displaySurface: 'browser',
          width: { ideal: Math.round(window.innerWidth * dpr), max: 3840 }, height: { ideal: Math.round(window.innerHeight * dpr), max: 2160 },
        },
        audio: { suppressLocalAudioPlayback: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        systemAudio: 'include',
      });
    } catch (e) {
      rec.status = 'idle'; updateBar();
      toast(e.name === 'NotAllowedError' ? T.recCancelled : T.captureFailed + e.message);
      return;
    }
    rec.display = display;
    const vTrack = display.getVideoTracks()[0];
    try { vTrack.contentHint = 'detail'; } catch { }
    const vs = vTrack.getSettings();
    rec.ar = vs.width && vs.height ? `${vs.width} / ${vs.height}` : null;
    vTrack.addEventListener('ended', () => stopRecording());

    rec.autoCam = false;
    if (state.camWanted && !state.camOn) rec.autoCam = await camOn();

    rec.dest = ac.createMediaStreamDestination();
    if (display.getAudioTracks().length) {
      rec.tabSrc = ac.createMediaStreamSource(new MediaStream(display.getAudioTracks()));
      rec.tabSrc.connect(rec.dest);
    }
    if (state.micOn) await ensureMic();
    connectMicToRec();

    const stream = new MediaStream([vTrack, ...rec.dest.stream.getAudioTracks()]);
    rec.mime = pickMime();
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { ...(rec.mime ? { mimeType: rec.mime } : {}), videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 });
    } catch {
      rec.mime = ''; recorder = new MediaRecorder(stream);
    }
    rec.recorder = recorder;
    rec.chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
    recorder.onstop = finishRecording;
    recorder.onerror = (e) => { toast(T.recError + (e.error?.message || T.unknown)); stopRecording(); };

    rec.status = 'countdown'; updateBar();
    const go = await countdown();
    if (!go || rec.cancelled || vTrack.readyState !== 'live') { teardown(); rec.status = 'idle'; updateBar(); toast(T.recCancelled); return; }
    state.recCount++;
    recorder.start(1000);
    rec.startedAt = now(); rec.pausedTotal = 0; rec.pausedAt = 0;
    rec.status = 'recording';
    rec.tick = setInterval(updateTimer, 250);
    updateBar(); updateHalo();
  }
  function countdown() {
    return new Promise((resolve) => {
      let n = 3;
      const num = cdEl.querySelector('.num');
      num.textContent = n;
      cdEl.classList.remove('hidden');
      const beat = () => num.animate([{ transform: 'scale(1.25)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,1.3,.4,1)' });
      beat();
      const done = (ok) => { clearInterval(iv); cdEl.classList.add('hidden'); cdEl.onclick = null; requestAnimationFrame(() => requestAnimationFrame(() => resolve(ok))); };
      const iv = setInterval(() => {
        if (rec.cancelled) return done(false);
        n--;
        if (n <= 0) return done(true);
        num.textContent = n; beat();
      }, 800);
      cdEl.onclick = () => { rec.cancelled = true; done(false); };
    });
  }
  function pauseResume() {
    if (rec.status === 'recording') { rec.recorder.pause(); rec.pausedAt = now(); rec.status = 'paused'; }
    else if (rec.status === 'paused') { rec.recorder.resume(); rec.pausedTotal += now() - rec.pausedAt; rec.status = 'recording'; }
    updateBar(); updateTimer();
  }
  function stopRecording() {
    if (rec.status === 'countdown' || rec.status === 'starting') { rec.cancelled = true; return; }
    if (!isRec()) return;
    rec.duration = elapsed();
    rec.status = 'stopping';
    clearInterval(rec.tick);
    updateBar(); updateHalo();
    try { rec.recorder.state !== 'inactive' ? rec.recorder.stop() : finishRecording(); } catch { finishRecording(); }
  }
  function teardown() {
    clearInterval(rec.tick);
    rec.display?.getTracks().forEach((t) => t.stop());
    try { rec.tabSrc?.disconnect(); } catch { }
    try { rec.micGain?.disconnect(); } catch { }
    rec.display = null; rec.tabSrc = null; rec.micGain = null; rec.dest = null; rec.recorder = null;
    if (rec.autoCam && state.camOn) camOff(); // we only turned it on to record: turn it back off
    rec.autoCam = false;
    if (!state.camOn) releaseMic();
  }
  function finishRecording() {
    if (rec.status !== 'stopping') return;
    const type = (rec.mime || rec.recorder?.mimeType || 'video/webm').split(';')[0];
    const blob = new Blob(rec.chunks, { type });
    rec.chunks = [];
    teardown();
    rec.status = 'idle';
    updateBar(); updateHalo();
    openReview(blob, rec.duration, state.recCount, rec.ar);
  }
  function updateTimer() {
    const t = bar.querySelector('.rec .t');
    if (isRec()) t.textContent = fmt(elapsed());
  }

  // ───────────────────────────── review
  let review = null; // { url, blob, ext, dur, n, saved }
  function openReview(blob, dur, n, ar) {
    if (review) URL.revokeObjectURL(review.url);
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(blob);
    const name = baseName();
    review = { url, blob, ext, dur, n, name, saved: false };
    const list = state.comments.filter((c) => !c.fresh && c.rec === n && c.t != null);
    const vtt = URL.createObjectURL(new Blob([toVTT(n, dur)], { type: 'text/vtt' }));
    review.vtt = vtt;
    const mb = (blob.size / 1048576).toFixed(1);
    setHTML(reviewEl, `
      <div class="rv-card">
        <div class="rv-head"><b>${T.ready}</b><span class="muted">${fmt(dur)} · ${mb} MB · ${ext.toUpperCase()}</span><span class="sp"></span>
          <button class="ib" data-rv="close" title="${T.close}">${icon('close')}</button></div>
        <div class="rv-body ${list.length ? '' : 'solo'}">
          <div class="rv-main">
            ${PLAYER ? `<iframe class="player" src="${PLAYER}" title="${T.recording}"></iframe>`
              : `<video class="player" controls playsinline preload="metadata" src="${url}">${list.length ? `<track kind="subtitles" srclang="${LANG}" label="${T.comments}" src="${vtt}" default>` : ''}</video>`}
            ${list.length ? `<div class="rv-track">${list.map((c) => { const col = colorOf(c); return `<button class="mk" data-t="${c.t}" title="${esc(fmt(c.t) + ' · ' + c.text)}" style="left:${clamp((c.t / Math.max(dur, 1)) * 100, 0, 100)}%;--c:${col.c};--fg:${col.fg}">${numberOf(c)}</button>`; }).join('')}</div>` : ''}
          </div>
          ${list.length ? `<div class="rv-side">${list.map((c) => itemHTML(c, { seek: true })).join('')}</div>` : ''}
        </div>
        <div class="rv-foot">
          <button class="btn primary" data-rv="video">${icon('download')} ${T.downloadVideo}</button>
          <button class="btn ghost" data-rv="md">${T.mdBtn}</button>
          ${list.length ? `<button class="btn ghost" data-rv="vtt">${T.vttBtn}</button>` : ''}
          <button class="btn ghost" data-rv="copy">${icon('copy')} ${T.copyBtn}</button>
          <span class="sp"></span>
          <button class="btn danger" data-rv="discard">${T.discard}</button>
        </div>
      </div>`);
    reviewEl.classList.remove('hidden');
    if (ar) reviewEl.querySelector('.player').style.setProperty('--ar', ar);
    if (PLAYER) {
      const fr = reviewEl.querySelector('iframe.player');
      fr.addEventListener('load', () => fr.contentWindow.postMessage({ garabato: 1, cmd: 'load', blob, vtt: list.length ? toVTT(n, dur) : null, lang: LANG, label: T.comments }, new URL(PLAYER).origin), { once: true });
      return;
    }
    const v = reviewEl.querySelector('video');
    // MediaRecorder doesn't write the duration: make the browser compute it
    v.addEventListener('loadedmetadata', () => {
      if (!isFinite(v.duration)) {
        const back = () => { v.removeEventListener('durationchange', back); v.currentTime = 0; };
        v.addEventListener('durationchange', back);
        v.currentTime = 1e7;
      }
    }, { once: true });
  }
  function seekReview(sec) {
    const fr = reviewEl.querySelector('iframe.player');
    if (fr) { fr.contentWindow?.postMessage({ garabato: 1, cmd: 'seek', t: sec }, new URL(PLAYER).origin); return; }
    const v = reviewEl.querySelector('video');
    if (v) { v.currentTime = sec; v.play().catch(() => {}); }
  }
  function closeReview(force) {
    if (!review) return;
    const btn = reviewEl.querySelector('[data-rv="discard"]');
    if (!review.saved && !force) {
      if (btn && btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = T.discardSure; toast(T.notSaved); return; }
    }
    reviewEl.querySelector('video')?.pause();
    reviewEl.classList.add('hidden');
    setHTML(reviewEl, '');
    URL.revokeObjectURL(review.url);
    URL.revokeObjectURL(review.vtt);
    review = null;
  }
  reviewEl.addEventListener('click', (e) => {
    if (e.target === reviewEl) return closeReview(false);
    const mk = e.target.closest('[data-t]');
    if (mk) { seekReview(Number(mk.dataset.t) / 1000); return; }
    const it = e.target.closest('.item');
    if (it) { const c = state.comments.find((x) => String(x.id) === it.dataset.id); if (c?.t != null) seekReview(c.t / 1000); return; }
    const b = e.target.closest('[data-rv]'); if (!b || !review) return;
    const a = b.dataset.rv;
    if (a === 'video') { downloadURL(review.url, `${review.name}.${review.ext}`); review.saved = true; }
    else if (a === 'md') downloadText(toMarkdown(review.n, review.dur), `${review.name}.md`, 'text/markdown');
    else if (a === 'vtt') downloadText(toVTT(review.n, review.dur), `${review.name}.vtt`, 'text/vtt');
    else if (a === 'copy') copyText(toMarkdown(review.n, review.dur)).then(() => toast(T.copied));
    else if (a === 'close') closeReview(false);
    else if (a === 'discard') closeReview(false);
  });

  // ───────────────────────────── toolbar
  function setTool(t) {
    state.tool = t;
    if (t !== 'comment' && editorFor) closeEditor(true);
    updateBar(); updateHalo();
  }
  function closePopovers() { colorsEl.classList.add('hidden'); }
  function updateBar() {
    const live = DRAW.has(state.tool) || state.tool === 'comment';
    canvas.classList.toggle('live', live);
    canvas.classList.toggle('comment', state.tool === 'comment');
    bar.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === state.tool));
    bar.querySelector('.sw').style.setProperty('--c', state.color.c);
    bar.querySelector('[data-act="fade"]').classList.toggle('toggled', state.fade);
    const camB = bar.querySelector('[data-act="cam"]');
    setHTML(camB, icon('cam', state.camOn || state.camWanted ? '' : P.slash));
    camB.classList.toggle('toggled', state.camOn);
    camB.classList.toggle('off', !state.camOn && !state.camWanted);
    camB.title = state.camOn ? T.camTurnOff : state.camWanted ? T.camAuto : T.camMuted;
    const micB = bar.querySelector('[data-act="mic"]');
    setHTML(micB, icon('mic', state.micOn ? '' : P.slash));
    micB.classList.toggle('off', !state.micOn);
    micB.title = state.micOn ? T.micMute : T.micUnmute;
    const listB = bar.querySelector('[data-act="list"]');
    listB.classList.toggle('on', state.panelOpen);
    listB.querySelector('.badge').textContent = state.comments.filter((c) => !c.fresh).length || '';
    const r = bar.querySelector('.rec');
    const tt = r.querySelector('.t');
    r.classList.toggle('live', rec.status === 'recording');
    r.classList.toggle('paused', rec.status === 'paused');
    r.classList.toggle('busy', ['starting', 'countdown', 'stopping'].includes(rec.status));
    bar.classList.toggle('recording', isRec());
    if (rec.status === 'idle') { tt.textContent = T.record; r.title = T.recIdle; }
    else if (rec.status === 'starting') tt.textContent = T.choosing;
    else if (rec.status === 'countdown') tt.textContent = T.getReady;
    else if (rec.status === 'stopping') tt.textContent = T.saving;
    else { tt.textContent = fmt(elapsed()); r.title = T.stop; }
    const pb = bar.querySelector('[data-act="pause"]');
    pb.classList.toggle('hidden', !isRec());
    setHTML(pb, icon(rec.status === 'paused' ? 'play' : 'pause'));
    pb.title = rec.status === 'paused' ? T.resume : T.pause;
    bar.querySelector('[data-act="close"]').disabled = isRec();
  }

  // buttons never keep focus: otherwise Space/Enter would fire them again (e.g. stop the recording)
  [bar, colorsEl, camEl].forEach((el) => el.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); }));
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    b.blur();
    if (b.dataset.tool) { closePopovers(); return setTool(b.dataset.tool); }
    const a = b.dataset.act;
    if (a !== 'color') closePopovers();
    if (a === 'rec') { if (rec.status === 'idle') startRecording(); else stopRecording(); }
    else if (a === 'pause') pauseResume();
    else if (a === 'color') toggleColors(b);
    else if (a === 'fade') { state.fade = !state.fade; toast(state.fade ? T.fadeOn : T.fadeOff, 1600); updateBar(); }
    else if (a === 'undo') undo();
    else if (a === 'clear') clearInk();
    else if (a === 'cam') {
      if (state.camOn) { state.camWanted = false; rec.autoCam = false; camOff(); toast(T.camOffToast, 1800); }
      else { state.camWanted = true; camOn(); }
    }
    else if (a === 'mic') toggleMic();
    else if (a === 'list') { state.panelOpen = !state.panelOpen; renderPanel(); updateBar(); }
    else if (a === 'close') hide();
  });
  async function toggleMic() {
    state.micOn = !state.micOn;
    updateBar();
    if (state.micOn) { if (await ensureMic()) connectMicToRec(); }
    else if (isRec()) connectMicToRec();
    else releaseMic();
  }
  function toggleColors(btn) {
    if (!colorsEl.classList.contains('hidden')) return closePopovers();
    colorsEl.classList.remove('hidden');
    colorsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', COLORS[b.dataset.color] === state.color));
    const r = btn.getBoundingClientRect(), cw = colorsEl.offsetWidth, ch = colorsEl.offsetHeight;
    colorsEl.style.left = clamp(r.left + r.width / 2 - cw / 2, 8, W - cw - 8) + 'px';
    colorsEl.style.top = (r.top - ch - 10 < 8 ? r.bottom + 10 : r.top - ch - 10) + 'px';
  }
  colorsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]'); if (!b) return;
    state.color = COLORS[b.dataset.color];
    halo.style.setProperty('--c', state.color.c);
    closePopovers(); updateBar();
  });

  // drag: toolbar + camera
  function draggable(el, handle, onStart) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const ox = e.clientX - r.left, oy = e.clientY - r.top;
      onStart?.();
      el.classList.add('dragging');
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        el.style.left = clamp(ev.clientX - ox, 4, W - r.width - 4) + 'px';
        el.style.top = clamp(ev.clientY - oy, 4, H - r.height - 4) + 'px';
        el.style.bottom = 'auto';
      };
      const up = () => { el.classList.remove('dragging'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }
  draggable(bar, bar.querySelector('.grip'), () => {
    if (!bar.classList.contains('placed')) {
      const r = bar.getBoundingClientRect();
      bar.classList.add('placed');
      bar.style.left = r.left + 'px'; bar.style.top = r.top + 'px'; bar.style.bottom = 'auto';
    }
  });
  draggable(camEl, camEl);
  camEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cam]'); if (!b) return;
    if (b.dataset.cam === 'size') setCamSize((state.camSize + 1) % CAM_SIZES.length);
    else { state.camWanted = false; rec.autoCam = false; camOff(); }
  });
  function keepInView(el) {
    if (!el.style.top) return;
    const r = el.getBoundingClientRect();
    el.style.left = clamp(r.left, 4, Math.max(4, W - r.width - 4)) + 'px';
    el.style.top = clamp(r.top, 4, Math.max(4, H - r.height - 4)) + 'px';
  }

  // ───────────────────────────── pointer halo (shows up in the video)
  halo.style.setProperty('--c', state.color.c);
  let lastPtr = null;
  function updateHalo() {
    const on = isRec() && !!lastPtr && state.visible;
    halo.classList.toggle('on', on);
    halo.classList.toggle('small', DRAW.has(state.tool));
    if (lastPtr) halo.style.transform = `translate(${lastPtr.x}px, ${lastPtr.y}px)`;
  }
  const onPtrMove = (e) => { lastPtr = { x: e.clientX, y: e.clientY }; if (isRec()) updateHalo(); };
  const onPtrDown = (e) => {
    if (!isRec() || !state.visible) return;
    const r = document.createElement('div');
    r.className = 'ripple';
    r.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;--c:${state.color.c}`;
    root.appendChild(r);
    setTimeout(() => r.remove(), 600);
  };
  const onPtrOut = (e) => { if (!e.relatedTarget) { lastPtr = null; updateHalo(); } };
  window.addEventListener('pointermove', onPtrMove, { capture: true, passive: true });
  window.addEventListener('pointerdown', onPtrDown, { capture: true, passive: true });
  document.addEventListener('pointerout', onPtrOut, { capture: true, passive: true });

  // ───────────────────────────── keyboard
  const KEYMAP = Object.fromEntries(TOOLS.map((t) => [t.key, t.id]));
  window.addEventListener('keydown', (e) => {
    if (!state.visible) return;
    const target = e.composedPath()[0];
    if (isEditable(target)) return;
    const k = (e.key || '').toLowerCase();
    let handled = true;
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && k === 'z') undo();
    else if (e.metaKey || e.ctrlKey || e.altKey) handled = false;
    else if (k === 'escape') { if (!reviewEl.classList.contains('hidden')) closeReview(false); else if (!colorsEl.classList.contains('hidden')) closePopovers(); else if (state.tool !== 'cursor') setTool('cursor'); else handled = false; }
    else if (KEYMAP[k] && !e.shiftKey) setTool(KEYMAP[k]);
    else if (k === 'f') { state.fade = !state.fade; updateBar(); toast(state.fade ? T.fadeShort : T.fadeOff, 1200); }
    else if (k === 'l') { state.panelOpen = !state.panelOpen; renderPanel(); updateBar(); }
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  // keys typed in the comment box must not trigger the page's own shortcuts
  ['keydown', 'keyup', 'keypress'].forEach((t) => root.addEventListener(t, (e) => { if (isEditable(e.composedPath()[0])) e.stopPropagation(); }));

  // ───────────────────────────── visibility
  function show() {
    state.visible = true;
    host.style.display = 'block';
    resize(); updateBar();
  }
  function hide() {
    if (isRec()) { toast(T.stopFirst); return; }
    if (editorFor) closeEditor(true);
    closePopovers();
    if (state.camOn) camOff();
    releaseMic();
    state.visible = false;
    host.style.display = 'none';
  }
  host.addEventListener('garabato:toggle', () => (state.visible ? hide() : show()));

  window.addEventListener('resize', () => { resize(); keepInView(bar); keepInView(camEl); }, { passive: true });
  window.addEventListener('scroll', dirty, { passive: true });
  window.addEventListener('beforeunload', (e) => { if (isRec()) { e.preventDefault(); e.returnValue = ''; } });

  resize();
  updateBar();
  renderPins();
  toast(T.hello, 3200);

  window.__garabato = { toggle: () => host.dispatchEvent(new CustomEvent('garabato:toggle')), state, rec, _test: { openReview, elapsed } };
})();
