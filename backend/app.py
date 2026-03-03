import os

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS

from core import state as S
from core.routes_auth import register_auth_routes
from core.routes_org_tree import register_org_tree_routes
from core.routes_promotions import register_promotions_routes
from core.routes_questionnaires_notifications import register_questionnaires_notifications_routes
from core.routes_registered import register_registered_routes
from core.routes_unregistered import register_unregistered_routes


app = Flask(__name__)
app.secret_key = S._get_or_create_secret_key()
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = False
app.config["SESSION_COOKIE_HTTPONLY"] = True
CORS(app, supports_credentials=True, origins=["http://localhost:5173", "http://127.0.0.1:5173"])

S.init_state()

register_registered_routes(app)
register_org_tree_routes(app)
register_unregistered_routes(app)
register_auth_routes(app)
register_promotions_routes(app)
register_questionnaires_notifications_routes(app)


@app.get("/api/logo")
def get_logo():
    logos_dir = os.path.join(S.PHOTOS_ROOT_DIR, "logos")
    logo_name = "JECJordanLogo.png"
    logo_path = os.path.join(logos_dir, logo_name)
    if not os.path.exists(logo_path):
        return jsonify({"error": "logo not found"}), 404
    return send_from_directory(logos_dir, logo_name)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
