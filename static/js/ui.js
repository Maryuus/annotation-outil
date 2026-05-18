// Affichage

function majTextes() {
  const s = state.cur / state.fps;
  document.getElementById('lbl-frame').textContent    = `${state.cur} / ${state.total - 1}`;
  document.getElementById('lbl-time').textContent     = `${s.toFixed(3)} s`;
  document.getElementById('label-center').textContent = `Frame ${state.cur} / ${state.total - 1}`;
  document.getElementById('badge-on').style.display   = estAnnotee(state.cur) ? 'inline' : 'none';
  majBtnAnn();
}

function majBtnAnn() {
  const btn = document.getElementById('btn-ann');
  const ann = obtenirAnnotation(state.cur);
  if (ann) {
    btn.textContent    = '✕ Retirer';
    btn.dataset.action = 'supprimer';
  } else {
    btn.textContent    = '✓ Annoter';
    btn.dataset.action = 'annoter';
  }
}

function majListe() {
  const liste = document.getElementById('ann-list');
  document.getElementById('ann-count').textContent = state.anns.length;

  if (!state.anns.length) {
    liste.innerHTML = `<div class="empty">Aucune annotation</div>`;
    return;
  }

  liste.innerHTML = state.anns.map(a => `
    <div class="ann-item ${a.frame === state.cur ? 'active' : ''}"
         id="a${a.frame}" data-frame="${a.frame}">
      <span class="ann-tc">${a.timecode}</span>
      <span class="ann-fr">#${a.frame}</span>
      <span class="ann-lbl" data-frame="${a.frame}"
            title="Double-clic pour éditer">${a.etiquette || '—'}</span>
      <button class="ann-del" data-frame="${a.frame}" title="Supprimer">✕</button>
    </div>
  `).join('');
}

function majListeActive() {
  document.querySelectorAll('.ann-item').forEach(e => e.classList.remove('active'));
  const el = document.getElementById('a' + state.cur);
  if (el) { el.classList.add('active'); el.scrollIntoView({ block: 'nearest' }); }
  majBtnAnn();
}

function majMarqueurs() {
  const wrap = document.getElementById('markers');
  if (!state.total) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = state.anns.map((a, i) => {
    const pct   = (a.frame / (state.total - 1)) * 100;
    const label = a.etiquette ? ` · ${a.etiquette}` : '';
    return `<div class="mk" data-index="${i}" style="left:${pct}%"
                 title="#${a.frame} · ${a.timecode}${label}"></div>`;
  }).join('');
}

function majPas() {
  document.getElementById('step-info').textContent = `Pas de saut : ${state.pas} frames`;
  document.getElementById('btn-mn').textContent = `−${state.pas}`;
  document.getElementById('btn-pn').textContent = `+${state.pas}`;
}

function activerElements(ids, v) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !v;
  });
}

// Raccourcis clavier

function basculerAide() {
  document.getElementById('help-overlay').classList.toggle('hidden');
}

function initKeyboard() {
  document.addEventListener('keydown', async e => {
    if (!state.total) return;

    const elementFocus = document.activeElement;
    const estChamp     = elementFocus && (elementFocus.tagName === 'INPUT' || elementFocus.tagName === 'TEXTAREA');

    // Mode lecture vidéo
    if (modeVideo) {
      switch (e.key) {
        case ' ':
          e.preventDefault(); pauseVideo(); return;
        case 'Enter':
          e.preventDefault(); annoterVideo(); return;
        case 'a': case 'A':
          if (!estChamp) { e.preventDefault(); annoterVideo(); return; }
          break;
        case 'p': case 'P':
          e.preventDefault(); pauseVideo(); return;
        case 'Escape':
          e.preventDefault(); window.location.href = '/'; return;
        case 'm': case 'M':
          e.preventDefault(); toggleMute(); return;
        case 'ArrowLeft':
          e.preventDefault();
          lecteurVideo.currentTime = Math.max(0, lecteurVideo.currentTime - 1 / state.fps); return;
        case 'ArrowRight':
          e.preventDefault();
          lecteurVideo.currentTime = Math.min(lecteurVideo.duration || Infinity, lecteurVideo.currentTime + 1 / state.fps); return;
        case 'ArrowUp': {
          e.preventDefault();
          const cur  = Math.round(lecteurVideo.currentTime * state.fps);
          const next = state.anns.find(a => a.frame > cur);
          if (next) lecteurVideo.currentTime = next.frame / state.fps;
          return;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const cur  = Math.round(lecteurVideo.currentTime * state.fps);
          const prev = [...state.anns].reverse().find(a => a.frame < cur);
          if (prev) lecteurVideo.currentTime = prev.frame / state.fps;
          return;
        }
      }
      return;
    }

    // Mode navigation frame par frame
    if (!estChamp) {
      switch (e.key) {

        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey && estAnnotee(state.cur)) {
            const dest = await deplacerAnnotation(-1);
            if (dest !== null) allerA(dest);
          } else {
            allerA(state.cur - (e.ctrlKey ? state.pas : 1));
          }
          return;

        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey && estAnnotee(state.cur)) {
            const dest = await deplacerAnnotation(+1);
            if (dest !== null) allerA(dest);
          } else {
            allerA(state.cur + (e.ctrlKey ? state.pas : 1));
          }
          return;

        case 'ArrowUp':
          e.preventDefault(); allerAnnotSuivante(); return;
        case 'ArrowDown':
          e.preventDefault(); allerAnnotPrecedente(); return;
        case 'Delete':
          e.preventDefault(); if (estAnnotee(state.cur)) supprimerAnn(state.cur); return;
        case 'Enter':
          e.preventDefault(); annoter(); return;
        case ' ':
          e.preventDefault(); togglePlay(); return;
        case 'a': case 'A':
          e.preventDefault(); annoter(); return;
        case 'p': case 'P':
          e.preventDefault(); togglePlay(); return;
        case 'm': case 'M':
          e.preventDefault(); toggleMute(); return;
        case 'Escape':
          e.preventDefault();
          if (isLissageMode()) { exitLissageMode(); return; }
          window.location.href = '/';
          return;
        case '?':
          e.preventDefault(); basculerAide(); return;
      }
    }

    // Valider l'étiquette depuis le champ texte
    if (elementFocus === document.getElementById('input-label') && e.key === 'Enter') {
      e.preventDefault(); annoter();
    }
  });

  // Ctrl+S → export  |  Ctrl+O → ouvrir JSON
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); lancerExport(); }
    if (e.ctrlKey && e.key === 'o') { e.preventDefault(); document.getElementById('input-file-json').click(); }
  });
}
