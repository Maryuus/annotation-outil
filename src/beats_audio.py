

import wave


# Utilitaire — durée audio (lecture d'en-tête uniquement, sans décoder)


def get_audio_duration(chemin):
    """Retourne la durée en secondes sans charger le signal audio."""
    # soundfile — ultra-rapide pour WAV, FLAC, OGG…
    try:
        import soundfile as sf
        return sf.info(chemin).duration
    except Exception:
        pass
    # audioread — ultra-rapide via ffmpeg/avconv pour MP3, AAC, M4A…
    try:
        import audioread
        with audioread.audio_open(chemin) as f:
            return f.duration
    except Exception:
        pass
    # librosa.get_duration — lit les métadonnées sans décoder
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
    # stdlib wave — fallback WAV simple
    try:
        with wave.open(chemin, 'rb') as w:
            return w.getnframes() / w.getframerate()
    except Exception:
        pass
    # NE PAS utiliser librosa.load() ici : charge tout le fichier en RAM
    return None



# Utilitaire — construction d'un beat normalisé

def construire_beat(temps_ms, etiquette=''):
    """Crée un dict beat avec les trois champs attendus par le front-end."""
    temps_ms = int(temps_ms)
    return {
        "temps_ms":       temps_ms,
        "temps_secondes": round(temps_ms / 1000, 3),
        "etiquette":      str(etiquette).strip(),
    }



# Gestionnaire de beats (classe, miroir de GestionnaireAnnotations)

class GestionnaireBeat:
    """Gère la liste des beats d'une piste audio en mémoire."""

    def __init__(self):
        self.beats = []

    # Opérations de base

    def ajouter(self, temps_ms, etiquette=''):
        """
        Ajoute un beat ou le supprime s'il existe déjà au même temps (toggle).
        Retourne (beat, action) avec action = 'ajoute' | 'supprime'.
        """
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
        """Supprime le beat à ce temps exact (sans toggle)."""
        self.beats = [b for b in self.beats if b["temps_ms"] != temps_ms]

    def modifier_etiquette(self, temps_ms, etiquette):
        """Met à jour l'étiquette d'un beat existant. Retourne le beat ou None."""
        for b in self.beats:
            if b["temps_ms"] == temps_ms:
                b["etiquette"] = str(etiquette).strip()
                return b
        return None

    def vider(self):
        """Supprime tous les beats."""
        self.beats.clear()

    # -- Opérations en lot 

    def ajouter_lot(self, debut_ms, fin_ms, nb, etiquette=''):
        """
        Ajoute `nb` beats équidistants entre debut_ms et fin_ms.
        Retourne le nombre de beats réellement ajoutés.
        """
        if nb < 2 or fin_ms <= debut_ms:
            return 0
        step = (fin_ms - debut_ms) / (nb - 1)
        ajoutes = 0
        for i in range(nb):
            t_ms = round(debut_ms + i * step)
            if not any(b["temps_ms"] == t_ms for b in self.beats):
                self.beats.append(construire_beat(t_ms, etiquette))
                ajoutes += 1
        self._trier()
        return ajoutes

    def completer(self, duree_ms):
        """
        Extrapole les beats jusqu'à la fin de la piste en utilisant
        l'intervalle moyen des beats existants.
        Retourne (nb_ajoutes, intervalle_ms).
        """
        if len(self.beats) < 2:
            return 0, 0
        intervals = [
            self.beats[i]["temps_ms"] - self.beats[i - 1]["temps_ms"]
            for i in range(1, len(self.beats))
        ]
        step = round(sum(intervals) / len(intervals))
        dernier = self.beats[-1]["temps_ms"]
        ajoutes = 0
        t_ms = dernier + step
        while t_ms <= duree_ms:
            if not any(b["temps_ms"] == t_ms for b in self.beats):
                self.beats.append(construire_beat(t_ms))
                ajoutes += 1
            t_ms += step
        self._trier()
        return ajoutes, step

    def charger_depuis_json(self, liste):
        """Remplace les beats par ceux lus depuis un export JSON."""
        self.beats.clear()
        for b in liste:
            self.beats.append(construire_beat(
                b.get("temps_ms", 0),
                b.get("etiquette", ""),
            ))
        self._trier()

    # -- Métriques 

    def get_bpm(self):
        """BPM moyen calculé depuis les intervalles. Retourne None si < 2 beats."""
        if len(self.beats) < 2:
            return None
        intervals = [
            self.beats[i]["temps_ms"] - self.beats[i - 1]["temps_ms"]
            for i in range(1, len(self.beats))
        ]
        avg = sum(intervals) / len(intervals)
        return round(60000 / avg, 1) if avg > 0 else None

    # -- Interne 

    def _trier(self):
        self.beats.sort(key=lambda b: b["temps_ms"])
