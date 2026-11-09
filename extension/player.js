// Review player. It lives on the extension's origin so the page's CSP
// (e.g. GitHub's media-src) can't block the blob: video.
const v = document.querySelector('video');
const urls = [];
window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const d = e.data || {};
  if (d.garabato !== 1) return;
  if (d.cmd === 'load' && d.blob instanceof Blob) {
    urls.forEach(URL.revokeObjectURL); urls.length = 0;
    v.querySelectorAll('track').forEach((t) => t.remove());
    const src = URL.createObjectURL(d.blob); urls.push(src);
    if (d.vtt) {
      const tr = document.createElement('track');
      tr.kind = 'subtitles'; tr.srclang = d.lang || 'en'; tr.label = d.label || 'Comments'; tr.default = true;
      tr.src = URL.createObjectURL(new Blob([d.vtt], { type: 'text/vtt' })); urls.push(tr.src);
      v.appendChild(tr);
    }
    v.addEventListener('loadedmetadata', () => {
      if (!isFinite(v.duration)) { // MediaRecorder doesn't write the duration: make the browser compute it
        const back = () => { v.removeEventListener('durationchange', back); v.currentTime = 0; };
        v.addEventListener('durationchange', back);
        v.currentTime = 1e7;
      }
    }, { once: true });
    v.src = src;
  } else if (d.cmd === 'seek') { v.currentTime = d.t; v.play().catch(() => {}); }
  else if (d.cmd === 'pause') v.pause();
});
