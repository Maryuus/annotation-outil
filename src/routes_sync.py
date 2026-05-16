# Routes pour la synchronisation vidéo/musique.

import json
import os

from flask import Blueprint, jsonify, request, send_file

import sync as sync_module

bp_sync = Blueprint("sync", __name__)


@bp_sync.route("/sync/preroll")
def sync_preroll():
    # Retourne le preroll maximum possible (min entre t_ann_1 et t_beat_1)
    anns_path  = request.args.get("annotations_path", "").strip()
    beats_path = request.args.get("beats_path",       "").strip()

    if not os.path.isfile(anns_path):
        return jsonify({"erreur": "fichier annotations introuvable"}), 404
    if not os.path.isfile(beats_path):
        return jsonify({"erreur": "fichier beats introuvable"}), 404

    try:
        with open(anns_path,  "r", encoding="utf-8") as fh:
            anns_data  = json.load(fh)
        with open(beats_path, "r", encoding="utf-8") as fh:
            beats_data = json.load(fh)
    except Exception as e:
        return jsonify({"erreur": str(e)}), 422

    anns  = anns_data.get("annotations", [])
    beats = beats_data.get("beats", [])
    if not anns or not beats:
        return jsonify({"erreur": "annotations ou beats vides"}), 400

    t_ann_1  = float(anns[0]["temps_secondes"])
    t_beat_1 = float(beats[0]["temps_secondes"])
    return jsonify({
        "t_ann_1":     round(t_ann_1,  3),
        "t_beat_1":    round(t_beat_1, 3),
        "max_preroll": round(min(t_ann_1, t_beat_1), 2),
    }), 200


@bp_sync.route("/sync/lancer", methods=["POST"])
def lancer_sync():
    data = request.get_json(silent=True) or {}
    mode = data.get("mode", "").strip()

    if mode not in ("global", "precis"):
        return jsonify({"erreur": "mode invalide (global ou precis)"}), 400

    video_path = data.get("video_path", "").strip()
    if not os.path.isfile(video_path):
        return jsonify({"erreur": f"vidéo introuvable : {video_path}"}), 400

    if mode == "global":
        try:
            bpm_source = float(data["bpm_source"])
            bpm_cible  = float(data["bpm_cible"])
        except (KeyError, ValueError, TypeError):
            return jsonify({"erreur": "bpm_source et bpm_cible requis"}), 400
        if bpm_source <= 0 or bpm_cible <= 0:
            return jsonify({"erreur": "les BPM doivent être > 0"}), 400

        annotations_glob = []
        beats_glob       = []
        if data.get("avec_musique"):
            anns_path  = data.get("annotations_path", "").strip()
            beats_path = data.get("beats_path",       "").strip()
            if os.path.isfile(anns_path) and os.path.isfile(beats_path):
                with open(anns_path,  "r", encoding="utf-8") as fh:
                    annotations_glob = json.load(fh).get("annotations", [])
                with open(beats_path, "r", encoding="utf-8") as fh:
                    beats_glob = json.load(fh).get("beats", [])

        ok = sync_module.lancer("global", {
            "video_path":    video_path,
            "bpm_source":    bpm_source,
            "bpm_cible":     bpm_cible,
            "avec_musique":  bool(data.get("avec_musique")),
            "musique_path":  data.get("musique_path", "").strip() or None,
            "annotations":   annotations_glob,
            "beats":         beats_glob,
            "duree_preroll": data.get("duree_preroll"),
        })

    else:  # precis
        anns_path  = data.get("annotations_path", "").strip()
        beats_path = data.get("beats_path",       "").strip()

        if not os.path.isfile(anns_path):
            return jsonify({"erreur": f"fichier annotations introuvable : {anns_path}"}), 400
        if not os.path.isfile(beats_path):
            return jsonify({"erreur": f"fichier beats introuvable : {beats_path}"}), 400

        try:
            with open(anns_path,  "r", encoding="utf-8") as fh:
                annotations = json.load(fh).get("annotations", [])
            with open(beats_path, "r", encoding="utf-8") as fh:
                beats = json.load(fh).get("beats", [])
        except Exception as e:
            return jsonify({"erreur": f"JSON invalide : {e}"}), 422

        ok = sync_module.lancer("precis", {
            "video_path":    video_path,
            "annotations":   annotations,
            "beats":         beats,
            "avec_musique":  bool(data.get("avec_musique")),
            "musique_path":  data.get("musique_path", "").strip() or None,
            "duree_preroll": data.get("duree_preroll"),
        })

    if not ok:
        return jsonify({"erreur": "une synchronisation est déjà en cours"}), 409
    return jsonify({"ok": True}), 200


@bp_sync.route("/sync/progression")
def get_sync_progression():
    return jsonify(sync_module.get_etat()), 200


@bp_sync.route("/sync/telecharger")
def telecharger_sync():
    etat    = sync_module.get_etat()
    fichier = etat.get("fichier")
    if not fichier or not os.path.isfile(fichier):
        return jsonify({"erreur": "aucun résultat disponible"}), 404
    return send_file(fichier, as_attachment=True)
