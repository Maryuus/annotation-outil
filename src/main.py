import datetime
import io
import json
import os
import re

import librosa  # détection de beats + génération son de clic
import numpy as np
from flask import Flask, jsonify, render_template, request, send_file

from annotations import GestionnaireAnnotations
from beats_audio import GestionnaireBeat, get_audio_duration, construire_beat
from export_json import exporter_json
from video_loader import VideoLoader

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

VIDEO_EXTENSIONS = {'.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v'}
AUDIO_EXTENSIONS = {'.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus'}
PATTERN_EXPORT   = re.compile(r'^(.+)_export_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.json$')
PATTERN_BEATS    = re.compile(r'^(.+)_beats_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.json$')



def chemin_miniature(chemin_video):
    """Retourne le chemin de la miniature pour une vidéo donnée."""
    dossier  = os.path.dirname(chemin_video)
    nom_base = os.path.splitext(os.path.basename(chemin_video))[0]
    return os.path.join(dossier, "." + nom_base + "_thumb.jpg")


def generer_miniature(chemin, video_loader):
    """Sauvegarde la frame 0 en JPEG à côté de la vidéo (fichier caché)."""
    thumb_path = chemin_miniature(chemin)
    if os.path.isfile(thumb_path):
        return
    data = video_loader.get_frame(0, max_width=320)
    if data:
        with open(thumb_path, "wb") as fh:
            fh.write(data)

app = Flask(
    __name__,
    static_folder=os.path.join(BASE_DIR, "static"),
    template_folder=os.path.join(BASE_DIR, "templates"),
)

# état global
loader                  = VideoLoader()
projet_actuel           = {"dossier": None, "videos": [], "audios": []}
nom_export_ouvert       = ""   # pré-rempli quand on ouvre un export vidéo
gestionnaire            = GestionnaireAnnotations()
infos_video             = {}
infos_audio             = {}
gestionnaire_beats      = GestionnaireBeat()
nom_export_audio_ouvert = ""



def formater_timecode(temps):
    minutes = int(temps // 60)
    secondes = temps % 60
    return f"{minutes:02d}:{secondes:05.2f}"


# ---------------------------------------------------------------------------
# Page principale
# ---------------------------------------------------------------------------

@app.route("/")
def accueil():
    return render_template("accueil.html")


@app.route("/annoter")
def annotateur():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Projets
# ---------------------------------------------------------------------------

@app.route("/projets")
def get_projets():
    # Génère les miniatures manquantes pour les vidéos du projet en cours
    for v in projet_actuel["videos"]:
        if not os.path.isfile(chemin_miniature(v["chemin"])) and os.path.isfile(v["chemin"]):
            tmp = VideoLoader()
            if tmp.charger_video(v["chemin"]):
                generer_miniature(v["chemin"], tmp)
            tmp.capture.release()
    return jsonify(projet_actuel)


@app.route("/projets/thumbnail/<nom>")
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


@app.route("/projets/supprimer-video", methods=["POST"])
def supprimer_video_projet():
    data = request.get_json(silent=True) or {}
    nom = data.get("nom", "")
    if not nom:
        return jsonify({"erreur": "champ 'nom' manquant"}), 400
    projet_actuel["videos"] = [v for v in projet_actuel["videos"] if v["nom"] != nom]
    return jsonify({"ok": True}), 200


@app.route("/projets/supprimer-export", methods=["POST"])
def supprimer_export_projet():
    data = request.get_json(silent=True) or {}
    nom_video     = data.get("nom_video", "")
    chemin_export = data.get("chemin_export", "")
    if not nom_video or not chemin_export:
        return jsonify({"erreur": "champs requis manquants"}), 400

    # Supprimer le fichier JSON du disque
    if os.path.isfile(chemin_export):
        try:
            os.remove(chemin_export)
        except Exception as e:
            return jsonify({"erreur": f"impossible de supprimer le fichier : {e}"}), 500

    # Retirer l'entrée en mémoire
    for v in projet_actuel["videos"]:
        if v["nom"] == nom_video:
            v["exports"] = [e for e in v.get("exports", []) if e.get("fichier") != chemin_export]
            break
    return jsonify({"ok": True}), 200



@app.route("/projets/fermer", methods=["POST"])
def fermer_projet():
    projet_actuel["dossier"] = None
    projet_actuel["videos"]  = []
    return jsonify({"ok": True}), 200


@app.route("/projets/choisir-dossier")
def choisir_dossier():
    """Ouvre la boîte de dialogue native pour choisir un dossier.
    Si tkinter n'est pas disponible, retourne no_tkinter pour que
    le navigateur propose une saisie manuelle à la place."""
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


@app.route("/projets/scanner-dossier", methods=["POST"])
def scanner_dossier():
    data = request.get_json(silent=True) or {}
    chemin_dossier = data.get("chemin", "").strip()

    if not chemin_dossier:
        return jsonify({"erreur": "champ 'chemin' manquant"}), 400
    if not os.path.isdir(chemin_dossier):
        return jsonify({"erreur": f"dossier introuvable : {chemin_dossier}"}), 404

    try:
        fichiers = os.listdir(chemin_dossier)
    except PermissionError:
        return jsonify({"erreur": "accès refusé au dossier"}), 403

    # Séparer vidéos, audios et exports JSON
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

    # Nouveau dossier = nouveau projet : on repart de zéro
    nouvelles_videos = []

    for nom_video, chemin_video in videos_trouvees:
        nom_base = os.path.splitext(nom_video)[0]

        # Chercher les exports qui correspondent à cette vidéo
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
                bpm        = round(len(anns) / (duree_clip / 60), 1) if duree_clip > 0 else None
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

        # Charger les métadonnées de la vidéo
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

    # Scan des fichiers audio
    nouvelles_audios = []
    for nom_audio, chemin_audio in audios_trouvees:
        nom_base = os.path.splitext(nom_audio)[0]

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

        # Ne pas bloquer le scan sur la durée : on l'inclut même si inconnue
        nouvelles_audios.append({
            "nom":       nom_audio,
            "chemin":    chemin_audio,
            "duree_sec": None,   # sera rempli en async par /audio/durees
            "exports":   exports_audio,
        })

    # Remplace complètement le projet en cours (en mémoire)
    projet_actuel["dossier"] = chemin_dossier
    projet_actuel["videos"]  = nouvelles_videos
    projet_actuel["audios"]  = nouvelles_audios
    return jsonify({
        "ok":           True,
        "dossier":      chemin_dossier,
        "total":        len(nouvelles_videos),
        "total_audios": len(nouvelles_audios),
    }), 200


# ---------------------------------------------------------------------------
# Vidéo
# ---------------------------------------------------------------------------


@app.route("/video/charger", methods=["POST"])
def charger_video():
    data = request.get_json(silent=True) or {}
    chemin = data.get("chemin", "").strip()
    if not chemin:
        return jsonify({"erreur": "champ 'chemin' manquant"}), 400
    if not os.path.isfile(chemin):
        return jsonify({"erreur": f"fichier introuvable : {chemin}"}), 404

    global infos_video, nom_export_ouvert
    if not loader.charger_video(chemin):
        return jsonify({"erreur": "impossible d'ouvrir la vidéo"}), 422

    infos_video       = loader.get_infos()
    nom_export_ouvert = ""
    gestionnaire.vider()
    generer_miniature(chemin, loader)
    return jsonify(infos_video), 200


@app.route("/video/stream")
def stream_video():
    if not infos_video:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404
    return send_file(infos_video["chemin"], conditional=True)


@app.route("/video/infos")
def get_infos():
    if not infos_video:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404
    resp = jsonify({**infos_video, "nom_export": nom_export_ouvert})
    resp.headers["Cache-Control"] = "no-cache, no-store"
    return resp, 200


# ---------------------------------------------------------------------------
# Audio — annotateur musical
# ---------------------------------------------------------------------------

@app.route("/audio-annoter")
def audio_annotateur():
    return render_template("audio.html")


@app.route("/audio/charger", methods=["POST"])
def charger_audio():
    data   = request.get_json(silent=True) or {}
    chemin = data.get("chemin", "").strip()
    if not chemin:
        return jsonify({"erreur": "champ 'chemin' manquant"}), 400
    if not os.path.isfile(chemin):
        return jsonify({"erreur": f"fichier introuvable : {chemin}"}), 404

    global infos_audio, nom_export_audio_ouvert
    duree = get_audio_duration(chemin)
    if duree is None:
        return jsonify({"erreur": "impossible de lire le fichier audio"}), 422

    infos_audio = {
        "chemin":    chemin,
        "nom":       os.path.basename(chemin),
        "duree_sec": round(duree, 3),
    }
    gestionnaire_beats.vider()
    nom_export_audio_ouvert = ""
    return jsonify(infos_audio), 200


@app.route("/audio/infos")
def get_infos_audio():
    if not infos_audio:
        return jsonify({"erreur": "aucun fichier audio chargé"}), 404
    return jsonify({**infos_audio, "nom_export": nom_export_audio_ouvert}), 200


@app.route("/audio/durees", methods=["POST"])
def get_durees_batch():
    """Calcule la durée de plusieurs fichiers audio en une requête (appelé en async depuis l'accueil)."""
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


@app.route("/audio/stream")
def stream_audio():
    if not infos_audio:
        return jsonify({"erreur": "aucun fichier audio chargé"}), 404
    return send_file(infos_audio["chemin"], conditional=True)


@app.route("/audio/beats", methods=["GET"])
def lister_beats():
    resp = jsonify({"beats": gestionnaire_beats.beats})
    resp.headers["Cache-Control"] = "no-cache, no-store"
    return resp, 200


@app.route("/audio/beats", methods=["POST"])
def ajouter_beat():
    if not infos_audio:
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


@app.route("/audio/beats/<int:temps_ms>", methods=["DELETE", "PATCH"])
def gerer_beat(temps_ms):
    if request.method == "DELETE":
        gestionnaire_beats.supprimer(temps_ms)
        return jsonify({"ok": True}), 200

    # PATCH — modifier l'étiquette
    data = request.get_json(silent=True) or {}
    b = gestionnaire_beats.modifier_etiquette(temps_ms, data.get("etiquette", ""))
    if b:
        return jsonify({"ok": True, "beat": b}), 200
    return jsonify({"erreur": f"aucun beat à {temps_ms} ms"}), 404


@app.route("/audio/beats", methods=["DELETE"])
def vider_beats():
    gestionnaire_beats.vider()
    return jsonify({"message": "beats effacés"}), 200


@app.route("/audio/beats/lot", methods=["POST"])
def ajouter_beats_lot():
    data      = request.get_json(silent=True) or {}
    debut_ms  = int(data.get("debut_ms",  0))
    fin_ms    = int(data.get("fin_ms",    0))
    nb        = int(data.get("nb",        2))
    etiquette = str(data.get("etiquette", "")).strip()

    if nb < 2:
        return jsonify({"erreur": "il faut au moins 2 beats"}), 400
    if fin_ms <= debut_ms:
        return jsonify({"erreur": "fin_ms doit être > debut_ms"}), 400

    ajoutes = gestionnaire_beats.ajouter_lot(debut_ms, fin_ms, nb, etiquette)
    return jsonify({"beats": gestionnaire_beats.beats, "ajoutes": ajoutes}), 201


@app.route("/audio/beats/completer", methods=["POST"])
def completer_beats():
    if not infos_audio:
        return jsonify({"erreur": "aucun fichier audio chargé"}), 404
    if len(gestionnaire_beats.beats) < 2:
        return jsonify({"erreur": "il faut au moins 2 beats pour calculer l'intervalle"}), 400

    duree_ms          = round(infos_audio["duree_sec"] * 1000)
    ajoutes, step     = gestionnaire_beats.completer(duree_ms)
    return jsonify({"beats": gestionnaire_beats.beats, "ajoutes": ajoutes, "intervalle_ms": step}), 201


@app.route("/audio/beats/detecter", methods=["POST"])
def detecter_beats():
    if not infos_audio:
        return jsonify({"erreur": "aucun fichier audio chargé"}), 404
    try:
        y, sr          = librosa.load(infos_audio["chemin"], sr=None, mono=True)
        _, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times     = librosa.frames_to_time(beat_frames, sr=sr)

        gestionnaire_beats.vider()
        for t in beat_times:
            gestionnaire_beats.beats.append(construire_beat(round(float(t) * 1000)))
        gestionnaire_beats._trier()
        return jsonify({"beats": gestionnaire_beats.beats, "total": len(gestionnaire_beats.beats)}), 200
    except Exception as e:
        return jsonify({"erreur": str(e)}), 500


@app.route("/audio/beats/exporter", methods=["POST"])
def exporter_beats():
    if not infos_audio:
        return jsonify({"erreur": "aucun fichier audio chargé"}), 404
    if not gestionnaire_beats.beats:
        return jsonify({"erreur": "aucun beat à exporter"}), 400

    data          = request.get_json(silent=True) or {}
    nom           = str(data.get("nom", "")).strip()
    nom_audio     = os.path.basename(infos_audio["chemin"])
    nom_base      = os.path.splitext(nom_audio)[0]
    horodatage    = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    nom_fichier   = f"{nom_base}_beats_{horodatage}.json"
    chemin_export = os.path.join(os.path.dirname(infos_audio["chemin"]), nom_fichier)

    contenu = {
        "audio":          nom_audio,
        "nom":            nom or None,
        "duree_secondes": infos_audio["duree_sec"],
        "beats":          gestionnaire_beats.beats,
    }
    with open(chemin_export, "w", encoding="utf-8") as fh:
        json.dump(contenu, fh, ensure_ascii=False, indent=2)

    global nom_export_audio_ouvert
    nom_export_audio_ouvert = nom

    beats = gestionnaire_beats.beats
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

    return jsonify({"ok": True, "fichier": nom_fichier}), 200


# ---------------------------------------------------------------------------
# Audio — son de clic (existant)
# ---------------------------------------------------------------------------

@app.route("/audio/click")
def get_click_sound():
    sr = 22050
    click = librosa.clicks(times=[0.0], sr=sr, hop_length=512, length=int(sr * 0.08))
    samples = (np.clip(click, -1.0, 1.0) * 32767).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(samples.tobytes())
    buf.seek(0)

    resp = send_file(buf, mimetype="audio/wav")
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


# ---------------------------------------------------------------------------
# Frames
# ---------------------------------------------------------------------------

@app.route("/frames/<int:numero>")
def get_frame(numero):
    if not infos_video:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404

    nb = infos_video["nb_frames"]
    if not (0 <= numero < nb):
        return jsonify({"erreur": f"frame {numero} hors limites (0–{nb - 1})"}), 400

    max_width = 400 if request.args.get("size") == "thumb" else 1280
    data = loader.get_frame(numero, max_width=max_width)
    if data is None:
        return jsonify({"erreur": "impossible de lire la frame"}), 500

    resp = send_file(io.BytesIO(data), mimetype="image/jpeg")
    resp.headers["Cache-Control"] = "public, max-age=86400"
    return resp


# ---------------------------------------------------------------------------
# Annotations
# ---------------------------------------------------------------------------

@app.route("/annotations", methods=["GET"])
def lister_annotations():
    items = []
    for a in gestionnaire.annotations:
        items.append({
            "frame": a["frame"],
            "temps_secondes": a["temps_secondes"],
            "timecode": formater_timecode(a["temps_secondes"]),
            "etiquette": a["etiquette"],
        })
    resp = jsonify({"items": items, "pas": gestionnaire.get_pas()})
    resp.headers["Cache-Control"] = "no-cache, no-store"
    return resp, 200


@app.route("/annotations", methods=["POST"])
def ajouter_annotation():
    if not infos_video:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404

    data = request.get_json(silent=True) or {}
    if "frame" not in data:
        return jsonify({"erreur": "champ 'frame' manquant"}), 400

    frame = int(data["frame"])
    nb = infos_video["nb_frames"]
    if not (0 <= frame < nb):
        return jsonify({"erreur": f"frame {frame} hors limites (0–{nb - 1})"}), 400

    fps = infos_video["fps"] or 25.0
    temps = round(frame / fps, 3)
    etiquette = str(data.get("etiquette", "")).strip()

    ann = gestionnaire.ajouter(frame, temps, etiquette)
    return jsonify({
        "frame": ann["frame"],
        "temps_secondes": ann["temps_secondes"],
        "timecode": formater_timecode(ann["temps_secondes"]),
        "etiquette": ann["etiquette"],
    }), 201


@app.route("/annotations/lot", methods=["POST"])
def annoter_en_lot():
    if not infos_video:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404

    data = request.get_json(silent=True) or {}
    try:
        debut_raw = float(data["debut"])
        fin_raw = float(data["fin"])
        nombre = int(data["nombre"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"erreur": "champs 'debut', 'fin', 'nombre' requis"}), 400

    if nombre < 1:
        return jsonify({"erreur": "'nombre' doit être >= 1"}), 400

    fps = infos_video["fps"] or 25.0
    nb = infos_video["nb_frames"]
    mode = data.get("mode", "frame")

    if mode == "secondes":
        debut_frame = round(debut_raw * fps)
        fin_frame = round(fin_raw * fps)
    else:
        debut_frame = round(debut_raw)
        fin_frame = round(fin_raw)

    debut_frame = max(0, min(nb - 1, debut_frame))
    fin_frame = max(0, min(nb - 1, fin_frame))

    if nombre == 1:
        frames_liste = [debut_frame]
    else:
        frames_liste = []
        for i in range(nombre):
            f = round(debut_frame + i * (fin_frame - debut_frame) / (nombre - 1))
            frames_liste.append(f)

    # on déduplique et on garde dans l'ordre
    frames_liste = sorted(set(max(0, min(nb - 1, f)) for f in frames_liste))
    etiquette = str(data.get("etiquette", "")).strip()

    creees = []
    for frame in frames_liste:
        temps = round(frame / fps, 3)
        ann = gestionnaire.ajouter(frame, temps, etiquette)
        creees.append({
            "frame": ann["frame"],
            "temps_secondes": ann["temps_secondes"],
            "timecode": formater_timecode(ann["temps_secondes"]),
            "etiquette": ann["etiquette"],
        })

    return jsonify({
        "creees": len(creees),
        "items": creees,
        "pas": gestionnaire.get_pas(),
    }), 201


@app.route("/annotations/lisser", methods=["POST"])
def lisser_annotations():
    if not infos_video:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404

    data = request.get_json(silent=True) or {}
    try:
        debut = int(data["debut"])
        fin   = int(data["fin"])
    except (KeyError, ValueError, TypeError):
        return jsonify({"erreur": "champs 'debut' et 'fin' requis"}), 400

    largeur = int(data.get("largeur", 1))
    largeur = max(1, min(3, largeur))  # clamp entre 1 et 3

    if debut >= fin:
        return jsonify({"erreur": "'debut' doit être inférieur à 'fin'"}), 400

    dans_range = sorted(
        [a for a in gestionnaire.annotations if debut <= a["frame"] <= fin],
        key=lambda a: a["frame"]
    )

    if len(dans_range) < 3:
        return jsonify({"erreur": "Il faut au moins 3 annotations dans la plage pour lisser"}), 400

    fps = infos_video.get("fps", 25.0) or 25.0
    nb  = infos_video.get("nb_frames", 0)
    n   = len(dans_range)

    etiquettes = [a["etiquette"] for a in dans_range]
    frames_orig = [a["frame"] for a in dans_range]

    # Lissage gaussien : w[j] = exp(-j² / 2), les extrêmes restent fixes
    import math
    def gauss(j):
        return math.exp(-(j * j) / 2.0)

    frames_lisses = list(frames_orig)
    for i in range(1, n - 1):
        total_w = 0.0
        total_f = 0.0
        for j in range(-largeur, largeur + 1):
            k = i + j
            if 0 <= k < n:
                w = gauss(j)
                total_w += w
                total_f += w * frames_orig[k]
        frames_lisses[i] = round(total_f / total_w)
        frames_lisses[i] = max(0, min(nb - 1, frames_lisses[i]))

    for a in dans_range:
        gestionnaire.supprimer(a["frame"])

    nouvelles = []
    frames_vus = set()
    for i in range(n):
        new_frame = frames_lisses[i]
        if new_frame in frames_vus:
            continue
        frames_vus.add(new_frame)
        temps = round(new_frame / fps, 3)
        ann = gestionnaire.ajouter(new_frame, temps, etiquettes[i])
        nouvelles.append({
            "frame": ann["frame"],
            "temps_secondes": ann["temps_secondes"],
            "timecode": formater_timecode(ann["temps_secondes"]),
            "etiquette": ann["etiquette"],
        })

    return jsonify({
        "lissees": len(nouvelles),
        "items": nouvelles,
        "pas": gestionnaire.get_pas(),
    }), 200


@app.route("/annotations/<int:frame>", methods=["DELETE"])
def supprimer_annotation(frame):
    if not gestionnaire.frame_annotee(frame):
        return jsonify({"erreur": f"aucune annotation sur la frame {frame}"}), 404
    gestionnaire.supprimer(frame)
    return jsonify({"supprimee": frame}), 200


@app.route("/annotations", methods=["DELETE"])
def vider_annotations():
    gestionnaire.vider()
    return jsonify({"message": "annotations effacées"}), 200


@app.route("/annotations/exporter", methods=["POST"])
def exporter_annotations():
    if not infos_video:
        return jsonify({"erreur": "aucune vidéo chargée"}), 404
    if not gestionnaire.annotations:
        return jsonify({"erreur": "aucune annotation à exporter"}), 404

    data              = request.get_json(silent=True) or {}
    nom_export        = str(data.get("nom", "")).strip()
    forcer_ecrasement = data.get("forcer_ecrasement", False)

    nom_video = os.path.basename(infos_video["chemin"])

    # Chercher un export existant portant le même nom (uniquement si nom non vide)
    export_existant = None
    if nom_export:
        for v in projet_actuel["videos"]:
            if v["nom"] == nom_video:
                for e in v.get("exports", []):
                    if e.get("nom") == nom_export:
                        export_existant = e
                        break
                break

    # Conflit détecté et non confirmé → demander confirmation côté client
    if export_existant and not forcer_ecrasement:
        return jsonify({"conflit": True, "nom": nom_export}), 200

    # Déterminer le fichier de destination
    if export_existant:
        # Écraser le fichier existant (même chemin, même nom de fichier)
        chemin_export = export_existant["fichier"]
        nom_fichier   = os.path.basename(chemin_export)
    else:
        nom_base      = os.path.splitext(nom_video)[0]
        horodatage    = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        nom_fichier   = f"{nom_base}_export_{horodatage}.json"
        dossier_video = os.path.dirname(infos_video["chemin"])
        chemin_export = os.path.join(dossier_video, nom_fichier)

    contenu = exporter_json(
        gestionnaire.annotations,
        infos_video["chemin"],
        infos_video["fps"],
        infos_video["nb_frames"],
        nom=nom_export,
    )

    with open(chemin_export, "wb") as fh:
        fh.write(contenu)

    # Mettre à jour les métadonnées en mémoire
    anns       = gestionnaire.annotations
    t_debut    = anns[0]["temps_secondes"]
    t_fin      = anns[-1]["temps_secondes"]
    duree_clip = round(t_fin - t_debut, 3)
    bpm        = round(len(anns) / (duree_clip / 60), 1) if duree_clip > 0 else None
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
                # Remplacer l'entrée existante
                for i, e in enumerate(exports):
                    if e.get("fichier") == chemin_export:
                        exports[i] = export_info
                        break
            else:
                exports.insert(0, export_info)
            break

    return jsonify({"ok": True, "fichier": nom_fichier}), 200


@app.route("/audio/restaurer", methods=["POST"])
def restaurer_beats():
    try:
        data          = request.get_json(silent=True) or {}
        chemin_audio  = data.get("chemin_audio",  "")
        chemin_export = data.get("chemin_export", "")

        if not os.path.isfile(chemin_audio):
            return jsonify({"erreur": f"fichier audio introuvable : {chemin_audio}"}), 404
        if not os.path.isfile(chemin_export):
            return jsonify({"erreur": f"fichier export introuvable : {chemin_export}"}), 404

        global infos_audio, nom_export_audio_ouvert
        duree = get_audio_duration(chemin_audio)
        if duree is None:
            return jsonify({"erreur": "impossible de lire la durée du fichier audio"}), 422

        infos_audio = {
            "chemin":    chemin_audio,
            "nom":       os.path.basename(chemin_audio),
            "duree_sec": round(duree, 3),
        }

        with open(chemin_export, "r", encoding="utf-8") as fh:
            donnees = json.load(fh)

        gestionnaire_beats.charger_depuis_json(donnees.get("beats", []))
        nom_export_audio_ouvert = donnees.get("nom") or ""
        return jsonify({"ok": True, "importes": len(gestionnaire_beats.beats)}), 200

    except Exception as e:
        return jsonify({"erreur": str(e)}), 500


@app.route("/projets/restaurer", methods=["POST"])
def restaurer_export():
    data = request.get_json(silent=True) or {}
    chemin_video  = data.get("chemin_video", "")
    chemin_export = data.get("chemin_export", "")

    if not os.path.isfile(chemin_video):
        return jsonify({"erreur": "vidéo introuvable"}), 404
    if not os.path.isfile(chemin_export):
        return jsonify({"erreur": "fichier export introuvable"}), 404

    global infos_video, nom_export_ouvert
    if not loader.charger_video(chemin_video):
        return jsonify({"erreur": "impossible d'ouvrir la vidéo"}), 422
    infos_video = loader.get_infos()

    with open(chemin_export, "r", encoding="utf-8") as fh:
        try:
            donnees = json.load(fh)
        except Exception as e:
            return jsonify({"erreur": f"JSON invalide : {e}"}), 422

    gestionnaire.charger_depuis_json(donnees.get("annotations", []))

    # Pré-remplit le nom dans l'annotateur
    nom_export_ouvert = donnees.get("nom") or ""
    return jsonify({"ok": True, "importees": len(gestionnaire.annotations)}), 200



@app.route("/annotations/importer", methods=["POST"])
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


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True, use_reloader=False, threaded=True, port=5000)
