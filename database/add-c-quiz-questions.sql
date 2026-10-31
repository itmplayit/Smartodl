-- =====================================================================
--  Let Us C — Module 1 quiz + questions (one self-contained script)
--
--  Kyun: aapke INSERT me `@q` NULL tha. MySQL user-variables sirf usi
--  connection/session me zinda rehte hain jisme SET chala ho. Naya query
--  tab = naya session = @q NULL = "Column 'quiz_id' cannot be null".
--
--  Isliye: poora file EK hi baar me, EK hi tab me chalao (Workbench me
--  Ctrl+Shift+Enter = run all, ya phpMyAdmin me "Go" ek hi baar).
-- =====================================================================

-- 0) Pre-check: course exist karta hai?
SET @course_id := (SELECT id FROM courses WHERE slug = 'let-us-c' LIMIT 1);
SELECT @course_id AS course_id, 'NULL ho to pehle: npm run seed:let-us-c' AS note;

-- 1) Quiz dhoondo; na mile to banao (course se linked, taaki certificate
--    par integrity band kaam kare)
SET @q := (SELECT id FROM quizzes WHERE slug = 'let-us-c-module-1-check' LIMIT 1);

INSERT INTO quizzes
  (title, slug, description, category_id, course_id, difficulty, quiz_type,
   total_marks, passing_score, status, created_by)
SELECT
  'Let Us C — Module 1 Check',
  'let-us-c-module-1-check',
  'Short check on the first module: compiling, printf, scanf and reading compiler errors.',
  NULL,
  @course_id,
  'easy',
  'normal',
  20, 40, 'published',
  (SELECT id FROM users ORDER BY FIELD(role_id, 4, 1, 2, 3), id LIMIT 1)
FROM DUAL
WHERE @q IS NULL AND @course_id IS NOT NULL;

-- 2) Ab @q pakka set hai (yeh line NULL print kare to ruk jao)
SET @q := (SELECT id FROM quizzes WHERE slug = 'let-us-c-module-1-check' LIMIT 1);
SELECT @q AS quiz_id, 'yeh NULL nahi hona chahiye' AS note;

-- 3) Questions — sirf tab insert hote hain jab wo pehle se na hon
--    (script dobara chalane par duplicate nahi banega)

INSERT INTO quiz_questions
  (quiz_id, type, question_text, options, correct_answer, explanation, marks, difficulty, position)
SELECT @q, 'mcq',
  'Which header declares printf?',
  '["<stdlib.h>","<stdio.h>","<string.h>","<math.h>"]',
  '<stdio.h>',
  'stdio.h = standard input/output; printf, scanf, fopen sab yahin declare hain.',
  2, 'easy', 1
FROM DUAL
WHERE @q IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM quiz_questions WHERE quiz_id = @q AND question_text = 'Which header declares printf?');

INSERT INTO quiz_questions
  (quiz_id, type, question_text, options, correct_answer, explanation, marks, difficulty, position)
SELECT @q, 'mcq',
  'What does the expression 7 / 2 evaluate to in C?',
  '["3.5","3","4","1"]',
  '3',
  'Dono operands int hain, isliye integer division hota hai aur .5 truncate ho jaata hai. 3.5 chahiye to 7 / 2.0 likho.',
  2, 'easy', 2
FROM DUAL
WHERE @q IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM quiz_questions WHERE quiz_id = @q AND question_text = 'What does the expression 7 / 2 evaluate to in C?');

INSERT INTO quiz_questions
  (quiz_id, type, question_text, options, correct_answer, explanation, marks, difficulty, position)
SELECT @q, 'true_false',
  'In scanf("%d", &age), removing the & makes the program write to a random address.',
  '["True","False"]',
  'True',
  'scanf ko variable ka address chahiye. & hataya to wo value ko address samajh kar likhne ki koshish karega — undefined behaviour.',
  2, 'easy', 3
FROM DUAL
WHERE @q IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM quiz_questions WHERE quiz_id = @q AND question_text LIKE 'In scanf("%d", &age)%');

INSERT INTO quiz_questions
  (quiz_id, type, question_text, coding_languages, starter_code, test_cases,
   marks, difficulty, time_limit_ms, memory_limit_kb, explanation, position)
SELECT @q, 'coding',
  'Read two integers from stdin and print their sum.',
  '["python","javascript","c","cpp","java"]',
  '{}',
  '[{"input":"3 4","expected_output":"7"},{"input":"-2 9","expected_output":"7"}]',
  10, 'easy', 2000, 262144,
  'Split the line, convert to int, add.',
  4
FROM DUAL
WHERE @q IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM quiz_questions WHERE quiz_id = @q AND question_text = 'Read two integers from stdin and print their sum.');

-- 4) Quiz ke counters sync karo (marks/position ke hisaab se)
UPDATE quizzes q
   SET q.question_count = (SELECT COUNT(*) FROM quiz_questions WHERE quiz_id = q.id),
       q.total_marks    = (SELECT COALESCE(SUM(marks), 0) FROM quiz_questions WHERE quiz_id = q.id)
 WHERE q.id = @q;

-- 5) Result dekho
SELECT q.id AS quiz_id, q.title, q.status, q.question_count, q.total_marks, q.course_id
  FROM quizzes q
 WHERE q.id = @q;

SELECT position, type, marks, LEFT(question_text, 60) AS question
  FROM quiz_questions
 WHERE quiz_id = @q
 ORDER BY position;
