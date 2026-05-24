const DATA_PATH = 'db/mahat_questions.json';

let exams = [];
let questions = [];
let current = 0;
let stats = { total: 0, answered: 0, correct: 0 };
let dataLoaded = false;

const LETTERS = ['א','ב','ג','ד'];

function normalizeQuestion(raw) {
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

  return {
    prompt: prompt,
    options: opts.slice(0, 4),
    correct_index: typeof raw.correct_index === 'number' ? raw.correct_index : (raw.correct_answer ? LETTERS.indexOf(raw.correct_answer) : -1)
  };
}

async function loadData() {
  try {
    const res = await fetch(DATA_PATH);
    exams = await res.json();
    dataLoaded = true;
    // enable start buttons
    document.querySelectorAll('[data-action="start-full"], [data-action="start-random"]').forEach(b => { if (b) b.disabled = false; });
    // show counts
    const totalQ = exams.flatMap(e => e.questions || []).length;
    setExamTitle({exam_title: `מאגר: ${exams.length} מבחנים, ${totalQ} שאלות`});
    // update debug status
    const dbg = document.getElementById('debug-status');
    if (dbg) dbg.textContent = `סטטוס: נטען ${exams.length} מבחנים, ${totalQ} שאלות`;
  } catch (e) {
    console.error('Failed to load data', e);
    exams = [];
    const dbg = document.getElementById('debug-status');
    if (dbg) dbg.textContent = `טעינת מאגר נכשלה: ${e}`;
  }
}

function buildQuestionListFromExam(exam) {
  questions = (exam.questions || []).map(normalizeQuestion);
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
  const pool = exams.flatMap(e => (e.questions || []).map(normalizeQuestion));
  if (pool.length) {
    questions = pool;
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
  const pool = exams.flatMap(e => e.questions || []).map(normalizeQuestion);
  if (!pool.length) return buildQuestionListFromExam({questions: sampleQuestions()});
  // pick up to 40 random
  const n = Math.min(40, pool.length);
  const shuffled = [...pool].sort(() => Math.random()-0.5).slice(0,n);
  questions = shuffled;
  stats.total = questions.length;
  stats.answered = 0; stats.correct = 0; current = 0;
  renderQuestion(0); populateQuestionJump(); updateStats();
}

function sampleQuestions() {
  return [
    {prompt: 'מהי מהירות הקול בגובה פני הים?', options: ['340 מ/ש', '300 מ/ש', '150 מ/ש', '1,000 מ/ש'], correct_index: 0},
    {prompt: 'איזה מהמכשירים הבא אינו מכשיר כניסה לאות?', options: ['מיקרופון','רמקול','DI','מגבר'], correct_index: 1}
  ];
}

function renderQuestion(idx) {
  if (!questions.length) {
    document.getElementById('question-text').textContent = 'אין שאלות טעונות — לחץ על "מבחן מלא" או טען JSON.';
    document.getElementById('options').innerHTML = '';
    document.getElementById('q-number').textContent = '0/0';
    return;
  }
  current = Math.max(0, Math.min(idx, questions.length - 1));
  const q = questions[current];
  document.getElementById('q-number').textContent = `${current+1}/${questions.length}`;
  document.getElementById('question-text').textContent = q.prompt || '(שאלה ללא טקסט)';
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
  const opts = document.querySelectorAll('#options .option');
  opts.forEach((o,i) => { o.classList.remove('correct','wrong'); if (i===correctIdx) o.classList.add('correct'); if (i===selIdx && i!==correctIdx) o.classList.add('wrong'); });
  if (correctIdx >= 0) {
    if (selIdx === correctIdx) { document.getElementById('feedback').textContent = 'נכון!'; stats.correct += 1; }
    else document.getElementById('feedback').textContent = 'לא נכון';
    stats.answered += 1; updateStats();
  } else {
    document.getElementById('feedback').textContent = 'אין מפתח תשובה לשאלה זו';
  }
}

function nextQuestion() { renderQuestion(current+1); }
function prevQuestion() { renderQuestion(current-1); }

function populateQuestionJump() {
  const container = document.getElementById('question-jump');
  if (!container) return;
  container.innerHTML = '';
  for (let i=0;i<questions.length;i++) {
    const btn = document.createElement('button'); btn.textContent = i+1; btn.onclick = () => renderQuestion(i); container.appendChild(btn);
  }
}

function updateStats() {
  document.getElementById('stat-total').textContent = stats.total || 0;
  document.getElementById('stat-answered').textContent = stats.answered || 0;
  document.getElementById('stat-correct').textContent = stats.correct || 0;
}

window.addEventListener('load', () => {
  // wire controls
  document.querySelectorAll('[data-action="start-full"]').forEach(b => b.onclick = startFullTest);
  document.querySelectorAll('[data-action="start-random"]').forEach(b => b.onclick = startRandomTest);
  document.querySelectorAll('[data-action="reset"]').forEach(b => { b.onclick = () => { questions = []; stats = {total:0,answered:0,correct:0}; renderQuestion(0); updateStats(); }; });
  document.getElementById('btn-prev').onclick = prevQuestion;
  document.getElementById('btn-next').onclick = nextQuestion;
  document.getElementById('btn-submit').onclick = submitAnswer;
  // disable start buttons until data loads
  document.querySelectorAll('[data-action="start-full"], [data-action="start-random"]').forEach(b => { if (b) b.disabled = true; });
  loadData().then(() => { /* data ready */ }).catch(e => console.error(e));
});
