# Noga - MAHAT Practice Quiz

פרויקט לתרגול שאלות אמריקאיות ממבחני מה"ט (הנדסת קול), עם ממשק ווב פשוט וכלי חילוץ נתונים ב-Python.

## מבנה הפרויקט

- `noga.html`, `noga.js`, `noga.css` - אפליקציית התרגול.
- `db/mahat_questions.json` - מאגר השאלות הראשי.
- `extract_mahat_questions.py` - חילוץ שאלות/תשובות מ-PDF לתוך JSON.
- `diagnose_pdfs.py` - דוח אבחון על קבצי PDF בתיקיית `db`.
- `export_questions_answers.py` - חילוץ שאלות+תשובות מה-JSON לקבצי פלט נוחים.

## התקנה והרצה

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

שרת מקומי ל-Frontend:

```powershell
python -m http.server 8080
```

ואז לפתוח בדפדפן: `http://localhost:8080/noga.html`

## חילוץ מתוך DB קיים

כדי לחלץ את כל השאלות והתשובות מתוך `db/mahat_questions.json`:

```powershell
python .\export_questions_answers.py
```

הסקריפט מייצר:

- `db/questions_with_answers.json` - רשימה שטוחה של כל השאלות.
- `db/answers_by_exam.json` - תשובות מקובצות לפי מבחן ומספר שאלה.
- `db/questions_with_answers.csv` - CSV לשימוש באקסל.
