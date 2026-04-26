const appView = document.querySelector(".app-view");
const pages = document.querySelectorAll(".page");
const dockButtons = document.querySelectorAll(".floating-dock [data-page]");
const screenBody = document.querySelector(".screen-body");
const slides = document.querySelectorAll(".slide");
const slideButtons = document.querySelectorAll("[data-slide]");
const startupScreen = document.querySelector("#startup-screen");
const examLoader = document.querySelector("#exam-loader");
const examLoaderTitle = document.querySelector("#exam-loader-title");
const examLoaderCopy = document.querySelector("#exam-loader-copy");

const state = {
  index: null,
  selectedExam: "JAMB",
  selectedSubjects: { JAMB: [] },
  cache: new Map(),
  session: null,
  current: 0,
  reviewCurrent: 0,
  answers: {},
  questionTimes: {},
  questionStartedAt: 0,
  resultSummary: null,
  history: [],
  settings: {
    largeText: true,
    compactCards: false,
    autoNext: false,
    showTimer: true,
  },
  timerId: null,
  remaining: 0,
  calcValue: "0",
  studyPool: [],
  studyIndex: 0,
  currentStudyQuestion: null,
};

let activeSlide = 0;
let slideTimer;
let toastTimer;
let transitionActive = false;
const historyKey = "beasonExamHistory";
const settingsKey = "beasonSettings";

const examDefaults = {
  JAMB: { page: "jamb", duration: 120 * 60, questionCount: 180 },
  WAEC: { page: "waec", duration: 60 * 60, questionCount: 50 },
  NECO: { page: "neco", duration: 60 * 60, questionCount: 50 },
};

function showPage(pageName) {
  appView.classList.toggle("focus-mode", pageName === "simulation" || pageName === "review");
  pages.forEach((page) => page.classList.toggle("active", page.dataset.view === pageName));
  dockButtons.forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.page === pageName && !button.classList.contains("start-action")
    );
  });
  document.querySelector("#calculator")?.classList.remove("show");
  screenBody.scrollTo({ top: 0, behavior: "smooth" });
  if (pageName === "history") renderHistory();
}

function toast(message) {
  let toastEl = document.querySelector(".toast");
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    appView.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 1800);
}

function hideStartupScreen() {
  window.setTimeout(() => {
    startupScreen?.classList.add("hide");
    if (startupScreen) startupScreen.hidden = true;
  }, 3000);
}

function runExamLoader(title, copy) {
  if (!examLoader) return Promise.resolve();
  transitionActive = true;
  examLoaderTitle.textContent = title;
  examLoaderCopy.textContent = copy;
  examLoader.classList.add("show");
  examLoader.setAttribute("aria-hidden", "false");
  return new Promise((resolve) => {
    window.setTimeout(() => {
      examLoader.classList.remove("show");
      examLoader.setAttribute("aria-hidden", "true");
      transitionActive = false;
      resolve();
    }, 2500);
  });
}

function showSlide(index) {
  activeSlide = index;
  slides.forEach((slide, slideIndex) => slide.classList.toggle("active", slideIndex === activeSlide));
  slideButtons.forEach((button, buttonIndex) => button.classList.toggle("active", buttonIndex === activeSlide));
}

function restartSlideshow() {
  window.clearInterval(slideTimer);
  slideTimer = window.setInterval(() => showSlide((activeSlide + 1) % slides.length), 4200);
}

function loadStoredState() {
  try {
    state.history = JSON.parse(localStorage.getItem(historyKey) || "[]");
  } catch {
    state.history = [];
  }
  try {
    state.settings = { ...state.settings, ...JSON.parse(localStorage.getItem(settingsKey) || "{}") };
  } catch {
    // Defaults are already loaded.
  }
  applySettings();
}

function saveSettings() {
  localStorage.setItem(settingsKey, JSON.stringify(state.settings));
}

function applySettings() {
  appView.classList.toggle("large-text", state.settings.largeText);
  appView.classList.toggle("compact-cards", state.settings.compactCards);
  appView.classList.toggle("hide-timer", !state.settings.showTimer);
  document.querySelectorAll("[data-setting]").forEach((button) => {
    button.querySelector(".switch")?.classList.toggle("active", Boolean(state.settings[button.dataset.setting]));
  });
}

function safeHtml(value) {
  const raw = String(value || "");
  const cleaned = raw
    .replace(new RegExp("<script[\\s\\S]*?>[\\s\\S]*?</script>", "gi"), "")
    .replace(new RegExp("\\son\\w+=\"[^\"]*\"", "gi"), "")
    .replace(new RegExp("\\son\\w+='[^']*'", "gi"), "");
  return renderLatexTables(cleaned);
}

function cleanLatexCell(value) {
  return String(value || "")
    .replace(new RegExp("\\\\hline", "g"), "")
    .replace(new RegExp("\\\\text\\{([^}]*)\\}", "g"), "$1")
    .replace(new RegExp("\\\\[()]", "g"), "")
    .replace(new RegExp("\\\\", "g"), "")
    .replace(new RegExp("\\s+", "g"), " ")
    .trim();
}

function renderLatexTables(html) {
  return html.replace(
    new RegExp("\\\\\\(\\\\begin\\{array\\}\\{[^}]+\\}([\\s\\S]*?)\\\\end\\{array\\}\\\\\\)", "g"),
    (_, body) => {
      const rows = body
        .split(new RegExp("\\\\\\\\"))
        .map((row) => row.split("&").map(cleanLatexCell))
        .map((cells) => cells.filter((cell, index) => cell || index < cells.length - 1))
        .filter((cells) => cells.some(Boolean));

      if (!rows.length) return "";

      const width = Math.max(...rows.map((row) => row.length));
      const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] || ""));
      return `<div class="latex-table-wrap"><table class="latex-table">${normalized
        .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
        .join("")}</table></div>`;
    }
  );
}

function titleCase(value) {
  const text = String(value || "objective").toLowerCase();
  if (text === "obj") return "Objective";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function allQuestionImages(question) {
  return [question?.image, ...(question?.editorImages || []), question?.answerImage].filter(Boolean);
}

function questionImageTag(src, alt = "Question image") {
  const path = String(src || "");
  const resolved = path.startsWith("http") || path.startsWith("/trybeason/")
    ? path
    : `/trybeason/${path.replace(/^\/+/, "")}`;
  return `<img src="${resolved}" alt="${alt}" loading="lazy" onerror="this.remove()" />`;
}

function questionSearchText(question) {
  return [
    question?.id,
    question?.q,
    question?.subject,
    question?.year,
    question?.type,
    question?.answer,
    question?.explanation,
    ...(question?.options || []),
    ...(question?.topics || []).map((topic) => topic.title || topic.slug),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}

function compactTime(seconds) {
  const safe = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  if (m >= 60) return formatTime(safe);
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function subjectsFor(exam) {
  return state.index?.exams?.[exam]?.subjects || [];
}

async function loadIndex() {
  const res = await fetch("/trybeason/assets/data/question-index.json");
  state.index = await res.json();
  const total = Object.values(state.index.exams).reduce(
    (sum, exam) => sum + exam.subjects.reduce((subSum, subject) => subSum + subject.count, 0),
    0
  );
  document.querySelector("#home-bank-count").textContent = `${total.toLocaleString()} questions loaded`;
  populateExamControls();
  populateStudyControls();
}

function populateExamControls() {
  const jambMenu = document.querySelector('[data-menu="JAMB"]');
  jambMenu.innerHTML = "";
  const subjects = subjectsFor("JAMB");
  const english = subjects.find((subject) => subject.name.toLowerCase().includes("english"));
  state.selectedSubjects.JAMB = english ? [english.slug] : [];

  subjects.forEach((subject) => {
    const label = document.createElement("label");
    label.className = "subject-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = subject.slug;
    checkbox.checked = state.selectedSubjects.JAMB.includes(subject.slug);
    checkbox.disabled = checkbox.checked && subject.slug === english?.slug;
    checkbox.addEventListener("change", () => toggleJambSubject(subject.slug, checkbox));
    label.append(checkbox, document.createTextNode(`${subject.name} (${subject.count.toLocaleString()})`));
    jambMenu.appendChild(label);
  });

  for (const exam of ["WAEC", "NECO"]) {
    const select = document.querySelector(`#${exam.toLowerCase()}-subject`);
    select.innerHTML = subjectsFor(exam)
      .map((subject) => `<option value="${subject.slug}">${subject.name} (${subject.count.toLocaleString()})</option>`)
      .join("");
  }
  updateJambSummary();
}

function populateStudyControls() {
  const studyExam = document.querySelector("#study-exam");
  const studySubject = document.querySelector("#study-subject");
  const studyYear = document.querySelector("#study-year");
  const studyType = document.querySelector("#study-type");
  const studyTopic = document.querySelector("#study-topic");
  const studySearch = document.querySelector("#study-search");
  studyExam.innerHTML = Object.entries(state.index.exams)
    .map(([key, exam]) => `<option value="${key}">${exam.label || key}</option>`)
    .join("");
  const update = () => {
    const exam = studyExam.value;
    studySubject.innerHTML = subjectsFor(exam)
      .map((subject) => `<option value="${subject.slug}">${subject.name}</option>`)
      .join("");
    updateStudySecondaryFilters();
  };
  const updateStudySecondaryFilters = () => {
    const subject = subjectsFor(studyExam.value).find((item) => item.slug === studySubject.value);
    const years = subject?.years?.length ? Array.from({ length: subject.years[1] - subject.years[0] + 1 }, (_, i) => subject.years[1] - i) : [];
    studyYear.innerHTML = `<option value="">All years</option>${years.map((year) => `<option>${year}</option>`).join("")}`;
    studyType.innerHTML = `<option value="">All types</option>${Object.keys(subject?.types || {}).map((type) => `<option value="${type}">${type}</option>`).join("")}`;
    studyTopic.innerHTML = `<option value="">All topics</option>${(subject?.topics || []).map((topic) => `<option value="${topic.slug}">${topic.title}</option>`).join("")}`;
    renderStudyQuestion();
  };
  studyExam.addEventListener("change", update);
  studySubject.addEventListener("change", updateStudySecondaryFilters);
  document.querySelector("#apply-study-filter").addEventListener("click", renderStudyQuestion);
  studySearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") renderStudyQuestion();
  });
  update();
}

function makeSubjectMeta(exam, selectedSlugs, questions) {
  return selectedSlugs.map((slug) => {
    const firstQuestion = questions.find((q) => q.subjectSlug === slug);
    const subject = subjectsFor(exam).find((item) => item.slug === slug) || subjectsFor("REAL_JAMB").find((item) => item.slug === slug);
    return {
      slug,
      name: firstQuestion?.subject || subject?.name || slug,
      start: questions.findIndex((q) => q.subjectSlug === slug),
      count: questions.filter((q) => q.subjectSlug === slug).length,
    };
  }).filter((item) => item.start >= 0 && item.count > 0);
}

function toggleJambSubject(slug, checkbox) {
  const selected = state.selectedSubjects.JAMB;
  if (checkbox.checked) {
    if (selected.length >= 4) {
      checkbox.checked = false;
      toast("JAMB allows a maximum of 4 subjects");
      return;
    }
    selected.push(slug);
  } else {
    state.selectedSubjects.JAMB = selected.filter((item) => item !== slug);
  }
  updateJambSummary();
}

function updateJambSummary() {
  const selected = state.selectedSubjects.JAMB || [];
  const names = selected
    .map((slug) => subjectsFor("JAMB").find((subject) => subject.slug === slug)?.name)
    .filter(Boolean);
  document.querySelector("#jamb-subject-summary").textContent =
    names.length > 0 ? `${names.length}/4: ${names.join(", ")}` : "Choose subjects";
}

async function loadSubjectQuestions(exam, slug) {
  const key = `${exam}/${slug}`;
  if (state.cache.has(key)) return state.cache.get(key);
  const res = await fetch(`/trybeason/assets/data/questions/${exam.toLowerCase()}/${slug}.json`);
  if (!res.ok) throw new Error(`Could not load ${key}`);
  const data = await res.json();
  state.cache.set(key, data);
  return data;
}

async function renderStudyQuestion(direction = 0) {
  const box = document.querySelector("#study-question");
  const exam = document.querySelector("#study-exam").value;
  const slug = document.querySelector("#study-subject").value;
  const year = document.querySelector("#study-year").value;
  const type = document.querySelector("#study-type").value;
  const topic = document.querySelector("#study-topic").value;
  const search = document.querySelector("#study-search").value.trim().toLowerCase();
  if (!slug) {
    box.innerHTML = "<p>No subjects available for this exam yet.</p>";
    return;
  }
  box.innerHTML = "<p>Loading question...</p>";
  const questions = await loadSubjectQuestions(exam, slug);
  const filtered = questions.filter((q) => {
    const matchesYear = !year || String(q.year) === year;
    const matchesType = !type || q.type === type;
    const matchesTopic = !topic || (q.topics || []).some((item) => item.slug === topic);
    const matchesSearch = !search || questionSearchText(q).includes(search);
    return matchesYear && matchesType && matchesTopic && matchesSearch;
  });
  if (!filtered.length) {
    box.innerHTML = "<p>No question matches those filters. Try another year, type, topic, or search key.</p>";
    return;
  }
  const filtersChanged = state.studyExam !== exam
    || state.studySubject !== slug
    || state.studyYear !== year
    || state.studyType !== type
    || state.studyTopic !== topic
    || state.studySearch !== search;
  if (filtersChanged) {
    state.studyPool = search ? filtered : shuffle(filtered);
    state.studyIndex = 0;
    state.studyExam = exam;
    state.studySubject = slug;
    state.studyYear = year;
    state.studyType = type;
    state.studyTopic = topic;
    state.studySearch = search;
  } else if (direction) {
    state.studyIndex = (state.studyIndex + direction + state.studyPool.length) % state.studyPool.length;
  }
  const question = state.studyPool[state.studyIndex] || filtered[0];
  state.currentStudyQuestion = question;
  const isObj = question.type === "obj" && question.options?.some((option) => String(option || "").trim());
  const images = allQuestionImages(question);
  box.innerHTML = `
    <small>${state.index.exams[exam]?.label || exam} - ${question.subject} - ${question.year || "Past question"} - ${question.type} - ID ${question.id}</small>
    ${search ? `<span class="search-hit">${filtered.length.toLocaleString()} match${filtered.length === 1 ? "" : "es"} found</span>` : ""}
    <div class="study-q">${safeHtml(question.q)}</div>
    ${images.length ? `<div class="question-images">${images.map((src) => questionImageTag(src)).join("")}</div>` : ""}
    ${isObj ? `<div class="study-options">${question.options
      .map((option, index) => `<p><b>${"ABCDE"[index]}.</b> ${safeHtml(option)}</p>`)
      .join("")}</div>` : `<p class="theory-note">Theory question: write your answer first, then compare with the guide.</p>`}
    <div class="study-stepper" aria-label="Study question navigation">
      <button class="study-nav-button" id="prev-study-question" aria-label="Previous question">‹</button>
      <span>${state.studyIndex + 1} / ${state.studyPool.length}</span>
      <button class="study-nav-button" id="next-study-question" aria-label="Next question">›</button>
    </div>
    <button class="primary-action" id="show-study-answer">Show Answer</button>
  `;
  document.querySelector("#show-study-answer").addEventListener("click", () => openAnswerSheet(question));
  document.querySelector("#prev-study-question").addEventListener("click", () => renderStudyQuestion(-1));
  document.querySelector("#next-study-question").addEventListener("click", () => renderStudyQuestion(1));
}

function openAnswerSheet(question) {
  const sheet = document.querySelector("#answer-sheet");
  const isObj = question.type === "obj";
  document.querySelector("#answer-title").textContent = isObj ? "Answer + Explanation" : "Suggested Answer Guide";
  document.querySelector("#answer-subtitle").textContent = isObj
    ? "Review the prompt, answer key, and explanation below."
    : "Review the prompt and use the guide below to structure your response.";
  document.querySelector("#answer-key-label").textContent = isObj ? "Correct Option" : "Expected Response";
  document.querySelector("#answer-key").textContent = isObj ? question.answer || "N/A" : titleCase(question.type);
  document.querySelector("#answer-type").textContent = titleCase(question.type);
  document.querySelector("#answer-reason-title").textContent = isObj ? "Why this is correct" : "Answer guide";
  document.querySelector("#answer-prompt").innerHTML = `
    <div class="answer-question">${safeHtml(question.q)}</div>
    ${allQuestionImages(question).map((src, index) => questionImageTag(src, `Question image ${index + 1}`)).join("")}
  `;
  const explanation = question.explanation || (isObj
    ? "No explanation has been added for this question yet."
    : "Use the marking guide or teacher explanation for this theory/practical question when available.");
  document.querySelector("#answer-explanation").innerHTML = safeHtml(explanation);
  sheet.classList.add("show");
  sheet.setAttribute("aria-hidden", "false");
}

function closeAnswerSheet() {
  const sheet = document.querySelector("#answer-sheet");
  sheet.classList.remove("show");
  sheet.setAttribute("aria-hidden", "true");
}

async function buildSession(exam) {
  if (exam === "JAMB") {
    const selected = state.selectedSubjects.JAMB || [];
    if (selected.length !== 4) {
      toast("Pick exactly 4 JAMB subjects");
      return null;
    }
    const subjects = subjectsFor("JAMB");
    const english = subjects.find((subject) => subject.name.toLowerCase().includes("english"));
    const questions = [];
    for (const slug of selected) {
      const subject = subjects.find((item) => item.slug === slug);
      const jambPool = await loadSubjectQuestions("JAMB", slug).catch(() => []);
      const hasRealSubject = subjectsFor("REAL_JAMB").some((item) => item.slug === slug);
      const realPool = hasRealSubject ? await loadSubjectQuestions("REAL_JAMB", slug).catch(() => []) : [];
      const pool = [...jambPool, ...realPool].filter((q) => q.type === "obj" && q.options.length >= 4);
      const needed = slug === english?.slug ? 60 : 40;
      questions.push(...shuffle(pool).slice(0, Math.min(needed, pool.length)).map((q) => ({ ...q, subjectSlug: slug })));
      if (pool.length < needed) toast(`${subject?.name || slug} has ${pool.length} available questions`);
    }
    return { exam, duration: examDefaults.JAMB.duration, questions, subjects: makeSubjectMeta("JAMB", selected, questions), startedAt: Date.now() };
  }

  const slug = document.querySelector(`#${exam.toLowerCase()}-subject`).value;
  if (!slug) {
    toast(`Choose a ${exam} subject`);
    return null;
  }
  const pool = (await loadSubjectQuestions(exam, slug)).filter((q) => q.type === "obj" && q.options.length >= 4);
  const questions = shuffle(pool).slice(0, Math.min(examDefaults[exam].questionCount, pool.length)).map((q) => ({ ...q, subjectSlug: slug }));
  return {
    exam,
    duration: examDefaults[exam].duration,
    questions,
    subjects: makeSubjectMeta(exam, [slug], questions),
    startedAt: Date.now(),
  };
}

async function startExam(exam) {
  if (transitionActive) return;
  toast("Loading questions...");
  const session = await buildSession(exam);
  if (!session || session.questions.length === 0) {
    toast("No questions available for this setup");
    return;
  }
  await runExamLoader("Preparing exam", "Building your CBT session");
  window.clearInterval(state.timerId);
  state.session = session;
  state.current = 0;
  state.answers = {};
  state.questionTimes = {};
  state.remaining = session.duration;
  state.questionStartedAt = Date.now();
  document.querySelector("#sim-exam-label").textContent = exam;
  showPage("simulation");
  renderQuestion();
  startTimer();
}

function startTimer() {
  document.querySelector("#timer").textContent = formatTime(state.remaining);
  state.timerId = window.setInterval(() => {
    state.remaining -= 1;
    document.querySelector("#timer").textContent = formatTime(Math.max(state.remaining, 0));
    if (state.remaining <= 0) submitExam();
  }, 1000);
}

function recordQuestionTime() {
  if (!state.session?.questions?.length || !state.questionStartedAt) return;
  const question = state.session.questions[state.current];
  if (!question) return;
  const elapsed = Math.max(0, Math.round((Date.now() - state.questionStartedAt) / 1000));
  state.questionTimes[question.id] = (state.questionTimes[question.id] || 0) + elapsed;
  state.questionStartedAt = Date.now();
}

function goToQuestion(index) {
  recordQuestionTime();
  state.current = Math.max(0, Math.min(state.session.questions.length - 1, index));
  state.questionStartedAt = Date.now();
  renderQuestion();
}

function goToReviewQuestion(index) {
  state.reviewCurrent = Math.max(0, Math.min(state.session.questions.length - 1, index));
  renderReviewQuestion();
}

function subjectForIndex(index) {
  return state.session?.subjects?.find((subject) => index >= subject.start && index < subject.start + subject.count);
}

function renderQuestion() {
  const q = state.session.questions[state.current];
  const subject = subjectForIndex(state.current);
  const localNumber = subject ? state.current - subject.start + 1 : state.current + 1;
  const localTotal = subject ? subject.count : state.session.questions.length;
  document.querySelector("#question-count").textContent = `Question ${localNumber} of ${localTotal}`;
  document.querySelector("#question-subject").textContent = `${q.subject}${q.year ? ` - ${q.year}` : ""}`;
  document.querySelector("#question-text").innerHTML = safeHtml(q.q);
  const imageBox = document.querySelector("#question-images");
  const images = [q.image, ...(q.editorImages || [])].filter(Boolean);
  imageBox.innerHTML = images.map((src) => questionImageTag(src, "Question diagram")).join("");
  document.querySelector("#option-list").innerHTML = q.options
    .map((option, index) => {
      const letter = "ABCDE"[index];
      const checked = state.answers[q.id] === letter ? "selected" : "";
      return `<button class="${checked}" data-answer="${letter}"><b>${letter}</b><span>${safeHtml(option)}</span></button>`;
    })
    .join("");
  document.querySelectorAll("[data-answer]").forEach((button) => {
    button.addEventListener("click", () => {
      state.answers[q.id] = button.dataset.answer;
      if (state.settings.autoNext && state.current < state.session.questions.length - 1) goToQuestion(state.current + 1);
      else renderQuestion();
    });
  });
  renderSubjectTabs();
  renderQuestionNav();
}

function renderSubjectTabs() {
  const tabs = document.querySelector("#subject-tabs");
  if (!state.session?.subjects?.length || state.session.subjects.length < 2) {
    tabs.innerHTML = "";
    return;
  }
  tabs.innerHTML = state.session.subjects
    .map((subject) => {
      const active = state.current >= subject.start && state.current < subject.start + subject.count ? "active" : "";
      return `<button class="${active}" data-subject-jump="${subject.start}"><strong>${subject.name}</strong><span>${subject.count} Qs</span></button>`;
    })
    .join("");
  document.querySelectorAll("[data-subject-jump]").forEach((button) => {
    button.addEventListener("click", () => goToQuestion(Number(button.dataset.subjectJump)));
  });
}

function renderQuestionNav() {
  const nav = document.querySelector("#question-nav");
  const subject = subjectForIndex(state.current);
  const questions = subject ? state.session.questions.slice(subject.start, subject.start + subject.count) : state.session.questions;
  const offset = subject ? subject.start : 0;
  nav.innerHTML = questions
    .map((question, localIndex) => {
      const index = offset + localIndex;
      const answered = state.answers[question.id] ? "answered" : "";
      const active = index === state.current ? "active" : "";
      return `<button class="${answered} ${active}" data-jump="${index}">${localIndex + 1}</button>`;
    })
    .join("");
  document.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => goToQuestion(Number(button.dataset.jump)));
  });
}

function buildResultSummary(status = "submitted") {
  if (!state.session) return;
  recordQuestionTime();
  const total = state.session.questions.length;
  const correct = state.session.questions.filter((q) => state.answers[q.id] === q.answer).length;
  const timeUsed = Math.max(0, state.session.duration - state.remaining);
  const subjects = (state.session.subjects?.length ? state.session.subjects : []).map((subject) => {
    const questions = state.session.questions.filter((q) => q.subjectSlug === subject.slug);
    const subjectCorrect = questions.filter((q) => state.answers[q.id] === q.answer).length;
    const subjectTime = questions.reduce((sum, q) => sum + (state.questionTimes[q.id] || 0), 0);
    return { ...subject, correct: subjectCorrect, total: questions.length, time: subjectTime };
  });
  return { status, exam: state.session.exam, total, correct, percent: Math.round((correct / total) * 100), timeUsed, subjects };
}

function saveHistory(summary) {
  const entry = {
    id: `exam-${Date.now()}`,
    date: new Date().toLocaleString(),
    summary,
    session: state.session,
    answers: state.answers,
    questionTimes: state.questionTimes,
  };
  state.history = [entry, ...state.history].slice(0, 10);
  try {
    localStorage.setItem(historyKey, JSON.stringify(state.history));
  } catch {
    toast("History saved for this session only");
  }
}

async function submitExam(status = "submitted") {
  if (transitionActive) return;
  if (!state.session) return;
  document.querySelector("#calculator").classList.remove("show");
  window.clearInterval(state.timerId);
  const summary = buildResultSummary(status);
  state.resultSummary = summary;
  saveHistory(summary);
  document.querySelector("#score-title").textContent = `${summary.correct} / ${summary.total}`;
  document.querySelector("#score-copy").textContent = `${summary.percent}% score in ${summary.exam}. ${summary.total - summary.correct} questions need review.`;
  document.querySelector("#result-meta").innerHTML = `
    <span>Time used: ${compactTime(summary.timeUsed)}</span>
    <span>${status === "quit" ? "Quit before final submit" : "Submitted"}</span>
  `;
  renderSubjectBreakdown(summary);
  if (status === "submitted") {
    await runExamLoader("Submitting exam", "Calculating your result");
  }
  showPage("result");
}

function renderSubjectBreakdown(summary = state.resultSummary) {
  const box = document.querySelector("#subject-breakdown");
  if (!summary?.subjects?.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = summary.subjects.map((subject) => {
    const percent = Math.round((subject.correct / subject.total) * 100);
    return `<article>
      <strong>${subject.name}</strong>
      <span>${subject.correct}/${subject.total} - ${percent}%</span>
      <small>Time used: ${compactTime(subject.time)}</small>
    </article>`;
  }).join("");
}

function quitExam() {
  submitExam("quit");
}

function startReviewMode() {
  if (!state.session?.questions?.length) return;
  state.reviewCurrent = 0;
  document.querySelector("#review-exam-label").textContent = `${state.session.exam} Review`;
  document.querySelector("#review-score-mini").textContent = document.querySelector("#score-title").textContent;
  showPage("review");
  renderReviewQuestion();
}

function renderReviewQuestion() {
  const q = state.session.questions[state.reviewCurrent];
  const subject = subjectForIndex(state.reviewCurrent);
  const localNumber = subject ? state.reviewCurrent - subject.start + 1 : state.reviewCurrent + 1;
  const localTotal = subject ? subject.count : state.session.questions.length;
  const chosen = state.answers[q.id] || "";
  const correct = q.answer || "";
  const isCorrect = chosen && chosen === correct;
  document.querySelector("#review-question-count").textContent = `Question ${localNumber} of ${localTotal}`;
  document.querySelector("#review-question-subject").textContent = `${q.subject}${q.year ? ` - ${q.year}` : ""}`;
  document.querySelector("#review-status").innerHTML = `
    <span class="${isCorrect ? "correct" : "wrong"}">${isCorrect ? "Correct" : "Needs review"}</span>
    <span>Your answer: ${chosen || "Not answered"}</span>
    <span>Correct: ${correct || "N/A"}</span>
    <span>Time: ${compactTime(state.questionTimes[q.id] || 0)}</span>
  `;
  document.querySelector("#review-question-text").innerHTML = safeHtml(q.q);
  document.querySelector("#review-question-images").innerHTML = allQuestionImages(q)
    .map((src) => questionImageTag(src, "Question diagram"))
    .join("");
  document.querySelector("#review-option-list").innerHTML = q.options
    .map((option, index) => {
      const letter = "ABCDE"[index];
      const classes = [
        letter === correct ? "correct-answer" : "",
        letter === chosen && chosen !== correct ? "wrong-answer" : "",
        letter === chosen && chosen === correct ? "correct-answer" : "",
      ].filter(Boolean).join(" ");
      return `<button class="${classes}" type="button"><b>${letter}</b><span>${safeHtml(option)}</span></button>`;
    })
    .join("");
  renderReviewNav();
}

function renderReviewNav() {
  const nav = document.querySelector("#review-question-nav");
  const subject = subjectForIndex(state.reviewCurrent);
  const questions = subject ? state.session.questions.slice(subject.start, subject.start + subject.count) : state.session.questions;
  const offset = subject ? subject.start : 0;
  nav.innerHTML = questions
    .map((question, localIndex) => {
      const index = offset + localIndex;
      const chosen = state.answers[question.id] || "";
      const answered = chosen ? "answered" : "";
      const active = index === state.reviewCurrent ? "active" : "";
      const wrong = chosen && chosen !== question.answer ? "wrong" : "";
      return `<button class="${answered} ${active} ${wrong}" data-review-jump="${index}">${localIndex + 1}</button>`;
    })
    .join("");
  document.querySelectorAll("[data-review-jump]").forEach((button) => {
    button.addEventListener("click", () => goToReviewQuestion(Number(button.dataset.reviewJump)));
  });
}

function renderHistory() {
  const list = document.querySelector("#history-list");
  if (!state.history.length) {
    list.innerHTML = "<p>No exams submitted yet.</p>";
    return;
  }
  list.innerHTML = state.history.map((entry) => `
    <article class="history-card">
      <span>${entry.date}</span>
      <strong>${entry.summary.exam} - ${entry.summary.correct}/${entry.summary.total}</strong>
      <small>${entry.summary.percent}% - ${compactTime(entry.summary.timeUsed)} - ${entry.summary.status}</small>
      <button data-history-review="${entry.id}">Review</button>
    </article>
  `).join("");
  document.querySelectorAll("[data-history-review]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.history.find((item) => item.id === button.dataset.historyReview);
      if (!entry) return;
      state.session = entry.session;
      state.answers = entry.answers || {};
      state.questionTimes = entry.questionTimes || {};
      state.resultSummary = entry.summary;
      document.querySelector("#score-title").textContent = `${entry.summary.correct} / ${entry.summary.total}`;
      document.querySelector("#score-copy").textContent = `${entry.summary.percent}% score in ${entry.summary.exam}. ${entry.summary.total - entry.summary.correct} questions need review.`;
      document.querySelector("#result-meta").innerHTML = `<span>Time used: ${compactTime(entry.summary.timeUsed)}</span><span>From history</span>`;
      renderSubjectBreakdown(entry.summary);
      startReviewMode();
    });
  });
}

function runCalc(input) {
  if (input === "clear") state.calcValue = "0";
  else if (input === "back") state.calcValue = state.calcValue.length > 1 ? state.calcValue.slice(0, -1) : "0";
  else if (input === "=") {
    try {
      const expression = state.calcValue.replace(new RegExp("[^0-9+\\-*/%.()]", "g"), "");
      state.calcValue = String(Function(`return (${expression})`)());
    } catch {
      state.calcValue = "Error";
    }
  } else {
    state.calcValue = state.calcValue === "0" || state.calcValue === "Error" ? input : state.calcValue + input;
  }
  document.querySelector("#calc-display").value = state.calcValue;
}

document.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page)));
document.querySelectorAll("[data-open-exam]").forEach((button) => {
  button.addEventListener("click", () => {
    state.selectedExam = button.dataset.openExam;
    document.querySelectorAll("[data-open-exam].exam-pill").forEach((pill) => pill.classList.toggle("active", pill.dataset.openExam === state.selectedExam));
    showPage(examDefaults[state.selectedExam].page);
  });
});
document.querySelectorAll("[data-start-exam]").forEach((button) => button.addEventListener("click", () => startExam(button.dataset.startExam)));
document.querySelectorAll("[data-subject-menu]").forEach((button) => button.addEventListener("click", () => document.querySelector(`[data-menu="${button.dataset.subjectMenu}"]`).classList.toggle("show")));
slideButtons.forEach((button) => button.addEventListener("click", () => { showSlide(Number(button.dataset.slide)); restartSlideshow(); }));
document.querySelector("#prev-question").addEventListener("click", () => goToQuestion(state.current - 1));
document.querySelector("#next-question").addEventListener("click", () => {
  document.querySelector("#calculator").classList.remove("show");
  goToQuestion(state.current + 1);
});
document.querySelector("#submit-exam").addEventListener("click", () => submitExam());
document.querySelector("#quit-exam").addEventListener("click", quitExam);
document.querySelector("#review-exam").addEventListener("click", startReviewMode);
document.querySelector("#reveal-review-answer").addEventListener("click", () => openAnswerSheet(state.session.questions[state.reviewCurrent]));
document.querySelector("#prev-review-question").addEventListener("click", () => {
  state.reviewCurrent = Math.max(0, state.reviewCurrent - 1);
  renderReviewQuestion();
});
document.querySelector("#next-review-question").addEventListener("click", () => {
  state.reviewCurrent = Math.min(state.session.questions.length - 1, state.reviewCurrent + 1);
  renderReviewQuestion();
});
document.querySelector("#review-to-result").addEventListener("click", () => showPage("result"));
document.querySelector("#review-back-result").addEventListener("click", () => showPage("result"));
document.querySelector("#calculator-toggle").addEventListener("click", () => document.querySelector("#calculator").classList.toggle("show"));
document.querySelector("#study-calculator-toggle").addEventListener("click", () => document.querySelector("#calculator").classList.toggle("show"));
document.querySelector("#calculator-close").addEventListener("click", () => document.querySelector("#calculator").classList.remove("show"));
document.querySelectorAll("[data-calc]").forEach((button) => button.addEventListener("click", () => runCalc(button.dataset.calc)));
document.querySelectorAll("[data-setting]").forEach((button) => button.addEventListener("click", () => {
  state.settings[button.dataset.setting] = !state.settings[button.dataset.setting];
  saveSettings();
  applySettings();
  toast(`${button.querySelector("strong").textContent} ${state.settings[button.dataset.setting] ? "on" : "off"}`);
}));
document.querySelectorAll("[data-toggle]").forEach((button) => button.addEventListener("click", () => {
  const toggle = button.querySelector(".switch");
  toggle.classList.toggle("active");
  toast(`${button.dataset.toggle} turned ${toggle.classList.contains("active") ? "on" : "off"}`);
}));
document.querySelectorAll("[data-close-answer]").forEach((button) => button.addEventListener("click", closeAnswerSheet));

loadStoredState();
showSlide(0);
restartSlideshow();
hideStartupScreen();
loadIndex().catch((error) => {
  console.error(error);
  toast("Open http://127.0.0.1:4177/index.html to load questions.");
});
