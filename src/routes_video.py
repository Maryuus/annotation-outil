# Routes pour l'annotateur vidéo : chargement, frames, annotations.

import datetime
import io
import json
import math
import os

from flask import Blueprint, jsonify, request, send_file

from etat import loader, projet_actuel, video_courante, gestionnaire
from utils import formater_timecode, chemin_miniature, generer_miniature

bp_video = Blueprint("video", __name__)


# Vidéo

@bp_video.route("/video/charger", methods=["POST"])
def charger_video():
    data   = request.get_json(silent=True) or {}
    chemin = data.get("chemin", "").strip()
    if not chemin:
        return jsonify({"erreur": "champ 'chemin' manquant"}), 400
    if not os.path.isfile(chemin):
        return jsonify({"erreur": f"fichier introuvable : {chemin}"}), 404

    if not loader.charger_video(chemin):
        return jsonify({"erreur": "impossible d'ouvrir la vidéo"}), 422

    video_courante["infos"]      = loader.get_infos()
    video_courante["nom_export"] = ""
    gestionnaire.vider()
    generer_miniature(chemin, loader)
    return jsonify(video_courante["infos"]), 200


@bp_video.route("/video/stream")
def stream_video():
    if not video_courante["infos"]:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404
    return send_file(video_courante["infos"]["chemin"], conditional=True)


@bp_video.route("/video/infos")
def get_infos_video():
    if not video_courante["infos"]:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404
    resp = jsonify({**video_courante["infos"], "nom_export": video_courante["nom_export"]})
    resp.headers["Cache-Control"] = "no-cache, no-store"
    return resp, 200


# Frames

@bp_video.route("/frames/<int:numero>")
def get_frame(numero):
    if not video_courante["infos"]:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404

    nb = video_courante["infos"]["nb_frames"]
    if not (0 <= numero < nb):
        return jsonify({"erreur": f"frame {numero} hors limites (0–{nb - 1})"}), 400

    max_width = 400 if request.args.get("size") == "thumb" else 1280
    data      = loader.get_frame(numero, max_width=max_width)
    if data is None:
        return jsonify({"erreur": "impossible de lire la frame"}), 500

    resp = send_file(io.BytesIO(data), mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


# Annotations

@bp_video.route("/annotations", methods=["GET"])
def lister_annotations():
    items = [{
        "frame":          a["frame"],
        "temps_secondes": a["temps_secondes"],
        "timecode":       formater_timecode(a["temps_secondes"]),
        "etiquette":      a["etiquette"],
    } for a in gestionnaire.annotations]
    resp = jsonify({"items": items, "pas": gestionnaire.get_pas()})
    resp.headers["Cache-Control"] = "no-cache, no-store"
    return resp, 200


@bp_video.route("/annotations", methods=["POST"])
def ajouter_annotation():
    if not video_courante["infos"]:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404

    data = request.get_json(silent=True) or {}
    if "frame" not in data:
        return jsonify({"erreur": "champ 'frame' manquant"}), 400

    frame = int(data["frame"])
    nb    = video_courante["infos"]["nb_frames"]
    if not (0 <= frame < nb):
        return jsonify({"erreur": f"frame {frame} hors limites (0–{nb - 1})"}), 400

    fps       = video_courante["infos"]["fps"] or 25.0
    temps     = round(frame / fps, 3)
    etiquette = str(data.get("etiquette", "")).strip()
    ann       = gestionnaire.ajouter(frame, temps, etiquette)
    return jsonify({
        "frame":          ann["frame"],
        "temps_secondes": ann["temps_secondes"],
        "timecode":       formater_timecode(ann["temps_secondes"]),
        "etiquette":      ann["etiquette"],
    }), 201


@bp_video.route("/annotations/<int:frame>", methods=["DELETE"])
def supprimer_annotation(frame):
    if not gestionnaire.frame_annotee(frame):
        return jsonify({"erreur": f"aucune annotation sur la frame {frame}"}), 404
    gestionnaire.supprimer(frame)
    return jsonify({"supprimee": frame}), 200


@bp_video.route("/annotations", methods=["DELETE"])
def vider_annotations():
    gestionnaire.vider()
    return jsonify({"message": "annotations effacées"}), 200


@bp_video.route("/annotations/lot", methods=["POST"])
def annoter_en_lot():
    if not video_courante["infos"]:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404

    data = request.get_json(silent=True) or {}
    try:
        debut_raw = float(data["debut"])
        fin_raw   = float(data["fin"])
        nombre    = int(data["nombre"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"erreur": "champs 'debut', 'fin', 'nombre' requis"}), 400

    if nombre < 1:
        return jsonify({"erreur": "'nombre' doit être >= 1"}), 400

    fps  = video_courante["infos"]["fps"] or 25.0
    nb   = video_courante["infos"]["nb_frames"]
    mode = data.get("mode", "frame")

    if mode == "secondes":
        debut_frame = round(debut_raw * fps)
        fin_frame   = round(fin_raw   * fps)
    else:
        debut_frame = round(debut_raw)
        fin_frame   = round(fin_raw)

    debut_frame = max(0, min(nb - 1, debut_frame))
    fin_frame   = max(0, min(nb - 1, fin_frame))

    if nombre == 1:
        frames_liste = [debut_frame]
    else:
        frames_liste = [round(debut_frame + i * (fin_frame - debut_frame) / (nombre - 1)) for i in range(nombre)]

    frames_liste = sorted(set(max(0, min(nb - 1, f)) for f in frames_liste))
    etiquette    = str(data.get("etiquette", "")).strip()

    creees = []
    for frame in frames_liste:
        temps = round(frame / fps, 3)
        ann   = gestionnaire.ajouter(frame, temps, etiquette)
        creees.append({
            "frame":          ann["frame"],
            "temps_secondes": ann["temps_secondes"],
            "timecode":       formater_timecode(ann["temps_secondes"]),
            "etiquette":      ann["etiquette"],
        })

    return jsonify({"creees": len(creees), "items": creees, "pas": gestionnaire.get_pas()}), 201


@bp_video.route("/annotations/lisser", methods=["POST"])
def lisser_annotations():
    if not video_courante["infos"]:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404

    data = request.get_json(silent=True) or {}
    try:
        debut = int(data["debut"])
        fin   = int(data["fin"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"erreur": "champs 'debut' et 'fin' requis"}), 400

    largeur = max(1, min(3, int(data.get("largeur", 1))))

    if debut >= fin:
        return jsonify({"erreur": "'debut' doit être inférieur à 'fin'"}), 400

    dans_range = sorted(
        [a for a in gestionnaire.annotations if debut <= a["frame"] <= fin],
        key=lambda a: a["frame"]
    )
    if len(dans_range) < 3:
        return jsonify({"erreur": "Il faut au moins 3 annotations dans la plage pour lisser"}), 400

    fps          = video_courante["infos"].get("fps", 25.0) or 25.0
    nb           = video_courante["infos"].get("nb_frames", 0)
    n            = len(dans_range)
    etiquettes   = [a["etiquette"] for a in dans_range]
    frames_orig  = [a["frame"]     for a in dans_range]

    # Lissage gaussien (les extrêmes restent fixes)
    def gauss(j):
        return math.exp(-(j * j) / 2.0)

    frames_lisses = list(frames_orig)
    for i in range(1, n - 1):
        total_w = total_f = 0.0
        for j in range(-largeur, largeur + 1):
            k = i + j
            if 0 <= k < n:
                w        = gauss(j)
                total_w += w
                total_f += w * frames_orig[k]
        frames_lisses[i] = max(0, min(nb - 1, round(total_f / total_w)))

    for a in dans_range:
        gestionnaire.supprimer(a["frame"])

    nouvelles   = []
    frames_vus  = set()
    for i in range(n):
        f = frames_lisses[i]
        if f in frames_vus:
            continue
        frames_vus.add(f)
        temps = round(f / fps, 3)
        ann   = gestionnaire.ajouter(f, temps, etiquettes[i])
        nouvelles.append({
            "frame":          ann["frame"],
            "temps_secondes": ann["temps_secondes"],
            "timecode":       formater_timecode(ann["temps_secondes"]),
            "etiquette":      ann["etiquette"],
        })

    return jsonify({"lissees": len(nouvelles), "items": nouvelles, "pas": gestionnaire.get_pas()}), 200


@bp_video.route("/annotations/exporter", methods=["POST"])
def exporter_annotations():
    if not video_courante["infos"]:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404
    if not gestionnaire.annotations:
        return jsonify({"erreur": "aucune annotation à exporter"}), 404

    data              = request.get_json(silent=True) or {}
    nom_export        = str(data.get("nom", "")).strip()
    forcer_ecrasement = data.get("forcer_ecrasement", False)

    infos     = video_courante["infos"]
    nom_video = os.path.basename(infos["chemin"])

    # Cherche un export existant avec le même nom (pour éventuel écrasement)
    export_existant = None
    if nom_export:
        for v in projet_actuel["videos"]:
            if v["nom"] == nom_video:
                for e in v.get("exports", []):
                    if e.get("nom") == nom_export:
                        export_existant = e
                        break
                break

    if export_existant and not forcer_ecrasement:
        return jsonify({"conflit": True, "nom": nom_export}), 200

    if export_existant:
        chemin_export = export_existant["fichier"]
    else:
        nom_base      = os.path.splitext(nom_video)[0]
        horodatage    = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        chemin_export = os.path.join(os.path.dirname(infos["chemin"]),
                                     f"{nom_base}_export_{horodatage}.json")

    contenu = gestionnaire.vers_json(infos["chemin"], infos["fps"], infos["nb_frames"], nom=nom_export)
    with open(chemin_export, "wb") as fh:
        fh.write(contenu)

    video_courante["nom_export"] = nom_export

    anns       = gestionnaire.annotations
    t_debut    = anns[0]["temps_secondes"]
    t_fin      = anns[-1]["temps_secondes"]
    duree_clip = round(t_fin - t_debut, 3)
    bpm        = round((len(anns) - 1) / (duree_clip / 60), 1) if duree_clip > 0 and len(anns) > 1 else None
    export_info = {
        "nom":            nom_export or None,
        "date":           datetime.datetime.now().strftime("%d/%m/%Y %H:%M"),
        "nb_annotations": len(anns),
        "premier":        formater_timecode(t_debut),
        "dernier":        formater_timecode(t_fin),
        "duree_clip":     duree_clip,
        "bpm":            bpm,
        "fichier":        chemin_export,
    }
    for v in projet_actuel["videos"]:
        if v["nom"] == nom_video:
            exports = v.setdefault("exports", [])
            if export_existant:
                for i, e in enumerate(exports):
                    if e.get("fichier") == chemin_export:
                        exports[i] = export_info
                        break
            else:
                exports.insert(0, export_info)
            break

    return jsonify({"ok": True, "fichier": os.path.basename(chemin_export)}), 200


@bp_video.route("/annotations/importer", methods=["POST"])
def importer_annotations():
    if "fichier" not in request.files:
        return jsonify({"erreur": "champ 'fichier' manquant"}), 400
    f = request.files["fichier"]
    try:
        donnees = json.load(f)
    except Exception as e:
        return jsonify({"erreur": f"JSON invalide : {e}"}), 422
    gestionnaire.charger_depuis_json(donnees.get("annotations", []))
    return jsonify({"importees": len(gestionnaire.annotations)}), 200
