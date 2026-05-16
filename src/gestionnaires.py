# Classes qui gèrent les annotations vidéo et les beats audio en mémoire.
# GestionnaireAnnotations et GestionnaireBeat partagent la même interface de base.

import json
import os
import wave


# Classe de base commune

class GestionnaireBase:
    """Interface commune aux deux gestionnaires (annotations et beats)."""

    def vider(self):
        raise NotImplementedError

    def charger_depuis_json(self, liste):
        raise NotImplementedError


# Annotations vidéo

class GestionnaireAnnotations(GestionnaireBase):
    # Gère la liste des annotations d'une vidéo en mémoire

    def __init__(self):
        self.annotations = []

    def ajouter(self, frame, temps, etiquette):
        # Met à jour l'étiquette si la frame existe déjà, sinon crée une nouvelle annotation
        for ann in self.annotations:
            if ann["frame"] == frame:
                ann["etiquette"] = etiquette
                return ann
        ann = {"frame": frame, "temps_secondes": temps, "etiquette": etiquette}
        self.annotations.append(ann)
        self.annotations.sort(key=lambda a: a["frame"])
        return ann

    def supprimer(self, frame):
        self.annotations = [a for a in self.annotations if a["frame"] != frame]

    def vider(self):
        self.annotations = []

    def frame_annotee(self, frame):
        return any(a["frame"] == frame for a in self.annotations)

    def charger_depuis_json(self, liste):
        # Remplace les annotations par celles lues depuis un export JSON
        self.annotations.clear()
        for ann in liste:
            self.annotations.append({
                "frame":          int(ann["frame"]),
                "temps_secondes": float(ann.get("temps_secondes", ann.get("temps", 0))),
                "etiquette":      str(ann.get("etiquette", "")).strip(),
            })

    def get_pas(self):
        # Écart entre les deux dernières annotations (suggère un pas de navigation)
        if len(self.annotations) < 2:
            return 10
        return self.annotations[-1]["frame"] - self.annotations[-2]["frame"]

    def vers_json(self, chemin_video, fps, nb_frames, nom=None):
        # Sérialise les annotations en JSON prêt à écrire sur disque
        contenu = {
            "video":          os.path.basename(chemin_video),
            "fps":            fps,
            "duree_secondes": round(nb_frames / fps, 3),
            "nom":            nom or None,
            "annotations":    [],
        }
        for a in sorted(self.annotations, key=lambda x: x["frame"]):
            contenu["annotations"].append({
                "frame":          a["frame"],
                "temps_secondes": a["temps_secondes"],
                "etiquette":      a["etiquette"],
            })
        return json.dumps(contenu, ensure_ascii=False, indent=2).encode("utf-8")


# Beats audio

def construire_beat(temps_ms, etiquette=''):
    # Crée un dict beat normalisé avec les trois champs attendus par le front-end
    temps_ms = int(temps_ms)
    return {
        "temps_ms":       temps_ms,
        "temps_secondes": round(temps_ms / 1000, 3),
        "etiquette":      str(etiquette).strip(),
    }


class GestionnaireBeat(GestionnaireBase):
    # Gère la liste des beats d'une piste audio en mémoire

    def __init__(self):
        self.beats = []

    def ajouter(self, temps_ms, etiquette=''):
        # Toggle : ajoute le beat, ou le supprime s'il existe déjà au même temps
        for b in self.beats:
            if b["temps_ms"] == temps_ms:
                self.beats.remove(b)
                self._trier()
                return b, "supprime"
        b = construire_beat(temps_ms, etiquette)
        self.beats.append(b)
        self._trier()
        return b, "ajoute"

    def supprimer(self, temps_ms):
        self.beats = [b for b in self.beats if b["temps_ms"] != temps_ms]

    def modifier_etiquette(self, temps_ms, etiquette):
        for b in self.beats:
            if b["temps_ms"] == temps_ms:
                b["etiquette"] = str(etiquette).strip()
                return b
        return None

    def vider(self):
        self.beats.clear()

    def ajouter_lot(self, debut_ms, fin_ms, nb, etiquette=''):
        # Ajoute nb beats équidistants entre debut_ms et fin_ms
        if nb < 2 or fin_ms <= debut_ms:
            return 0
        step    = (fin_ms - debut_ms) / (nb - 1)
        ajoutes = 0
        for i in range(nb):
            t_ms = round(debut_ms + i * step)
            if not any(b["temps_ms"] == t_ms for b in self.beats):
                self.beats.append(construire_beat(t_ms, etiquette))
                ajoutes += 1
        self._trier()
        return ajoutes

    def completer(self, duree_ms):
        # Extrapole les beats jusqu'à la fin de la piste avec l'intervalle moyen
        if len(self.beats) < 2:
            return 0, 0
        intervals = [self.beats[i]["temps_ms"] - self.beats[i-1]["temps_ms"] for i in range(1, len(self.beats))]
        step    = round(sum(intervals) / len(intervals))
        dernier = self.beats[-1]["temps_ms"]
        ajoutes = 0
        t_ms    = dernier + step
        while t_ms <= duree_ms:
            if not any(b["temps_ms"] == t_ms for b in self.beats):
                self.beats.append(construire_beat(t_ms))
                ajoutes += 1
            t_ms += step
        self._trier()
        return ajoutes, step

    def charger_depuis_json(self, liste):
        self.beats.clear()
        for b in liste:
            self.beats.append(construire_beat(b.get("temps_ms", 0), b.get("etiquette", "")))
        self._trier()

    def get_bpm(self):
        # BPM moyen calculé depuis les intervalles entre beats
        if len(self.beats) < 2:
            return None
        intervals = [self.beats[i]["temps_ms"] - self.beats[i-1]["temps_ms"] for i in range(1, len(self.beats))]
        avg = sum(intervals) / len(intervals)
        return round(60000 / avg, 1) if avg > 0 else None

    def _trier(self):
        self.beats.sort(key=lambda b: b["temps_ms"])


# Durée audio

def get_audio_duration(chemin):
    # Retourne la durée en secondes sans charger tout le fichier audio en RAM.
    # Essaie plusieurs bibliothèques dans l'ordre du plus rapide au plus lent.
    try:
        import soundfile as sf
        return sf.info(chemin).duration
    except Exception:
        pass
    try:
        import audioread
        with audioread.audio_open(chemin) as f:
            return f.duration
    except Exception:
        pass
    try:
        import librosa
        return librosa.get_duration(path=chemin)
    except TypeError:
        pass
    try:
        import librosa
        return librosa.get_duration(filename=chemin)
    except Exception:
        pass
    try:
        with wave.open(chemin, 'rb') as w:
            return w.getnframes() / w.getframerate()
    except Exception:
        pass
    return None
