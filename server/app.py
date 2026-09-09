from pathlib import Path
import os
import re
import tempfile

from flask import Flask, jsonify, request, send_from_directory
from pptx import Presentation
from pypdf import PdfReader

BASE_DIR = Path(__file__).resolve().parent.parent
CLIENT_DIR = BASE_DIR / "client" / "dist"

app = Flask(__name__)


def extract_text_from_upload(uploaded_file):
    if uploaded_file is None or not uploaded_file.filename:
        return ""

    suffix = Path(uploaded_file.filename).suffix.lower()
    fd, temp_path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)

    try:
        uploaded_file.save(temp_path)

        if suffix == ".pptx":
            presentation = Presentation(temp_path)
            blocks = []
            for slide in presentation.slides:
                for shape in slide.shapes:
                    if hasattr(shape, "text") and shape.text:
                        blocks.append(shape.text.strip())
            text = "\n".join(block for block in blocks if block)
            return text

        if suffix == ".pdf":
            reader = PdfReader(temp_path)
            pages = []
            for page in reader.pages:
                content = page.extract_text() or ""
                pages.append(content)
            return "\n".join(page for page in pages if page)

        if suffix in {".txt", ".md"}:
            with open(temp_path, "r", encoding="utf-8", errors="ignore") as handle:
                return handle.read()

        return ""
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def build_questions_from_content(content, filename, question_count):
    cleaned_content = re.sub(r"\s+", " ", content).strip()
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", cleaned_content) if part.strip()]

    if not sentences:
        sentences = [f"Uploaded presentation: {filename}"]

    questions = []
    for idx in range(question_count):
        source = sentences[min(idx, len(sentences) - 1)]
        snippet = source[:160]
        answer = snippet

        questions.append(
            {
                "id": idx + 1,
                "type": "multiple-choice",
                "prompt": f"Question {idx + 1}: What is the main idea of this section from {filename}?",
                "options": [
                    answer,
                    "A topic that is unrelated to the uploaded material",
                    "A blank answer",
                    "A copied image label",
                ],
                "answer": answer,
            }
        )

    return questions


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

    extracted_content = extract_text_from_upload(uploaded_file)
    questions = build_questions_from_content(extracted_content, filename, question_count)

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
