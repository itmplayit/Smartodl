export const LANGS = [
  { slug: 'c', name: 'C', mode: 'c', version: 'gcc 14' },
  { slug: 'cpp', name: 'C++', mode: 'cpp', version: 'g++ 14' },
  { slug: 'java', name: 'Java', mode: 'java', version: 'OpenJDK 21' },
  { slug: 'python', name: 'Python', mode: 'python', version: '3.13' },
  { slug: 'javascript', name: 'JavaScript', mode: 'javascript', version: 'Node 20' },
  { slug: 'sql', name: 'SQL', mode: 'sql', version: 'MariaDB' },
];

export const STARTER = {
  c: '#include <stdio.h>\n\nint main() {\n    // read input with scanf, print with printf\n    \n    return 0;\n}\n',
  cpp: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    \n    return 0;\n}\n',
  java: 'import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        \n    }\n}\n',
  python: 'import sys\n\ndef main():\n    data = sys.stdin.read().split()\n    \n\nmain()\n',
  javascript: 'const fs = require("fs");\nconst data = fs.readFileSync(0, "utf8").trim().split(/\\s+/);\n\n',
  sql: '-- The sandbox schema contains: students(id, name, cgpa, city),\n-- courses(id, title, credits), enrollments(id, student_id, course_id, marks)\nSELECT * FROM students;\n',
};

export const DIFFICULTIES = ['easy', 'medium', 'hard'];
/** courses.difficulty is a beginner/intermediate/advanced enum in the DB */
export const COURSE_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
export const QUIZ_TYPES = ['normal', 'live', 'practice'];
export const QUESTION_TYPES = [
  { value: 'mcq', label: 'MCQ (single correct)' },
  { value: 'multiple', label: 'Multiple correct' },
  { value: 'true_false', label: 'True / False' },
  { value: 'short_answer', label: 'Short answer' },
  { value: 'coding', label: 'Coding question' },
];

export const ROLE_HOME = { student: '/student', developer: '/developer', admin: '/admin', owner: '/admin' };

export const ROLE_META = {
  student: { label: 'Student', icon: '🎓' },
  developer: { label: 'Developer / Instructor', icon: '👨‍🏫' },
  admin: { label: 'Administrator', icon: '🛠' },
  owner: { label: 'Owner', icon: '🛡️', protected: true },
};

// Roles available to normal registration/account-management forms. Owner is
// intentionally omitted because it can only be created by secure bootstrap.
export const ROLES = [
  { slug: 'student', label: 'Student', icon: '🎓' },
  { slug: 'developer', label: 'Developer / Instructor', icon: '👨‍🏫' },
  { slug: 'admin', label: 'Administrator', icon: '🛠' },
];

export const PERMISSIONS = [
  ['create_course', 'Create Course', 'courses'],
  ['edit_course', 'Edit Course', 'courses'],
  ['delete_course', 'Delete Course', 'courses'],
  ['upload_notes', 'Upload Notes', 'notes'],
  ['create_quiz', 'Create Quiz', 'quizzes'],
  ['host_quiz', 'Host Live Quiz', 'quizzes'],
  ['manage_anticheat', 'Manage Anti-cheat', 'quizzes'],
  ['create_problem', 'Create Coding Problem', 'coding'],
  ['create_contest', 'Create Contest', 'contests'],
  ['view_student_data', 'View Student Data', 'analytics'],
  ['view_submissions', 'View Submissions', 'coding'],
];
