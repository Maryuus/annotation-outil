// Synchronisation depuis l'accueil
// Mode sélection : l'utilisateur clique sur un export vidéo puis un export beats,
// une petite modale s'ouvre ensuite pour configurer et lancer le rendu.

const syncAcc = {
  actif:       false,
  etape:       'video',   // 'video' | 'beats'
  exportVid:   null,      // { chemin_video, chemin_export, bpm, nb_annotations, nom }
  exportBeats: null,      // { chemin_audio, chemin_export, bpm, nb_beats, nom }
  mode:        'global',
  bpmCible:    null,
  timer:       null,
  maxPreroll:  0,         // max disponible calculé côté serveur
};

// Entrée / sortie du mode

function entrerModeSync() {
  syncAcc.actif       = true;
  syncAcc.etape       = 'video';
  syncAcc.exportVid   = null;
  syncAcc.exportBeats = null;
  syncAcc.bpmCible    = null;

  document.getElementById('sync-banner').classList.remove('hidden');
  document.getElementById('sync-overlay').classList.add('hidden');
  majBanniere();
  document.body.classList.add('sync-mode');
}

function sortirModeSync() {
  syncAcc.actif = false;
  if (syncAcc.timer) { clearInterval(syncAcc.timer); syncAcc.timer = null; }
  document.getElementById('sync-banner').classList.add('hidden');
  document.getElementById('sync-overlay').classList.add('hidden');
  document.body.classList.remove('sync-mode');
  document.querySelectorAll('.sync-sel-row').forEach(el => el.classList.remove('sync-sel-row'));
}

function majBanniere() {
  const txt = document.getElementById('sync-banner-text');
  if (syncAcc.etape === 'video') {
    txt.textContent = 'Sélectionnez un export vidéo';
  } else {
    const nom = syncAcc.exportVid?.nom || syncAcc.exportVid?.nom_video || '?';
    txt.textContent = `"${nom}" · sélectionnez un export beats`;
  }
}

// Sélection d'un export vidéo

function selectionnerExportVid(row) {
  if (syncAcc.etape !== 'video') return;

  // Lire les données depuis la ligne et le projet global
  const cheminVideo  = row.dataset.video;
  const cheminExport = row.dataset.export;
  const projet       = window._projetData || {};

  let infoExport = null;
  for (const v of (projet.videos || [])) {
    if (v.chemin !== cheminVideo) continue;
    infoExport = (v.exports || []).find(e => e.fichier === cheminExport);
    if (infoExport) { infoExport = { ...infoExport, chemin_video: cheminVideo, nom_video: v.nom }; break; }
  }
  if (!infoExport) {
    infoExport = { chemin_video: cheminVideo, chemin_export: cheminExport };
  }

  // Marquer visuellement
  document.querySelectorAll('.sync-sel-row').forEach(el => el.classList.remove('sync-sel-row'));
  row.classList.add('sync-sel-row');

  syncAcc.exportVid = { ...infoExport, chemin_export: cheminExport };
  syncAcc.etape     = 'beats';
  majBanniere();
}

// Sélection d'un export beats

function selectionnerExportBeats(row) {
  if (syncAcc.etape !== 'beats') return;

  const cheminAudio  = row.dataset.audio;
  const cheminExport = row.dataset.export;
  const projet       = window._projetData || {};

  let infoExport = null;
  for (const a of (projet.audios || [])) {
    if (a.chemin !== cheminAudio) continue;
    infoExport = (a.exports || []).find(e => e.fichier === cheminExport);
    if (infoExport) { infoExport = { ...infoExport, chemin_audio: cheminAudio, nom_audio: a.nom }; break; }
  }
  if (!infoExport) {
    infoExport = { chemin_audio: cheminAudio, chemin_export: cheminExport };
  }

  row.classList.add('sync-sel-row');
  syncAcc.exportBeats = { ...infoExport, chemin_export: cheminExport };

  ouvrirModal();
}

// Modale

function ouvrirModal() {
  // Labels sélection
  document.getElementById('sm-sel-vid').textContent =
    syncAcc.exportVid?.nom || syncAcc.exportVid?.nom_video || 'export vidéo';
  document.getElementById('sm-sel-aud').textContent =
    syncAcc.exportBeats?.nom || syncAcc.exportBeats?.nom_audio || 'export beats';

  // Reset progression/résultat
  document.getElementById('sm-prog').style.display   = 'none';
  document.getElementById('sm-btn-dl').style.display = 'none';
  document.getElementById('sm-prog-bar').style.width = '0%';
  document.getElementById('sm-prog-msg').textContent = '';
  document.getElementById('sm-prog-msg').style.color = '';

  // Reset curseur prélude
  syncAcc.maxPreroll = 0;
  document.getElementById('sm-preroll-row').style.display = 'none';

  setModeModal(syncAcc.mode);
  document.getElementById('sync-overlay').classList.remove('hidden');

  // Charger les infos de prélude en arrière-plan
  _chargerPreroll();
}

async function _chargerPreroll() {
  try {
    const annsPath  = encodeURIComponent(syncAcc.exportVid.chemin_export);
    const beatsPath = encodeURIComponent(syncAcc.exportBeats.chemin_export);
    const data = await fetch(`/sync/preroll?annotations_path=${annsPath}&beats_path=${beatsPath}`)
                        .then(r => r.json());
    if (data.erreur || data.max_preroll == null) return;

    const step       = data.max_preroll > 10 ? 0.5 : 0.1;
    const maxArrondi = Math.floor(data.max_preroll / step) * step;  // thumb atteint bien la fin
    syncAcc.maxPreroll = maxArrondi;

    const slider = document.getElementById('sm-preroll');
    slider.max   = maxArrondi;
    slider.step  = step;
    const defaut = Math.min(2.0, maxArrondi);
    slider.value = defaut;
    document.getElementById('sm-preroll-val').textContent = defaut.toFixed(1);

    // Afficher si la case musique est cochée
    if (document.getElementById('sm-chk-musique').checked) {
      document.getElementById('sm-preroll-row').style.display = '';
    }
  } catch { /* réseau indisponible, on ignore silencieusement */ }
}

const _textesModes = {
  global: 'Vitesse uniforme : toute la vidéo est accélérée ou ralentie d\'un même facteur.',
  precis: 'Chaque annotation est calée sur le beat le plus proche, chaque segment est ajusté indépendamment.',
};

function setModeModal(mode) {
  syncAcc.mode     = mode;
  syncAcc.bpmCible = null;
  document.getElementById('sm-tab-global').classList.toggle('active', mode === 'global');
  document.getElementById('sm-tab-precis').classList.toggle('active', mode === 'precis');
  document.getElementById('sm-panel-global').style.display = mode === 'global' ? '' : 'none';
  document.getElementById('sm-panel-precis').style.display = mode === 'precis' ? '' : 'none';
  // Met à jour le texte du "?" sans l'afficher
  const desc = document.getElementById('sm-mode-desc');
  desc.textContent  = _textesModes[mode] || '';
  desc.style.display = 'none';
  majMultiplesModal();
  majBoutonLancer();
}

// Grille BPM (mode global)

function arrondir(v) { return Math.round(v * 10) / 10; }

function majMultiplesModal() {
  const container = document.getElementById('sm-multiples');
  const infoFact  = document.getElementById('sm-facteur');
  container.innerHTML    = '';
  infoFact.textContent   = '';

  const musicBpm = syncAcc.exportBeats?.bpm;
  const videoBpm = syncAcc.exportVid?.bpm;
  if (!musicBpm) return;

  const options = [
    { mult: 2,     desc: '2 actions / beat' },
    { mult: 1,     desc: '1 action / beat'  },
    { mult: 0.5,   desc: '1 action / 2 beats' },
    { mult: 1 / 3, desc: '1 action / 3 beats' },
  ];

  options.forEach(opt => {
    const bpmCible = arrondir(musicBpm * opt.mult);
    const btn = document.createElement('button');
    btn.className = 'sync-multiple-btn' + (syncAcc.bpmCible === bpmCible ? ' active' : '');
    btn.innerHTML =
      `<span class="sync-mult-bpm">${bpmCible} BPM</span>` +
      `<span class="sync-mult-desc">${opt.desc}</span>`;
    btn.addEventListener('click', () => {
      syncAcc.bpmCible = bpmCible;
      container.querySelectorAll('.sync-multiple-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (videoBpm) {
        const facteur = bpmCible / videoBpm;
        infoFact.textContent = `Vitesse ×${facteur.toFixed(3)}  ·  ${videoBpm} → ${bpmCible} BPM`;
      }
      majBoutonLancer();
    });
    container.appendChild(btn);
  });
}


function majBoutonLancer() {
  const ok = syncAcc.mode === 'precis'
    ? !!(syncAcc.exportVid && syncAcc.exportBeats)
    : !!(syncAcc.exportVid && syncAcc.exportBeats && syncAcc.bpmCible);
  document.getElementById('sm-btn-lancer').disabled = !ok;
}

// Lancement

async function lancerSync() {
  const btn = document.getElementById('sm-btn-lancer');
  btn.disabled = true;

  const avecMusique  = document.getElementById('sm-chk-musique').checked;
  const dureePreroll = avecMusique
    ? parseFloat(document.getElementById('sm-preroll').value) || 0
    : 0;
  const body = {
    mode:             syncAcc.mode,
    video_path:       syncAcc.exportVid.chemin_video,
    annotations_path: syncAcc.exportVid.chemin_export,
    beats_path:       syncAcc.exportBeats.chemin_export,
    avec_musique:     avecMusique,
    musique_path:     avecMusique ? syncAcc.exportBeats.chemin_audio : null,
    duree_preroll:    dureePreroll,
  };

  if (syncAcc.mode === 'global') {
    body.bpm_source = syncAcc.exportVid.bpm;
    body.bpm_cible  = syncAcc.bpmCible;
  }

  try {
    const resp = await fetch('/sync/lancer', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await resp.json();
    if (data.erreur) throw new Error(data.erreur);

    document.getElementById('sm-prog').style.display   = 'flex';
    document.getElementById('sm-btn-dl').style.display = 'none';
    syncAcc.timer = setInterval(majProgression, 600);
  } catch (e) {
    alert('Erreur : ' + e.message);
    btn.disabled = false;
  }
}

async function majProgression() {
  try {
    const data = await fetch('/sync/progression').then(r => r.json());
    document.getElementById('sm-prog-bar').style.width  = data.progression + '%';
    document.getElementById('sm-prog-msg').textContent  = data.message;

    if (!data.en_cours) {
      clearInterval(syncAcc.timer);
      syncAcc.timer = null;

      if (data.erreur) {
        document.getElementById('sm-prog-msg').textContent = '❌ ' + data.erreur;
        document.getElementById('sm-prog-msg').style.color = 'var(--danger)';
        document.getElementById('sm-btn-lancer').disabled  = false;
      } else {
        document.getElementById('sm-prog-msg').textContent = '✓ Terminé !';
        document.getElementById('sm-prog-msg').style.color = 'var(--accent)';
        document.getElementById('sm-btn-dl').style.display = 'flex';
      }
    }
  } catch { /* erreur réseau, on réessaie */ }
}

// Interception des clics sur les exports

document.getElementById('video-list').addEventListener('click', e => {
  if (!syncAcc.actif) return;
  const row = e.target.closest('.exp-restaurable');
  if (!row) return;
  e.stopImmediatePropagation();
  selectionnerExportVid(row);
}, true);  // capture = avant les autres handlers

document.getElementById('audio-list').addEventListener('click', e => {
  if (!syncAcc.actif) return;
  const row = e.target.closest('.aud-exp-row.exp-restaurable');
  if (!row) return;
  e.stopImmediatePropagation();
  selectionnerExportBeats(row);
}, true);

// Événements

document.getElementById('btn-sync').addEventListener('click', entrerModeSync);
document.getElementById('sync-banner-cancel').addEventListener('click', sortirModeSync);
document.getElementById('sync-modal-close').addEventListener('click', sortirModeSync);
document.getElementById('sync-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('sync-overlay')) sortirModeSync();
});

document.getElementById('sm-tab-global').addEventListener('click', () => setModeModal('global'));
document.getElementById('sm-tab-precis').addEventListener('click', () => setModeModal('precis'));
document.getElementById('sm-btn-lancer').addEventListener('click', lancerSync);

// Curseur prélude

document.getElementById('sm-preroll').addEventListener('input', () => {
  const v = parseFloat(document.getElementById('sm-preroll').value);
  document.getElementById('sm-preroll-val').textContent = v.toFixed(1);
});

document.getElementById('sm-chk-musique').addEventListener('change', () => {
  const avec = document.getElementById('sm-chk-musique').checked;
  // Afficher le curseur uniquement si des données preroll sont disponibles
  document.getElementById('sm-preroll-row').style.display =
    (avec && syncAcc.maxPreroll > 0) ? '' : 'none';
});

document.getElementById('sm-mode-help').addEventListener('click', () => {
  const desc = document.getElementById('sm-mode-desc');
  desc.style.display = desc.style.display === 'none' ? '' : 'none';
});
