import os
import re

# Extensions de fichiers reconnues par le scanner de dossier
VIDEO_EXTENSIONS = {'.mp4', '.avi', '.mov', '.mkv', '.wmv', '.flv', '.webm', '.m4v'}
AUDIO_EXTENSIONS = {'.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma', '.opus'}

# Patterns pour reconnaître les exports JSON dans un dossier
PATTERN_EXPORT = re.compile(r'^(.+)_export_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.json$')
PATTERN_BEATS  = re.compile(r'^(.+)_beats_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.json$')


def formater_timecode(temps):
    # Convertit des secondes en chaîne "MM:SS.ss"
    minutes  = int(temps // 60)
    secondes = temps % 60
    return f"{minutes:02d}:{secondes:05.2f}"


def chemin_miniature(chemin_video):
    # Retourne le chemin du fichier miniature associé à une vidéo (fichier caché)
    dossier  = os.path.dirname(chemin_video)
    nom_base = os.path.splitext(os.path.basename(chemin_video))[0]
    return os.path.join(dossier, "." + nom_base + "_thumb.jpg")


def generer_miniature(chemin, video_loader):
    # Sauvegarde la première frame de la vidéo en JPEG si elle n'existe pas déjà
    thumb_path = chemin_miniature(chemin)
    if os.path.isfile(thumb_path):
        return
    data = video_loader.get_frame(0, max_width=320)
    if data:
        with open(thumb_path, "wb") as fh:
            fh.write(data)
