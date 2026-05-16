// ─── Mise à jour complète après toute modification ────────────────────────

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

// ─── Annoter / supprimer la frame courante ────────────────────────────────

async function annoter() {
  if (!state.total) return;
  if (isAnnotee(state.cur)) {
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
  const ann = getAnnotation(state.cur);
  if (!ann) return null;
  const newFrame = clamp(state.cur + delta, 0, state.total - 1);
  if (isAnnotee(newFrame)) return null;
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

// ─── Lissage des annotations (mode sélection) ────────────────────────────

let _lissageMode       = false;
let _lissageDebutFrame = null;

const isLissageMode = () => _lissageMode;

function toggleLissageMode() {
  if (_lissageMode) exitLissageMode();
  else              enterLissageMode();
}

function enterLissageMode() {
  _lissageMode       = true;
  _lissageDebutFrame = null;
  document.getElementById('ann-list').classList.add('lissage-select');
  document.getElementById('lissage-hint-bar').classList.add('visible');
  document.getElementById('lissage-hint').textContent = 'Cliquez sur l\'annotation de début…';
  document.getElementById('lissage-btn').textContent  = '✕ Annuler';
}

function exitLissageMode() {
  _lissageMode       = false;
  _lissageDebutFrame = null;
  document.getElementById('ann-list').classList.remove('lissage-select');
  document.getElementById('lissage-hint-bar').classList.remove('visible');
  document.getElementById('lissage-hint').textContent = '';
  document.getElementById('lissage-btn').textContent  = '✂ Lisser';
  document.querySelectorAll('.ann-item.lissage-debut').forEach(el => el.classList.remove('lissage-debut'));
}

async function handleLissageClick(frame) {
  if (!_lissageMode) return;

  if (_lissageDebutFrame === null) {
    _lissageDebutFrame = frame;
    document.getElementById('a' + frame)?.classList.add('lissage-debut');
    document.getElementById('lissage-hint').textContent = 'Cliquez sur l\'annotation de fin…';
    return;
  }

  if (frame === _lissageDebutFrame) return;

  const debut = Math.min(_lissageDebutFrame, frame);
  const fin   = Math.max(_lissageDebutFrame, frame);

  exitLissageMode();

  const btn = document.getElementById('lissage-btn');
  btn.disabled    = true;
  btn.textContent = 'Lissage…';

  const largeur = parseInt(document.getElementById('lissage-largeur').value, 10) || 1;
  const data = await postLissage(debut, fin, largeur);

  if (data.erreur) {
    alert('Erreur : ' + data.erreur);
  } else {
    const horsRange = state.anns.filter(a => a.frame < debut || a.frame > fin);
    state.anns = [...horsRange, ...data.items].sort((a, b) => a.frame - b.frame);
    state.pas  = data.pas;
    majListe();
    majMarqueurs();
    majPas();
    majImages();
    majListeActive();
    majTextes();
  }

  btn.disabled    = false;
  btn.textContent = '✂ Lisser';
}

// ─── Annotation en lot ────────────────────────────────────────────────────

function isBulkTimeMode() {
  return document.getElementById('bulk-mode-chk').checked;
}

function calcBulkFramesPreview() {
  const debut  = parseFloat(document.getElementById('bulk-start').value);
  const fin    = parseFloat(document.getElementById('bulk-end').value);
  const nombre = parseInt(document.getElementById('bulk-count').value, 10);
  if (isNaN(debut) || isNaN(fin) || isNaN(nombre) || nombre < 1) return null;

  const timeMode = isBulkTimeMode();
  let df = timeMode ? Math.round(debut * state.fps) : Math.round(debut);
  let ff = timeMode ? Math.round(fin   * state.fps) : Math.round(fin);
  df = Math.max(0, Math.min(state.total - 1, df));
  ff = Math.max(0, Math.min(state.total - 1, ff));

  if (nombre === 1) return [df];
  return Array.from({ length: nombre }, (_, i) =>
    Math.round(df + i * (ff - df) / (nombre - 1))
  );
}

function tc(frame) {
  const s = frame / state.fps;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`;
}

function majBulkHint() {
  const hint   = document.getElementById('bulk-hint');
  const frames = calcBulkFramesPreview();
  if (!frames || frames.length === 0) { hint.textContent = ''; return; }
  const fmt = f => `#${f} (${tc(f)})`;
  hint.textContent = frames.length <= 3
    ? frames.map(fmt).join('  ·  ')
    : `${fmt(frames[0])}  …  ${fmt(frames[frames.length - 1])}  (${frames.length})`;
}

function onBulkModeChange() {
  const timeMode = isBulkTimeMode();
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
  const mode      = isBulkTimeMode() ? 'secondes' : 'frame';
  const btn       = document.getElementById('bulk-btn');

  btn.disabled    = true;
  btn.textContent = 'Génération…';

  const data = await postAnnotationLot(debut, fin, nombre, etiquette, mode);

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
