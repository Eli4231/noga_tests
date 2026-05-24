from pathlib import Path
from extract_mahat_questions import extract_answer_key_from_pdf, extract_questions_from_pdf

PDF_DIR = Path('db')
for p in sorted(PDF_DIR.glob('*.pdf')):
    try:
        ak = extract_answer_key_from_pdf(p)
    except Exception as e:
        ak = {'error':str(e)}
    try:
        q = extract_questions_from_pdf(p)
    except Exception as e:
        q = {'error':str(e)}
    print(p.name, '-> answers:', len(ak.get('answers',{})), 'qcount:', ak.get('question_count'), 'questions_extracted:', len(q.get('questions',[])))
