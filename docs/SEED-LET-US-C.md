# Seeding the "Let Us C" course

A ready-made beginner C programming course: **4 modules, 21 lessons, ~11.5 hours**, created by an idempotent script that runs against your own database.

## Run it (Windows PowerShell)

```powershell
cd F:\Project\smartodl\backend
npm ci
npm run migrate
npm run seed:let-us-c
```

The script prints what it will create, then writes everything in **one transaction**.

| Flag | Effect |
| --- | --- |
| `-- --dry-run` | Print the module/lesson plan only; nothing is written |
| `-- --draft` | Create as a draft instead of published |
| `-- --instructor=email@example.com` | Attribute the course to a specific account |

Default instructor is the first active **owner**, otherwise the first **admin**. If neither exists, run `npm run owner:bootstrap` first.

Re-running is safe: if the slug `let-us-c` already exists the script prints `course already exists` and exits without touching anything.

## What gets created

| Module | Lessons |
| --- | --- |
| 1 — Getting Started with C | What C is and where it runs · Setting up your toolchain · Your first program, line by line · Variables, data types and input · Reading compiler errors without panic |
| 2 — Control Flow and Functions | Operators and expressions · if / else if / switch · Loops · Writing and calling functions · Scope, storage and recursion |
| 3 — Arrays, Strings and Pointers | Arrays and iteration · Strings as character arrays · Pointers · Pointers and arrays together · Dynamic memory (malloc/free) · Mini project: word counter |
| 4 — Structures, Files and a Capstone | Structures and typedef · Arrays of structures · Reading and writing files · Debugging with gdb and printf · Capstone: student-record CLI |

Course fields: title **Let Us C**, slug `let-us-c`, level *beginner*, language *English*, price **0 (free)**, category **Programming** (created if missing), duration 11.5 h, 21 lessons, first lesson marked preview.

Every lesson body is Markdown-ish text with explanations, runnable `c` code and a "Try it" task.

## About the name

The title is used only as the learner-facing course name. **All lesson text here is original SmartODL material** — no text, exercise or example is copied from the book *Let Us C* by Yashavant Kanetkar, and the course is not affiliated with it. If you would rather avoid the name entirely, rename the course in **Admin → Courses** after seeding; the slug can stay or be changed there.

## After seeding

- Edit or extend content in **Admin → Modules & Lessons**.
- Link an assessment to it so its certificate can show the integrity band: **Admin → Quizzes → Edit quiz → Linked course → Let Us C**.
- Attach an assessment to it: **Admin → Quizzes → Edit quiz → "Linked course"**, then tick this course. The quiz then shows in the course page's *Course assessments* section.

## Verified on a real database

Run against MariaDB 11.8 with the bundled schema: migrations applied cleanly (including `certificate-integrity`), the script created 4 modules / 21 lessons exactly once, `GET /api/courses/let-us-c` returned all modules and lessons, and a re-run was a no-op.
