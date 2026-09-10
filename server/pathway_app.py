"""Serves the PA-thway student app.

The app is a small set of plain files in server/pathway/ — no build step, no
bundler. Mounting it on its own route leaves the existing React client at `/`
untouched.

    /app        redirects to /app/
    /app/       the student app
    /api/hub/*  the shared Student Hub (see hub.py)

The redirect matters: the app's files reference each other relatively
("./support.js"), which only resolves correctly when the page's own URL ends in
a slash. Served at "/app" those would resolve against "/" and 404.
"""

from pathlib import Path

from flask import Blueprint, redirect, send_from_directory

APP_DIR = Path(__file__).resolve().parent / "pathway"

pathway = Blueprint("pathway", __name__)


@pathway.get("/app")
def student_app_redirect():
    return redirect("/app/", code=302)


@pathway.get("/app/")
def student_app():
    return send_from_directory(str(APP_DIR), "index.html")


@pathway.get("/app/<path:filename>")
def student_asset(filename):
    return send_from_directory(str(APP_DIR), filename)


def register_pathway(app):
    app.register_blueprint(pathway)
    return app
