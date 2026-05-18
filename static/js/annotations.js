async function fetchAndUpdate() {
  const data = await fetchAnnotations();
  state.anns = data.items;
  state.pas  = data.pas;
  majListe();
  majMarqueurs();
  majPas();
  majImages();
  majListeActive();
  majTextes();
}

// Annoter / supprimer la frame courante

async function annoter() {
  if (!state.total) return;
  if (estAnnotee(state.cur)) {
    await supprimerAnn(state.cur);
    return;
  }
  const lbl = document.getElementById('input-label').value.trim();
  await postAnnotation(state.cur, lbl);
  await fetchAndUpdate();
}

// Déplace l'annotation de la frame courante de `delta` frames.
// Retourne la nouvelle frame, ou null si impossible.
async function deplacerAnnotation(delta) {
  const ann = obtenirAnnotation(state.cur);
  if (!ann) return null;
  const newFrame = clamp(state.cur + delta, 0, state.total - 1);
  if (estAnnotee(newFrame)) return null;
  await deleteAnnotation(state.cur);
  await postAnnotation(newFrame, ann.etiquette);
  await fetchAndUpdate();
  return newFrame;
}

async function supprimerAnn(frame) {
  await deleteAnnotation(frame);
  await fetchAndUpdate();
}

async function modifierEtiquette(frame, etiquette) {
  await postAnnotation(frame, etiquette);
  await fetchAndUpdate();
}

async function resetAnnotations() {
  if (!confirm('Supprimer toutes les annotations ?')) return;
  await deleteAllAnnotations();
  await fetchAndUpdate();
}

// Lissage

let _lissageMode       = false;
let _lissageFrameDebut = null;

const isLissageMode = () => _lissageMode;

function toggleLissageMode() {
  if (_lissageMode) exitLissageMode();
  else              enterLissageMode();
}

function enterLissageMode() {
  _lissageMode       = true;
  _lissageFrameDebut = null;
  document.getElementById('ann-list').classList.add('lissage-select');
  document.getElementById('lissage-hint-bar').classList.add('visible');
  document.getElementById('lissage-hint').textContent = 'Cliquez sur l\'annotation de début…';
  document.getElementById('lissage-btn').textContent  = '✕ Annuler';
}

function exitLissageMode() {
  _lissageMode       = false;
  _lissageFrameDebut = null;
  document.getElementById('ann-list').classList.remove('lissage-select');
  document.getElementById('lissage-hint-bar').classList.remove('visible');
  document.getElementById('lissage-hint').textContent = '';
  document.getElementById('lissage-btn').textContent  = '✂ Lisser';
  document.querySelectorAll('.ann-item.lissage-debut').forEach(el => el.classList.remove('lissage-debut'));
}

async function handleLissageClick(frame) {
  if (!_lissageMode) return;

  if (_lissageFrameDebut === null) {
    _lissageFrameDebut = frame;
    document.getElementById('a' + frame)?.classList.add('lissage-debut');
    document.getElementById('lissage-hint').textContent = 'Cliquez sur l\'annotation de fin…';
    return;
  }

  if (frame === _lissageFrameDebut) return;

  const debut = Math.min(_lissageFrameDebut, frame);
  const fin   = Math.max(_lissageFrameDebut, frame);

  exitLissageMode();

  const btn = document.getElementById('lissage-btn');
  btn.disabled    = true;
  btn.textContent = 'Lissage…';

  const largeur = parseInt(document.getElementById('lissage-largeur').value, 10) || 1;
  const data = await posterLissage(debut, fin, largeur);

  if (data.erreur) {
    alert('Erreur : ' + data.erreur);
  } else {
    await fetchAndUpdate();
  }

  btn.disabled    = false;
  btn.textContent = '✂ Lisser';
}

// Annotation en lot

function estModeSeconde() {
  return document.getElementById('bulk-mode-chk').checked;
}

function calculerApercuBulk() {
  const debut  = parseFloat(document.getElementById('bulk-start').value);
  const fin    = parseFloat(document.getElementById('bulk-end').value);
  const nombre = parseInt(document.getElementById('bulk-count').value, 10);
  if (isNaN(debut) || isNaN(fin) || isNaN(nombre) || nombre < 1) return null;

  const timeMode = estModeSeconde();
  let df = timeMode ? Math.round(debut * state.fps) : Math.round(debut);
  let ff = timeMode ? Math.round(fin   * state.fps) : Math.round(fin);
  df = Math.max(0, Math.min(state.total - 1, df));
  ff = Math.max(0, Math.min(state.total - 1, ff));

  if (nombre === 1) return [df];
  return Array.from({ length: nombre }, (_, i) =>
    Math.round(df + i * (ff - df) / (nombre - 1))
  );
}

function formaterTc(frame) {
  const s = frame / state.fps;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
}

function majBulkHint() {
  const hint   = document.getElementById('bulk-hint');
  const frames = calculerApercuBulk();
  if (!frames || frames.length === 0) { hint.textContent = ''; return; }
  const fmt = f => `#${f} (${formaterTc(f)})`;
  hint.textContent = frames.length <= 3
    ? frames.map(fmt).join('  ·  ')
    : `${fmt(frames[0])}  …  ${fmt(frames[frames.length - 1])}  (${frames.length})`;
}

function surChangementModeBulk() {
  const timeMode = estModeSeconde();
  document.getElementById('bulk-panel').classList.toggle('time-mode', timeMode);
  const startEl = document.getElementById('bulk-start');
  const endEl   = document.getElementById('bulk-end');
  document.getElementById('lbl-bulk-start').textContent = timeMode ? 'Début (s)'    : 'Début (frame)';
  document.getElementById('lbl-bulk-end').textContent   = timeMode ? 'Fin (s)'      : 'Fin (frame)';
  startEl.placeholder = '0';
  endEl.placeholder   = timeMode ? '4.000' : '100';
  if (timeMode) { startEl.setAttribute('step', '0.001'); endEl.setAttribute('step', '0.001'); }
  else          { startEl.removeAttribute('step');        endEl.removeAttribute('step'); }
  majBulkHint();
}

async function annoterEnLot() {
  if (!state.total) { alert('Chargez une vidéo d\'abord.'); return; }

  const debut  = parseFloat(document.getElementById('bulk-start').value);
  const fin    = parseFloat(document.getElementById('bulk-end').value);
  const nombre = parseInt(document.getElementById('bulk-count').value, 10);

  if (isNaN(debut) || isNaN(fin) || isNaN(nombre) || nombre < 1) {
    alert('Remplissez les champs Début, Fin et Nb d\'étiquettes.');
    return;
  }

  const etiquette = document.getElementById('bulk-label').value.trim();
  const mode      = estModeSeconde() ? 'secondes' : 'frame';
  const btn       = document.getElementById('bulk-btn');

  btn.disabled    = true;
  btn.textContent = 'Génération…';

  const data = await posterAnnotationsLot(debut, fin, nombre, etiquette, mode);

  if (data.erreur) {
    alert('Erreur : ' + data.erreur);
  } else {
    await fetchAndUpdate();
    state.pas = data.pas;
    majPas();
    majImages();
    majListeActive();
  }

  btn.disabled    = false;
  btn.textContent = 'Générer les annotations';
}
