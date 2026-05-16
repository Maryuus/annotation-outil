# Routes pour la gestion du projet (dossier, scan, miniatures, pages HTML).

import json
import os

from flask import Blueprint, jsonify, render_template, request, send_file

from etat import loader, projet_actuel
from gestionnaires import get_audio_duration
from utils import (VIDEO_EXTENSIONS, AUDIO_EXTENSIONS,
                   PATTERN_EXPORT, PATTERN_BEATS,
                   formater_timecode, chemin_miniature, generer_miniature)
from video_loader import VideoLoader

bp_projets = Blueprint("projets", __name__)


# Pages HTML

@bp_projets.route("/")
def accueil():
    return render_template("accueil.html")

@bp_projets.route("/annoter")
def annotateur():
    return render_template("index.html")

@bp_projets.route("/audio-annoter")
def audio_annotateur():
    return render_template("audio.html")


# Projet

@bp_projets.route("/projets")
def get_projets():
    # Génère les miniatures manquantes avant de renvoyer la liste
    for v in projet_actuel["videos"]:
        if not os.path.isfile(chemin_miniature(v["chemin"])) and os.path.isfile(v["chemin"]):
            tmp = VideoLoader()
            if tmp.charger_video(v["chemin"]):
                generer_miniature(v["chemin"], tmp)
            tmp.capture.release()
    return jsonify(projet_actuel)


@bp_projets.route("/projets/thumbnail/<nom>")
def get_thumbnail(nom):
    video = next((v for v in projet_actuel["videos"] if v["nom"] == nom), None)
    if not video:
        return "", 404
    thumb_path = chemin_miniature(video["chemin"])
    if not os.path.isfile(thumb_path):
        return "", 404
    resp = send_file(thumb_path, mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


@bp_projets.route("/projets/supprimer-video", methods=["POST"])
def supprimer_video_projet():
    data = request.get_json(silent=True) or {}
    nom  = data.get("nom", "")
    if not nom:
        return jsonify({"erreur": "champ 'nom' manquant"}), 400
    projet_actuel["videos"] = [v for v in projet_actuel["videos"] if v["nom"] != nom]
    return jsonify({"ok": True}), 200


@bp_projets.route("/projets/supprimer-audio", methods=["POST"])
def supprimer_audio_projet():
    data = request.get_json(silent=True) or {}
    nom  = data.get("nom", "")
    if not nom:
        return jsonify({"erreur": "champ 'nom' manquant"}), 400
    projet_actuel["audios"] = [a for a in projet_actuel["audios"] if a["nom"] != nom]
    return jsonify({"ok": True}), 200


@bp_projets.route("/projets/supprimer-export", methods=["POST"])
def supprimer_export_projet():
    data          = request.get_json(silent=True) or {}
    nom_video     = data.get("nom_video", "")
    chemin_export = data.get("chemin_export", "")
    if not nom_video or not chemin_export:
        return jsonify({"erreur": "champs requis manquants"}), 400

    if os.path.isfile(chemin_export):
        try:
            os.remove(chemin_export)
        except Exception as e:
            return jsonify({"erreur": f"impossible de supprimer : {e}"}), 500

    for v in projet_actuel["videos"]:
        if v["nom"] == nom_video:
            v["exports"] = [e for e in v.get("exports", []) if e.get("fichier") != chemin_export]
            break
    return jsonify({"ok": True}), 200


@bp_projets.route("/projets/fermer", methods=["POST"])
def fermer_projet():
    projet_actuel["dossier"] = None
    projet_actuel["videos"]  = []
    projet_actuel["audios"]  = []
    return jsonify({"ok": True}), 200


@bp_projets.route("/projets/actualiser", methods=["POST"])
def actualiser_projet():
    # Re-scanne le dossier déjà ouvert sans avoir à le resélectionner
    chemin = projet_actuel.get("dossier")
    if not chemin:
        return jsonify({"erreur": "aucun dossier ouvert"}), 400
    if not os.path.isdir(chemin):
        return jsonify({"erreur": f"dossier introuvable : {chemin}"}), 404
    return _faire_scan(chemin)


@bp_projets.route("/projets/choisir-dossier")
def choisir_dossier():
    # Ouvre la boîte de dialogue native pour choisir un dossier
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", True)
        chemin = filedialog.askdirectory(title="Choisir le dossier de travail")
        root.destroy()
        return jsonify({"chemin": chemin or None}), 200
    except Exception:
        return jsonify({"erreur": "no_tkinter"}), 200


@bp_projets.route("/projets/scanner-dossier", methods=["POST"])
def scanner_dossier():
    data   = request.get_json(silent=True) or {}
    chemin = data.get("chemin", "").strip()
    if not chemin:
        return jsonify({"erreur": "champ 'chemin' manquant"}), 400
    if not os.path.isdir(chemin):
        return jsonify({"erreur": f"dossier introuvable : {chemin}"}), 404
    return _faire_scan(chemin)


@bp_projets.route("/projets/restaurer", methods=["POST"])
def restaurer_export():
    # Charge une vidéo et restaure ses annotations depuis un export JSON
    from etat import gestionnaire
    data          = request.get_json(silent=True) or {}
    chemin_video  = data.get("chemin_video", "")
    chemin_export = data.get("chemin_export", "")

    if not os.path.isfile(chemin_video):
        return jsonify({"erreur": "vidéo introuvable"}), 404
    if not os.path.isfile(chemin_export):
        return jsonify({"erreur": "fichier export introuvable"}), 404

    if not loader.charger_video(chemin_video):
        return jsonify({"erreur": "impossible d'ouvrir la vidéo"}), 422

    from etat import video_courante
    video_courante["infos"] = loader.get_infos()

    with open(chemin_export, "r", encoding="utf-8") as fh:
        try:
            donnees = json.load(fh)
        except Exception as e:
            return jsonify({"erreur": f"JSON invalide : {e}"}), 422

    gestionnaire.charger_depuis_json(donnees.get("annotations", []))
    video_courante["nom_export"] = donnees.get("nom") or ""
    return jsonify({"ok": True, "importees": len(gestionnaire.annotations)}), 200


# Scan de dossier

def _faire_scan(chemin_dossier):
    # Scanne un dossier et met à jour projet_actuel
    try:
        fichiers = os.listdir(chemin_dossier)
    except PermissionError:
        return jsonify({"erreur": "accès refusé au dossier"}), 403

    videos_trouvees = []
    audios_trouvees = []
    jsons_trouves   = []
    beats_trouves   = []

    for nom in sorted(fichiers):
        chemin = os.path.join(chemin_dossier, nom)
        if not os.path.isfile(chemin):
            continue
        ext = os.path.splitext(nom)[1].lower()
        if ext in VIDEO_EXTENSIONS:
            videos_trouvees.append((nom, chemin))
        elif ext in AUDIO_EXTENSIONS:
            audios_trouvees.append((nom, chemin))
        elif ext == ".json":
            m = PATTERN_EXPORT.match(nom)
            if m:
                jsons_trouves.append((m.group(1), chemin, nom, m.groups()[1:]))
            else:
                m2 = PATTERN_BEATS.match(nom)
                if m2:
                    beats_trouves.append((m2.group(1), chemin, nom, m2.groups()[1:]))

    nouvelles_videos = []
    for nom_video, chemin_video in videos_trouvees:
        nom_base      = os.path.splitext(nom_video)[0]
        exports_video = []

        for base_json, chemin_json, nom_json, groupes in jsons_trouves:
            if base_json != nom_base:
                continue
            try:
                with open(chemin_json, "r", encoding="utf-8") as fh:
                    donnees = json.load(fh)
                anns = donnees.get("annotations", [])
                if not anns:
                    continue
                y, mo, d, h, mi, s = groupes
                t_debut    = anns[0].get("temps_secondes", 0)
                t_fin      = anns[-1].get("temps_secondes", 0)
                duree_clip = round(t_fin - t_debut, 3)
                bpm        = round((len(anns) - 1) / (duree_clip / 60), 1) if duree_clip > 0 and len(anns) > 1 else None
                exports_video.append({
                    "nom":            donnees.get("nom") or None,
                    "date":           f"{d}/{mo}/{y} {h}:{mi}",
                    "nb_annotations": len(anns),
                    "premier":        formater_timecode(t_debut),
                    "dernier":        formater_timecode(t_fin),
                    "duree_clip":     duree_clip,
                    "bpm":            bpm,
                    "fichier":        chemin_json,
                })
            except Exception:
                pass

        tmp = VideoLoader()
        if not tmp.charger_video(chemin_video):
            if tmp.capture:
                tmp.capture.release()
            continue
        infos = tmp.get_infos()
        generer_miniature(chemin_video, tmp)
        tmp.capture.release()

        nouvelles_videos.append({
            "nom":       nom_video,
            "chemin":    chemin_video,
            "fps":       round(infos["fps"], 3),
            "nb_frames": infos["nb_frames"],
            "duree_sec": infos["duree_sec"],
            "largeur":   infos["largeur"],
            "hauteur":   infos["hauteur"],
            "exports":   exports_video,
        })

    nouvelles_audios = []
    for nom_audio, chemin_audio in audios_trouvees:
        nom_base      = os.path.splitext(nom_audio)[0]
        exports_audio = []

        for base_json, chemin_json, nom_json, groupes in beats_trouves:
            if base_json != nom_base:
                continue
            try:
                with open(chemin_json, "r", encoding="utf-8") as fh:
                    donnees = json.load(fh)
                beats = donnees.get("beats", [])
                if not beats:
                    continue
                y, mo, d, h, mi, s = groupes
                t_debut    = beats[0].get("temps_secondes", 0)
                t_fin      = beats[-1].get("temps_secondes", 0)
                duree_clip = round(t_fin - t_debut, 3)
                bpm        = round((len(beats) - 1) / (duree_clip / 60), 1) if duree_clip > 0 and len(beats) > 1 else None
                exports_audio.append({
                    "nom":      donnees.get("nom") or None,
                    "date":     f"{d}/{mo}/{y} {h}:{mi}",
                    "nb_beats": len(beats),
                    "bpm":      bpm,
                    "fichier":  chemin_json,
                })
            except Exception:
                pass

        nouvelles_audios.append({
            "nom":       nom_audio,
            "chemin":    chemin_audio,
            "duree_sec": None,
            "exports":   exports_audio,
        })

    projet_actuel["dossier"] = chemin_dossier
    projet_actuel["videos"]  = nouvelles_videos
    projet_actuel["audios"]  = nouvelles_audios
    return jsonify({
        "ok":           True,
        "dossier":      chemin_dossier,
        "total":        len(nouvelles_videos),
        "total_audios": len(nouvelles_audios),
    }), 200
