// ─── État de l'application ────────────────────────────────────────────────

const state = {
  cur:       0,       // frame courante
  total:     0,       // nombre total de frames
  fps:       25,      // images par seconde
  anns:      [],      // annotations { frame, temps_secondes, timecode, etiquette }
  pas:       10,      // saut en frames
  videoSeed: '',      // cache-busting, changé à chaque nouvelle vidéo
};

const clamp        = (n, a, b) => Math.max(a, Math.min(b, n));
const isAnnotee    = frame => state.anns.some(a => a.frame === frame);
const getAnnotation = frame => state.anns.find(a => a.frame === frame) ?? null;

// ─── Appels API ───────────────────────────────────────────────────────────

async function fetchAnnotations() {
  const res = await fetch('/annotations');
  return res.json();
}

async function postAnnotation(frame, etiquette) {
  const res = await fetch('/annotations', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ frame, etiquette }),
  });
  return res.json();
}

async function deleteAnnotation(frame) {
  return fetch(`/annotations/${frame}`, { method: 'DELETE' });
}

async function deleteAllAnnotations() {
  return fetch('/annotations', { method: 'DELETE' });
}

async function postAnnotationLot(debut, fin, nombre, etiquette, mode) {
  const res = await fetch('/annotations/lot', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ debut, fin, nombre, etiquette, mode }),
  });
  return res.json();
}

async function postLissage(debut, fin, largeur) {
  const res = await fetch('/annotations/lisser', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ debut, fin, largeur }),
  });
  return res.json();
}

async function importAnnotations(file) {
  const fd = new FormData();
  fd.append('fichier', file);
  const res = await fetch('/annotations/importer', { method: 'POST', body: fd });
  return res.json();
}


// ─── Chargement vidéo ─────────────────────────────────────────────────────

function onVideoChargee(data, nom) {
  state.videoSeed = Date.now();

  resetPlayer();
  resetFilmstrip();

  state.total = data.nb_frames;
  state.fps   = data.fps || 25;
  state.anns  = [];
  state.pas   = 10;

  if (data.largeur && data.hauteur) {
    document.documentElement.style.setProperty('--video-ar', `${data.largeur} / ${data.hauteur}`);
  }

  document.getElementById('video-info').textContent =
    `${nom}  ·  ${data.nb_frames} frames  ·  ${data.fps.toFixed(2)} fps  ·  ${data.largeur}×${data.hauteur}`;

  const slider = document.getElementById('slider');
  slider.max      = data.nb_frames - 1;
  slider.value    = 0;
  slider.disabled = false;

  enable(['btn-play', 'speed-select', 'btn-mn', 'btn-m1',
          'btn-ann', 'btn-p1', 'btn-pn', 'btn-export', 'btn-reset',
          'btn-ann-prev', 'btn-ann-next'], true);

  majListe();
  majMarqueurs();
  goTo(0);
}


// ─── Export / Import ──────────────────────────────────────────────────────

async function lancerExport() {
  if (!state.total) return;
  const nom = document.getElementById('input-nom-export').value.trim();
  const btn = document.getElementById('btn-export');
  btn.disabled = true;

  const envoyer = (forcer_ecrasement = false) =>
    fetch('/annotations/exporter', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ nom, forcer_ecrasement }),
    }).then(r => r.json());

  let data = await envoyer(false);

  if (data.conflit) {
    const ok = confirm(`Un export nommé "${nom}" existe déjà.\nVoulez-vous l'écraser ?`);
    if (!ok) { btn.disabled = false; return; }
    data = await envoyer(true);
  }

  if (data.erreur) {
    alert('Erreur export : ' + data.erreur);
    btn.disabled = false;
    return;
  }
  btn.textContent = '✓ Sauvegardé';
  setTimeout(() => {
    btn.textContent = '⬇ Exporter JSON';
    btn.disabled    = false;
  }, 2000);
}

document.getElementById('btn-export').addEventListener('click', lancerExport);

document.getElementById('input-file-json').addEventListener('change', async function () {
  const file = this.files[0];
  if (!file) return;
  this.value = '';
  const data = await importAnnotations(file);
  if (data.erreur) { alert('Import : ' + data.erreur); return; }
  await fetchAndUpdate();
});

document.getElementById('btn-reset').addEventListener('click', resetAnnotations);

// ─── Slider ───────────────────────────────────────────────────────────────

let timerSlider = null;

document.getElementById('slider').addEventListener('input', function () {
  const frame = parseInt(this.value, 10);
  state.cur = frame;
  majTextes();
  if (videoMode) {
    videoEl.currentTime = frame / state.fps;
  } else {
    clearTimeout(timerSlider);
    timerSlider = setTimeout(majImages, 80);
  }
});

document.getElementById('slider').addEventListener('change', function () {
  if (!videoMode) goTo(parseInt(this.value, 10));
});

// ─── Boutons de navigation ────────────────────────────────────────────────

document.getElementById('btn-play').addEventListener('click', togglePlay);
document.getElementById('btn-ann-prev').addEventListener('click', gotoAnnotPrev);
document.getElementById('btn-ann-next').addEventListener('click', gotoAnnotNext);
document.getElementById('btn-m1').addEventListener('click', () => goTo(state.cur - 1));
document.getElementById('btn-p1').addEventListener('click', () => goTo(state.cur + 1));
document.getElementById('btn-mn').addEventListener('click', () => naviguerN(-1));
document.getElementById('btn-pn').addEventListener('click', () => naviguerN(+1));
document.getElementById('btn-ann').addEventListener('click', annoter);

// ─── Contrôles lecture ────────────────────────────────────────────────────

document.getElementById('speed-select').addEventListener('change', function () {
  changerVitesse(this.value);
});

document.getElementById('vol-slider').addEventListener('input', function () {
  changerVolume(this.value);
});

// ─── Modes d'affichage ────────────────────────────────────────────────────

[1, 3, 5].forEach(n =>
  document.getElementById(`mode-btn-${n}`).addEventListener('click', () => setMode(n))
);

// ─── Vignettes latérales cliquables ───────────────────────────────────────

[['vig-m2', -2], ['vig-m1', -1], ['vig-p1', +1], ['vig-p2', +2]].forEach(([id, offset]) => {
  document.getElementById(id).addEventListener('click', () => naviguer(offset));
});

// ─── Marqueurs sur le slider (délégation) ─────────────────────────────────

document.getElementById('markers').addEventListener('click', e => {
  const mk = e.target.closest('.mk');
  if (!mk) return;
  const index = parseInt(mk.dataset.index, 10);
  if (!isNaN(index) && state.anns[index]) goTo(state.anns[index].frame);
});

// ─── Liste des annotations (délégation) ───────────────────────────────────

document.getElementById('ann-list').addEventListener('click', e => {
  const del  = e.target.closest('.ann-del');
  const item = e.target.closest('.ann-item');
  if (del) {
    e.stopPropagation();
    if (!isLissageMode()) supprimerAnn(parseInt(del.dataset.frame, 10));
    return;
  }
  if (!item) return;
  const frame = parseInt(item.dataset.frame, 10);
  if (isLissageMode()) {
    handleLissageClick(frame);
  } else if (!e.target.closest('.ann-lbl')) {
    goTo(frame);
  }
});

document.getElementById('ann-list').addEventListener('dblclick', e => {
  if (isLissageMode()) return;
  const lbl = e.target.closest('.ann-lbl');
  if (!lbl) return;
  e.stopPropagation();
  _demarrerEditionInline(lbl, parseInt(lbl.dataset.frame, 10));
});

function _demarrerEditionInline(span, frame) {
  const ann = state.anns.find(a => a.frame === frame);
  const inp = document.createElement('input');
  inp.className = 'ann-lbl-edit';
  inp.value = ann?.etiquette ?? '';
  span.replaceWith(inp);
  inp.focus();
  inp.select();
  let saved = false;
  const save = () => {
    if (saved) return;
    saved = true;
    modifierEtiquette(frame, inp.value.trim());
  };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); save(); }
    if (e.key === 'Escape') { fetchAndUpdate(); }
  });
  inp.addEventListener('blur', save);
}

// ─── Annotation en lot ────────────────────────────────────────────────────

document.getElementById('bulk-toggle').addEventListener('click', () => {
  document.getElementById('bulk-panel').classList.toggle('open');
});

document.getElementById('bulk-mode-chk').addEventListener('change', onBulkModeChange);
document.getElementById('bulk-start').addEventListener('input', majBulkHint);
document.getElementById('bulk-end').addEventListener('input', majBulkHint);
document.getElementById('bulk-count').addEventListener('input', majBulkHint);
document.getElementById('bulk-btn').addEventListener('click', annoterEnLot);

// ─── Lissage ──────────────────────────────────────────────────────────────

document.getElementById('lissage-btn').addEventListener('click', toggleLissageMode);

// ─── Aide raccourcis ──────────────────────────────────────────────────────

document.getElementById('btn-help').addEventListener('click', () => {
  document.getElementById('help-overlay').classList.toggle('hidden');
});
document.getElementById('help-close').addEventListener('click', () => {
  document.getElementById('help-overlay').classList.add('hidden');
});
document.getElementById('help-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('help-overlay'))
    document.getElementById('help-overlay').classList.add('hidden');
});

// ─── Init ─────────────────────────────────────────────────────────────────

initKeyboard();

// Auto-chargement si une vidéo est déjà active côté serveur
async function initDepuisServeur() {
  try {
    const res = await fetch('/video/infos');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.nb_frames) return;
    const nom = (data.chemin || '').split('/').pop().split('\\').pop();
    onVideoChargee(data, nom);
    await fetchAndUpdate();
    document.getElementById('input-nom-export').value = data.nom_export || '';
  } catch (e) {
    console.error('Erreur init:', e);
  }
}

initDepuisServeur();

// Si la page est restaurée depuis le cache navigateur (bfcache),
// on force une réinitialisation pour avoir l'état serveur à jour.
window.addEventListener('pageshow', function (event) {
  if (event.persisted) initDepuisServeur();
});
