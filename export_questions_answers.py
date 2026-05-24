from __future__ import annotations

import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DB_DIR = ROOT / "db"
SOURCE_FILE = DB_DIR / "mahat_questions.json"
QUESTIONS_OUT = DB_DIR / "questions_with_answers.json"
ANSWERS_OUT = DB_DIR / "answers_by_exam.json"
CSV_OUT = DB_DIR / "questions_with_answers.csv"

LETTERS = ["א", "ב", "ג", "ד"]


def normalize_options(raw_options: object) -> list[str]:
    if isinstance(raw_options, list):
        return [(item or "").strip() if isinstance(item, str) else "" for item in raw_options[:4]]
    if isinstance(raw_options, dict):
        return [str(raw_options.get(letter, "") or "").strip() for letter in LETTERS]
    return ["", "", "", ""]


def main() -> None:
    if not SOURCE_FILE.exists():
        raise FileNotFoundError(f"Missing source db file: {SOURCE_FILE}")

    data = json.loads(SOURCE_FILE.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise ValueError("Expected db/mahat_questions.json to contain a list of exams")

    rows: list[dict[str, object]] = []
    answers_by_exam: dict[str, dict[str, str]] = {}

    for exam_index, exam in enumerate(data, start=1):
        if not isinstance(exam, dict):
            continue
        exam_id = str(exam.get("exam_id") or "")
        file_name = str(exam.get("file_name") or "")
        exam_key = file_name or (exam_id if exam_id else f"exam_{exam_index:03d}")
        exam_title = str(exam.get("exam_title") or "")
        exam_date = str(exam.get("exam_date") or "")
        questions = exam.get("questions", [])
        if not isinstance(questions, list):
            continue

        if exam_key not in answers_by_exam:
            answers_by_exam[exam_key] = {}

        for q in questions:
            if not isinstance(q, dict):
                continue
            number = int(q.get("number") or 0)
            prompt = str(q.get("prompt") or q.get("raw") or "").strip()
            options = normalize_options(q.get("options"))
            correct_answer = str(q.get("correct_answer") or "").strip()
            correct_index = q.get("correct_index")
            if not isinstance(correct_index, int):
                correct_index = LETTERS.index(correct_answer) if correct_answer in LETTERS else -1

            if correct_answer and number > 0:
                answers_by_exam[exam_key][str(number)] = correct_answer

            rows.append(
                {
                    "exam_id": exam_id,
                    "file_name": file_name,
                    "exam_title": exam_title,
                    "exam_date": exam_date,
                    "question_number": number,
                    "prompt": prompt,
                    "option_a": options[0] if len(options) > 0 else "",
                    "option_b": options[1] if len(options) > 1 else "",
                    "option_c": options[2] if len(options) > 2 else "",
                    "option_d": options[3] if len(options) > 3 else "",
                    "correct_answer": correct_answer,
                    "correct_index": correct_index,
                }
            )

    QUESTIONS_OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    ANSWERS_OUT.write_text(json.dumps(answers_by_exam, ensure_ascii=False, indent=2), encoding="utf-8")

    fieldnames = [
        "exam_id",
        "file_name",
        "exam_title",
        "exam_date",
        "question_number",
        "prompt",
        "option_a",
        "option_b",
        "option_c",
        "option_d",
        "correct_answer",
        "correct_index",
    ]

    with CSV_OUT.open("w", encoding="utf-8-sig", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    total_answers = sum(len(v) for v in answers_by_exam.values())
    print(
        f"Export complete: {len(rows)} questions, {total_answers} answers, "
        f"{len(answers_by_exam)} exams"
    )
    print(f"- {QUESTIONS_OUT}")
    print(f"- {ANSWERS_OUT}")
    print(f"- {CSV_OUT}")


if __name__ == "__main__":
    main()
