// ─── État ─────────────────────────────────────────────────────────────────────

const state = {
  duree: 0,     // durée totale en secondes
  beats: [],    // [{temps_ms, temps_secondes, etiquette}]
  nom:   '',    // nom du fichier
  bpm:   null,  // BPM moyen calculé
};

const audioEl = document.getElementById('audio-player');

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function fmtTime(ms) {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = (totalSec % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function calcBpm(beats) {
  if (beats.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < beats.length; i++) {
    intervals.push(beats[i].temps_ms - beats[i - 1].temps_ms);
  }
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return Math.round(60000 / avg);
}

function curMs() {
  return Math.round(audioEl.currentTime * 1000);
}

function enable(ids, v) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !v;
  });
}

// ─── Appels API ───────────────────────────────────────────────────────────────

async function fetchBeats() {
  const res = await fetch('/audio/beats');
  return res.json();
}

async function postBeat(temps_ms, etiquette) {
  const res = await fetch('/audio/beats', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ temps_ms, etiquette }),
  });
  return res.json();
}

async function deleteBeat(temps_ms) {
  return fetch(`/audio/beats/${temps_ms}`, { method: 'DELETE' });
}

async function patchBeat(temps_ms, etiquette) {
  const res = await fetch(`/audio/beats/${temps_ms}`, {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ etiquette }),
  });
  return res.json();
}

async function deleteAllBeats() {
  return fetch('/audio/beats', { method: 'DELETE' });
}

async function postBeatsLot(debut_ms, fin_ms, nb, etiquette) {
  const res = await fetch('/audio/beats/lot', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ debut_ms, fin_ms, nb, etiquette }),
  });
  return res.json();
}

async function postCompleter() {
  const res  = await fetch('/audio/beats/completer', { method: 'POST' });
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Erreur serveur ${res.status}`); }
}

async function fetchAndUpdate() {
  const data    = await fetchBeats();
  state.beats   = data.beats || [];
  state.bpm     = calcBpm(state.beats);
  majListe();
  majMarqueurs();
  majBpmDisplay();
  // Replanifier les flashes si la lecture est en cours
  if (!audioEl.paused) planifierFlashes();
}

// ─── Affichage ────────────────────────────────────────────────────────────────

function majTemps() {
  const ms = curMs();
  document.getElementById('aud-cur-time').textContent   = fmtTime(ms);
  document.getElementById('aud-total-time').textContent = fmtTime(state.duree * 1000);

  const slider = document.getElementById('aud-slider');
  if (!audioEl.seeking && state.duree > 0) {
    slider.value = Math.round((audioEl.currentTime / state.duree) * 10000);
  }
  majListeActive();
}

function majListe() {
  const liste = document.getElementById('aud-beat-list');
  document.getElementById('aud-beat-count').textContent = state.beats.length;

  if (!state.beats.length) {
    liste.innerHTML = `
      <div class="empty">
        <div class="empty-icon">🎵</div>
        Aucun beat<br>Appuyez sur <kbd>A</kbd> pendant la lecture
      </div>`;
    return;
  }

  const ms = curMs();
  liste.innerHTML = state.beats.map(b => `
    <div class="beat-item ${Math.abs(b.temps_ms - ms) < 100 ? 'active' : ''}"
         id="b${b.temps_ms}" data-ms="${b.temps_ms}">
      <span class="beat-tc">${fmtTime(b.temps_ms)}</span>
      <span class="beat-lbl" data-ms="${b.temps_ms}" title="Double-clic pour modifier">${b.etiquette ? escHtml(b.etiquette) : '—'}</span>
      <button class="beat-del" data-ms="${b.temps_ms}" title="Supprimer">✕</button>
    </div>
  `).join('');
}

function majListeActive() {
  const ms = curMs();
  const proche = state.beats.reduce((best, b) =>
    !best || Math.abs(b.temps_ms - ms) < Math.abs(best.temps_ms - ms) ? b : best, null);

  document.querySelectorAll('.beat-item').forEach(el => el.classList.remove('active'));
  if (proche && Math.abs(proche.temps_ms - ms) < 250) {
    const el = document.getElementById('b' + proche.temps_ms);
    if (el) { el.classList.add('active'); el.scrollIntoView({ block: 'nearest' }); }
  }
}

function majMarqueurs() {
  const wrap = document.getElementById('aud-markers');
  if (!state.duree) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = state.beats.map((b, i) => {
    const pct   = (b.temps_ms / (state.duree * 1000)) * 100;
    const label = b.etiquette ? ` · ${b.etiquette}` : '';
    return `<div class="mk" data-index="${i}" style="left:${pct}%"
                 title="${fmtTime(b.temps_ms)}${label}"></div>`;
  }).join('');
}

function majBpmDisplay() {
  const badge = document.getElementById('aud-bpm-display');
  const small = document.getElementById('aud-bpm-info');
  if (state.bpm) {
    badge.textContent  = `${state.bpm} BPM`;
    badge.style.display = 'inline-flex';
    small.textContent  = `≈ ${state.bpm} BPM`;
  } else {
    badge.style.display = 'none';
    small.textContent  = '';
  }
}

// ─── Flash d'annotation (texte) ───────────────────────────────────────────────

let _flashTimer = null;
function flashAnn(ajoute) {
  const el = document.getElementById('aud-ann-flash');
  clearTimeout(_flashTimer);
  el.textContent = ajoute ? '✓ Beat marqué' : '✕ Beat retiré';
  el.className   = 'show';
  _flashTimer    = setTimeout(() => { el.className = ''; }, 700);
}

// ─── Flash visuel planifié sur les beats ─────────────────────────────────────
// On connaît les temps exacts de chaque beat, donc on programme un setTimeout
// par beat plutôt que de polluer la boucle de rendu.

let _beatTimers = [];

function planifierFlashes() {
  annulerFlashes();
  if (!state.beats.length || audioEl.paused) return;

  const nowMs = audioEl.currentTime * 1000;           // position média actuelle (ms)
  const taux  = audioEl.playbackRate || 1;             // vitesse (0.5×, 1×, 2×…)

  state.beats.forEach(b => {
    const mediaRestant = b.temps_ms - nowMs;           // ms de média jusqu'au beat
    if (mediaRestant <= 0) return;                     // beat déjà passé
    const realDelay = mediaRestant / taux;             // ms réels à attendre
    _beatTimers.push(
      setTimeout(() => {
        if (!audioEl.paused) triggerBeatFlash();
      }, realDelay)
    );
  });
}

function annulerFlashes() {
  _beatTimers.forEach(clearTimeout);
  _beatTimers = [];
}

function triggerBeatFlash() {
  const el = document.getElementById('aud-viz');
  el.classList.remove('beat-flash');
  void el.offsetWidth;            // force reflow pour relancer l'animation CSS
  el.classList.add('beat-flash');
}

// ─── Helper : feedback bouton pendant une action async ────────────────────────
// Usage : btnAction(btn, '⏳ Analyse…', async () => { ...; return '✓ Fait'; })
// Si fn() retourne une chaîne elle devient le label de succès (temporaire).
// Si fn() ne retourne rien, le bouton est simplement réactivé immédiatement.
async function btnAction(btn, labelAttente, fn, delaiRestauration = 2000) {
  const labelOriginal = btn.textContent;
  btn.disabled    = true;
  btn.textContent = labelAttente;
  try {
    const resultat  = await fn();
    const labelFinal = typeof resultat === 'string' ? resultat : null;
    btn.textContent  = labelFinal || labelOriginal;
    if (labelFinal) setTimeout(() => { btn.textContent = labelOriginal; btn.disabled = false; }, delaiRestauration);
    else btn.disabled = false;
    return resultat;
  } catch (err) {
    alert('Erreur : ' + (err.message || 'réseau'));
    btn.textContent = labelOriginal;
    btn.disabled    = false;
  }
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function marquerBeat() {
  if (!state.duree) return;
  const ms  = curMs();
  const lbl = document.getElementById('aud-input-label').value.trim();
  const data = await postBeat(ms, lbl);
  flashAnn(data.action === 'ajoute');
  await fetchAndUpdate();
}

async function supprimerBeat(ms) {
  await deleteBeat(ms);
  await fetchAndUpdate();
}

async function resetBeats() {
  if (!confirm('Effacer tous les beats ?')) return;
  await deleteAllBeats();
  await fetchAndUpdate();
}

async function detecterAuto() {
  const btn = document.getElementById('aud-btn-detect');
  await btnAction(btn, '⏳ Analyse…', async () => {
    const res  = await fetch('/audio/beats/detecter', { method: 'POST' });
    const data = await res.json();
    if (data.erreur) throw new Error(data.erreur);
    await fetchAndUpdate();
    return state.bpm ? `✓ ${state.bpm} BPM détectés` : `✓ ${state.beats.length} beats`;
  }, 2500);
}

async function lancerExport() {
  if (!state.duree) return;
  const nom = document.getElementById('aud-input-nom-export').value.trim();
  const btn = document.getElementById('aud-btn-export');
  await btnAction(btn, '⏳…', async () => {
    const res  = await fetch('/audio/beats/exporter', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ nom }),
    });
    const data = await res.json();
    if (data.erreur) throw new Error(data.erreur);
    return '✓ Sauvegardé';
  });
}

// ─── Édition inline de l'étiquette d'un beat ─────────────────────────────────

function demarrerEditionInlineBeat(lbl, temps_ms) {
  const ancien = lbl.textContent === '—' ? '' : lbl.textContent;
  const input  = document.createElement('input');
  input.type      = 'text';
  input.value     = ancien;
  input.className = 'beat-lbl-input';
  input.title     = 'Entrée pour valider, Échap pour annuler';
  lbl.replaceWith(input);
  input.focus();
  input.select();

  async function valider() {
    const nouveau = input.value.trim();
    // Remplacer d'abord dans le DOM pour éviter le double fire blur/Enter
    const span = document.createElement('span');
    span.className = 'beat-lbl';
    span.textContent = nouveau || '—';
    input.replaceWith(span);
    if (nouveau !== ancien) {
      await patchBeat(temps_ms, nouveau);
      // Mettre à jour state local sans refetch complet
      const b = state.beats.find(x => x.temps_ms === temps_ms);
      if (b) b.etiquette = nouveau;
      majMarqueurs();
      majBpmDisplay();
    }
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); valider(); }
    if (e.key === 'Escape') {
      const span = document.createElement('span');
      span.className   = 'beat-lbl';
      span.textContent = ancien || '—';
      input.replaceWith(span);
    }
  });
  input.addEventListener('blur', valider);
}

// ─── Ajouter en lot ───────────────────────────────────────────────────────────

function majBulkHint() {
  const hint   = document.getElementById('aud-bulk-hint');
  const debutV = parseFloat(document.getElementById('aud-bulk-debut').value);
  const finV   = parseFloat(document.getElementById('aud-bulk-fin').value);
  const nbV    = parseInt(document.getElementById('aud-bulk-nb').value, 10);
  if (!isNaN(debutV) && !isNaN(finV) && finV > debutV && nbV >= 2) {
    const intervalMs = ((finV - debutV) / (nbV - 1) * 1000).toFixed(1);
    const bpmEst     = Math.round(60000 / parseFloat(intervalMs));
    hint.textContent = `≈ ${intervalMs} ms entre beats · ${bpmEst} BPM`;
    hint.style.display = 'block';
  } else {
    hint.textContent   = '';
    hint.style.display = 'none';
  }
}

async function annoterEnLot() {
  const debutV = parseFloat(document.getElementById('aud-bulk-debut').value);
  const finV   = parseFloat(document.getElementById('aud-bulk-fin').value);
  const nbV    = parseInt(document.getElementById('aud-bulk-nb').value, 10);
  const lbl    = document.getElementById('aud-bulk-lbl').value.trim();

  if (isNaN(debutV) || isNaN(finV) || finV <= debutV || nbV < 2) {
    alert('Veuillez renseigner un début, une fin et un nombre de beats valides.'); return;
  }

  const btn = document.getElementById('aud-btn-lot');
  await btnAction(btn, '…', async () => {
    const data = await postBeatsLot(
      Math.round(debutV * 1000),
      Math.round(finV   * 1000),
      nbV, lbl
    );
    if (data.erreur) throw new Error(data.erreur);
    await fetchAndUpdate();
    return `✓ ${data.ajoutes} ajoutés`;
  });
}

// ─── Compléter la musique ─────────────────────────────────────────────────────

async function completerMusique() {
  if (state.beats.length < 2) {
    alert('Il faut au moins 2 beats pour extrapoler l\'intervalle.'); return;
  }
  const btn = document.getElementById('aud-btn-completer');
  await btnAction(btn, '⏳…', async () => {
    const data = await postCompleter();
    if (data.erreur) throw new Error(data.erreur);
    await fetchAndUpdate();
    return `✓ +${data.ajoutes} beats`;
  }, 2500);
}

// ─── Lecture ──────────────────────────────────────────────────────────────────

function togglePlay() {
  if (audioEl.paused) audioEl.play();
  else                audioEl.pause();
}

function toggleMute() {
  audioEl.muted = !audioEl.muted;
  majVolIcon();
}

function majVolIcon() {
  const btn = document.getElementById('aud-btn-mute');
  if (!btn) return;
  if (audioEl.muted || audioEl.volume === 0) btn.textContent = '🔇';
  else if (audioEl.volume < 0.4)             btn.textContent = '🔉';
  else                                        btn.textContent = '🔊';
}

function setVolume(v) {
  audioEl.volume = Math.max(0, Math.min(1, v));
  if (audioEl.muted && audioEl.volume > 0) audioEl.muted = false;
  document.getElementById('aud-vol-slider').value = Math.round(audioEl.volume * 100);
  majVolIcon();
}

function majBtnPlay() {
  document.getElementById('aud-btn-play').textContent = audioEl.paused ? '▶' : '⏸';
}

function setPlaying(v) {
  document.body.classList.toggle('playing', v);
  majBtnPlay();
  if (v) planifierFlashes(); else annulerFlashes();
}

// Navigation entre beats
function gotoBeatNext() {
  const ms   = curMs();
  const next = state.beats.find(b => b.temps_ms > ms + 50);
  if (next) audioEl.currentTime = next.temps_ms / 1000;
}

function gotoBeatPrev() {
  const ms   = curMs();
  const prev = [...state.beats].reverse().find(b => b.temps_ms < ms - 50);
  if (prev) audioEl.currentTime = prev.temps_ms / 1000;
}

// ─── Événements audio ────────────────────────────────────────────────────────

audioEl.addEventListener('timeupdate',    majTemps);
audioEl.addEventListener('play',         () => setPlaying(true));
audioEl.addEventListener('pause',        () => setPlaying(false));
audioEl.addEventListener('ended',        () => setPlaying(false));
// Après un seek ou un changement de vitesse : replanifier depuis la nouvelle position
audioEl.addEventListener('seeked',       () => { if (!audioEl.paused) planifierFlashes(); });
audioEl.addEventListener('ratechange',   () => { if (!audioEl.paused) planifierFlashes(); });

audioEl.addEventListener('loadedmetadata', () => {
  state.duree = audioEl.duration || 0;
  document.getElementById('aud-total-time').textContent = fmtTime(state.duree * 1000);
  majMarqueurs();
});

// ─── Slider ───────────────────────────────────────────────────────────────────

document.getElementById('aud-slider').addEventListener('input', function () {
  if (!state.duree) return;
  const t = (parseInt(this.value, 10) / 10000) * state.duree;
  audioEl.currentTime = t;
  majTemps();
});

// ─── Marqueurs cliquables ─────────────────────────────────────────────────────

document.getElementById('aud-markers').addEventListener('click', e => {
  const mk = e.target.closest('.mk');
  if (!mk) return;
  const i = parseInt(mk.dataset.index, 10);
  if (!isNaN(i) && state.beats[i]) audioEl.currentTime = state.beats[i].temps_ms / 1000;
});

// ─── Liste beats (délégation) ─────────────────────────────────────────────────

document.getElementById('aud-beat-list').addEventListener('click', e => {
  const del  = e.target.closest('.beat-del');
  const item = e.target.closest('.beat-item');
  if (del) {
    e.stopPropagation();
    supprimerBeat(parseInt(del.dataset.ms, 10));
    return;
  }
  if (item) {
    audioEl.currentTime = parseInt(item.dataset.ms, 10) / 1000;
  }
});

// Double-clic sur l'étiquette → édition inline
document.getElementById('aud-beat-list').addEventListener('dblclick', e => {
  const lbl = e.target.closest('.beat-lbl');
  if (!lbl || lbl.tagName === 'INPUT') return;
  e.stopPropagation();
  const ms = parseInt(lbl.dataset.ms, 10);
  demarrerEditionInlineBeat(lbl, ms);
});

// ─── Panel "ajouter en lot" ───────────────────────────────────────────────────

document.getElementById('aud-bulk-toggle').addEventListener('click', () => {
  const form  = document.getElementById('aud-bulk-form');
  const arrow = document.getElementById('aud-bulk-arrow');
  const open  = form.classList.toggle('hidden');
  arrow.textContent = open ? '▾' : '▴';
});

['aud-bulk-debut', 'aud-bulk-fin', 'aud-bulk-nb'].forEach(id => {
  document.getElementById(id).addEventListener('input', majBulkHint);
});

document.getElementById('aud-btn-lot').addEventListener('click', annoterEnLot);
document.getElementById('aud-btn-completer').addEventListener('click', completerMusique);

// ─── Boutons ──────────────────────────────────────────────────────────────────

document.getElementById('aud-btn-mute').addEventListener('click', toggleMute);
document.getElementById('aud-vol-slider').addEventListener('input', function () {
  setVolume(parseInt(this.value, 10) / 100);
});

document.getElementById('aud-btn-play').addEventListener('click', togglePlay);
document.getElementById('aud-btn-ann').addEventListener('click', marquerBeat);
document.getElementById('aud-btn-detect').addEventListener('click', detecterAuto);
document.getElementById('aud-btn-export').addEventListener('click', lancerExport);
document.getElementById('aud-btn-reset').addEventListener('click', resetBeats);
document.getElementById('aud-btn-prev-beat').addEventListener('click', gotoBeatPrev);
document.getElementById('aud-btn-next-beat').addEventListener('click', gotoBeatNext);
document.getElementById('aud-speed-select').addEventListener('change', function () {
  audioEl.playbackRate = parseFloat(this.value);
});

// ─── Raccourcis clavier ───────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  // Valider depuis le champ d'étiquette
  if (document.activeElement?.id === 'aud-input-label' && e.key === 'Enter') {
    e.preventDefault(); marquerBeat(); return;
  }

  if (!state.duree) return;
  const focus   = document.activeElement;
  const isInput = focus && (focus.tagName === 'INPUT' || focus.tagName === 'TEXTAREA' || focus.tagName === 'SELECT');
  if (isInput) return;

  switch (e.key) {
    case ' ':
    case 'p': case 'P':
      e.preventDefault(); togglePlay(); return;

    case 'a': case 'A':
    case 'Enter':
      e.preventDefault(); marquerBeat(); return;

    case 'ArrowLeft':
      e.preventDefault();
      audioEl.currentTime = Math.max(0, audioEl.currentTime - (e.shiftKey ? 1 : 5));
      return;

    case 'ArrowRight':
      e.preventDefault();
      audioEl.currentTime = Math.min(state.duree, audioEl.currentTime + (e.shiftKey ? 1 : 5));
      return;

    case 'ArrowUp':
      e.preventDefault(); gotoBeatNext(); return;

    case 'ArrowDown':
      e.preventDefault(); gotoBeatPrev(); return;

    case 'Delete': {
      e.preventDefault();
      const ms = curMs();
      const best = state.beats.reduce((b, c) =>
        !b || Math.abs(c.temps_ms - ms) < Math.abs(b.temps_ms - ms) ? c : b, null);
      if (best && Math.abs(best.temps_ms - ms) < 500) supprimerBeat(best.temps_ms);
      return;
    }

    case 'm': case 'M':
      e.preventDefault(); toggleMute(); return;

    case '+': case '=':
      e.preventDefault(); setVolume(audioEl.volume + 0.1); return;

    case '-': case '_':
      e.preventDefault(); setVolume(audioEl.volume - 0.1); return;

    case 'Escape':
      e.preventDefault(); window.location.href = '/'; return;

    case '?':
      e.preventDefault();
      document.getElementById('aud-help-overlay').classList.toggle('hidden');
      return;
  }
});

// Ctrl+S → export
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === 's') { e.preventDefault(); lancerExport(); }
});

// ─── Aide ─────────────────────────────────────────────────────────────────────

document.getElementById('aud-btn-help').addEventListener('click', () => {
  document.getElementById('aud-help-overlay').classList.toggle('hidden');
});
document.getElementById('aud-help-close').addEventListener('click', () => {
  document.getElementById('aud-help-overlay').classList.add('hidden');
});
document.getElementById('aud-help-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('aud-help-overlay'))
    document.getElementById('aud-help-overlay').classList.add('hidden');
});

// ─── Init ─────────────────────────────────────────────────────────────────────

audioEl.volume = 0.8;
majVolIcon();

async function initDepuisServeur() {
  try {
    const res  = await fetch('/audio/infos');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.nom) return;

    state.nom   = data.nom;
    state.duree = data.duree_sec || 0;

    // ── Forcer le rechargement de l'élément audio ──────────────────────────
    // Le navigateur met /audio/stream en cache : si on charge un nouveau fichier
    // sans changer l'URL, il continue de jouer l'ancien. On ajoute le nom du
    // fichier dans le paramètre `v` pour que chaque audio ait une URL unique.
    audioEl.pause();
    audioEl.src = `/audio/stream?v=${encodeURIComponent(data.nom)}`;
    audioEl.load();

    document.getElementById('aud-info').textContent =
      `${data.nom}  ·  ${fmtTime(state.duree * 1000)}`;
    document.getElementById('aud-input-nom-export').value = data.nom_export || '';
    // Pré-remplir le champ "fin" avec la durée totale
    const finEl = document.getElementById('aud-bulk-fin');
    if (finEl && state.duree) finEl.value = state.duree.toFixed(3);

    enable(['aud-btn-play', 'aud-btn-ann', 'aud-btn-detect', 'aud-btn-export',
            'aud-btn-reset', 'aud-btn-prev-beat', 'aud-btn-next-beat',
            'aud-speed-select', 'aud-slider',
            'aud-btn-lot', 'aud-btn-completer'], true);

    await fetchAndUpdate();
    majTemps();
  } catch (err) {
    console.error('Erreur init audio:', err);
  }
}

initDepuisServeur();

window.addEventListener('pageshow', e => {
  if (e.persisted) initDepuisServeur();
});
