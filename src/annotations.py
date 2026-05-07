class GestionnaireAnnotations:
    def __init__(self):
        self.annotations = []

    def ajouter(self, frame, temps, etiquette):
        # si la frame est déjà annotée, on met à jour l'étiquette
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
        for ann in self.annotations:
            if ann["frame"] == frame:
                return True
        return False

    def get_pas(self):
        # écart entre les deux dernières annotations pour suggérer un pas
        if len(self.annotations) < 2:
            return 10
        return self.annotations[-1]["frame"] - self.annotations[-2]["frame"]
