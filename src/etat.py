# État global de l'application, partagé entre tous les modules de routes.

from video_loader import VideoLoader
from gestionnaires import GestionnaireAnnotations, GestionnaireBeat

# Loader vidéo réutilisé pour toutes les requêtes de frames
loader = VideoLoader()

# Projet ouvert : dossier scanné + listes de vidéos et musiques
projet_actuel = {"dossier": None, "videos": [], "audios": []}

# Fichier vidéo actuellement chargé dans l'annotateur
video_courante = {"infos": {}, "nom_export": ""}

# Fichier audio actuellement chargé dans l'annotateur
audio_courant = {"infos": {}, "nom_export": ""}

# Gestionnaires d'annotations et de beats en mémoire
gestionnaire       = GestionnaireAnnotations()
gestionnaire_beats = GestionnaireBeat()
