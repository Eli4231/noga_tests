from __future__ import annotations

import json
from pathlib import Path

from extract_mahat_questions import ANSWER_LETTERS, extract_answer_key_from_pdf, extract_questions_from_pdf


ROOT = Path(__file__).resolve().parent
DB_DIR = ROOT / "db"
VERIFIED_JSON = DB_DIR / "verified_questions.json"
VERIFIED_JS = DB_DIR / "verified_questions.js"


def answer_distribution_is_suspicious(questions: list[dict[str, object]]) -> bool:
    counts = [0, 0, 0, 0]
    for question in questions:
        index = question.get("correct_index")
        if isinstance(index, int) and 0 <= index <= 3:
            counts[index] += 1
    total = sum(counts)
    if total < 20:
        return True
    dominant_ratio = max(counts) / total
    distinct = sum(1 for count in counts if count > 0)
    return dominant_ratio > 0.75 or distinct < 3


def main() -> None:
    pdf_files = sorted(DB_DIR.glob("*.pdf"))
    exams: list[dict[str, object]] = []
    answer_keys: list[dict[str, object]] = []

    for pdf in pdf_files:
        try:
            exams.append(extract_questions_from_pdf(pdf))
        except Exception:
            continue
        try:
            key = extract_answer_key_from_pdf(pdf)
            if key.get("exam_id") and isinstance(key.get("answers"), dict) and key.get("answers"):
                answer_keys.append(key)
        except Exception:
            continue

    keys_by_exam_id: dict[str, list[dict[str, object]]] = {}
    for key in answer_keys:
        exam_id = str(key.get("exam_id") or "")
        if not exam_id:
            continue
        keys_by_exam_id.setdefault(exam_id, []).append(key)

    verified_questions: list[dict[str, object]] = []
    for exam in exams:
        exam_id = str(exam.get("exam_id") or "")
        if not exam_id:
            continue

        matching_keys = keys_by_exam_id.get(exam_id, [])
        # Strict rule: only a single unambiguous answer key is allowed.
        if len(matching_keys) != 1:
            continue

        answers = matching_keys[0].get("answers", {})
        if not isinstance(answers, dict):
            continue

        for question in exam.get("questions", []):
            if not isinstance(question, dict):
                continue
            number = question.get("number")
            if not isinstance(number, int):
                continue
            letter = answers.get(number)
            if letter not in ANSWER_LETTERS:
                continue

            correct_index = ANSWER_LETTERS.index(letter)
            verified_questions.append(
                {
                    "exam_id": exam_id,
                    "file_name": exam.get("file_name", ""),
                    "exam_title": exam.get("exam_title", ""),
                    "question_number": number,
                    "prompt": question.get("prompt", ""),
                    "options": question.get("options", {}),
                    "correct_answer": letter,
                    "correct_index": correct_index,
                    "answer_verified": True,
                    "verification_source": "strict_exam_id_match",
                }
            )

    if answer_distribution_is_suspicious(verified_questions):
        print("Warning: verified answer distribution looks suspicious; writing empty verified bank.")
        verified_questions = []

    VERIFIED_JSON.write_text(json.dumps(verified_questions, ensure_ascii=False, indent=2), encoding="utf-8")
    VERIFIED_JS.write_text(
        "window.MAHAT_VERIFIED_DATA = " + json.dumps(verified_questions, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    print(f"Verified questions: {len(verified_questions)}")
    print(f"- {VERIFIED_JSON}")
    print(f"- {VERIFIED_JS}")


if __name__ == "__main__":
    main()
