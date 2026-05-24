from __future__ import annotations

import json
import re
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
PDF_DIR = ROOT / "db"
OUTPUT_FILE = PDF_DIR / "mahat_questions.json"

ANSWER_LETTERS = ["א", "ב", "ג", "ד"]


HEADER_PATTERNS = [
    re.compile(r"^שאלון.*$"),
    re.compile(r"^עמוד\s+\d+\s+מתוך\s*\d+.*$"),
    re.compile(r"^שאלות\d+-\d+.*$"),
    re.compile(r"^מועד הבחינה:.*$"),
    re.compile(r"^מספר השאלון:.*$"),
    re.compile(r"^נספח:.*$"),
    re.compile(r"^בשאלון זה.*$"),
    re.compile(r"^בהצלחה!.*$"),
    re.compile(r"^הוראות לנבחן.*$"),
]

QUESTION_START_RE = re.compile(r"(?m)^\s*(\d{1,3})\.\s*")
OPTION_START_RE = re.compile(r"(?<!\S)([אבגדה])\.\s*")
QUESTION_SECTION_RE = re.compile(r"שאלות\s*\d+\s*-\s*\d+")
ANSWER_PAIR_RE = re.compile(r"(?<!\d)(\d{1,2})\s*([אבגדה])")


def collapse_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def clean_text(value: str) -> str:
    lines: list[str] = []
    for raw_line in value.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        if any(pattern.match(line) for pattern in HEADER_PATTERNS):
            continue
        lines.append(line)
    return "\n".join(lines)


def extract_exam_meta(first_page_text: str, file_name: str) -> dict[str, str | int | None]:
    meta: dict[str, str | int | None] = {
        "file_name": file_name,
        "exam_id": None,
        "exam_title": None,
        "exam_date": None,
        "question_count": None,
    }

    exam_id_match = re.search(r"מספר\s+השאלון:\s*([\d*]+)", first_page_text)
    if exam_id_match:
        meta["exam_id"] = exam_id_match.group(1)

    date_match = re.search(r"מועד\s+הבחינה:\s*([^\n]+)", first_page_text)
    if date_match:
        meta["exam_date"] = collapse_spaces(date_match.group(1))

    title_match = re.search(r"^(.*?הנדסת\s+קול.*?)$", first_page_text, re.MULTILINE)
    if title_match:
        meta["exam_title"] = collapse_spaces(title_match.group(1))

    count_match = re.search(r"בשאלון\s+זה\s+(\d+)\s+שאלות", first_page_text)
    if count_match:
        meta["question_count"] = int(count_match.group(1))

    return meta


def parse_question_block(raw_block: str) -> dict[str, object] | None:
    block = clean_text(raw_block)
    if not block:
        return None

    question_match = re.match(r"^(\d{1,3})\.\s*(.*)$", block, re.S)
    if not question_match:
        return None

    number = int(question_match.group(1))
    remainder = question_match.group(2).strip()

    option_matches = list(OPTION_START_RE.finditer(remainder))
    options: dict[str, str] = {}
    prompt = remainder

    if option_matches:
        prompt = remainder[: option_matches[0].start()].strip()
        for index, match in enumerate(option_matches):
            option_key = match.group(1)
            option_start = match.end()
            option_end = option_matches[index + 1].start() if index + 1 < len(option_matches) else len(remainder)
            option_value = collapse_spaces(remainder[option_start:option_end])
            options[option_key] = option_value

    return {
        "number": number,
        "prompt": collapse_spaces(prompt),
        "options": options,
        "raw": block,
    }


def extract_questions_from_pdf(pdf_path: Path) -> dict[str, object]:
    reader = PdfReader(str(pdf_path))
    pages_text = []
    for page in reader.pages:
        page_text = page.extract_text() or ""
        pages_text.append(page_text)

    combined_text = "\n".join(pages_text)
    first_page_text = pages_text[0] if pages_text else ""
    meta = extract_exam_meta(first_page_text, pdf_path.name)

    section_match = QUESTION_SECTION_RE.search(combined_text)
    question_text = combined_text[section_match.end() :] if section_match else combined_text

    question_starts = list(QUESTION_START_RE.finditer(question_text))
    questions: list[dict[str, object]] = []

    for index, start_match in enumerate(question_starts):
        block_start = start_match.start()
        block_end = question_starts[index + 1].start() if index + 1 < len(question_starts) else len(combined_text)
        block = question_text[block_start:block_end]
        parsed = parse_question_block(block)
        if parsed and parsed.get("options"):
            questions.append(parsed)

    return {
        **meta,
        "questions": questions,
    }


def extract_answer_key_from_pdf(pdf_path: Path) -> dict[str, object]:
    reader = PdfReader(str(pdf_path))
    text = "\n".join((page.extract_text() or "") for page in reader.pages)
    # require explicit indicator that this PDF is an answer key to avoid false positives
    if not re.search(r"פתרון|תשובות|פתרון לשאלון", text):
        return {"file_name": pdf_path.name, "exam_id": None, "question_count": 0, "answers": {}}
    pairs = ANSWER_PAIR_RE.findall(text)
    answers: dict[int, str] = {}

    for number_text, answer_letter in pairs:
        number = int(number_text)
        if 1 <= number <= 60:
            answers[number] = answer_letter

    exam_id_match = re.search(r"(?:שאלון|פתרון)[^\d]*(\d{5}\*?)", text)
    exam_id = exam_id_match.group(1) if exam_id_match else None
    question_count = max(answers) if answers else 0

    return {
        "file_name": pdf_path.name,
        "exam_id": exam_id,
        "question_count": question_count,
        "answers": answers,
    }


def merge_answer_key(exam: dict[str, object], answer_key: dict[str, object] | None) -> None:
    if not answer_key:
        return

    # allow merging when exam_id matches or when the answer_key's question_count matches
    if answer_key.get("answers") is None or not isinstance(answer_key.get("answers"), dict):
        return

    # if both have exam_id and they disagree, only continue if counts match
    if exam.get("exam_id") and answer_key.get("exam_id") and exam.get("exam_id") != answer_key.get("exam_id"):
        expected_count = answer_key.get("question_count") or 0
        if expected_count and len(exam.get("questions", [])) != expected_count:
            return

    questions = exam.get("questions", [])
    if not isinstance(questions, list):
        return

    expected_count = answer_key.get("question_count") or 0
    if expected_count and len(questions) < expected_count:
        return

    answers = answer_key.get("answers", {})
    if not isinstance(answers, dict):
        return

    exam["answer_key_source"] = answer_key.get("file_name")
    for question in questions:
        if not isinstance(question, dict):
            continue
        number = question.get("number")
        answer_letter = answers.get(number)
        if answer_letter:
            question["correct_answer"] = answer_letter
            if answer_letter in ANSWER_LETTERS:
                question["correct_index"] = ANSWER_LETTERS.index(answer_letter)


def main() -> None:
    results = []
    answer_keys = []
    pdf_files = sorted(PDF_DIR.glob("*.pdf"))

    for pdf_path in pdf_files:
        try:
            # try to extract an answer key first; register it if present
            ak = extract_answer_key_from_pdf(pdf_path)
            if ak.get("answers"):
                answer_keys.append(ak)
            # always attempt to extract questions (many PDFs contain both)
            results.append(extract_questions_from_pdf(pdf_path))
        except Exception as exc:  # pragma: no cover - diagnostic output
            # best-effort: attempt to parse as questions, otherwise mark error
            try:
                results.append(extract_questions_from_pdf(pdf_path))
            except Exception:
                results.append(
                    {
                        "file_name": pdf_path.name,
                        "error": f"{type(exc).__name__}: {exc}",
                        "questions": [],
                    }
                )

    # Merge answer keys into exams. Match by exam_id when possible, else by question_count.
    for exam in results:
        for answer_key in answer_keys:
            # prefer exact exam_id match
            if exam.get("exam_id") and answer_key.get("exam_id"):
                if exam.get("exam_id") == answer_key.get("exam_id"):
                    merge_answer_key(exam, answer_key)
                    continue

            # fallback: if answer key has same question_count, merge
            if answer_key.get("question_count") and len(exam.get("questions", [])) == answer_key.get("question_count"):
                merge_answer_key(exam, answer_key)
                continue

    OUTPUT_FILE.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    total_questions = sum(len(exam.get("questions", [])) for exam in results)
    total_keys = len(answer_keys)
    print(f"Wrote {OUTPUT_FILE} with {len(results)} exams, {total_keys} answer keys and {total_questions} questions")


if __name__ == "__main__":
    main()