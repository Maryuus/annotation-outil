const lecteurVideo = document.getElementById('video-player');
let modeVideo = false;
let timerVideo  = null;

// Son de clic sur les annotations
// click.wav est chargé et décodé une seule fois via AudioContext.
// Chaque clic joue depuis le buffer en mémoire — pas de réseau, fiable sur Linux.

let _contexteAudio = null;
let _bufferClick   = null;

async function _initAudioClick() {
  try {
    _contexteAudio       = new (window.AudioContext || window.webkitAudioContext)();
    const resp           = await fetch('/static/click.wav');
    const bytes          = await resp.arrayBuffer();
    _bufferClick         = await _contexteAudio.decodeAudioData(bytes);
  } catch (e) { _contexteAudio = null; }
}
_initAudioClick();

function jouerClick() {
  if (!document.getElementById('chk-click').checked) return;
  if (!_contexteAudio || !_bufferClick) return;
  if (_contexteAudio.state === 'suspended') _contexteAudio.resume();
  try {
    const src  = _contexteAudio.createBufferSource();
    const gain = _contexteAudio.createGain();
    src.buffer      = _bufferClick;
    gain.gain.value = 0.7;
    src.connect(gain);
    gain.connect(_contexteAudio.destination);
    src.start();
  } catch (e) {}
}

// Planification des clics par setTimeout
// On calcule le délai réel jusqu'à chaque frame annotée et on programme un
// setTimeout par annotation, plutôt que de détecter dans un setInterval.

let _timersClick = [];

function planifierClics() {
  annulerClics();
  if (!state.anns.length || lecteurVideo.paused) return;
  const nowMs = lecteurVideo.currentTime * 1000;
  const taux  = lecteurVideo.playbackRate || 1;
  state.anns.forEach(ann => {
    const frameMs      = (ann.frame / state.fps) * 1000;
    const mediaRestant = frameMs - nowMs;
    if (mediaRestant <= 0) return;
    _timersClick.push(setTimeout(() => {
      if (!lecteurVideo.paused) jouerClick();
    }, mediaRestant / taux));
  });
}

function annulerClics() {
  _timersClick.forEach(clearTimeout);
  _timersClick = [];
}

// Volume

function majVolIcon() {
  const btn = document.getElementById('vol-icon');
  if (!btn) return;
  if (lecteurVideo.muted || lecteurVideo.volume === 0) btn.textContent = '🔇';
  else if (lecteurVideo.volume < 0.4)                  btn.textContent = '🔉';
  else                                                  btn.textContent = '🔊';
}

function changerVolume(v) {
  const pct = parseInt(v, 10);                    // 0–100
  lecteurVideo.volume = pct / 100;
  if (lecteurVideo.muted && pct > 0) lecteurVideo.muted = false;
  document.getElementById('vol-slider').value    = pct;
  document.getElementById('vol-pct').textContent = pct + ' %';
  majVolIcon();
}

function toggleMute() {
  lecteurVideo.muted = !lecteurVideo.muted;
  majVolIcon();
}

function changerVitesse(v) {
  lecteurVideo.playbackRate = parseFloat(v);
}

// Réinitialisation

function resetPlayer() {
  clearInterval(timerVideo);
  timerVideo  = null;
  modeVideo = false;
  lecteurVideo.pause();
  lecteurVideo.src = '';
  lecteurVideo.removeAttribute('data-loaded');
  lecteurVideo.load();
  lecteurVideo.style.display = 'none';
  document.getElementById('img-0').style.display = 'block';
  document.getElementById('btn-play').textContent = '▶';
}

// Lecture / Pause

function togglePlay() {
  if (!state.total) return;
  if (!modeVideo)              entrerModeVideo();
  else if (lecteurVideo.paused) lecteurVideo.play();
  else                          pauseVideo();
}

function entrerModeVideo() {
  modeVideo = true;
  if (!lecteurVideo.getAttribute('data-loaded')) {
    lecteurVideo.src = `/video/stream?v=${state.videoSeed}`;
    lecteurVideo.setAttribute('data-loaded', '1');
  }
  lecteurVideo.currentTime = state.cur / state.fps;
  lecteurVideo.style.display = 'block';
  document.getElementById('img-0').style.display = 'none';
  document.getElementById('ph-center').textContent = '';
  lecteurVideo.play();
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

  // Mettre à jour le slider et les textes (sans détection de clic — géré par planifierClics)
  timerVideo = setInterval(() => {
    if (lecteurVideo.paused) return;
    state.cur = Math.round(lecteurVideo.currentTime * state.fps);
    document.getElementById('slider').value = state.cur;
    majTextes();
  }, 50);

  // Planifier les clics aux moments exacts des frames annotées
  planifierClics();
}

function pauseVideo() {
  annulerClics();
  clearInterval(timerVideo);
  const framePause = Math.round(lecteurVideo.currentTime * state.fps);
  lecteurVideo.pause();
  modeVideo = false;
  document.getElementById('btn-play').textContent = '▶';
  state.cur = clamp(framePause, 0, state.total - 1);
  majTextes();
  document.getElementById('slider').value = state.cur;

  const img    = document.getElementById('img-0');
  const newSrc = `/frames/${state.cur}?v=${state.videoSeed}`;
  img.removeAttribute('data-src');
  lecteurVideo.style.display = 'none';

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

lecteurVideo.addEventListener('ended',      pauseVideo);
// Replanifier après un seek ou un changement de vitesse
lecteurVideo.addEventListener('seeked',     () => { if (!lecteurVideo.paused) planifierClics(); });
lecteurVideo.addEventListener('ratechange', () => { if (!lecteurVideo.paused) planifierClics(); });

// Annoter pendant la lecture

async function annoterVideo() {
  const frame = Math.round(lecteurVideo.currentTime * state.fps);
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

// Filmstrip

let nbVignettes    = 5;
let observateurMode1 = null;

function getVideoAr() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--video-ar').trim();
  if (!v) return 16 / 9;
  const [w, h] = v.split('/').map(parseFloat);
  return (w && h) ? w / h : 16 / 9;
}

function appliquerLargeurMode1() {
  if (nbVignettes !== 1) return;
  const fs   = document.getElementById('filmstrip');
  const vig  = document.getElementById('vig-0');
  const head = vig.querySelector('.vig-head');
  const ar   = getVideoAr();
  const maxByH = (fs.clientHeight - head.offsetHeight - 20) * ar;
  const maxByW = fs.clientWidth - 28;
  vig.style.width = Math.min(maxByH, maxByW) + 'px';
}

function setMode(n) {
  if (nbVignettes === 1 && n !== 1) {
    if (observateurMode1) { observateurMode1.disconnect(); observateurMode1 = null; }
    document.getElementById('vig-0').style.width = '';
  }

  nbVignettes = n;
  const fs = document.getElementById('filmstrip');
  fs.classList.remove('mode-3', 'mode-1');
  if (n === 3) fs.classList.add('mode-3');
  if (n === 1) {
    fs.classList.add('mode-1');
    appliquerLargeurMode1();
    observateurMode1 = new ResizeObserver(appliquerLargeurMode1);
    observateurMode1.observe(fs);
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

function urlFrame(idx, isThumb) {
  const base = `/frames/${idx}?v=${state.videoSeed}`;
  return isThumb ? base + '&size=thumb' : base;
}

function majImages() {
  const actifs = ACTIFS[nbVignettes] ?? ACTIFS[5];

  for (const slot of SLOTS) {
    if (!actifs.includes(slot.offset)) continue;
    const idx = state.cur + slot.offset;
    const img = document.getElementById(slot.imgId);
    const vig = document.getElementById(slot.id);
    const ph  = document.getElementById(slot.wrapId)?.querySelector('.placeholder');

    if (idx >= 0 && idx < state.total) {
      const newSrc = urlFrame(idx, slot.offset !== 0);

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

      vig.classList.toggle('annotee', estAnnotee(idx));
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
  cacheFrames.clear();
  for (const slot of SLOTS) {
    document.getElementById(slot.imgId).removeAttribute('data-src');
  }
}

// Cache mémoire des frames

const cacheFrames = new Map();
let   timerMajCache = null;

function mettreAJourCache() {
  clearTimeout(timerMajCache);
  timerMajCache = setTimeout(_actualiserCache, 200);
}

function _actualiserCache() {
  if (!state.total) return;
  const aGarder = new Set();

  for (let i = Math.max(0, state.cur - 20); i <= Math.min(state.total - 1, state.cur + 20); i++)
    aGarder.add(i);

  for (const [frame, img] of cacheFrames) {
    if (!aGarder.has(frame)) { img.src = ''; cacheFrames.delete(frame); }
  }
  for (const frame of aGarder) {
    if (!cacheFrames.has(frame)) {
      const img = new Image();
      img.src = urlFrame(frame, true);
      cacheFrames.set(frame, img);
    }
  }
}

// Navigation

let timerImage = null;

function allerA(n) {
  if (!state.total) return;
  state.cur = clamp(n, 0, state.total - 1);
  document.getElementById('slider').value = state.cur;
  majTextes();
  clearTimeout(timerImage);
  timerImage = setTimeout(() => { majImages(); majListeActive(); }, 60);
  mettreAJourCache();
}

const naviguer  = offset => allerA(state.cur + offset);
const naviguerN = signe  => allerA(state.cur + signe * state.pas);

function allerAnnotPrecedente() {
  const prev = [...state.anns].reverse().find(a => a.frame < state.cur);
  if (prev) allerA(prev.frame);
}

function allerAnnotSuivante() {
  const next = state.anns.find(a => a.frame > state.cur);
  if (next) allerA(next.frame);
}
