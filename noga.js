const DATA_PATH = 'db/mahat_questions.json';

let exams = [];
let questions = [];
let current = 0;
let stats = { total: 0, answered: 0, correct: 0 };
let dataLoaded = false;
let answersByQuestion = [];
let verifiedQuestionsPool = [];

const LETTERS = ['א','ב','ג','ד'];
const EMBEDDED_DB_KEY = 'MAHAT_QUESTIONS_DATA';
const VERIFIED_DB_KEY = 'MAHAT_VERIFIED_DATA';
const verifiedQuestionKeys = new Set();
const verifiedAnswerByKey = new Map();

function applyLoadedExams(loadedExams, sourceLabel = 'מאגר') {
  exams = Array.isArray(loadedExams) ? loadedExams : [];
  dataLoaded = exams.length > 0;
  document.querySelectorAll('[data-action="start-full"], [data-action="start-random"]').forEach(b => { if (b) b.disabled = false; });
  document.querySelectorAll('[data-action="start-verified"]').forEach(b => { if (b) b.disabled = verifiedQuestionsPool.length === 0; });
  const totalQ = exams.flatMap(e => e.questions || []).length;
  setExamTitle({exam_title: `${sourceLabel}: ${exams.length} מבחנים, ${totalQ} שאלות`});
  const dbg = document.getElementById('debug-status');
  if (dbg) {
    dbg.textContent = dataLoaded
      ? `סטטוס: המאגר נטען בהצלחה (${totalQ} שאלות).`
      : 'סטטוס: לא נטענו מבחנים.';
  }
}

function makeQuestionKey(examId, questionNumber) {
  return `${examId || ''}|${questionNumber || ''}`;
}

function normalizeQuestion(raw, examMeta = {}) {
  // Support different shapes: {prompt, options: {א:..}} or {prompt, options: []}
  const prompt = raw.prompt || raw.text || raw.prompt_text || raw.raw || '';
  let opts = [];
  if (Array.isArray(raw.options)) opts = raw.options.slice(0,4);
  else if (raw.options && typeof raw.options === 'object') {
    opts = LETTERS.map(l => raw.options[l] || '');
  }
  // fallback: try properties opt1..opt4
  if (!opts.length) {
    for (let i=1;i<=4;i++) {
      if (raw['option_'+i]) opts.push(raw['option_'+i]);
    }
  }
  while (opts.length < 4) opts.push('');
  const examId = examMeta.exam_id || raw.exam_id || '';
  const questionNumber = raw.number || raw.question_number || null;
  const key = makeQuestionKey(examId, questionNumber);
  const hasVerifiedAnswer = verifiedAnswerByKey.has(key);
  const fallbackIndex = typeof raw.correct_index === 'number' ? raw.correct_index : (raw.correct_answer ? LETTERS.indexOf(raw.correct_answer) : -1);
  let resolvedIndex = -1;
  let sourceLabel = 'מבחן לא מאומת';
  let isVerified = false;

  if (hasVerifiedAnswer) {
    resolvedIndex = verifiedAnswerByKey.get(key);
    sourceLabel = 'פתרון רשמי מאומת (מה"ט)';
    isVerified = true;
  } else if (fallbackIndex >= 0) {
    resolvedIndex = fallbackIndex;
    sourceLabel = 'מבחן לא מאומת';
  }

  return {
    prompt: prompt,
    options: opts.slice(0, 4),
    correct_index: resolvedIndex,
    source_label: sourceLabel,
    answer_verified: isVerified
  };
}

function normalizeVerifiedQuestion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let opts = [];
  if (Array.isArray(raw.options)) opts = raw.options.slice(0, 4);
  else if (raw.options && typeof raw.options === 'object') {
    opts = LETTERS.map((letter) => raw.options[letter] || '');
  }
  while (opts.length < 4) opts.push('');
  const idx = Number.isInteger(raw.correct_index)
    ? raw.correct_index
    : LETTERS.indexOf(raw.correct_answer);
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) return null;
  return {
    prompt: raw.prompt || raw.text || raw.prompt_text || '',
    options: opts.slice(0, 4),
    correct_index: idx,
    source_label: 'פתרון רשמי מאומת (מה"ט)',
    answer_verified: true
  };
}

async function loadData() {
  try {
    const verifiedFromScript = Array.isArray(window[VERIFIED_DB_KEY]) ? window[VERIFIED_DB_KEY] : [];

    verifiedQuestionKeys.clear();
    verifiedAnswerByKey.clear();
    verifiedQuestionsPool = [];
    for (const item of verifiedFromScript) {
      if (!item || typeof item !== 'object') continue;
      const key = makeQuestionKey(item.exam_id, item.question_number);
      if (key && Number.isInteger(item.correct_index)) {
        verifiedQuestionKeys.add(key);
        verifiedAnswerByKey.set(key, item.correct_index);
      }
      const normalized = normalizeVerifiedQuestion(item);
      if (normalized) verifiedQuestionsPool.push(normalized);
    }

    if (Array.isArray(window[EMBEDDED_DB_KEY]) && window[EMBEDDED_DB_KEY].length) {
      applyLoadedExams(window[EMBEDDED_DB_KEY], 'מאגר');
      return;
    }
    const res = await fetch(DATA_PATH);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const loaded = await res.json();
    applyLoadedExams(loaded, 'מאגר');
  } catch (e) {
    console.error('Failed to load data', e);
    const dbg = document.getElementById('debug-status');
    const runningFromFile = window.location.protocol === 'file:';
    if (dbg) dbg.textContent = runningFromFile ? 'טעינת מאגר נכשלה. נסה לפתוח דרך localhost.' : `טעינת מאגר נכשלה: ${e}`;
    applyLoadedExams([], 'ללא מאגר');
  }
}

function buildQuestionListFromExam(exam) {
  questions = (exam.questions || []).map((q) => normalizeQuestion(q, exam));
  answersByQuestion = new Array(questions.length).fill(null);
  stats.total = questions.length;
  stats.answered = 0;
  stats.correct = 0;
  current = 0;
  renderQuestion(0);
  populateQuestionJump();
  updateStats();
}

function setExamTitle(exam) {
  const el = document.getElementById('exam-title');
  if (!el) return;
  el.textContent = exam.exam_title || exam.file_name || '(מבחן ללא כותרת)';
}

function startFullTest() {
  // Load all questions from all exams into one continuous test
  const pool = exams.flatMap(e => (e.questions || []).map(q => normalizeQuestion(q, e)));
  if (pool.length) {
    questions = pool;
    answersByQuestion = new Array(questions.length).fill(null);
    stats.total = questions.length; stats.answered = 0; stats.correct = 0; current = 0;
    setExamTitle({exam_title: `כל המאגר - ${questions.length} שאלות`} );
    renderQuestion(0); populateQuestionJump(); updateStats();
  } else {
    const sample = {exam_title: 'מבחן דוגמה', questions: sampleQuestions()};
    setExamTitle(sample);
    buildQuestionListFromExam(sample);
  }
}

function startRandomTest() {
  const pool = exams.flatMap(e => (e.questions || []).map(q => normalizeQuestion(q, e)));
  if (!pool.length) return buildQuestionListFromExam({questions: sampleQuestions()});
  // pick up to 40 random
  const n = Math.min(40, pool.length);
  const shuffled = [...pool].sort(() => Math.random()-0.5).slice(0,n);
  questions = shuffled;
  answersByQuestion = new Array(questions.length).fill(null);
  stats.total = questions.length;
  stats.answered = 0; stats.correct = 0; current = 0;
  renderQuestion(0); populateQuestionJump(); updateStats();
}

function startVerifiedTest() {
  if (!verifiedQuestionsPool.length) {
    const dbg = document.getElementById('debug-status');
    if (dbg) dbg.textContent = 'לא נמצאו כרגע שאלות מאומתות.';
    return startFullTest();
  }
  questions = [...verifiedQuestionsPool];
  answersByQuestion = new Array(questions.length).fill(null);
  stats.total = questions.length;
  stats.answered = 0;
  stats.correct = 0;
  current = 0;
  setExamTitle({exam_title: `מבחן מאומת - ${questions.length} שאלות (מה"ט הנדסאי סאונד)`});
  renderQuestion(0);
  populateQuestionJump();
  updateStats();
}

function sampleQuestions() {
  return [
    {prompt: 'מהי מהירות הקול בגובה פני הים?', options: ['340 מ/ש', '300 מ/ש', '150 מ/ש', '1,000 מ/ש'], correct_index: 0, answer_verified: false},
    {prompt: 'איזה מהמכשירים הבא אינו מכשיר כניסה לאות?', options: ['מיקרופון','רמקול','DI','מגבר'], correct_index: 1, answer_verified: false}
  ];
}

function renderQuestion(idx) {
  if (!questions.length) {
    document.getElementById('question-text').textContent = 'אין שאלות טעונות — לחץ על "מבחן מלא".';
    document.getElementById('options').innerHTML = '';
    document.getElementById('q-number').textContent = '0/0';
    populateQuestionJump();
    return;
  }
  current = Math.max(0, Math.min(idx, questions.length - 1));
  const q = questions[current];
  document.getElementById('q-number').textContent = `${current+1}/${questions.length}`;
  document.getElementById('question-text').textContent = q.prompt || '(שאלה ללא טקסט)';
  const topic = document.getElementById('question-topic');
  if (topic) topic.textContent = `מקור תשובה: ${q.source_label || 'לא ידוע'}`;
  const opts = document.getElementById('options');
  opts.innerHTML = '';
  q.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option';
    btn.dataset.index = i;
    btn.innerHTML = `<strong>${LETTERS[i] || i+1}</strong>. ${opt}`;
    btn.onclick = () => selectOption(i);
    opts.appendChild(btn);
  });
  // update progress
  const pct = Math.round(((current+1)/questions.length)*100);
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = pct + '%';
  const meta = document.getElementById('progress-meta');
  if (meta) meta.textContent = `${current+1} מתוך ${questions.length}`;
  document.getElementById('feedback').textContent = '';
  populateQuestionJump();
}

function selectOption(i) {
  const opts = document.querySelectorAll('#options .option');
  opts.forEach(o => o.classList.remove('selected'));
  opts[i] && opts[i].classList.add('selected');
}

function submitAnswer() {
  if (!questions.length) return;
  const selected = document.querySelector('#options .option.selected');
  if (!selected) return;
  const selIdx = Number(selected.dataset.index);
  const q = questions[current];
  const correctIdx = typeof q.correct_index === 'number' ? q.correct_index : -1;
  const previousAnswer = answersByQuestion[current];
  const opts = document.querySelectorAll('#options .option');
  opts.forEach((o,i) => { o.classList.remove('correct','wrong'); if (i===correctIdx) o.classList.add('correct'); if (i===selIdx && i!==correctIdx) o.classList.add('wrong'); });
  if (correctIdx >= 0) {
    answersByQuestion[current] = selIdx;
    if (previousAnswer === null) stats.answered += 1;
    if (previousAnswer === correctIdx && selIdx !== correctIdx) stats.correct -= 1;
    if (previousAnswer !== correctIdx && selIdx === correctIdx) stats.correct += 1;
    if (q.answer_verified) {
      if (selIdx === correctIdx) { document.getElementById('feedback').textContent = 'נכון! (פתרון רשמי מאומת)'; }
      else document.getElementById('feedback').textContent = 'לא נכון (בהתבסס על פתרון רשמי מאומת)';
    } else {
      if (selIdx === correctIdx) { document.getElementById('feedback').textContent = 'נכון לפי מפתח התשובות של המאגר'; }
      else document.getElementById('feedback').textContent = 'לא נכון לפי מפתח התשובות של המאגר';
    }
    updateStats();
    populateQuestionJump();
  } else {
    document.getElementById('feedback').textContent = 'לשאלה זו אין תשובה מוגדרת';
  }
}

function nextQuestion() { renderQuestion(current+1); }
function prevQuestion() { renderQuestion(current-1); }

function populateQuestionJump() {
  const container = document.getElementById('question-jump');
  if (!container) return;
  container.innerHTML = '';
  const summary = document.getElementById('jump-summary');
  const input = document.getElementById('jump-input');
  if (!questions.length) {
    if (summary) summary.textContent = 'אין שאלות להצגה כרגע.';
    if (input) input.value = '';
    return;
  }
  if (summary) {
    const rangeStart = Math.max(0, current - 6) + 1;
    const rangeEnd = Math.min(questions.length, current + 6);
    summary.textContent = `מוצגות שאלות ${rangeStart}-${rangeEnd} מתוך ${questions.length}`;
  }
  if (input) input.value = String(current + 1);

  const start = Math.max(0, current - 6);
  const end = Math.min(questions.length, current + 7);
  for (let i=start;i<end;i++) {
    const btn = document.createElement('button');
    btn.textContent = i + 1;
    btn.className = 'jump-btn';
    if (i === current) btn.classList.add('active');
    if (answersByQuestion[i] !== null) btn.classList.add('answered');
    btn.onclick = () => renderQuestion(i);
    container.appendChild(btn);
  }
}

function jumpToQuestionInput() {
  if (!questions.length) return;
  const input = document.getElementById('jump-input');
  if (!input) return;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  const index = Math.max(0, Math.min(questions.length - 1, Math.floor(value) - 1));
  renderQuestion(index);
}

function updateStats() {
  document.getElementById('stat-total').textContent = stats.total || 0;
  document.getElementById('stat-answered').textContent = stats.answered || 0;
  document.getElementById('stat-correct').textContent = stats.correct || 0;
}

window.addEventListener('load', () => {
  // wire controls
  document.querySelectorAll('[data-action="start-verified"]').forEach(b => b.onclick = startVerifiedTest);
  document.querySelectorAll('[data-action="start-full"]').forEach(b => b.onclick = startFullTest);
  document.querySelectorAll('[data-action="start-random"]').forEach(b => b.onclick = startRandomTest);
  document.querySelectorAll('[data-action="reset"]').forEach(b => { b.onclick = () => { questions = []; answersByQuestion = []; stats = {total:0,answered:0,correct:0}; renderQuestion(0); updateStats(); }; });
  document.getElementById('btn-prev').onclick = prevQuestion;
  document.getElementById('btn-next').onclick = nextQuestion;
  document.getElementById('btn-submit').onclick = submitAnswer;
  const jumpBtn = document.getElementById('btn-jump-go');
  if (jumpBtn) jumpBtn.onclick = jumpToQuestionInput;
  const jumpInput = document.getElementById('jump-input');
  if (jumpInput) {
    jumpInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') jumpToQuestionInput();
    });
  }
  loadData().then(() => {
    if (!dataLoaded) startFullTest();
  }).catch(e => {
    console.error(e);
    startFullTest();
  });
});
