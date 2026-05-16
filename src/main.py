import os

from flask import Flask

from routes_projets import bp_projets
from routes_video   import bp_video
from routes_audio   import bp_audio
from routes_sync    import bp_sync

# Dossier racine du projet (un cran au-dessus de src/)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

app = Flask(
    __name__,
    static_folder=os.path.join(BASE_DIR, "static"),
    template_folder=os.path.join(BASE_DIR, "templates"),
)

# Enregistrement des blueprints
app.register_blueprint(bp_projets)
app.register_blueprint(bp_video)
app.register_blueprint(bp_audio)
app.register_blueprint(bp_sync)

if __name__ == "__main__":
    app.run(debug=True, use_reloader=False, threaded=True, port=5000)
