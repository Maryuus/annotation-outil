import threading
import cv2


class VideoLoader:
    def __init__(self):
        self.capture = None
        self.chemin = ""
        self._lock = threading.Lock()

    def charger_video(self, chemin):
        # Le verrou protège aussi le chargement : évite qu'un get_frame()
        # s'exécute sur une capture en cours de remplacement.
        with self._lock:
            if self.capture:
                self.capture.release()
            self.capture = cv2.VideoCapture(chemin)
            self.chemin = chemin
            return self.capture.isOpened()

    def get_infos(self):
        with self._lock:
            fps = self.capture.get(cv2.CAP_PROP_FPS)
            nb_frames = int(self.capture.get(cv2.CAP_PROP_FRAME_COUNT))
            duree = round(nb_frames / fps, 3) if fps > 0 else 0
            return {
                "fps": fps,
                "nb_frames": nb_frames,
                "duree_sec": duree,
                "largeur": int(self.capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
                "hauteur": int(self.capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                "chemin": self.chemin,
            }

    def get_frame(self, numero, max_width=None):
        with self._lock:
            self.capture.set(cv2.CAP_PROP_POS_FRAMES, numero)
            ok, image = self.capture.read()
            if not ok:
                return None
            if max_width is not None:
                h, w = image.shape[:2]
                if w > max_width:
                    nouveau_h = int(h * max_width / w)
                    image = cv2.resize(image, (max_width, nouveau_h))
            ok, buffer = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 82])
            if ok:
                return buffer.tobytes()
            return None
