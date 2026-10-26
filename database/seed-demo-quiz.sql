INSERT IGNORE INTO categories (name, slug, type, description, icon)
VALUES ('Programming Basics','programming-basics','quiz','Fundamentals quiz category','#');
SET @cat=(SELECT id FROM categories WHERE slug='programming-basics');
SET @uid=(SELECT id FROM users WHERE email='owner@smartodl.local');
-- The clean baseline has NO users (the first Owner is created with
-- `npm run owner:bootstrap`). Run this file only AFTER creating the Owner,
-- and adapt the email above if needed. Without a matching user @uid is NULL
-- and the guarded SELECT below inserts nothing instead of a broken quiz.
INSERT INTO quizzes (title,slug,description,category_id,difficulty,quiz_type,total_marks,question_count,
  negative_marking,time_limit_minutes,passing_score,status,shuffle_questions,show_answers_after,
  allow_reattempt,is_private,is_premium,created_by)
SELECT 'Python Fundamentals — Live','python-fundamentals-live',
 'A short live quiz covering Python basics, complexity and one coding question.',
 @cat,'easy','live',40,4,0.00,15,50,'live',0,1,1,0,0,@uid
WHERE @uid IS NOT NULL AND @cat IS NOT NULL;
SET @q=(SELECT id FROM quizzes WHERE slug='python-fundamentals-live');
INSERT INTO quiz_questions (quiz_id,type,question_text,options,correct_answer,marks,difficulty,explanation,position)
VALUES
 (@q,'mcq','What is the average-case time complexity of a dict lookup in Python?',
  '["O(1)","O(log n)","O(n)","O(n log n)"]','"O(1)"',10,'easy','Dicts are hash tables.',1),
 (@q,'true_false','Python lists are immutable.','["True","False"]','"False"',10,'easy','Lists are mutable.',2),
 (@q,'multiple','Which of these are valid Python sequence types?',
  '["list","tuple","dict","str"]','["list","tuple","str"]',10,'medium','dict is a mapping.',3);
INSERT INTO quiz_questions (quiz_id,type,question_text,coding_languages,starter_code,test_cases,
  marks,difficulty,time_limit_ms,memory_limit_kb,explanation,position)
VALUES (@q,'coding','Read two integers from stdin and print their sum.',
 '["python","javascript","c","cpp","java"]','{}',
 '[{"input":"3 4","expected_output":"7"},{"input":"-2 9","expected_output":"7"}]',
 10,'easy',2000,262144,'Split the line, convert to int, add.',4);
