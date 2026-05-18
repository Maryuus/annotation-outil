// Thème clair / sombre
// Ce fichier est inclus dans les 3 pages (accueil, annotateur vidéo, audio).
// Le thème est appliqué via data-theme sur <html>, persisté dans localStorage.

function toggleTheme() {
  const html    = document.documentElement;
  const nouveau = html.dataset.theme === 'light' ? 'dark' : 'light';
  html.dataset.theme = nouveau;
  localStorage.setItem('theme', nouveau);
  majBoutonTheme();
}

function majBoutonTheme() {
  const btn    = document.getElementById('btn-theme');
  if (!btn) return;
  const clair  = document.documentElement.dataset.theme === 'light';
  btn.textContent = clair ? '🌙' : '☀️';
  btn.title       = clair ? 'Passer en thème sombre' : 'Passer en thème clair';
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-theme');
  if (btn) {
    btn.addEventListener('click', toggleTheme);
    majBoutonTheme();
  }
});
