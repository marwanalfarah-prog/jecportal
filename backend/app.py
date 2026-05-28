import os

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS

from core import state as S
from core.routes_auth import register_auth_routes
from core.routes_org_tree import register_org_tree_routes
from core.routes_people import register_person_routes
from core.routes_promotions import register_promotions_routes
from core.routes_questionnaires_notifications import register_questionnaires_notifications_routes
from core.routes_config import register_config_routes
from core.routes_youth_groups import register_youth_group_routes
from core.routes_parishes import register_churches_routes
from core.routes_bible_reader import register_bible_reader_routes
from core.routes_registration import register_registration_routes
from core.routes_requests import register_requests_routes


app = Flask(__name__)
app.secret_key = S._get_or_create_secret_key()
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = False
app.config["SESSION_COOKIE_HTTPONLY"] = True
CORS(app, supports_credentials=True, origins=["http://localhost:5173", "http://127.0.0.1:5173"])

S.init_state()

register_person_routes(app)
register_org_tree_routes(app)
register_auth_routes(app)
register_promotions_routes(app)
register_questionnaires_notifications_routes(app)
register_config_routes(app)
register_youth_group_routes(app)
register_churches_routes(app)
register_bible_reader_routes(app)
register_registration_routes(app)
register_requests_routes(app)


@app.get("/api/logo")
def get_logo():
    logos_dir = os.path.join(S.PHOTOS_ROOT_DIR, "logos")
    logo_name = "JECJordanLogo.png"
    return send_from_directory(logos_dir, logo_name)


@app.get("/api/logo/lpj")
def get_lpj_logo():
    logos_dir = os.path.join(S.PHOTOS_ROOT_DIR, "logos")
    logo_name = "LPJLogo.png"
    return send_from_directory(logos_dir, logo_name)


_DIST_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    # Never intercept API routes — let Flask return its own 404 for unknown API paths
    if path.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    if path and os.path.exists(os.path.join(_DIST_DIR, path)):
        return send_from_directory(_DIST_DIR, path)
    return send_from_directory(_DIST_DIR, "index.html")


if __name__ == "__main__":
    app.run(debug=True, port=5000, use_reloader=False)
