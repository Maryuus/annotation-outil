import json
import os


def exporter_json(annotations, chemin_video, fps, nb_frames, nom=None):
    contenu = {
        "video": os.path.basename(chemin_video),
        "fps": fps,
        "duree_secondes": round(nb_frames / fps, 3),
        "nom": nom or None,
        "annotations": []
    }
    for a in sorted(annotations, key=lambda x: x["frame"]):
        contenu["annotations"].append({
            "frame": a["frame"],
            "temps_secondes": a["temps_secondes"],
            "etiquette": a["etiquette"],
        })
    return json.dumps(contenu, ensure_ascii=False, indent=2).encode("utf-8")
