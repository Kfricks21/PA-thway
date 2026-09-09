from pathlib import Path
import os

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent.parent
CLIENT_DIR = BASE_DIR / "client" / "dist"

app = Flask(__name__)


@app.get("/api/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "service": "ppt-quiz-generator",
            "client_build_exists": CLIENT_DIR.exists(),
        }
    )


@app.post("/api/generate")
def generate_quiz():
    uploaded_file = request.files.get("file")
    filename = uploaded_file.filename if uploaded_file and uploaded_file.filename else request.form.get("filename") or "presentation.pptx"
    question_count = request.form.get("questionCount", default=5, type=int)

    if question_count <= 0:
        question_count = 5

    questions = []
    for idx in range(1, question_count + 1):
        questions.append(
            {
                "id": idx,
                "type": "multiple-choice",
                "prompt": f"Sample question {idx}: What is the main idea of {filename}?",
                "options": [
                    "A concept from the presentation",
                    "An unrelated topic",
                    "A blank answer",
                    "A copied image label",
                ],
                "answer": "A concept from the presentation",
            }
        )

    return jsonify(
        {
            "status": "success",
            "message": "Quiz generation request received.",
            "filename": filename,
            "questions": questions,
        }
    )


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if not CLIENT_DIR.exists():
        return jsonify(
            {
                "error": "Frontend build not found. Run npm --prefix client run build before starting the server."
            }
        ), 404

    if path and (CLIENT_DIR / path).exists() and (CLIENT_DIR / path).is_file():
        return send_from_directory(str(CLIENT_DIR), path)

    return send_from_directory(str(CLIENT_DIR), "index.html")


if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "5000"))
    app.run(host=host, port=port, debug=False)
