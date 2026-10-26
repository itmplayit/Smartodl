'use strict';
/** AI content generation admin endpoints.
 *  POST /api/admin/ai/generate  { type: 'course'|'quiz'|'problem', ...params }
 *     → returns the generated JSON (preview only, NOT inserted yet).
 *  POST /api/admin/ai/save/course  { course, modules } → inserts and returns course id.
 *  POST /api/admin/ai/save/quiz    { quiz, questions, course_id?, category_id? } → inserts.
 *  POST /api/admin/ai/save/problem { problem, test_cases, starter_code } → inserts.
 */
const { asyncHandler, ok, created, ApiError, slugify } = require('../utils/helpers');
const ai = require('../services/ai.service');
const { q, q1, exec, tx } = require('../config/db');

const generate = asyncHandler(async (req, res) => {
  if (!ai.hasKey) throw ApiError.serviceUnavailable('AI not configured. Set AI_PROVIDER + AI_API_KEY in backend .env (get a free key at aistudio.google.com).');
  const { type, ...params } = req.body;
  if (!['course', 'quiz', 'problem'].includes(type)) throw ApiError.badRequest('type must be course|quiz|problem');
  const data = await ai.generate(type, params);
  ok(res, { provider: ai.provider, model: ai.model, data });
});

const status = asyncHandler(async (req, res) => {
  ok(res, {
    provider: ai.provider, model: ai.model,
    configured: ai.hasKey,
    setup_instructions: ai.hasKey ? null : {
      step_1: 'Get a free API key from https://aistudio.google.com/apikey',
      step_2: `In backend/.env add:\nAI_PROVIDER=gemini\nAI_API_KEY=<your key>\nAI_MODEL=gemini-2.5-flash`,
      step_3: 'Restart backend.',
    }
  });
});

/* ---------------- save helpers ----------------
 * AI output is untrusted draft material. Every save is therefore:
 *   - validated against the real schema and bounded in size,
 *   - written in ONE transaction (no half-built course/quiz/problem),
 *   - saved with status='draft' for a human review before publishing.
 */
const text = (value, max, fallback = '') => String(value == null ? fallback : value).trim().slice(0, max);
const longText = (value, max = 65000) => String(value == null ? '' : value).slice(0, max);
const boundedInt = (value, fallback, min, max, label) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw ApiError.badRequest(`${label} must be between ${min} and ${max}`);
  }
  return Math.round(n);
};
const boundedDecimal = (value, fallback, min, max, label) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw ApiError.badRequest(`${label} must be between ${min} and ${max}`);
  }
  return n;
};

async function validatedCategoryId(conn, value) {
  if (value === undefined || value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw ApiError.badRequest('category_id is invalid');
  const [[category]] = await conn.query('SELECT id FROM categories WHERE id = ?', [id]);
  if (!category) throw ApiError.badRequest('category_id does not exist');
  return id;
}

async function uniqueSlug(conn, table, title, fallback) {
  const root = (slugify(title) || fallback).slice(0, 170);
  for (let i = 0; i < 100; i += 1) {
    const candidate = i ? `${root}-${i + 1}` : root;
    // Table names here are fixed internal literals, never request data.
    const [[clash]] = await conn.query(`SELECT id FROM ${table} WHERE slug = ?`, [candidate]);
    if (!clash) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

function normalizedStarterCode(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw ApiError.badRequest('starter_code must be an object keyed by language');
  }
  const aliases = {
    c: 'c', cpp: 'cpp', 'c++': 'cpp', cplusplus: 'cpp', java: 'java',
    python: 'python', py: 'python', javascript: 'javascript', js: 'javascript',
    node: 'javascript', sql: 'sql',
  };
  const out = {};
  for (const [key, code] of Object.entries(value)) {
    const slug = aliases[String(key).trim().toLowerCase()];
    if (slug && typeof code === 'string') out[slug] = code.slice(0, 65000);
  }
  return out;
}

const saveCourse = asyncHandler(async (req, res) => {
  const { course, modules } = req.body || {};
  if (!course || typeof course !== 'object' || !Array.isArray(modules)) {
    throw ApiError.badRequest('course + modules[] required');
  }
  if (!modules.length || modules.length > 50) {
    throw ApiError.badRequest('modules must contain between 1 and 50 items');
  }
  const title = text(course.title, 180);
  if (!title) throw ApiError.badRequest('Course title is required');
  const difficulty = course.difficulty || course.level || 'beginner';
  if (!['beginner', 'intermediate', 'advanced'].includes(difficulty)) {
    throw ApiError.badRequest('Course difficulty/level is invalid');
  }
  const normalizedModules = modules.map((module, mi) => {
    const moduleTitle = text(module && module.title, 180);
    if (!moduleTitle) throw ApiError.badRequest(`Module ${mi + 1} needs a title`);
    const lessons = Array.isArray(module.lessons) ? module.lessons : [];
    if (lessons.length > 100) throw ApiError.badRequest(`Module ${mi + 1} has too many lessons`);
    return {
      title: moduleTitle,
      description: text(module.description, 400) || null,
      lessons: lessons.map((lesson, li) => {
        const lessonTitle = text(lesson && lesson.title, 180);
        if (!lessonTitle) throw ApiError.badRequest(`Lesson ${li + 1} in module ${mi + 1} needs a title`);
        return {
          title: lessonTitle,
          description: text(lesson.description, 400) || null,
          content: longText(lesson.content_markdown ?? lesson.content ?? ''),
          duration: boundedInt(lesson.duration_minutes, 10, 1, 1440, 'lesson duration_minutes'),
          isPreview: lesson.is_preview ? 1 : 0,
        };
      }),
    };
  });
  const lessonsCount = normalizedModules.reduce((sum, module) => sum + module.lessons.length, 0);
  if (lessonsCount > 500) throw ApiError.badRequest('A generated course may contain at most 500 lessons');

  const courseId = await tx(async (conn) => {
    const categoryId = await validatedCategoryId(conn, course.category_id);
    const slug = await uniqueSlug(conn, 'courses', title, 'ai-course');
    const [courseResult] = await conn.execute(
      `INSERT INTO courses
         (title, slug, summary, description, category_id, difficulty, language,
          duration_hours, lessons_count, instructor_id, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,'draft')`,
      [title, slug, text(course.summary || course.short_description, 300) || null,
        longText(course.description || ''), categoryId, difficulty,
        text(course.language, 60) || null,
        boundedDecimal(course.duration_hours, 4, 0, 10000, 'duration_hours'),
        lessonsCount, req.user.id],
    );
    const newCourseId = courseResult.insertId;
    for (let mi = 0; mi < normalizedModules.length; mi += 1) {
      const module = normalizedModules[mi];
      const [moduleResult] = await conn.execute(
        'INSERT INTO course_modules (course_id, title, description, position) VALUES (?,?,?,?)',
        [newCourseId, module.title, module.description, mi + 1],
      );
      for (let li = 0; li < module.lessons.length; li += 1) {
        const lesson = module.lessons[li];
        await conn.execute(
          `INSERT INTO lessons
             (module_id, course_id, title, description, content, duration_minutes, position, is_preview)
           VALUES (?,?,?,?,?,?,?,?)`,
          [moduleResult.insertId, newCourseId, lesson.title, lesson.description,
            lesson.content, lesson.duration, li + 1, lesson.isPreview],
        );
      }
    }
    return newCourseId;
  });
  created(res, { course_id: courseId, status: 'draft', lessons_count: lessonsCount });
});

function normalizedQuizQuestions(questions, defaultDifficulty) {
  return questions.map((question, index) => {
    const questionText = longText(question && question.question_text, 20000).trim();
    if (!questionText) throw ApiError.badRequest(`Question ${index + 1} needs question_text`);
    let type = question.type || question.question_type || 'mcq';
    if (!['mcq', 'multiple', 'true_false'].includes(type)) {
      throw ApiError.badRequest(`Question ${index + 1} has unsupported type ${type}`);
    }
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const options = rawOptions.map((option) => {
      if (typeof option === 'string') return { text: text(option, 1000), correct: false };
      return {
        text: text(option && (option.option_text ?? option.text ?? option.label), 1000),
        correct: Boolean(option && (option.is_correct ?? option.correct)),
      };
    }).filter((option) => option.text);

    let correctAnswer;
    if (type === 'true_false') {
      const marked = options.find((option) => option.correct);
      const rawCorrect = String(
        question.correct_answer ?? (marked ? marked.text : ''),
      ).trim().toLowerCase();
      if (!['true', 'false'].includes(rawCorrect)) {
        throw ApiError.badRequest(`Question ${index + 1} needs a True/False correct answer`);
      }
      correctAnswer = rawCorrect === 'true' ? 'True' : 'False';
      return {
        type, questionText, options: ['True', 'False'], correctAnswer,
        marks: boundedInt(question.marks, 1, 1, 1000, 'question marks'),
        negativeMarks: boundedDecimal(question.negative_marks, 0, 0, 100, 'question negative_marks'),
        explanation: longText(question.explanation || '', 10000) || null,
        difficulty: ['easy', 'medium', 'hard'].includes(question.difficulty)
          ? question.difficulty : defaultDifficulty,
      };
    }

    if (options.length < 2 || options.length > 10) {
      throw ApiError.badRequest(`Question ${index + 1} needs between 2 and 10 options`);
    }
    if (new Set(options.map((option) => option.text)).size !== options.length) {
      throw ApiError.badRequest(`Question ${index + 1} has duplicate options`);
    }
    const markedCorrect = options.filter((option) => option.correct).map((option) => option.text);
    if (markedCorrect.length) {
      if (type === 'mcq' && markedCorrect.length !== 1) {
        throw ApiError.badRequest(`Question ${index + 1} must mark exactly one correct option`);
      }
      correctAnswer = type === 'multiple' ? markedCorrect : markedCorrect[0];
    } else if (question.correct_answer !== undefined) {
      // Accept an option index from older generators, but store the option
      // TEXT — that is what the runner submits and evaluator compares.
      const raw = question.correct_answer;
      const values = Array.isArray(raw) ? raw : [raw];
      const mapped = values.map((value) => {
        if (typeof value === 'number' && options[value]) return options[value].text;
        const numeric = Number(value);
        if (String(value).trim() !== '' && Number.isInteger(numeric)
            && options[numeric] && !options.some((option) => option.text === String(value))) {
          return options[numeric].text;
        }
        return String(value);
      });
      if (!mapped.length || mapped.some((value) => !options.some((option) => option.text === value))) {
        throw ApiError.badRequest(`Question ${index + 1} has a correct answer outside its options`);
      }
      if (type === 'mcq' && mapped.length !== 1) {
        throw ApiError.badRequest(`Question ${index + 1} must have exactly one correct answer`);
      }
      correctAnswer = type === 'multiple' ? mapped : mapped[0];
    } else {
      throw ApiError.badRequest(`Question ${index + 1} does not identify a correct option`);
    }

    return {
      type, questionText,
      options: options.map((option) => option.text), correctAnswer,
      marks: boundedInt(question.marks, 1, 1, 1000, 'question marks'),
      negativeMarks: boundedDecimal(question.negative_marks, 0, 0, 100, 'question negative_marks'),
      explanation: longText(question.explanation || '', 10000) || null,
      difficulty: ['easy', 'medium', 'hard'].includes(question.difficulty)
        ? question.difficulty : defaultDifficulty,
    };
  });
}

const saveQuiz = asyncHandler(async (req, res) => {
  const { quiz, questions } = req.body || {};
  if (!quiz || typeof quiz !== 'object' || !Array.isArray(questions)) {
    throw ApiError.badRequest('quiz + questions[] required');
  }
  if (!questions.length || questions.length > 200) {
    throw ApiError.badRequest('questions must contain between 1 and 200 items');
  }
  const title = text(quiz.title, 200);
  if (!title) throw ApiError.badRequest('Quiz title is required');
  const difficulty = quiz.difficulty || 'easy';
  if (!['easy', 'medium', 'hard'].includes(difficulty)) throw ApiError.badRequest('Quiz difficulty is invalid');
  const rawType = quiz.quiz_type || 'normal';
  const quizType = rawType === 'graded' ? 'normal' : rawType;
  if (!['normal', 'practice'].includes(quizType)) {
    throw ApiError.badRequest('AI save supports normal/practice quizzes; create live sessions from Live Hosting');
  }
  const normalizedQuestions = normalizedQuizQuestions(questions, difficulty);
  const totalMarks = normalizedQuestions.reduce((sum, question) => sum + question.marks, 0);

  const quizId = await tx(async (conn) => {
    const categoryId = await validatedCategoryId(conn, quiz.category_id);
    const slug = await uniqueSlug(conn, 'quizzes', title, 'ai-quiz');
    const [quizResult] = await conn.execute(
      `INSERT INTO quizzes
         (title, slug, description, category_id, difficulty, quiz_type, total_marks,
          question_count, negative_marking, time_limit_minutes, passing_score,
          status, show_answers_after, allow_reattempt, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?)`,
      [title, slug, longText(quiz.description || '', 20000) || null, categoryId, difficulty,
        quizType, totalMarks, normalizedQuestions.length,
        boundedDecimal(quiz.negative_marking, 0, 0, 100, 'negative_marking'),
        boundedInt(quiz.time_limit_minutes ?? quiz.duration_minutes, 15, 1, 1440, 'time_limit_minutes'),
        boundedInt(quiz.passing_score, 40, 0, 100, 'passing_score'),
        quiz.show_answers_after === undefined ? 1 : (quiz.show_answers_after ? 1 : 0),
        quiz.allow_reattempt ? 1 : 0, req.user.id],
    );
    const newQuizId = quizResult.insertId;
    for (let i = 0; i < normalizedQuestions.length; i += 1) {
      const question = normalizedQuestions[i];
      await conn.execute(
        `INSERT INTO quiz_questions
           (quiz_id, type, question_text, options, correct_answer, marks,
            negative_marks, difficulty, explanation, position)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [newQuizId, question.type, question.questionText, JSON.stringify(question.options),
          JSON.stringify(question.correctAnswer), question.marks, question.negativeMarks,
          question.difficulty, question.explanation, i + 1],
      );
    }
    return newQuizId;
  });
  created(res, { quiz_id: quizId, status: 'draft', question_count: normalizedQuestions.length, total_marks: totalMarks });
});

const saveProblem = asyncHandler(async (req, res) => {
  const { problem, test_cases: testCases, starter_code: starterCode } = req.body || {};
  if (!problem || typeof problem !== 'object') throw ApiError.badRequest('problem object required');
  if (!Array.isArray(testCases) || !testCases.length || testCases.length > 100) {
    throw ApiError.badRequest('A generated problem needs between 1 and 100 test cases');
  }
  const title = text(problem.title, 200);
  const description = longText(problem.description || '').trim();
  if (!title || !description) throw ApiError.badRequest('Problem title and description are required');
  const difficulty = problem.difficulty || 'easy';
  if (!['easy', 'medium', 'hard'].includes(difficulty)) throw ApiError.badRequest('Problem difficulty is invalid');

  const normalizedTests = testCases.map((test, index) => {
    if (!test || typeof test !== 'object' || !('expected_output' in test)) {
      throw ApiError.badRequest(`Test case ${index + 1} needs expected_output`);
    }
    const hidden = test.is_hidden !== undefined
      ? Boolean(test.is_hidden)
      : !Boolean(test.is_sample);
    return {
      input: longText(test.input ?? '', 65000),
      expectedOutput: longText(test.expected_output ?? '', 65000),
      isHidden: hidden ? 1 : 0,
      points: boundedInt(test.points ?? test.weight, 5, 0, 100000, 'test-case points'),
    };
  });
  if (!normalizedTests.some((test) => !test.isHidden)) normalizedTests[0].isHidden = 0;

  const tags = Array.isArray(problem.tags)
    ? problem.tags.map((tag) => text(tag, 60)).filter(Boolean).slice(0, 20)
    : [];
  const hints = problem.hints === undefined ? null
    : (Array.isArray(problem.hints) ? JSON.stringify(problem.hints.slice(0, 20)) : longText(problem.hints));

  const problemId = await tx(async (conn) => {
    const categoryId = await validatedCategoryId(conn, problem.category_id);
    const slug = await uniqueSlug(conn, 'coding_problems', title, 'ai-problem');
    const [problemResult] = await conn.execute(
      `INSERT INTO coding_problems
         (title, slug, description, difficulty, category_id, points, constraints,
          input_format, output_format, explanation, starter_code, tags, hints,
          time_limit_ms, memory_limit_kb, created_by, status, time_limit_minutes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'draft', ?)`,
      [title, slug, description, difficulty, categoryId,
        boundedInt(problem.points, 10, 0, 100000, 'problem points'),
        longText(problem.constraints || '') || null,
        longText(problem.input_format || '') || null,
        longText(problem.output_format || '') || null,
        longText(problem.solution_explanation ?? problem.explanation ?? '') || null,
        JSON.stringify(normalizedStarterCode(starterCode ?? problem.starter_code ?? {})),
        JSON.stringify(tags), hints,
        boundedInt(problem.time_limit_ms, 2000, 100, 60000, 'time_limit_ms'),
        boundedInt(problem.memory_limit_kb, 262144, 16384, 4194304, 'memory_limit_kb'),
        req.user.id,
        problem.time_limit_minutes ? boundedInt(problem.time_limit_minutes, 0, 1, 1440, 'time_limit_minutes') : null],
    );
    const newProblemId = problemResult.insertId;
    for (let i = 0; i < normalizedTests.length; i += 1) {
      const test = normalizedTests[i];
      await conn.execute(
        `INSERT INTO coding_test_cases
           (problem_id, input, expected_output, is_hidden, points, position)
         VALUES (?,?,?,?,?,?)`,
        [newProblemId, test.input, test.expectedOutput, test.isHidden, test.points, i + 1],
      );
    }
    return newProblemId;
  });
  created(res, { problem_id: problemId, status: 'draft', test_cases: normalizedTests.length });
});

module.exports = { generate, status, saveCourse, saveQuiz, saveProblem };
