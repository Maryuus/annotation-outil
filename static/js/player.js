// ─── Lecteur vidéo ────────────────────────────────────────────────────────

const videoEl = document.getElementById('video-player');
let videoMode = false;
let timerVid  = null;

// ─── Audio clic ───────────────────────────────────────────────────────────

let audioCtx    = null;
let clickBuffer = null;
let muteAvant   = false;

async function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const buf = await (await fetch('/audio/click')).arrayBuffer();
    clickBuffer = await audioCtx.decodeAudioData(buf);
  } catch (e) {
    console.warn('Impossible de charger le son de clic :', e);
  }
}

function jouerClick() {
  if (!clickBuffer || !document.getElementById('chk-click').checked) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const src = audioCtx.createBufferSource();
  src.buffer = clickBuffer;
  src.connect(audioCtx.destination);
  src.start();
}

// ─── Volume ───────────────────────────────────────────────────────────────

function changerVolume(v) {
  const vol = parseFloat(v);
  videoEl.volume = vol;
  document.getElementById('vol-pct').textContent  = Math.round(vol * 100) + ' %';
  document.getElementById('vol-icon').textContent = vol === 0 ? '🔇' : vol < 0.4 ? '🔉' : '🔊';
}

function toggleMute() {
  const slider = document.getElementById('vol-slider');
  if (videoEl.volume > 0) {
    muteAvant    = videoEl.volume;
    slider.value = 0;
  } else {
    slider.value = muteAvant || 1;
  }
  changerVolume(slider.value);
}

function changerVitesse(v) {
  videoEl.playbackRate = parseFloat(v);
}

// ─── Réinitialisation (changement de vidéo) ───────────────────────────────

function resetPlayer() {
  clearInterval(timerVid);
  timerVid  = null;
  videoMode = false;
  videoEl.pause();
  videoEl.src = '';
  videoEl.removeAttribute('data-loaded');
  videoEl.load();
  videoEl.style.display = 'none';
  document.getElementById('img-0').style.display = 'block';
  document.getElementById('btn-play').textContent = '▶';
}

// ─── Lecture / Pause ──────────────────────────────────────────────────────

function togglePlay() {
  if (!state.total) return;
  if (!videoMode)          enterVideoMode();
  else if (videoEl.paused) videoEl.play();
  else                     pauseVideo();
}

function enterVideoMode() {
  videoMode = true;
  initAudio();
  if (!videoEl.getAttribute('data-loaded')) {
    videoEl.src = `/video/stream?v=${state.videoSeed}`;
    videoEl.setAttribute('data-loaded', '1');
  }
  videoEl.currentTime = state.cur / state.fps;
  videoEl.style.display = 'block';
  document.getElementById('img-0').style.display = 'none';
  document.getElementById('ph-center').textContent = '';
  videoEl.play();
  document.getElementById('btn-play').textContent = '⏸';

  ['img-m2', 'img-m1', 'img-p1', 'img-p2'].forEach(id => {
    const img = document.getElementById(id);
    img.style.display = 'none';
    img.removeAttribute('data-src');
  });
  ['wrap-m2', 'wrap-m1', 'wrap-p1', 'wrap-p2'].forEach(id => {
    document.getElementById(id).querySelector('.placeholder').textContent = '▶';
  });
  ['vig-m2', 'vig-m1', 'vig-p1', 'vig-p2'].forEach(id =>
    document.getElementById(id).classList.remove('annotee')
  );

  let prevFrame   = state.cur;
  let lastClickFr = -1;

  timerVid = setInterval(() => {
    if (videoEl.paused) return;
    const newFrame = Math.round(videoEl.currentTime * state.fps);
    if (newFrame !== prevFrame) {
      const lo  = Math.min(prevFrame, newFrame);
      const hi  = Math.max(prevFrame, newFrame);
      const hit = state.anns.find(a => a.frame > lo && a.frame <= hi);
      if (hit && hit.frame !== lastClickFr) {
        jouerClick();
        lastClickFr = hit.frame;
      }
      prevFrame = newFrame;
    }
    state.cur = newFrame;
    document.getElementById('slider').value = state.cur;
    majTextes();
  }, 50);
}

function pauseVideo() {
  clearInterval(timerVid);
  const framePause = Math.round(videoEl.currentTime * state.fps);
  videoEl.pause();
  videoMode = false;
  document.getElementById('btn-play').textContent = '▶';
  state.cur = clamp(framePause, 0, state.total - 1);
  majTextes();
  document.getElementById('slider').value = state.cur;

  const img    = document.getElementById('img-0');
  const newSrc = `/frames/${state.cur}?v=${state.videoSeed}`;
  img.removeAttribute('data-src');
  videoEl.style.display = 'none';

  const afficherFrame = () => {
    img.style.display = 'block';
    document.getElementById('ph-center').textContent = '';
    majImages();
    majListeActive();
  };

  img.onload  = afficherFrame;
  img.onerror = () => { img.style.display = 'none'; };
  img.src = newSrc;
  img.setAttribute('data-src', newSrc);

  // Si l'image était déjà en cache à cette URL, le navigateur ne redéclenche
  // pas l'événement load → on l'affiche directement.
  if (img.complete && img.naturalWidth > 0) afficherFrame();

  mettreAJourCache();
}

videoEl.addEventListener('ended', pauseVideo);

// ─── Annoter pendant la lecture ───────────────────────────────────────────

async function annoterVideo() {
  const frame = Math.round(videoEl.currentTime * state.fps);
  const lbl   = document.getElementById('input-label').value.trim();
  await postAnnotation(frame, lbl);

  const data = await fetchAnnotations();
  state.anns = data.items;
  state.pas  = data.pas;
  majListe();
  majMarqueurs();
  majPas();

  const flash = document.getElementById('ann-flash');
  flash.textContent = `✓  #${frame}${lbl ? '  ·  ' + lbl : ''}`;
  flash.classList.add('show');
  clearTimeout(flash._t);
  flash._t = setTimeout(() => flash.classList.remove('show'), 900);
}

// ─── Filmstrip ────────────────────────────────────────────────────────────

let filmstripMode  = 5;
let mode1Observer  = null;

function getVideoAr() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--video-ar').trim();
  if (!v) return 16 / 9;
  const [w, h] = v.split('/').map(parseFloat);
  return (w && h) ? w / h : 16 / 9;
}

function applyMode1Width() {
  if (filmstripMode !== 1) return;
  const fs   = document.getElementById('filmstrip');
  const vig  = document.getElementById('vig-0');
  const head = vig.querySelector('.vig-head');
  const ar   = getVideoAr();
  const maxByH = (fs.clientHeight - head.offsetHeight - 20) * ar;
  const maxByW = fs.clientWidth - 28;
  vig.style.width = Math.min(maxByH, maxByW) + 'px';
}

function setMode(n) {
  if (filmstripMode === 1 && n !== 1) {
    if (mode1Observer) { mode1Observer.disconnect(); mode1Observer = null; }
    document.getElementById('vig-0').style.width = '';
  }

  filmstripMode = n;
  const fs = document.getElementById('filmstrip');
  fs.classList.remove('mode-3', 'mode-1');
  if (n === 3) fs.classList.add('mode-3');
  if (n === 1) {
    fs.classList.add('mode-1');
    applyMode1Width();
    mode1Observer = new ResizeObserver(applyMode1Width);
    mode1Observer.observe(fs);
  }

  [1, 3, 5].forEach(m =>
    document.getElementById(`mode-btn-${m}`).classList.toggle('active', m === n)
  );

  majImages();
}

const SLOTS = [
  { id: 'vig-m2', imgId: 'img-m2', wrapId: 'wrap-m2', offset: -2 },
  { id: 'vig-m1', imgId: 'img-m1', wrapId: 'wrap-m1', offset: -1 },
  { id: 'vig-0',  imgId: 'img-0',  wrapId: 'wrap-0',  offset:  0 },
  { id: 'vig-p1', imgId: 'img-p1', wrapId: 'wrap-p1', offset: +1 },
  { id: 'vig-p2', imgId: 'img-p2', wrapId: 'wrap-p2', offset: +2 },
];

const ACTIFS = { 5: [-2, -1, 0, 1, 2], 3: [-1, 0, 1], 1: [0] };

function frameUrl(idx, isThumb) {
  const base = `/frames/${idx}?v=${state.videoSeed}`;
  return isThumb ? base + '&size=thumb' : base;
}

function majImages() {
  const actifs = ACTIFS[filmstripMode] ?? ACTIFS[5];

  for (const slot of SLOTS) {
    if (!actifs.includes(slot.offset)) continue;
    const idx = state.cur + slot.offset;
    const img = document.getElementById(slot.imgId);
    const vig = document.getElementById(slot.id);
    const ph  = document.getElementById(slot.wrapId)?.querySelector('.placeholder');

    if (idx >= 0 && idx < state.total) {
      const newSrc = frameUrl(idx, slot.offset !== 0);

      if (img.getAttribute('data-src') !== newSrc) {
        img.setAttribute('data-src', newSrc);

        const wasVisible = img.style.display === 'block';
        if (!wasVisible && ph) ph.textContent = '…';

        const tmp = new Image();
        tmp.onload = () => {
          if (img.getAttribute('data-src') === newSrc) {
            img.src = newSrc;
            img.style.display = 'block';
            if (ph) ph.textContent = '';
          }
        };
        tmp.onerror = () => {
          if (img.getAttribute('data-src') === newSrc) {
            img.src = '';
            img.style.display = 'none';
            if (ph) ph.textContent = '✗';
          }
        };
        tmp.src = newSrc;
      }

      vig.classList.toggle('annotee', isAnnotee(idx));
    } else {
      img.src = '';
      img.removeAttribute('data-src');
      img.style.display = 'none';
      if (ph) ph.textContent = '—';
      vig.classList.remove('annotee');
    }
  }
}

function resetFilmstrip() {
  frameCache.clear();
  for (const slot of SLOTS) {
    document.getElementById(slot.imgId).removeAttribute('data-src');
  }
}

// ─── Cache mémoire des frames ─────────────────────────────────────────────

const frameCache = new Map();
let   timerCache = null;

function mettreAJourCache() {
  clearTimeout(timerCache);
  timerCache = setTimeout(_actualiserCache, 200);
}

function _actualiserCache() {
  if (!state.total) return;
  const aGarder = new Set();

  for (let i = Math.max(0, state.cur - 20); i <= Math.min(state.total - 1, state.cur + 20); i++)
    aGarder.add(i);
  for (const ann of state.anns)
    for (let i = Math.max(0, ann.frame - 5); i <= Math.min(state.total - 1, ann.frame + 5); i++)
      aGarder.add(i);

  for (const [frame, img] of frameCache) {
    if (!aGarder.has(frame)) { img.src = ''; frameCache.delete(frame); }
  }
  for (const frame of aGarder) {
    if (!frameCache.has(frame)) {
      const img = new Image();
      img.src = frameUrl(frame, true);
      frameCache.set(frame, img);
    }
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────

let timerImg = null;

function goTo(n) {
  if (!state.total) return;
  state.cur = clamp(n, 0, state.total - 1);
  document.getElementById('slider').value = state.cur;
  majTextes();
  clearTimeout(timerImg);
  timerImg = setTimeout(() => { majImages(); majListeActive(); }, 60);
  mettreAJourCache();
}

const naviguer  = offset => goTo(state.cur + offset);
const naviguerN = signe  => goTo(state.cur + signe * state.pas);

function gotoAnnotPrev() {
  const prev = [...state.anns].reverse().find(a => a.frame < state.cur);
  if (prev) goTo(prev.frame);
}

function gotoAnnotNext() {
  const next = state.anns.find(a => a.frame > state.cur);
  if (next) goTo(next.frame);
}
