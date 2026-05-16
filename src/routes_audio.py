# Routes pour l'annotateur audio : chargement, beats, export.

import datetime
import json
import os

import librosa
from flask import Blueprint, jsonify, request, send_file

from etat import projet_actuel, audio_courant, gestionnaire_beats
from gestionnaires import get_audio_duration, construire_beat

bp_audio = Blueprint("audio", __name__)


# Fichier audio

@bp_audio.route("/audio/charger", methods=["POST"])
def charger_audio():
    data   = request.get_json(silent=True) or {}
    chemin = data.get("chemin", "").strip()
    if not chemin:
        return jsonify({"erreur": "champ 'chemin' manquant"}), 400
    if not os.path.isfile(chemin):
        return jsonify({"erreur": f"fichier introuvable : {chemin}"}), 404

    duree = get_audio_duration(chemin)
    if duree is None:
        return jsonify({"erreur": "impossible de lire le fichier audio"}), 422

    audio_courant["infos"]      = {"chemin": chemin, "nom": os.path.basename(chemin), "duree_sec": round(duree, 3)}
    audio_courant["nom_export"] = ""
    gestionnaire_beats.vider()
    return jsonify(audio_courant["infos"]), 200


@bp_audio.route("/audio/infos")
def get_infos_audio():
    if not audio_courant["infos"]:
        return jsonify({"erreur": "aucun fichier audio chargé"}), 404
    return jsonify({**audio_courant["infos"], "nom_export": audio_courant["nom_export"]}), 200


@bp_audio.route("/audio/stream")
def stream_audio():
    if not audio_courant["infos"]:
        return jsonify({"erreur": "aucun fichier audio chargé"}), 404
    return send_file(audio_courant["infos"]["chemin"], conditional=True)


@bp_audio.route("/audio/durees", methods=["POST"])
def get_durees_batch():
    # Calcule la durée de plusieurs fichiers audio en une seule requête
    data    = request.get_json(silent=True) or {}
    chemins = data.get("chemins", [])
    result  = {}
    for chemin in chemins:
        if os.path.isfile(chemin):
            d = get_audio_duration(chemin)
            result[chemin] = round(d, 3) if d is not None else None
        else:
            result[chemin] = None
    return jsonify(result), 200


@bp_audio.route("/audio/restaurer", methods=["POST"])
def restaurer_beats():
    # Charge un fichier audio et restaure ses beats depuis un export JSON
    try:
        data          = request.get_json(silent=True) or {}
        chemin_audio  = data.get("chemin_audio",  "")
        chemin_export = data.get("chemin_export", "")

        if not os.path.isfile(chemin_audio):
            return jsonify({"erreur": f"fichier audio introuvable : {chemin_audio}"}), 404
        if not os.path.isfile(chemin_export):
            return jsonify({"erreur": f"fichier export introuvable : {chemin_export}"}), 404

        duree = get_audio_duration(chemin_audio)
        if duree is None:
            return jsonify({"erreur": "impossible de lire la durée du fichier audio"}), 422

        audio_courant["infos"] = {
            "chemin":    chemin_audio,
            "nom":       os.path.basename(chemin_audio),
            "duree_sec": round(duree, 3),
        }

        with open(chemin_export, "r", encoding="utf-8") as fh:
            donnees = json.load(fh)

        gestionnaire_beats.charger_depuis_json(donnees.get("beats", []))
        audio_courant["nom_export"] = donnees.get("nom") or ""
        return jsonify({"ok": True, "importes": len(gestionnaire_beats.beats)}), 200

    except Exception as e:
        return jsonify({"erreur": str(e)}), 500


# Beats

@bp_audio.route("/audio/beats", methods=["GET"])
def lister_beats():
    resp = jsonify({"beats": gestionnaire_beats.beats})
    resp.headers["Cache-Control"] = "no-cache, no-store"
    return resp, 200


@bp_audio.route("/audio/beats", methods=["POST"])
def ajouter_beat():
    if not audio_courant["infos"]:
        return jsonify({"erreur": "aucun fichier audio chargé"}), 404
    data = request.get_json(silent=True) or {}
    try:
        temps_ms = int(data["temps_ms"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"erreur": "champ 'temps_ms' requis"}), 400

    etiquette = str(data.get("etiquette", "")).strip()
    _, action = gestionnaire_beats.ajouter(temps_ms, etiquette)
    code = 201 if action == "ajoute" else 200
    resp = jsonify({"tous": gestionnaire_beats.beats, "action": action})
    resp.headers["Cache-Control"] = "no-cache, no-store"
    return resp, code


@bp_audio.route("/audio/beats/<int:temps_ms>", methods=["DELETE", "PATCH"])
def gerer_beat(temps_ms):
    if request.method == "DELETE":
        gestionnaire_beats.supprimer(temps_ms)
        return jsonify({"ok": True}), 200

    # PATCH : modifier l'étiquette
    data = request.get_json(silent=True) or {}
    b    = gestionnaire_beats.modifier_etiquette(temps_ms, data.get("etiquette", ""))
    if b:
        return jsonify({"ok": True, "beat": b}), 200
    return jsonify({"erreur": f"aucun beat à {temps_ms} ms"}), 404


@bp_audio.route("/audio/beats", methods=["DELETE"])
def vider_beats():
    gestionnaire_beats.vider()
    return jsonify({"message": "beats effacés"}), 200


@bp_audio.route("/audio/beats/lot", methods=["POST"])
def ajouter_beats_lot():
    data = request.get_json(silent=True) or {}
    try:
        debut_ms  = int(data["debut_ms"])
        fin_ms    = int(data["fin_ms"])
        nb        = int(data["nb"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"erreur": "champs 'debut_ms', 'fin_ms', 'nb' requis et numériques"}), 400
    etiquette = str(data.get("etiquette", "")).strip()

    if nb < 2:
        return jsonify({"erreur": "il faut au moins 2 beats"}), 400
    if fin_ms <= debut_ms:
        return jsonify({"erreur": "fin_ms doit être > debut_ms"}), 400

    ajoutes = gestionnaire_beats.ajouter_lot(debut_ms, fin_ms, nb, etiquette)
    return jsonify({"beats": gestionnaire_beats.beats, "ajoutes": ajoutes}), 201


@bp_audio.route("/audio/beats/supprimer-lot", methods=["POST"])
def supprimer_beats_lot():
    data = request.get_json(silent=True) or {}
    try:
        debut_s = float(data["debut_s"])
        fin_s   = float(data["fin_s"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"erreur": "champs 'debut_s' et 'fin_s' requis"}), 400
    if fin_s <= debut_s:
        return jsonify({"erreur": "fin_s doit être > debut_s"}), 400

    avant = len(gestionnaire_beats.beats)
    gestionnaire_beats.beats = [
        b for b in gestionnaire_beats.beats
        if not (debut_s <= b["temps_secondes"] <= fin_s)
    ]
    supprimes = avant - len(gestionnaire_beats.beats)
    return jsonify({"ok": True, "supprimes": supprimes, "restants": len(gestionnaire_beats.beats)}), 200


@bp_audio.route("/audio/beats/completer", methods=["POST"])
def completer_beats():
    if not audio_courant["infos"]:
        return jsonify({"erreur": "aucun fichier audio chargé"}), 404
    if len(gestionnaire_beats.beats) < 2:
        return jsonify({"erreur": "il faut au moins 2 beats pour calculer l'intervalle"}), 400

    duree_ms       = round(audio_courant["infos"]["duree_sec"] * 1000)
    ajoutes, step  = gestionnaire_beats.completer(duree_ms)
    return jsonify({"beats": gestionnaire_beats.beats, "ajoutes": ajoutes, "intervalle_ms": step}), 201


@bp_audio.route("/audio/beats/detecter", methods=["POST"])
def detecter_beats():
    if not audio_courant["infos"]:
        return jsonify({"erreur": "aucun fichier audio chargé"}), 404
    try:
        y, sr          = librosa.load(audio_courant["infos"]["chemin"], sr=None, mono=True)
        _, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times     = librosa.frames_to_time(beat_frames, sr=sr)

        gestionnaire_beats.vider()
        for t in beat_times:
            gestionnaire_beats.beats.append(construire_beat(round(float(t) * 1000)))
        gestionnaire_beats._trier()
        return jsonify({"beats": gestionnaire_beats.beats, "total": len(gestionnaire_beats.beats)}), 200
    except Exception as e:
        return jsonify({"erreur": str(e)}), 500


@bp_audio.route("/audio/beats/exporter", methods=["POST"])
def exporter_beats():
    if not audio_courant["infos"]:
        return jsonify({"erreur": "aucun fichier audio chargé"}), 404
    if not gestionnaire_beats.beats:
        return jsonify({"erreur": "aucun beat à exporter"}), 400

    data       = request.get_json(silent=True) or {}
    nom        = str(data.get("nom", "")).strip()
    infos      = audio_courant["infos"]
    nom_audio  = infos["nom"]
    nom_base   = os.path.splitext(nom_audio)[0]
    horodatage = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    chemin_export = os.path.join(os.path.dirname(infos["chemin"]),
                                 f"{nom_base}_beats_{horodatage}.json")

    contenu = {
        "audio":          nom_audio,
        "nom":            nom or None,
        "duree_secondes": infos["duree_sec"],
        "beats":          gestionnaire_beats.beats,
    }
    with open(chemin_export, "w", encoding="utf-8") as fh:
        json.dump(contenu, fh, ensure_ascii=False, indent=2)

    audio_courant["nom_export"] = nom

    beats      = gestionnaire_beats.beats
    t_debut    = beats[0]["temps_secondes"]
    t_fin      = beats[-1]["temps_secondes"]
    duree_clip = round(t_fin - t_debut, 3)
    bpm        = round((len(beats) - 1) / (duree_clip / 60), 1) if duree_clip > 0 and len(beats) > 1 else None

    export_info = {
        "nom":      nom or None,
        "date":     datetime.datetime.now().strftime("%d/%m/%Y %H:%M"),
        "nb_beats": len(beats),
        "bpm":      bpm,
        "fichier":  chemin_export,
    }
    for a in projet_actuel["audios"]:
        if a["nom"] == nom_audio:
            a.setdefault("exports", []).insert(0, export_info)
            break

    return jsonify({"ok": True, "fichier": os.path.basename(chemin_export)}), 200

