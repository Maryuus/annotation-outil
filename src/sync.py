"""
sync.py – Synchronisation vidéo/musique via MoviePy 2.x.

Deux modes :
  - global  : applique un facteur de vitesse uniforme (bpm_cible / bpm_source)
  - précis  : ajuste chaque segment entre deux annotations pour le caler sur le beat

Option musique :
  Si avec_musique=True, la timeline finale est :
    [ fondu (duree_intro s) | vidéo 1× ] [ segment synchronisé ] [ fondu noir 0.5 s ]
    |←── duree_intro ──────→|
  où duree_intro = min(2.0, t_beat_1).
  - La vidéo de préfixe commence duree_intro secondes avant la 1ère annotation
    (écran noir si pas assez de vidéo disponible).
  - La musique commence à t_beat_1 - duree_intro dans le fichier audio.
  - Le fondu d'ouverture dure exactement duree_intro s : il se termine pile
    au moment du 1er beat / de la 1ère annotation.
"""
import os
import threading
import traceback
from datetime import datetime

# État partagé

_etat = {
    "en_cours":    False,
    "progression": 0.0,
    "message":     "",
    "erreur":      None,
    "fichier":     None,
}


def get_etat():
    return dict(_etat)


def _set(**kwargs):
    _etat.update(kwargs)


# Imports MoviePy (compatibilité 1.x et 2.x)

def _imports():
    """Retourne les classes MoviePy. Compatible 1.x et 2.x."""
    try:
        # MoviePy 2.x
        from moviepy import (VideoFileClip, ColorClip, AudioFileClip,
                              concatenate_videoclips)
        from moviepy.video.fx import MultiplySpeed
        return VideoFileClip, ColorClip, AudioFileClip, concatenate_videoclips, MultiplySpeed
    except ImportError:
        # MoviePy 1.x (fallback)
        from moviepy.editor import (VideoFileClip, ColorClip, AudioFileClip,
                                     concatenate_videoclips)
        return VideoFileClip, ColorClip, AudioFileClip, concatenate_videoclips, None


def _fadein(clip, duree):
    """Applique un fondu à l'ouverture compatible 1.x et 2.x."""
    if duree <= 0:
        return clip
    try:
        from moviepy.video.fx import FadeIn
        return clip.with_effects([FadeIn(duree)])
    except ImportError:
        return clip.fadein(duree)


def _fadeout(clip, duree):
    """Applique un fondu à la fermeture compatible 1.x et 2.x."""
    if duree <= 0:
        return clip
    try:
        from moviepy.video.fx import FadeOut
        return clip.with_effects([FadeOut(duree)])
    except ImportError:
        return clip.fadeout(duree)


def _speedx(clip, facteur, MultiplySpeed):
    """Applique un facteur de vitesse compatible 1.x et 2.x."""
    if MultiplySpeed is not None:
        return clip.with_effects([MultiplySpeed(facteur)])
    return clip.speedx(facteur)


def _set_audio(clip, audio):
    """Attache une piste audio compatible 1.x et 2.x."""
    try:
        return clip.with_audio(audio)
    except AttributeError:
        return clip.set_audio(audio)


def _subclip(clip, start, end=None):
    """Sous-clip compatible 1.x et 2.x."""
    try:
        return clip.subclipped(start, end) if end is not None else clip.subclipped(start)
    except AttributeError:
        return clip.subclip(start, end)


def _set_fps(clip, fps):
    """Définit les fps compatible 1.x et 2.x."""
    try:
        return clip.with_fps(fps)
    except AttributeError:
        return clip.set_fps(fps)


# Helpers

def _clip_noir(w, h, fps, duree):
    """Retourne un clip noir muet de la durée demandée."""
    _, ColorClip, _, _, _ = _imports()
    return _set_fps(ColorClip(size=(w, h), color=(0, 0, 0), duration=duree), fps)


def _ajouter_musique(final, musique_path, t_beat_1, duree_intro):
    """
    Ajoute la piste audio (musique) au clip final.
    La musique démarre duree_intro secondes avant le premier beat,
    soit à t_beat_1 - duree_intro dans le fichier audio.
    """
    _, _, AudioFileClip, _, MS = _imports()
    musique    = AudioFileClip(musique_path)
    t_mus_deb  = max(0.0, t_beat_1 - duree_intro)
    duree_mus  = min(musique.duration - t_mus_deb, final.duration)
    audio      = _subclip(musique, t_mus_deb, t_mus_deb + duree_mus)
    return _set_audio(final, audio)


def _construire_prefixe(clip_original, t_ann_1, duree_intro):
    """
    Construit duree_intro secondes de contenu avant la première annotation :
      - vidéo originale (1× vitesse) sur les duree_intro dernières secondes dispo
      - complété par du noir en tête si la vidéo n'est pas assez longue
    Applique un fondu à l'ouverture de durée duree_intro (se termine à la 1ère annotation).
    """
    _, _, _, concatenate_videoclips, _ = _imports()
    w, h = clip_original.size
    fps  = clip_original.fps

    duree_video_dispo = min(t_ann_1, duree_intro)
    duree_noir        = duree_intro - duree_video_dispo

    parties = []
    if duree_noir > 0:
        parties.append(_clip_noir(w, h, fps, duree_noir))
    if duree_video_dispo > 0:
        parties.append(_subclip(clip_original, t_ann_1 - duree_video_dispo, t_ann_1))

    if not parties:
        return None
    prefixe = concatenate_videoclips(parties) if len(parties) > 1 else parties[0]
    return _fadein(prefixe, duree_intro)


# Mode global

def _run_global(video_path, bpm_source, bpm_cible, sortie,
                avec_musique=False, musique_path=None, annotations=None, beats=None,
                duree_preroll=None):
    VideoFileClip, _, _, concatenate_videoclips, MS = _imports()

    facteur = bpm_cible / bpm_source
    _set(message="Chargement vidéo…", progression=5.0)
    clip = VideoFileClip(video_path)

    if avec_musique and annotations and beats:
        t_ann_1     = float(annotations[0]["temps_secondes"])
        t_ann_N     = float(annotations[-1]["temps_secondes"])
        t_beat_1    = float(beats[0]["temps_secondes"])
        max_dispo   = min(t_ann_1, t_beat_1)
        duree_intro = float(duree_preroll) if duree_preroll is not None else min(2.0, max_dispo)
        duree_intro = max(0.0, min(duree_intro, max_dispo))   # clamp sécurité

        _set(message=f"Changement de vitesse ×{facteur:.3f}…", progression=15.0)
        segment_sync = _speedx(
            _subclip(clip, t_ann_1, min(t_ann_N, clip.duration)),
            facteur, MS
        )

        _set(message="Construction du préfixe…", progression=30.0)
        prefixe  = _construire_prefixe(clip, t_ann_1, duree_intro)
        noir_fin = _fadeout(_clip_noir(clip.size[0], clip.size[1], clip.fps, 0.5), 0.5)

        parties = ([prefixe] if prefixe else []) + [segment_sync, noir_fin]
        _set(message="Assemblage…", progression=45.0)
        final = concatenate_videoclips(parties)

        _set(message="Ajout de la musique…", progression=55.0)
        final = _ajouter_musique(final, musique_path, t_beat_1, duree_intro)
    else:
        _set(message=f"Changement de vitesse ×{facteur:.3f}…", progression=15.0)
        final = _speedx(clip, facteur, MS)

    _set(message="Encodage en cours…", progression=60.0)
    final.write_videofile(sortie, logger=None)
    clip.close()


# Mode précis

def _beat_le_plus_proche(t_ann, beats):
    """Retourne l'index du beat dont le temps_secondes est le plus proche de t_ann."""
    best_i, best_d = 0, float('inf')
    for i, b in enumerate(beats):
        d = abs(float(b["temps_secondes"]) - t_ann)
        if d < best_d:
            best_d, best_i = d, i
    return best_i


def _run_precis(video_path, annotations, beats, sortie,
                avec_musique=False, musique_path=None, duree_preroll=None):
    VideoFileClip, _, _, concatenate_videoclips, MS = _imports()

    if len(annotations) < 2:
        raise ValueError("Il faut au moins 2 annotations")
    if len(beats) < 2:
        raise ValueError("Il faut au moins 2 beats")

    _set(message="Chargement vidéo…", progression=2.0)
    clip = VideoFileClip(video_path)

    # Pour chaque annotation, trouver le beat le plus proche
    indices = [_beat_le_plus_proche(float(a["temps_secondes"]), beats) for a in annotations]
    # Forcer la monotonie
    for i in range(1, len(indices)):
        if indices[i] <= indices[i - 1]:
            indices[i] = indices[i - 1] + 1

    segments = []
    nb_segs  = len(annotations) - 1
    for i in range(nb_segs):
        if indices[i + 1] >= len(beats):
            break
        t_debut = float(annotations[i]["temps_secondes"])
        t_fin   = float(annotations[i + 1]["temps_secondes"])
        b_debut = float(beats[indices[i]]["temps_secondes"])
        b_fin   = float(beats[indices[i + 1]]["temps_secondes"])

        duree_video = t_fin - t_debut
        duree_cible = b_fin - b_debut
        if duree_video <= 0 or duree_cible <= 0:
            continue

        facteur = max(0.05, min(20.0, duree_video / duree_cible))
        segments.append(_speedx(_subclip(clip, t_debut, t_fin), facteur, MS))

        pct = 5.0 + (i + 1) / nb_segs * 40.0
        _set(progression=round(pct, 1), message=f"Segment {i + 1}/{nb_segs}…")

    if not segments:
        raise ValueError("Aucun segment valide généré")

    _set(message="Assemblage des segments…", progression=50.0)
    segment_sync = concatenate_videoclips(segments)

    if avec_musique and musique_path:
        t_ann_1     = float(annotations[0]["temps_secondes"])
        t_beat_1    = float(beats[0]["temps_secondes"])
        max_dispo   = min(t_ann_1, t_beat_1)
        duree_intro = float(duree_preroll) if duree_preroll is not None else min(2.0, max_dispo)
        duree_intro = max(0.0, min(duree_intro, max_dispo))   # clamp sécurité

        _set(message="Construction du préfixe…", progression=58.0)
        prefixe  = _construire_prefixe(clip, t_ann_1, duree_intro)
        noir_fin = _fadeout(_clip_noir(clip.size[0], clip.size[1], clip.fps, 0.5), 0.5)

        parties = ([prefixe] if prefixe else []) + [segment_sync, noir_fin]
        final   = concatenate_videoclips(parties)

        _set(message="Ajout de la musique…", progression=65.0)
        final = _ajouter_musique(final, musique_path, t_beat_1, duree_intro)
    else:
        final = segment_sync

    _set(message="Encodage en cours…", progression=70.0)
    final.write_videofile(sortie, logger=None)
    clip.close()


# Point d'entrée

def lancer(mode, params):
    """Lance la synchronisation en arrière-plan.
    Retourne False si une synchronisation est déjà en cours."""
    if _etat["en_cours"]:
        return False

    _etat.update({
        "en_cours":    True,
        "progression": 0.0,
        "message":     "Démarrage…",
        "erreur":      None,
        "fichier":     None,
    })

    def run():
        try:
            video_path   = params["video_path"]
            dossier      = os.path.dirname(video_path)
            nom_base     = os.path.splitext(os.path.basename(video_path))[0]
            ts           = datetime.now().strftime("%Y%m%d_%H%M%S")
            sortie       = os.path.join(dossier, f"{nom_base}_sync_{ts}.mp4")
            avec_musique  = params.get("avec_musique", False)
            musique_path  = params.get("musique_path")
            duree_preroll = params.get("duree_preroll")
            if duree_preroll is not None:
                duree_preroll = float(duree_preroll)

            if mode == "global":
                _run_global(
                    video_path,
                    float(params["bpm_source"]),
                    float(params["bpm_cible"]),
                    sortie,
                    avec_musique=avec_musique,
                    musique_path=musique_path,
                    annotations=params.get("annotations"),
                    beats=params.get("beats"),
                    duree_preroll=duree_preroll,
                )
            else:
                _run_precis(
                    video_path,
                    params["annotations"],
                    params["beats"],
                    sortie,
                    avec_musique=avec_musique,
                    musique_path=musique_path,
                    duree_preroll=duree_preroll,
                )

            _set(fichier=sortie, message="Terminé !", progression=100.0)

        except Exception as e:
            _set(erreur=str(e), message="Erreur", progression=0.0)
            traceback.print_exc()
        finally:
            _set(en_cours=False)

    threading.Thread(target=run, daemon=True).start()
    return True
