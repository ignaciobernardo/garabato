/* Garabato — talk through any web page while you draw on it, and turn that into feedback a
   coding agent can act on: what you said, what you marked (selector, text, source file), and
   screenshots, as Markdown + JSON. Also records the tab with your camera and mic.
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
  // served by the garabato CLI: feedback can go straight to the agent session
  const BRIDGE = (() => { try { return document.currentScript?.dataset.bridge || null; } catch { return null; } })();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
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
      transcriptLabel: 'Transcript', speechTip: 'Live transcript', speechOff: 'Transcript off', langOff: 'Off', speechLang: (l) => `Transcribing in ${l}`,
      speechNote: "Uses Chrome's speech recognition, which may send audio to Google.",
      speechNet: "Live transcript unavailable: Chrome's speech service didn't answer", speechBlocked: 'Transcript blocked: allow the microphone for this site',
      sendAgent: 'Send to agent', sending: 'Sending…', sentShort: 'Sent', sent: (p) => `Sent to your agent · ${p}`, sendFailed: "Couldn't reach the agent session: ",
      copyAgent: 'Copy for agent', agentCopied: 'Copied: paste it into your agent', downloadFeedback: 'Download feedback',
      agentSession: 'Agent session: what you say and draw goes to your agent', nothingYet: 'Nothing to send yet',
      moments: 'What your agent gets',
      kinds: { highlight: 'Highlight', underline: 'Underline', circle: 'Circle', box: 'Box', arrow: 'Arrow', sketch: 'Drawing', comment: 'Comment' },
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
      transcriptLabel: 'Transcripción', speechTip: 'Transcripción en vivo', speechOff: 'Transcripción apagada', langOff: 'Apagada', speechLang: (l) => `Transcribiendo en ${l}`,
      speechNote: 'Usa el reconocimiento de voz de Chrome, que puede enviar el audio a Google.',
      speechNet: 'La transcripción en vivo no está disponible: el servicio de voz de Chrome no respondió', speechBlocked: 'Transcripción bloqueada: permite el micrófono en este sitio',
      sendAgent: 'Enviar al agente', sending: 'Enviando…', sentShort: 'Enviado', sent: (p) => `Enviado a tu agente · ${p}`, sendFailed: 'No pude conectar con la sesión del agente: ',
      copyAgent: 'Copiar para el agente', agentCopied: 'Copiado: pégalo en tu agente', downloadFeedback: 'Descargar feedback',
      agentSession: 'Sesión con agente: lo que digas y dibujes le llega a tu agente', nothingYet: 'Todavía no hay nada que enviar',
      moments: 'Lo que recibe tu agente',
      kinds: { highlight: 'Destacado', underline: 'Subrayado', circle: 'Círculo', box: 'Recuadro', arrow: 'Flecha', sketch: 'Dibujo', comment: 'Comentario' },
      stopFirst: 'Detén la grabación antes de ocultar', hello: 'Garabato listo · C comenta · P dibuja · Grabar captura esta pestaña',
    },
  }[LANG];
  const SPEECH_LANGS = [
    { id: 'es', label: 'Español', code: /^es\b/i.test(navigator.language || '') ? navigator.language : 'es-419' },
    { id: 'en', label: 'English', code: /^en\b/i.test(navigator.language || '') ? navigator.language : 'en-US' },
  ];

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
    speech: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/>',
    send: '<path d="M21 3L10.5 13.5"/><path d="M21 3l-6.5 18-4-7.5L3 9.5z"/>',
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
    camWanted: !BRIDGE, // turns on by itself when recording (off in agent sessions: it would cover the page in the screenshots)
    camSize: 1,
    strokes: [],
    comments: [],
    history: [],
    panelOpen: false,
    recCount: 0,
    recDur: [],
    transcribe: !!SR,
    speechLang: LANG === 'es' ? 0 : 1,
    marks: [],  // every stroke with what it points at, kept even after it fades or is cleared
    speech: [], // transcript segments
    frames: [], // screenshots grabbed from the recording
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
  .toast { position: fixed; left: 50%; top: 18px; transform: translateX(-50%) translateY(-8px); padding: 9px 14px; border-radius: 10px;
    background: rgba(29,29,31,.92); color: #fff; opacity: 0; transition: opacity .2s, transform .2s; pointer-events: none; max-width: min(520px, 90vw); text-align: center; }
  .toast.on { opacity: 1; transform: translateX(-50%); }

  /* live transcript */
  .caption { position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%); width: max-content; max-width: min(660px, 88vw);
    padding: 7px 13px 8px; border-radius: 10px; background: rgba(29,29,31,.84); color: #fff; font-size: 15px; line-height: 1.38;
    text-align: center; pointer-events: none; text-wrap: balance; }
  .caption i { font-style: normal; opacity: .6; }
  .ib .lang { position: absolute; right: 1px; bottom: 2px; padding: 1px 3px; border-radius: 4px; background: #fff; color: #1d1d1f;
    box-shadow: 0 0 0 1px rgba(0,0,0,.14); font: 700 8px/1 -apple-system, BlinkMacSystemFont, sans-serif; letter-spacing: .02em; }
  .langs { position: fixed; display: flex; flex-direction: column; gap: 1px; padding: 5px; border-radius: 12px; pointer-events: auto; background: #fff;
    width: 230px; box-shadow: 0 0 0 1px rgba(0,0,0,.08), 0 10px 30px rgba(0,0,0,.18); }
  .langs button { height: 30px; padding: 0 10px; border-radius: 8px; text-align: left; display: flex; align-items: center; }
  .langs button:hover { background: #f2f2f7; }
  .langs button.on { font-weight: 600; }
  .langs button.on::after { content: "✓"; margin-left: auto; color: #0A84FF; }
  .langs .note { padding: 6px 10px 4px; font-size: 11px; line-height: 1.35; color: #8e8e93; }

  /* moments (review sidebar) */
  .rv-side h4 { margin: 8px 8px 2px; font-size: 11px; font-weight: 600; color: #8e8e93; text-transform: uppercase; letter-spacing: .04em; }
  .moment { display: block; width: 100%; padding: 8px; border-radius: 10px; text-align: left; }
  .moment[data-t]:hover { background: #f5f5f7; }
  .moment .meta { display: flex; gap: 6px; align-items: center; margin-bottom: 5px; }
  .moment .quote { margin-bottom: 5px; }
  .moment .quote::before { content: "“"; } .moment .quote::after { content: "”"; }
  .moment .marks { display: flex; flex-wrap: wrap; gap: 4px; }
  .moment .mark { font-size: 11px; padding: 2px 6px; border-radius: 6px; background: #f2f2f7; color: #3a3a3c; max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .moment .mark b { font-weight: 600; }
  .moment .thumb { display: block; width: 100%; margin-top: 7px; border-radius: 6px; box-shadow: 0 0 0 1px rgba(0,0,0,.1); }
  .btn.agent { background: #0A84FF; color: #fff; } .btn.agent:hover { background: #0071e3; }
  .btn:disabled { opacity: .6; pointer-events: none; }

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
  .rv-main { background: #0b0b0c; display: flex; flex-direction: column; justify-content: center; min-height: 0; }
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
      <button class="ib${SR ? '' : ' hidden'}" data-act="speech" title="${T.speechTip}"></button>
      <button class="ib" data-act="list" title="${T.commentsKey}">${icon('list')}<span class="badge"></span></button>
      <button class="ib" data-act="close" title="${T.hide}">${icon('close')}</button>
    </div>
    <div class="colors ui hidden">${COLORS.map((c, i) => `<button data-color="${i}" title="${c.name}" style="--c:${c.c}"></button>`).join('')}</div>
    <div class="langs ui hidden"></div>
    <div class="editor ui hidden"></div>
    <div class="panel ui hidden"></div>
    <div class="countdown ui hidden"><div class="num">3</div><div class="hint">${T.clickToCancel}</div></div>
    <div class="caption ui hidden"></div>
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
  const langsEl = $('.langs');
  const captionEl = $('.caption');
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
    cur = { id: ++uid, at: Date.now(), t0: isRec() ? elapsed() : null, rec: isRec() ? state.recCount : null, tool: state.tool, color: state.color.c, w: WIDTH[state.tool], pts: state.tool === 'pen' || state.tool === 'marker' ? [p] : [p, { ...p }] };
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
      s.atEnd = Date.now();
      s.desc = describeStroke(s);
      state.marks.push(s);
      if (isRec()) scheduleFrame(s);
    }
    dirty();
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  function undo() {
    while (state.history.length) {
      const h = state.history.pop();
      if (h.type === 'stroke') {
        if (state.strokes.includes(h.ref)) { state.strokes = state.strokes.filter((s) => s !== h.ref); state.marks = state.marks.filter((s) => s !== h.ref); dirty(); return; }
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

  // ───────────────────────────── what each mark points at (so an agent can find it)
  // Dev servers leave breadcrumbs back to the source: Astro and inspector plugins as attributes;
  // React ≤18, Svelte and Vue as properties, readable when we run in the page's own world.
  function sourceOf(el) {
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 12; e = e.parentElement, i++) {
      const af = e.getAttribute('data-astro-source-file');
      if (af) {
        const line = (e.getAttribute('data-astro-source-loc') || '').split(':')[0];
        return af.replace(/^.*?\/(?=src\/)/, '') + (line ? ':' + line : '');
      }
      const cid = [...e.attributes].find((x) => x.name.startsWith('data-astro-cid-'));
      const cf = cid && astroCidFile(cid.name.slice(15));
      if (cf) return cf.replace(/^.*?\/(?=src\/)/, '');
      const insp = e.getAttribute('data-insp-path') || e.getAttribute('data-v-inspector');
      if (insp) { const m = insp.match(/^(.+?):(\d+)/); return m ? `${m[1]}:${m[2]}` : insp; }
      try {
        const sv = e.__svelte_meta?.loc;
        if (sv?.file) return `${sv.file}:${sv.line}`;
        const fk = Object.keys(e).find((k) => k.startsWith('__reactFiber$'));
        for (let f = fk ? e[fk] : null, j = 0; f && j < 25; f = f.return, j++) {
          if (f._debugSource) return `${f._debugSource.fileName}:${f._debugSource.lineNumber}`;
        }
        const vf = e.__vueParentComponent?.type?.__file;
        if (vf) return vf;
      } catch { /* not readable from this world */ }
    }
    return null;
  }
  // Astro dev without the toolbar: scoped styles carry the component's file and its data-astro-cid
  let cidFiles = null;
  function astroCidFile(cid) {
    if (!cidFiles) {
      cidFiles = new Map();
      for (const st of document.querySelectorAll('style[data-vite-dev-id]')) {
        const file = (st.getAttribute('data-vite-dev-id') || '').split('?')[0];
        for (const m of (st.textContent || '').matchAll(/data-astro-cid-([a-z0-9]+)/g)) if (!cidFiles.has(m[1])) cidFiles.set(m[1], file);
      }
    }
    return cidFiles.get(cid) || null;
  }
  const info = (el) => (el ? { selector: describe(el) || el.tagName.toLowerCase(), text: snippet(el), source: sourceOf(el) } : null);
  // hit-test the page itself, under our overlay
  function probe(fn) { const v = root.style.visibility; root.style.visibility = 'hidden'; try { return fn(); } finally { root.style.visibility = v; } }
  const isWord = (ch) => /[\p{L}\p{N}'’-]/u.test(ch || '');
  function textBetween(a, b) {
    if (!document.caretRangeFromPoint) return '';
    const ra = document.caretRangeFromPoint(a.x, a.y), rb = document.caretRangeFromPoint(b.x, b.y);
    if (!ra || !rb) return '';
    let s = ra, e = rb;
    const r = document.createRange();
    try {
      if (ra.compareBoundaryPoints(Range.START_TO_START, rb) > 0) { s = rb; e = ra; }
      const sn = s.startContainer, en = e.startContainer;
      let so = s.startOffset, eo = e.startOffset;
      if (sn.nodeType === 3) while (so > 0 && isWord(sn.data[so - 1])) so--;
      if (en.nodeType === 3) while (eo < en.data.length && isWord(en.data[eo])) eo++;
      r.setStart(sn, so); r.setEnd(en, eo);
    } catch { return ''; }
    const t = r.toString().replace(/\s+/g, ' ').trim();
    return t.length > 180 ? t.slice(0, 178) + '…' : t;
  }
  const isBig = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height > W * H * 0.3; };
  // what an arrow points at: the first reasonably small element at or just past its tip
  function pointedAt(tip, ang) {
    for (const k of [0, 10, 22, 38]) {
      const el = elementAt(tip.x + Math.cos(ang) * k, tip.y + Math.sin(ang) * k);
      if (el && !isBig(el)) return el;
    }
    return elementAt(tip.x, tip.y);
  }
  // what a loop or box surrounds: the biggest element that fits inside it, or the words it cuts through
  function enclosedBy(vb) {
    const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2, tol = 16;
    const el = elementAt(cx, cy);
    let best = null;
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const r = e.getBoundingClientRect();
      if (r.left >= vb.x - tol && r.top >= vb.y - tol && r.right <= vb.x + vb.w + tol && r.bottom <= vb.y + vb.h + tol) best = e;
      else break;
    }
    if (best) return { el: best, text: '' };
    return { el, text: textBetween({ x: vb.x + 4, y: cy }, { x: vb.x + vb.w - 4, y: cy }) };
  }
  const DIRS = ['right', 'down-right', 'down', 'down-left', 'left', 'up-left', 'up', 'up-right'];
  const compass = (ang) => DIRS[((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8];
  function simplify(pts, n) {
    const pick = pts.length <= n ? pts : Array.from({ length: n }, (_, i) => pts[Math.round((i * (pts.length - 1)) / (n - 1))]);
    return pick.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  }
  function describeStroke(s) {
    const sx = window.scrollX, sy = window.scrollY;
    const xs = s.pts.map((p) => p.x), ys = s.pts.map((p) => p.y);
    const box = { x: Math.round(Math.min(...xs)), y: Math.round(Math.min(...ys)), w: Math.round(Math.max(...xs) - Math.min(...xs)), h: Math.round(Math.max(...ys) - Math.min(...ys)) };
    const vb = { x: box.x - sx, y: box.y - sy, w: box.w, h: box.h };
    const last = s.pts[s.pts.length - 1];
    const a = { x: s.pts[0].x - sx, y: s.pts[0].y - sy }, b = { x: last.x - sx, y: last.y - sy };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return probe(() => {
      if (s.tool === 'arrow') {
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const tail = elementAt(a.x, a.y);
        return { kind: 'arrow', to: info(pointedAt(b, ang)), from: tail && !isBig(tail) ? info(tail) : null, direction: compass(ang), length: Math.round(Math.hypot(b.x - a.x, b.y - a.y)), box };
      }
      if (s.tool === 'marker') return { kind: 'highlight', text: textBetween(a, b), target: info(elementAt(mid.x, mid.y)), box };
      if (s.tool === 'pen' && box.h < 26 && box.w > 40) {
        const up = (p) => ({ x: p.x, y: p.y - 12 });
        return { kind: 'underline', text: textBetween(up(a), up(b)), target: info(elementAt(mid.x, mid.y - 12)), box };
      }
      const closed = s.tool === 'rect' || (s.pts.length > 8 && Math.hypot(b.x - a.x, b.y - a.y) < Math.max(40, 0.35 * Math.min(box.w, box.h)));
      if (closed) {
        const t = enclosedBy(vb);
        return { kind: s.tool === 'rect' ? 'box' : 'circle', target: info(t.el), text: t.text, box };
      }
      return { kind: 'sketch', over: info(elementAt(vb.x + vb.w / 2, vb.y + vb.h / 2)), from: info(elementAt(a.x, a.y)), to: info(elementAt(b.x, b.y)), path: simplify(s.pts, 10), box };
    });
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
      url: location.href, target: describe(el), snippet: snippet(el), source: sourceOf(el), createdAt: Date.now(), fresh: true,
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
        if (c.fresh) { state.history.push({ type: 'comment', ref: c }); if (isRec()) scheduleFrame(c); }
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
        <button class="ib" data-p="copy" title="${T.copyAgent}">${icon('copy')}</button>
        ${BRIDGE ? `<button class="ib" data-p="agent" title="${T.sendAgent}">${icon('send')}</button>` : `<button class="ib" data-p="md" title="${T.downloadFeedback}">${icon('download')}</button>`}
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
      else if (a === 'copy') copyForAgent();
      else if (a === 'md') downloadFeedback();
      else if (a === 'agent') sendToAgent(b);
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
  function toVTT(recN, durMs) {
    const cues = [
      ...state.speech.filter((x) => x.rec === recN).map((x) => ({ a: x.t0, b: Math.max(x.t1, x.t0 + 1200), text: x.text })),
      ...state.comments.filter((c) => !c.fresh && c.text && c.rec === recN && c.t != null).map((c) => ({ a: c.t, b: c.t + 4500, text: `#${numberOf(c)} · ${c.text}` })),
    ].sort((x, y) => x.a - y.a);
    const out = ['WEBVTT', ''];
    cues.forEach((c, i) => out.push(String(i + 1), `${vttTime(c.a)} --> ${vttTime(Math.max(c.a + 500, Math.min(c.b, durMs || c.b)))}`, c.text, ''));
    return { text: out.join('\n'), count: cues.length };
  }

  // ───────────────────────────── feedback for agents: feedback.md + feedback.json + frames/
  const frameName = (id) => `frames/${String(id).padStart(2, '0')}.jpg`;
  const tLabel = (t, n, take = 'R') => (t == null ? '' : (state.recCount > 1 ? `${take}${n} ` : '') + fmt(t));
  const hasFeedback = () => state.marks.length > 0 || state.speech.length > 0 || state.comments.some((c) => !c.fresh && c.text);

  // a moment = marks made close together (or on the same frame) + what was said around them
  function buildMoments() {
    const marks = [
      ...state.marks.map((m) => ({ type: 'stroke', at0: m.at, at1: m.atEnd || m.at, t: m.t0, rec: m.rec, ref: m, frame: m.frame || null })),
      ...state.comments.filter((c) => !c.fresh && c.text).map((c) => ({ type: 'comment', at0: c.createdAt, at1: c.createdAt, t: c.t, rec: c.rec, ref: c, frame: c.frame || null })),
    ].sort((x, y) => x.at0 - y.at0);
    const out = [];
    for (const m of marks) {
      const last = out[out.length - 1];
      // marks in one burst share a frame; without a recording, marks close in time go together
      if (last && (m.frame ? m.frame === last.frame : !last.frame && m.at0 - last.at1 < 1500)) {
        last.marks.push(m); last.at1 = Math.max(last.at1, m.at1); last.frame = last.frame || m.frame;
      } else out.push({ at0: m.at0, at1: m.at1, marks: [m], said: [], frame: m.frame });
    }
    let loose = null;
    for (const x of state.speech) {
      let best = null, gap = Infinity;
      for (const mo of out) {
        if (!mo.marks.length) continue;
        const g = Math.max(0, x.at0 - mo.at1, mo.at0 - x.at1);
        if (g < gap) { gap = g; best = mo; }
      }
      if (best && gap <= 4000) { best.said.push(x); continue; }
      if (loose && loose.frame === x.frame && x.at0 - loose.at1 < 15000) { loose.said.push(x); loose.at1 = x.at1; continue; }
      loose = { at0: x.at0, at1: x.at1, marks: [], said: [x], frame: x.frame };
      out.push(loose);
    }
    for (const mo of out) {
      mo.said.sort((x, y) => x.at0 - y.at0);
      const ts = [...mo.marks.filter((m) => m.t != null).map((m) => [m.t, m.rec, m.at0]), ...mo.said.map((x) => [x.t0, x.rec, x.at0])].sort((x, y) => x[2] - y[2]);
      mo.t = ts.length ? ts[0][0] : null; mo.rec = ts.length ? ts[0][1] : null;
      mo.at0 = Math.min(mo.at0, ...mo.said.map((x) => x.at0));
    }
    return out.sort((x, y) => x.at0 - y.at0);
  }
  const mdEl = (i) => {
    if (!i) return 'empty space';
    let s = '`' + (i.selector || 'body') + '`';
    if (i.text) s += ` (“${i.text}”)`;
    if (i.source) s += ` · \`${i.source}\``;
    return s;
  };
  function markLine(m) {
    if (m.type === 'comment') { const c = m.ref; return `**Comment ${numberOf(c)}** on ${mdEl({ selector: c.target, text: c.snippet, source: c.source })}: ${c.text.replace(/\n+/g, ' / ')}`; }
    const d = m.ref.desc || {};
    const words = (verb) => `**${verb}** ${d.text ? `“${d.text}” in ` : ''}${mdEl(d.target)}`;
    switch (d.kind) {
      case 'highlight': return words('Highlighted');
      case 'underline': return words('Underlined');
      case 'circle': return words('Circled');
      case 'box': return words('Drew a box around');
      case 'arrow': return `**Arrow** pointing ${d.direction} at ${mdEl(d.to)}${d.from ? `, drawn from ${mdEl(d.from)}` : ''}`;
      case 'sketch': {
        const other = (x) => x && x.selector !== d.over?.selector;
        return `**Freehand drawing** over ${mdEl(d.over)}${other(d.from) ? `, starting at ${mdEl(d.from)}` : ''}${other(d.to) && d.to.selector !== d.from?.selector ? `, ending at ${mdEl(d.to)}` : ''}; ` +
          `box ${d.box.w}×${d.box.h} at (${d.box.x}, ${d.box.y}); path in page px: ${d.path.map((p) => `${p.x},${p.y}`).join(' → ')}`;
      }
      default: return '**Mark**';
    }
  }
  function toAgentMarkdown({ images = true } = {}) {
    const moments = buildMoments();
    const L = [`# Feedback · ${document.title || location.hostname || location.href}`, '', `- Page: ${location.href}`, `- Viewport: ${W}×${H} CSS px, device pixel ratio ${dpr}`];
    const recs = state.recDur.map((d, i) => (d == null ? null : `${state.recDur.length > 1 ? `R${i + 1} ` : ''}${fmt(d)}`)).filter(Boolean);
    if (recs.length) L.push(`- Recording: ${recs.join(', ')}`);
    const langs = [...new Set(state.speech.map((x) => x.lang))];
    if (langs.length) L.push(`- Speech: ${langs.join(', ')} (automatic transcript, may have recognition errors)`);
    L.push(`- Exported: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, '',
      'A reviewer went through this page out loud while drawing on it. Each moment below pairs what they said with what they marked, in order. ' +
      'Quotes are an automatic transcript; frames are screenshots of the page with their marks on it. Selectors, quoted text and source locations identify the marked elements. ' +
      'Read it as a list of changes to make to the page.', '');
    if (!moments.length) L.push('_No marks or speech were captured._', '');
    moments.forEach((mo, i) => {
      const t = tLabel(mo.t, mo.rec);
      L.push(`## ${i + 1}${t ? ` · ${t}` : ''}`, '');
      if (mo.said.length) L.push(mo.said.map((x) => `> ${x.text}`).join('\n>\n'), '');
      if (mo.marks.length) L.push(...mo.marks.map((m) => `- ${markLine(m)}`), '');
      if (images && mo.frame && state.frames.some((f) => f.id === mo.frame)) L.push(`![Moment ${i + 1}](${frameName(mo.frame)})`, '');
    });
    if (state.speech.length) L.push('## Transcript', '', ...state.speech.map((x) => `- [${tLabel(x.t0, x.rec)}] ${x.text}`), '');
    return L.join('\n');
  }
  function toAgentJSON(moments = buildMoments()) {
    const used = new Set(moments.map((m) => m.frame));
    const mark = (m) => {
      if (m.type === 'comment') return { type: 'comment', n: numberOf(m.ref), text: m.ref.text, target: { selector: m.ref.target, text: m.ref.snippet, source: m.ref.source } };
      const { kind, ...rest } = m.ref.desc || {};
      return { type: kind || m.ref.tool, tool: m.ref.tool, color: m.ref.color, ...rest };
    };
    return {
      format: 'garabato-feedback/1',
      page: { url: location.href, title: document.title, viewport: { width: W, height: H, dpr } },
      exportedAt: new Date().toISOString(),
      recordings: state.recDur.map((d, i) => ({ n: i + 1, durationMs: Math.round(d || 0) })),
      moments: moments.map((mo, i) => ({ n: i + 1, recording: mo.rec, timeMs: mo.t == null ? null : Math.round(mo.t), said: mo.said.map((x) => x.text), marks: mo.marks.map(mark), frame: mo.frame ? frameName(mo.frame) : null })),
      transcript: state.speech.map((x) => ({ recording: x.rec, startMs: Math.round(x.t0), endMs: Math.round(x.t1), lang: x.lang, text: x.text })),
      frames: state.frames.filter((f) => used.has(f.id)).map((f) => ({ file: frameName(f.id), recording: f.rec, timeMs: f.t == null ? null : Math.round(f.t), width: f.w, height: f.h })),
    };
  }
  async function feedbackFiles() {
    const moments = buildMoments();
    const used = new Set(moments.map((m) => m.frame));
    const list = state.frames.filter((f) => used.has(f.id));
    await Promise.all(list.map((f) => f.ready));
    return [
      { name: 'feedback.md', data: toAgentMarkdown() },
      { name: 'feedback.json', data: JSON.stringify(toAgentJSON(moments), null, 2) },
      ...list.filter((f) => f.blob).map((f) => ({ name: frameName(f.id), data: f.blob })),
    ];
  }
  function copyForAgent() {
    if (!hasFeedback()) return toast(T.nothingYet);
    return copyText(toAgentMarkdown({ images: false })).then(() => toast(T.agentCopied));
  }
  async function downloadFeedback() {
    if (!hasFeedback()) { toast(T.nothingYet); return false; }
    const files = await feedbackFiles();
    const name = baseName();
    if (files.length === 2) { downloadText(files[0].data, `${name}.md`, 'text/markdown'); return true; }
    const url = URL.createObjectURL(await makeZip(files.map((f) => ({ ...f, name: `${name}/${f.name}` }))));
    downloadURL(url, `${name}.zip`);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  }
  const blobToBase64 = (b) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(b); });
  async function sendToAgent(btn) {
    if (!BRIDGE) return false;
    if (!hasFeedback()) { toast(T.nothingYet); return false; }
    const label = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.textContent = T.sending; }
    try {
      const files = await feedbackFiles();
      const payload = { page: location.href, title: document.title, files: await Promise.all(files.map(async (f) => (typeof f.data === 'string' ? { name: f.name, text: f.data } : { name: f.name, base64: await blobToBase64(f.data) }))) };
      const res = await fetch(BRIDGE + '/feedback', { method: 'POST', headers: { 'content-type': 'application/json', 'x-garabato': '1' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      toast(T.sent(j.path || ''), 4500);
      if (review) review.saved = true;
      resetFeedback();
      if (btn) { btn.textContent = '✓ ' + T.sentShort; return true; }
      return true;
    } catch (e) {
      toast(T.sendFailed + (e.message || e), 5000);
      if (btn) { btn.disabled = false; setHTML(btn, label); }
      return false;
    }
  }
  // after sending, start a clean round
  function resetFeedback() {
    if (editorFor) closeEditor(false);
    state.frames.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    state.strokes = []; state.marks = []; state.speech = []; state.frames = []; state.history = [];
    state.comments = [];
    renderPins(); renderPanel(); updateBar(); dirty();
  }

  // minimal .zip writer (stored, no compression: JPEGs don't shrink anyway)
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  async function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    let off = 0;
    for (const f of files) {
      const data = typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer());
      const name = enc.encode(f.name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, time, true); h.setUint16(12, date, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(h, name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(c, name);
      off += 30 + name.length + data.length;
    }
    const size = central.reduce((n, x) => n + x.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, e], { type: 'application/zip' });
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

  // ───────────────────────────── frames: screenshots taken from the recording itself
  const grab = { video: null, pending: [], timer: 0, n: 0 };
  function startGrabber(track) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true;
    v.srcObject = new MediaStream([track]);
    v.play().catch(() => {});
    grab.video = v;
  }
  function stopGrabber() { flushFrame(); if (grab.video) { grab.video.srcObject = null; grab.video = null; } }
  function grabFrame() {
    const v = grab.video;
    if (!v || !v.videoWidth || state.frames.length >= 80) return null;
    const k = Math.min(1, 1600 / v.videoWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const f = { id: ++grab.n, t: isRec() ? elapsed() : null, rec: state.recCount, at: Date.now(), scrollY: window.scrollY, w: c.width, h: c.height, blob: null };
    f.ready = new Promise((res) => c.toBlob((b) => { f.blob = b; res(b); }, 'image/jpeg', 0.85));
    state.frames.push(f);
    return f;
  }
  // one frame per burst of marks, a moment after the last one (so the drawing is complete)
  function scheduleFrame(ref) {
    if (!grab.video) return;
    grab.pending.push(ref);
    clearTimeout(grab.timer);
    grab.timer = setTimeout(flushFrame, 900);
  }
  function flushFrame() {
    clearTimeout(grab.timer);
    const refs = grab.pending.splice(0);
    if (!refs.length) return;
    const f = grabFrame();
    if (f) refs.forEach((x) => { x.frame = f.id; });
  }

  // ───────────────────────────── live transcript (Web Speech API)
  const speech = { r: null, want: false, interim: '', start: null, failed: false, stopT: null, done: Promise.resolve() };
  function speechStart() {
    if (!SR || !state.transcribe || !state.micOn || speech.failed || !isRec()) return;
    speech.want = true;
    if (speech.r) return;
    const r = new SR();
    r.lang = SPEECH_LANGS[state.speechLang].code;
    r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    let ended;
    r.ended = new Promise((res) => { ended = res; });
    r.onresult = (e) => {
      if (r.dead) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) addSegment(res[0].transcript); else interim += res[0].transcript;
      }
      interim = interim.trim();
      if (interim && speech.start == null) speech.start = Math.max(0, (isRec() ? elapsed() : speech.stopT ?? 0) - 600);
      speech.interim = interim;
      renderCaption();
    };
    r.onerror = (e) => {
      if (['not-allowed', 'service-not-allowed'].includes(e.error)) { speech.failed = true; toast(T.speechBlocked, 4500); }
      else if (['network', 'language-not-supported'].includes(e.error)) { speech.failed = true; toast(T.speechNet, 4500); }
      if (speech.failed) { speech.want = false; updateBar(); renderCaption(); }
    };
    r.onend = () => {
      if (!r.dead && speech.interim) addSegment(speech.interim); // words that never got a final result
      ended();
      if (speech.r === r) speech.r = null;
      if (speech.want && isRec() && !speech.failed) setTimeout(speechStart, 150); // Chrome ends sessions on its own: keep going
      renderCaption();
    };
    try { r.start(); speech.r = r; } catch { ended(); }
  }
  // stop listening; the words in flight still arrive as a final result before 'end'
  function speechStop() {
    speech.want = false;
    const r = speech.r;
    if (!r) { speech.interim = ''; renderCaption(); return Promise.resolve(); }
    try { r.stop(); } catch { }
    return r.ended;
  }
  function speechRestart() {
    const r = speech.r;
    speech.r = null; speech.interim = ''; speech.start = null;
    if (r) { r.dead = true; try { r.abort(); } catch { } }
    if (isRec()) speechStart();
    renderCaption();
  }
  function addSegment(txt) {
    const text = String(txt || '').replace(/\s+/g, ' ').trim();
    speech.interim = '';
    if (!text) return;
    const t1 = isRec() ? elapsed() : (speech.stopT ?? 0);
    const t0 = speech.start != null ? Math.min(speech.start, t1) : Math.max(0, t1 - Math.min(8000, 400 + text.length * 60));
    speech.start = null;
    const at1 = Date.now();
    const seg = { id: ++uid, t0, t1, at0: at1 - (t1 - t0), at1, rec: state.recCount, text, lang: SPEECH_LANGS[state.speechLang].code, frame: null };
    state.speech.push(seg);
    // things said without drawing still get a picture of what was on screen
    const lastF = state.frames[state.frames.length - 1];
    if (grab.video && (!lastF || at1 - lastF.at > 6000 || Math.abs(window.scrollY - lastF.scrollY) > H * 0.3)) seg.frame = grabFrame()?.id ?? lastF?.id ?? null;
    else seg.frame = lastF?.id ?? null;
  }
  let capTimer = 0;
  function renderCaption() {
    clearTimeout(capTimer);
    const last = state.speech[state.speech.length - 1];
    const recent = last && last.rec === state.recCount && Date.now() - last.at1 < 3500 ? last.text : '';
    const show = isRec() && state.transcribe && !speech.failed && !!(speech.interim || recent);
    captionEl.classList.toggle('hidden', !show);
    if (!show) return;
    const tail = (x, n) => (x.length > n ? '…' + x.slice(-n) : x);
    setHTML(captionEl, speech.interim ? `${recent ? esc(tail(recent, 50)) + ' ' : ''}<i>${esc(tail(speech.interim, 110))}</i>` : esc(tail(recent, 140)));
    const br = bar.getBoundingClientRect();
    captionEl.style.left = clamp(br.left + br.width / 2, 160, W - 160) + 'px';
    captionEl.style.bottom = (br.top > H / 2 ? H - br.top + 10 : 24) + 'px';
    if (!speech.interim) capTimer = setTimeout(renderCaption, 3600);
  }

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
    startGrabber(vTrack);

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
    speechStart();
    setTimeout(() => { if (isRec() && !state.frames.some((f) => f.rec === state.recCount)) grabFrame(); }, 500);
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
    if (rec.status === 'recording') { flushFrame(); speech.stopT = elapsed(); speechStop(); rec.recorder.pause(); rec.pausedAt = now(); rec.status = 'paused'; }
    else if (rec.status === 'paused') { rec.recorder.resume(); rec.pausedTotal += now() - rec.pausedAt; rec.status = 'recording'; speechStart(); }
    updateBar(); updateTimer(); renderCaption();
  }
  function stopRecording() {
    if (rec.status === 'countdown' || rec.status === 'starting') { rec.cancelled = true; return; }
    if (!isRec()) return;
    flushFrame();
    rec.duration = speech.stopT = elapsed();
    speech.done = speechStop();
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
    stopGrabber();
    if (speech.want) speech.done = speechStop();
    if (rec.autoCam && state.camOn) camOff(); // we only turned it on to record: turn it back off
    rec.autoCam = false;
    if (!state.camOn) releaseMic();
  }
  async function finishRecording() {
    if (rec.status !== 'stopping' || rec.finishing) return;
    rec.finishing = true;
    const type = (rec.mime || rec.recorder?.mimeType || 'video/webm').split(';')[0];
    const blob = new Blob(rec.chunks, { type });
    rec.chunks = [];
    state.recDur[state.recCount - 1] = rec.duration;
    teardown();
    await Promise.race([speech.done, new Promise((res) => setTimeout(res, 1500))]); // last words
    await Promise.all(state.frames.map((f) => f.ready));
    rec.finishing = false;
    rec.status = 'idle';
    renderCaption();
    updateBar(); updateHalo();
    openReview(blob, rec.duration, state.recCount, rec.ar);
  }
  function updateTimer() {
    const t = bar.querySelector('.rec .t');
    if (isRec()) t.textContent = fmt(elapsed());
  }

  // ───────────────────────────── review
  let review = null; // { url, blob, ext, dur, n, saved }
  const markKind = (m) => (m.type === 'comment' ? `${T.kinds.comment} ${numberOf(m.ref)}` : T.kinds[m.ref.desc?.kind] || m.ref.tool);
  function markTarget(m) {
    if (m.type === 'comment') return m.ref.text;
    const d = m.ref.desc || {}, el = d.target || d.to || d.over;
    return d.text ? `“${d.text}”` : el ? (el.text ? `“${el.text}”` : el.selector) : '';
  }
  function momentHTML(mo, i, n) {
    const seek = mo.rec === n && mo.t != null;
    const marks = mo.marks.map((m) => `<span class="mark"><b>${esc(markKind(m))}</b> ${esc(markTarget(m))}</span>`).join('');
    return `<button class="moment" ${seek ? `data-t="${mo.t}"` : ''}>
      <div class="meta"><span class="ed-n" style="--c:#1d1d1f;--fg:#fff">${i + 1}</span>${mo.t != null ? `<span class="chip red">● ${esc(tLabel(mo.t, mo.rec, T.take))}</span>` : ''}</div>
      ${mo.said.length ? `<div class="quote">${esc(mo.said.map((x) => x.text).join(' … '))}</div>` : ''}
      ${marks ? `<div class="marks">${marks}</div>` : ''}
      ${frameURL(mo.frame) ? `<img class="thumb" alt="" src="${frameURL(mo.frame)}">` : ''}</button>`;
  }
  function frameURL(id) {
    const f = id && state.frames.find((x) => x.id === id);
    if (!f?.blob) return null;
    return (f.url ||= URL.createObjectURL(f.blob));
  }
  function openReview(blob, dur, n, ar) {
    if (review) URL.revokeObjectURL(review.url);
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(blob);
    const name = baseName();
    review = { url, blob, ext, dur, n, name, saved: false };
    const cues = toVTT(n, dur);
    const vtt = URL.createObjectURL(new Blob([cues.text], { type: 'text/vtt' }));
    review.vtt = vtt;
    const moments = buildMoments();
    const here = moments.map((mo, i) => ({ mo, i })).filter(({ mo }) => mo.rec === n && mo.t != null);
    const mb = (blob.size / 1048576).toFixed(1);
    setHTML(reviewEl, `
      <div class="rv-card">
        <div class="rv-head"><b>${T.ready}</b><span class="muted">${fmt(dur)} · ${mb} MB · ${ext.toUpperCase()}</span><span class="sp"></span>
          <button class="ib" data-rv="close" title="${T.close}">${icon('close')}</button></div>
        <div class="rv-body ${moments.length ? '' : 'solo'}">
          <div class="rv-main">
            ${PLAYER ? `<iframe class="player" src="${PLAYER}" title="${T.recording}"></iframe>`
              : `<video class="player" controls playsinline preload="metadata" src="${url}">${cues.count ? `<track kind="subtitles" srclang="${LANG}" label="${T.transcriptLabel}" src="${vtt}" default>` : ''}</video>`}
            ${here.length ? `<div class="rv-track">${here.map(({ mo, i }) => `<button class="mk" data-t="${mo.t}" title="${esc(fmt(mo.t) + ' · ' + (mo.said.map((x) => x.text).join(' ').slice(0, 90) || mo.marks.map(markKind).join(', ')))}" style="left:${clamp((mo.t / Math.max(dur, 1)) * 100, 0, 100)}%;--c:#FF3B30;--fg:#fff">${i + 1}</button>`).join('')}</div>` : ''}
          </div>
          ${moments.length ? `<div class="rv-side"><h4>${T.moments}</h4>${moments.map((mo, i) => momentHTML(mo, i, n)).join('')}</div>` : ''}
        </div>
        <div class="rv-foot">
          ${BRIDGE ? `<button class="btn agent" data-rv="agent">${icon('send')} ${T.sendAgent}</button>` : `<button class="btn primary" data-rv="feedback">${icon('download')} ${T.downloadFeedback}</button>`}
          <button class="btn ghost" data-rv="copy">${icon('copy')} ${T.copyAgent}</button>
          <button class="btn ghost" data-rv="video">${icon('download')} ${T.downloadVideo}</button>
          ${cues.count ? `<button class="btn ghost" data-rv="vtt">${T.vttBtn}</button>` : ''}
          <span class="sp"></span>
          <button class="btn danger" data-rv="discard">${T.discard}</button>
        </div>
      </div>`);
    reviewEl.querySelectorAll('img.thumb').forEach((im) => im.addEventListener('error', () => im.remove())); // a strict CSP may block blob: images
    reviewEl.classList.remove('hidden');
    if (ar) reviewEl.querySelector('.player').style.setProperty('--ar', ar);
    if (PLAYER) {
      const fr = reviewEl.querySelector('iframe.player');
      fr.addEventListener('load', () => fr.contentWindow.postMessage({ garabato: 1, cmd: 'load', blob, vtt: cues.count ? cues.text : null, lang: LANG, label: T.transcriptLabel }, new URL(PLAYER).origin), { once: true });
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
    else if (a === 'agent') sendToAgent(b);
    else if (a === 'feedback') downloadFeedback().then((ok) => { if (ok && review) review.saved = true; });
    else if (a === 'vtt') downloadText(toVTT(review.n, review.dur).text, `${review.name}.vtt`, 'text/vtt');
    else if (a === 'copy') copyForAgent();
    else if (a === 'close') closeReview(false);
    else if (a === 'discard') closeReview(false);
  });

  // ───────────────────────────── toolbar
  function setTool(t) {
    state.tool = t;
    if (t !== 'comment' && editorFor) closeEditor(true);
    updateBar(); updateHalo();
  }
  function closePopovers() { colorsEl.classList.add('hidden'); langsEl.classList.add('hidden'); }
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
    const spB = bar.querySelector('[data-act="speech"]');
    const spOn = state.transcribe && !speech.failed;
    setHTML(spB, icon('speech', spOn ? '' : P.slash) + (spOn ? `<span class="lang">${SPEECH_LANGS[state.speechLang].id.toUpperCase()}</span>` : ''));
    spB.classList.toggle('off', !spOn);
    spB.title = spOn ? T.speechLang(SPEECH_LANGS[state.speechLang].label) : T.speechOff;
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
  [bar, colorsEl, langsEl, camEl].forEach((el) => el.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); }));
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    b.blur();
    if (b.dataset.tool) { closePopovers(); return setTool(b.dataset.tool); }
    const a = b.dataset.act;
    if (a !== 'color' && a !== 'speech') closePopovers();
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
    else if (a === 'speech') toggleLangs(b);
    else if (a === 'list') { state.panelOpen = !state.panelOpen; renderPanel(); updateBar(); }
    else if (a === 'close') hide();
  });
  async function toggleMic() {
    state.micOn = !state.micOn;
    updateBar();
    if (state.micOn) { if (await ensureMic()) connectMicToRec(); speechStart(); }
    else if (isRec()) { connectMicToRec(); speechStop(); }
    else releaseMic();
  }
  function placePopover(el, btn) {
    const r = btn.getBoundingClientRect(), cw = el.offsetWidth, ch = el.offsetHeight;
    el.style.left = clamp(r.left + r.width / 2 - cw / 2, 8, W - cw - 8) + 'px';
    el.style.top = (r.top - ch - 10 < 8 ? r.bottom + 10 : r.top - ch - 10) + 'px';
  }
  function toggleColors(btn) {
    if (!colorsEl.classList.contains('hidden')) return closePopovers();
    closePopovers();
    colorsEl.classList.remove('hidden');
    colorsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', COLORS[b.dataset.color] === state.color));
    placePopover(colorsEl, btn);
  }
  function toggleLangs(btn) {
    if (!langsEl.classList.contains('hidden')) return closePopovers();
    closePopovers();
    const cur = state.transcribe && !speech.failed ? state.speechLang : -1;
    setHTML(langsEl, SPEECH_LANGS.map((l, i) => `<button data-lang="${i}" class="${cur === i ? 'on' : ''}">${l.label}</button>`).join('')
      + `<button data-lang="-1" class="${cur === -1 ? 'on' : ''}">${T.langOff}</button><div class="note">${T.speechNote}</div>`);
    langsEl.classList.remove('hidden');
    placePopover(langsEl, btn);
  }
  langsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]'); if (!b) return;
    const i = Number(b.dataset.lang);
    speech.failed = false;
    state.transcribe = i >= 0;
    if (i >= 0) state.speechLang = i;
    speechRestart();
    closePopovers(); updateBar();
  });
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
    else if (k === 'escape') { if (!reviewEl.classList.contains('hidden')) closeReview(false); else if (!colorsEl.classList.contains('hidden') || !langsEl.classList.contains('hidden')) closePopovers(); else if (state.tool !== 'cursor') setTool('cursor'); else handled = false; }
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
  toast(BRIDGE ? T.agentSession : T.hello, 3600);

  window.__garabato = { toggle: () => host.dispatchEvent(new CustomEvent('garabato:toggle')), state, rec, _test: { openReview, elapsed, buildMoments, toAgentMarkdown, toAgentJSON, feedbackFiles, makeZip } };
})();
