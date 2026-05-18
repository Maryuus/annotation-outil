// Accueil

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDuree(sec) {
  const m = Math.floor(sec / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

// Rendu carte vidéo

function renderCard(v) {
  const exports = v.exports || [];
  const meta = [
    v.fps     ? v.fps.toFixed(2) + ' fps'  : null,
    v.largeur ? v.largeur + '×' + v.hauteur : null,
    v.duree_sec ? formatDuree(v.duree_sec)  : null,
  ].filter(Boolean).join(' · ');

  return `
    <div class="vid-card" data-chemin="${escHtml(v.chemin)}" data-nom="${escHtml(v.nom)}">
      <div class="vid-card-body">
        <div class="vid-thumb">
          <img src="/projets/thumbnail/${encodeURIComponent(v.nom)}" alt=""
               onerror="this.style.display='none';this.parentElement.classList.add('no-thumb')">
        </div>
        <div class="vid-info">
          <div class="vid-nom">${escHtml(v.nom)}</div>
          <div class="vid-meta">${escHtml(meta)}</div>
        </div>
        <div class="vid-actions">
          <button class="btn btn-accent vid-open-btn">▶ Annoter</button>
          ${exports.length
            ? `<button class="btn btn-ghost vid-exp-toggle">Exports (${exports.length}) ▾</button>`
            : `<span class="vid-no-exp">Aucun export</span>`
          }
          <button class="btn-del-card vid-del-btn" data-nom="${escHtml(v.nom)}" title="Retirer de la liste">✕</button>
        </div>
      </div>
      ${exports.length ? `
        <div class="vid-exp-list">
          <div class="vid-exp-head">
            <span>Nom</span><span>Date</span><span>Annot.</span><span>BPM</span><span>Durée</span><span>Plage</span><span></span>
          </div>
          ${exports.map(e => `
            <div class="vid-exp-row ${e.fichier ? 'exp-restaurable' : ''}"
                 ${e.fichier ? `data-video="${escHtml(v.chemin)}" data-export="${escHtml(e.fichier)}"` : ''}>
              <span class="exp-nom">${e.nom ? escHtml(e.nom) : '<span class="exp-sans-nom">—</span>'}</span>
              <span class="exp-date">${escHtml(e.date)}</span>
              <span class="exp-nb">${e.nb_annotations}</span>
              <span class="exp-bpm">${e.bpm != null ? Math.round(e.bpm) : '—'}</span>
              <span class="exp-duree">${e.duree_clip != null ? formatDuree(e.duree_clip) : '—'}</span>
              <span class="exp-range">${escHtml(e.premier)} → ${escHtml(e.dernier)}</span>
              <span class="exp-actions">
                ${e.fichier ? '<span class="exp-open">▶ Ouvrir</span>' : ''}
                ${e.fichier ? `<button class="exp-del-btn" data-nom="${escHtml(v.nom)}" data-export="${escHtml(e.fichier)}" title="Supprimer cet export">✕</button>` : ''}
              </span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>`;
}

// Rendu liste d'exports audio

function renderExportsAudio(exports, cheminAudio, nomAudio) {
  if (!exports.length) return '';
  const lignes = exports.map(e => `
    <div class="vid-exp-row aud-exp-row ${e.fichier ? 'exp-restaurable' : ''}"
         ${e.fichier ? `data-audio="${escHtml(cheminAudio)}" data-export="${escHtml(e.fichier)}"` : ''}>
      <span class="exp-nom">${e.nom ? escHtml(e.nom) : '<span class="exp-sans-nom">—</span>'}</span>
      <span class="exp-date">${escHtml(e.date)}</span>
      <span class="exp-nb">${e.nb_beats}</span>
      <span class="exp-bpm">${e.bpm != null ? Math.round(e.bpm) : '—'}</span>
      <span class="exp-actions">
        ${e.fichier ? '<span class="exp-open">▶ Ouvrir</span>' : ''}
        ${e.fichier ? `<button class="exp-del-btn aud-exp-del-btn" data-nom="${escHtml(nomAudio)}" data-export="${escHtml(e.fichier)}" title="Supprimer cet export">✕</button>` : ''}
      </span>
    </div>`).join('');
  return `
    <div class="vid-exp-list aud-exp-list">
      <div class="vid-exp-head aud-exp-head">
        <span>Nom</span><span>Date</span><span>Beats</span><span>BPM</span><span></span>
      </div>
      ${lignes}
    </div>`;
}

// Rendu carte audio

function renderCardAudio(a) {
  const exports  = a.exports || [];
  const ext      = a.nom.split('.').pop().toUpperCase();
  const dureeStr = a.duree_sec ? formatDuree(a.duree_sec) : '…';
  const meta     = `${ext} · ${dureeStr}`;

  // Même structure HTML que les cartes vidéo — réutilise les mêmes classes CSS
  return `
    <div class="vid-card" data-chemin="${escHtml(a.chemin)}" data-nom="${escHtml(a.nom)}"
         ${!a.duree_sec ? `data-loading-duree="${escHtml(a.chemin)}"` : ''}>
      <div class="vid-card-body">
        <div class="aud-icon">🎵</div>
        <div class="vid-info">
          <div class="vid-nom">${escHtml(a.nom)}</div>
          <div class="vid-meta">${escHtml(meta)}</div>
        </div>
        <div class="vid-actions">
          <button class="btn btn-accent aud-open-btn">▶ Annoter</button>
          ${exports.length
            ? `<button class="btn btn-ghost vid-exp-toggle">Exports (${exports.length}) ▾</button>`
            : `<span class="vid-no-exp">Aucun export</span>`
          }
          <button class="btn-del-card aud-del-btn" data-nom="${escHtml(a.nom)}" title="Retirer de la liste">✕</button>
        </div>
      </div>
      ${renderExportsAudio(exports, a.chemin, a.nom)}
    </div>`;
}

// Persistance état exports ouverts

function lireEtatsExports() {
  try { return JSON.parse(localStorage.getItem('acc-exports-ouverts') || '{}'); }
  catch { return {}; }
}

function sauverEtatsExports() {
  const etats = {};
  document.querySelectorAll('.vid-card').forEach(card => {
    const list = card.querySelector('.vid-exp-list');
    if (list) etats[card.dataset.nom] = list.classList.contains('open');
  });
  localStorage.setItem('acc-exports-ouverts', JSON.stringify(etats));
}

function restaurerEtatsExports() {
  const etats = lireEtatsExports();
  document.querySelectorAll('.vid-card').forEach(card => {
    if (!etats[card.dataset.nom]) return;
    const list   = card.querySelector('.vid-exp-list');
    const toggle = card.querySelector('.vid-exp-toggle');
    if (list)   list.classList.add('open');
    if (toggle) toggle.textContent = toggle.textContent.replace('▾', '▴');
  });
}

// Persistance sections ouvertes

function lireEtatsSections() {
  try { return JSON.parse(localStorage.getItem('acc-sections') || '{"videos":true,"audios":true}'); }
  catch { return { videos: true, audios: true }; }
}

function sauverEtatsSections() {
  const etats = {
    videos: !document.getElementById('sec-videos').classList.contains('collapsed'),
    audios: !document.getElementById('sec-audios').classList.contains('collapsed'),
  };
  localStorage.setItem('acc-sections', JSON.stringify(etats));
}

function toggleSection(id) {
  const sec = document.getElementById('sec-' + id);
  const arr = document.querySelector('#toggle-' + id + ' .acc-section-arrow');
  sec.classList.toggle('collapsed');
  arr.textContent = sec.classList.contains('collapsed') ? '▸' : '▾';
  sauverEtatsSections();
}

function restaurerEtatsSections() {
  const etats = lireEtatsSections();
  ['videos', 'audios'].forEach(id => {
    if (!etats[id]) {
      document.getElementById('sec-' + id).classList.add('collapsed');
      const arr = document.querySelector('#toggle-' + id + ' .acc-section-arrow');
      if (arr) arr.textContent = '▸';
    }
  });
}

// Rendu global

function renderListe(videos, audios) {
  const listV  = document.getElementById('video-list');
  const listA  = document.getElementById('audio-list');
  const empty  = document.getElementById('acc-empty');
  const secV   = document.getElementById('sec-videos');
  const secA   = document.getElementById('sec-audios');

  // Compteurs dans les en-têtes
  document.getElementById('count-videos').textContent = videos.length;
  document.getElementById('count-audios').textContent = audios.length;

  // Masquer les sections vides
  secV.style.display = videos.length ? 'block' : 'none';
  secA.style.display = audios.length ? 'block' : 'none';

  if (!videos.length && !audios.length) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  listV.innerHTML = videos.map(renderCard).join('');
  listA.innerHTML = audios.map(renderCardAudio).join('');
  restaurerEtatsExports();
  restaurerEtatsSections();
  chargerDureesAsync();   // charge les durées en arrière-plan, sans bloquer l'affichage
}

// Chargement async des durées audio

async function chargerDureesAsync() {
  const cartes = [...document.querySelectorAll('[data-loading-duree]')];
  if (!cartes.length) return;

  const chemins = cartes.map(c => c.dataset.loadingDuree);
  try {
    const res    = await fetch('/audio/durees', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chemins }),
    });
    const durees = await res.json();

    cartes.forEach(carte => {
      const chemin = carte.dataset.loadingDuree;
      const duree  = durees[chemin];
      carte.removeAttribute('data-loading-duree');
      if (duree == null) return;
      // Met à jour le texte .aud-meta : remplace le "…" par la vraie durée
      const metaEl = carte.querySelector('.vid-meta');
      if (metaEl) {
        metaEl.textContent = metaEl.textContent.replace('…', formatDuree(duree));
      }
    });
  } catch {
    // Silencieux : "…" reste affiché si la requête échoue
  }
}

// Chargement

function afficherDossier(chemin) {
  const el          = document.getElementById('acc-dossier-actuel');
  const btnFermer   = document.getElementById('btn-fermer');
  const btnRefresh  = document.getElementById('btn-refresh');
  if (chemin) {
    el.textContent          = chemin;
    el.style.display        = 'inline';
    btnFermer.style.display  = 'inline-flex';
    btnRefresh.style.display = 'inline-flex';
  } else {
    el.textContent          = '';
    el.style.display        = 'none';
    btnFermer.style.display  = 'none';
    btnRefresh.style.display = 'none';
  }
}

async function fermerProjet() {
  await fetch('/projets/fermer', { method: 'POST' });
  afficherDossier(null);
  renderListe([], []);
}

async function chargerListe() {
  const data = await fetch('/projets').then(r => r.json());
  window._projetData = data;   // partagé avec sync-accueil.js
  afficherDossier(data.dossier || null);
  renderListe(data.videos || [], data.audios || []);
}

// Ouvrir un dossier

async function ouvrirDossier() {
  const btn = document.getElementById('btn-ouvrir');
  btn.disabled    = true;
  btn.textContent = 'Ouverture…';

  try {
    const res  = await fetch('/projets/choisir-dossier');
    const data = await res.json();

    if (data.erreur === 'no_tkinter') {
      const saisi = prompt('Entrez le chemin du dossier de travail :', '');
      if (!saisi || !saisi.trim()) return;
      data.chemin = saisi.trim();
    } else if (!res.ok || !data.chemin) {
      return;
    }

    btn.textContent = 'Scan en cours…';

    const res2  = await fetch('/projets/scanner-dossier', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chemin: data.chemin }),
    });
    const data2 = await res2.json();

    if (!res2.ok) {
      alert('Erreur : ' + (data2.erreur || 'scan échoué'));
      return;
    }
    if (data2.total === 0 && data2.total_audios === 0) {
      alert('Aucune vidéo ni musique trouvée dans ce dossier.');
    }

    afficherDossier(data.chemin);
    chargerListe();
  } catch {
    alert('Erreur réseau.');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Ouvrir un dossier';
  }
}

// Ouvrir l'annotateur vidéo

async function ouvrirAnnotateur(chemin) {
  const res = await fetch('/video/charger', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chemin }),
  });
  if (res.ok) {
    window.location.href = '/annoter';
  } else {
    const err = await res.json().catch(() => ({}));
    alert('Erreur : ' + (err.erreur || 'impossible de charger la vidéo'));
  }
}

// Ouvrir l'annotateur audio

async function ouvrirAnnotateurAudio(chemin) {
  const res = await fetch('/audio/charger', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chemin }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert('Erreur : ' + (err.erreur || 'impossible de charger le fichier audio'));
    return;
  }

  window.location.href = '/audio-annoter';
}

async function supprimerVideo(nom) {
  if (!confirm(`Retirer "${nom}" de la liste ?`)) return;
  await fetch('/projets/supprimer-video', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ nom }),
  });
  chargerListe();
}

async function supprimerAudio(nom) {
  if (!confirm(`Retirer "${nom}" de la liste ?`)) return;
  await fetch('/projets/supprimer-audio', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ nom }),
  });
  chargerListe();
}

async function supprimerExportAudio(nomAudio, cheminExport) {
  if (!confirm('Supprimer cet export de la liste ?')) return;
  await fetch('/projets/supprimer-export-audio', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ nom_audio: nomAudio, chemin_export: cheminExport }),
  });
  chargerListe();
}

async function supprimerExport(nomVideo, cheminExport) {
  if (!confirm('Supprimer cet export de la liste ?')) return;
  await fetch('/projets/supprimer-export', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ nom_video: nomVideo, chemin_export: cheminExport }),
  });
  chargerListe();
}

async function ouvrirExport(cheminVideo, cheminExport) {
  const res = await fetch('/projets/restaurer', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chemin_video: cheminVideo, chemin_export: cheminExport }),
  });
  if (res.ok) {
    window.location.href = '/annoter';
  } else {
    const err = await res.json().catch(() => ({}));
    alert('Erreur : ' + (err.erreur || 'impossible de restaurer'));
  }
}

async function ouvrirExportAudio(cheminAudio, cheminExport) {
  try {
    const res = await fetch('/audio/restaurer', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chemin_audio: cheminAudio, chemin_export: cheminExport }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok) {
      window.location.href = '/audio-annoter';
    } else {
      alert('Erreur : ' + (data?.erreur || `HTTP ${res.status}`));
    }
  } catch(err) {
    alert('Erreur réseau : ' + err.message);
  }
}

// Événements

document.getElementById('btn-ouvrir').addEventListener('click', ouvrirDossier);
document.getElementById('btn-fermer').addEventListener('click', fermerProjet);
document.getElementById('acc-empty').addEventListener('click', ouvrirDossier);

document.getElementById('btn-refresh').addEventListener('click', async () => {
  const btn = document.getElementById('btn-refresh');
  btn.classList.add('spinning');
  btn.disabled = true;
  try {
    await fetch('/projets/actualiser', { method: 'POST' });
  } catch { /* réseau : on continue quand même */ }
  await chargerListe();
  btn.disabled = false;
  btn.classList.remove('spinning');
});

document.getElementById('toggle-videos').addEventListener('click', () => toggleSection('videos'));
document.getElementById('toggle-audios').addEventListener('click', () => toggleSection('audios'));

// Délégation — cartes vidéo
document.getElementById('video-list').addEventListener('click', e => {
  const btnSupprimerVid = e.target.closest('.vid-del-btn');
  const btnSupprimerExp = e.target.closest('.exp-del-btn');
  const btnOuvrirExp    = e.target.closest('.exp-open');
  const btnToggleExp    = e.target.closest('.vid-exp-toggle');
  const ligneExp        = e.target.closest('.exp-restaurable');
  const corpsCard       = e.target.closest('.vid-card-body');
  const btnOuvrir       = e.target.closest('.vid-open-btn');

  if (btnOuvrir) {
    ouvrirAnnotateur(btnOuvrir.closest('.vid-card').dataset.chemin);
    return;
  }
  if (btnSupprimerVid) {
    e.stopPropagation();
    supprimerVideo(btnSupprimerVid.dataset.nom);
    return;
  }
  if (btnSupprimerExp) {
    e.stopPropagation();
    supprimerExport(btnSupprimerExp.dataset.nom, btnSupprimerExp.dataset.export);
    return;
  }
  if (btnOuvrirExp) {
    const row = btnOuvrirExp.closest('.exp-restaurable');
    if (row) ouvrirExport(row.dataset.video, row.dataset.export);
    return;
  }
  if (btnToggleExp) {
    const list = btnToggleExp.closest('.vid-card').querySelector('.vid-exp-list');
    if (!list) return;
    const ouvert = list.classList.toggle('open');
    btnToggleExp.textContent = btnToggleExp.textContent.replace(ouvert ? '▾' : '▴', ouvert ? '▴' : '▾');
    sauverEtatsExports();
    return;
  }
  if (ligneExp && !e.target.closest('.exp-actions')) {
    ouvrirExport(ligneExp.dataset.video, ligneExp.dataset.export);
    return;
  }
  if (corpsCard && !e.target.closest('.vid-actions')) {
    ouvrirAnnotateur(corpsCard.closest('.vid-card').dataset.chemin);
  }
});

// Délégation — cartes audio (même structure que les cartes vidéo, classes vid-*)
document.getElementById('audio-list').addEventListener('click', e => {
  const btnOuvrir       = e.target.closest('.aud-open-btn');
  const btnSupprimer    = e.target.closest('.aud-del-btn');
  const btnSupprimerExp = e.target.closest('.aud-exp-del-btn');
  const btnToggleExp    = e.target.closest('.vid-exp-toggle');
  const btnOuvrirExp    = e.target.closest('.exp-open');
  const ligneExp        = e.target.closest('.exp-restaurable');
  const corpsCard       = e.target.closest('.vid-card-body');

  if (btnOuvrir) {
    ouvrirAnnotateurAudio(btnOuvrir.closest('.vid-card').dataset.chemin);
    return;
  }
  if (btnSupprimer) {
    e.stopPropagation();
    supprimerAudio(btnSupprimer.dataset.nom);
    return;
  }
  if (btnSupprimerExp) {
    e.stopPropagation();
    supprimerExportAudio(btnSupprimerExp.dataset.nom, btnSupprimerExp.dataset.export);
    return;
  }
  if (btnToggleExp) {
    const list = btnToggleExp.closest('.vid-card').querySelector('.vid-exp-list');
    if (!list) return;
    const ouvert = list.classList.toggle('open');
    btnToggleExp.textContent = btnToggleExp.textContent.replace(ouvert ? '▾' : '▴', ouvert ? '▴' : '▾');
    sauverEtatsExports();
    return;
  }
  if (btnOuvrirExp) {
    const row = btnOuvrirExp.closest('.exp-restaurable');
    if (row) ouvrirExportAudio(row.dataset.audio, row.dataset.export);
    return;
  }
  if (ligneExp && !e.target.closest('.exp-actions')) {
    ouvrirExportAudio(ligneExp.dataset.audio, ligneExp.dataset.export);
    return;
  }
  if (corpsCard && !e.target.closest('.vid-actions')) {
    ouvrirAnnotateurAudio(corpsCard.closest('.vid-card').dataset.chemin);
  }
});

// Init

chargerListe();
