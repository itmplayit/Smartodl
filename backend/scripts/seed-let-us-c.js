'use strict';
/**
 * Seeds the "Let Us C" course: 4 modules with 22 lessons, in the learner's own
 * SmartODL database.
 *
 *   cd backend
 *   npm run seed:let-us-c            # create it (published)
 *   npm run seed:let-us-c -- --draft # create it as a draft for review
 *   npm run seed:let-us-c -- --dry-run
 *   npm run seed:let-us-c -- --instructor=you@example.com
 *
 * Safety:
 *   • Idempotent — if the slug `let-us-c` already exists it does nothing.
 *   • Never deletes anything. Everything happens in one transaction.
 *   • All lesson text below is original SmartODL material written for this
 *     course. No text, exercise or example is copied from the book "Let Us C";
 *     the title is used only as the learner-facing course name.
 */
require('dotenv').config();
const { q, q1, tx } = require('../config/db');

const SLUG = 'let-us-c';
const TITLE = 'Let Us C';
const SUMMARY = 'A complete beginner-to-confident C programming course: syntax, control flow, functions, arrays, strings, pointers, structs and files — ending in a working capstone.';

const DESCRIPTION = `C is still the best first systems language: small, strict and close to the machine. This course walks you from your first "hello, world" to a small working record-keeping program, with runnable examples at every step.

**What makes this course different**
Every lesson ends with a small task you can run on your own machine. Compiler errors are treated as teaching material rather than failures — a large part of writing C is reading messages carefully.

**Who this is for**
Beginners with no prior programming experience, and learners moving from a dynamic language who want to understand memory and pointers properly.

**Note on the course name:** this is an independently written SmartODL curriculum. It is not affiliated with, endorsed by, or copied from any published book of the same name.`;

/* ------------------------------------------------------------------ content */
const MODULES = [
  {
    title: 'Module 1 — Getting Started with C',
    description: 'Install a compiler, write your first program, and get comfortable with variables, input and output.',
    lessons: [
      {
        title: 'What C is and where it runs',
        duration_minutes: 20,
        is_preview: true,
        description: 'Why C still matters, what a compiler does, and where C code runs today.',
        content: `## In this lesson
- What a compiled language means compared with an interpreted one
- Where C is used: operating systems, embedded firmware, databases, language runtimes
- How source code becomes a running program: preprocess → compile → link → execute

## Concept
You write text in a \`.c\` file. The compiler translates that text into machine instructions, the linker joins it with library code, and the operating system loads the result.

\`\`\`
hello.c  →  preprocessor  →  compiler  →  object file  →  linker  →  a.out
\`\`\`

C gives you direct control over memory and does almost nothing behind your back — which is exactly why it teaches you how programs really work.

## Try it
Open a terminal and check whether a compiler is already installed:

\`\`\`bash
cc --version
\`\`\`

If that prints a version, you are ready for the next lesson.`,
      },
      {
        title: 'Setting up your toolchain',
        duration_minutes: 25,
        description: 'Install gcc or clang and learn the compile flags you will use every day.',
        content: `## Install
- **Windows:** install MSYS2 or use WSL, then \`pacman -S mingw-w64-ucrt-x86_64-gcc\` (MSYS2) or \`sudo apt install build-essential\` (WSL)
- **macOS:** \`xcode-select --install\` (installs clang)
- **Linux:** \`sudo apt install build-essential\` or the equivalent for your distribution

## The four flags worth memorising
\`\`\`bash
cc -Wall -Wextra -std=c17 -o hello hello.c
./hello
\`\`\`

- \`-Wall\` and \`-Wextra\` switch on useful warnings. Do not ignore them.
- \`-std=c17\` pins the language version so your code behaves the same everywhere.
- \`-o hello\` names the output file.

## Habit
Always compile with warnings on, and fix warnings before adding features. A warning today is a bug with a delay fuse.`,
      },
      {
        title: 'Your first program, line by line',
        duration_minutes: 25,
        description: 'Understand every token in a minimal C program, including main and printf.',
        content: `## The program
\`\`\`c
#include <stdio.h>

int main(void)
{
    printf("hello, world\\n");
    return 0;
}
\`\`\`

## Line by line
- \`#include <stdio.h>\` pastes in the declarations for standard input/output, including \`printf\`.
- \`int main(void)\` is the entry point. The operating system calls it. \`void\` means "takes no arguments".
- \`printf\` writes formatted text to standard output. \`\\n\` ends the line.
- \`return 0;\` tells the operating system the program succeeded.

## Try it
Change the message, recompile, run. Then delete a semicolon on purpose and read the compiler error carefully — note how it names the file and line number.`,
      },
      {
        title: 'Variables, data types and input',
        duration_minutes: 35,
        description: 'Declare variables of the core integer and floating types and read input with scanf.',
        content: `## Core types
\`\`\`c
#include <stdio.h>

int main(void)
{
    int age = 0;
    double height = 0.0;
    char grade = 'A';

    printf("Age: ");
    if (scanf("%d", &age) != 1) {
        printf("That was not a number.\\n");
        return 1;
    }
    printf("You are %d years old, grade %c.\\n", age, grade);
    return 0;
}
\`\`\`

## Points to notice
- Every variable must be declared with a type; C does not guess.
- \`&\` passes the **address** of a variable to \`scanf\`, because \`scanf\` must be able to write into it.
- \`scanf\` returns how many items it read. Checking that return value is the difference between a robust program and a crash.
- \`int\` is usually 4 bytes, \`double\` 8 bytes, \`char\` 1 byte — \`sizeof\` tells you for sure on any machine.

## Try it
Print \`sizeof(int)\` and \`sizeof(double)\` on your machine.`,
      },
      {
        title: 'Reading compiler errors without panic',
        duration_minutes: 20,
        description: 'A method for turning red compiler output into a fix in under a minute.',
        content: `## A repeatable method
1. Read the **first** error only. Later errors are often caused by the first one.
2. Note the file and line number, open that line.
3. Read the message for the *thing* it expected: \`expected ';' before '}' token\`, \`undeclared identifier\`, \`too few arguments to function\`.
4. Fix one thing, recompile.

## The five errors beginners meet most
| Message | Usual cause |
| --- | --- |
| \`expected ';' before ...\` | missing semicolon on the previous line |
| \`undeclared identifier 'x'\` | typo, or variable used before declaration |
| \`implicit declaration of function\` | forgot \`#include\` for the header |
| \`format '%d' expects argument of type 'int'\` | wrong printf/scanf specifier |
| \`warning: unused variable\` | declared but never used — remove it |

## Try it
Write a program with three deliberate mistakes, compile, and fix them one at a time. This is faster to learn than reading about it.`,
      },
    ],
  },
  {
    title: 'Module 2 — Control Flow and Functions',
    description: 'Make decisions, repeat work, and break programs into functions that you can test.',
    lessons: [
      {
        title: 'Operators and expressions',
        duration_minutes: 30,
        description: 'Arithmetic, comparison, logical and assignment operators, plus integer division traps.',
        content: `## The families
\`\`\`c
int a = 7, b = 2;
a + b;      /* 9  */
a / b;      /* 3  — integer division truncates */
a % b;      /* 1  — remainder */
a > b;      /* 1  — true */
a == b;     /* 0  — false */
a > 0 && b > 0;  /* logical AND */
!a;              /* logical NOT */
\`\`\`

## The trap that costs marks
\`7 / 2\` is \`3\`, not \`3.5\`. To get a fractional result, at least one operand must be floating point: \`7 / 2.0\`.

## Precedence
Multiplication and division bind tighter than addition; comparison tighter than \`&&\`; \`&&\` tighter than \`||\`. When unsure, add parentheses — they cost nothing and prevent real bugs.

## Try it
Predict the value of \`1 + 2 * 3 - 4 / 2\` before running it, then check.`,
      },
      {
        title: 'if, else if and switch',
        duration_minutes: 30,
        description: 'Branch on conditions and choose between if-chains and switch statements.',
        content: `## if-chain
\`\`\`c
int marks = 0;
scanf("%d", &marks);

if (marks >= 90)       printf("A\\n");
else if (marks >= 75)  printf("B\\n");
else if (marks >= 60)  printf("C\\n");
else                   printf("Needs work\\n");
\`\`\`

## switch
\`\`\`c
switch (grade) {
    case 'A': printf("Excellent\\n"); break;
    case 'B': printf("Good\\n");      break;
    default:  printf("Check the result\\n");
}
\`\`\`

## Rules of thumb
- Use \`switch\` for a fixed set of integer or character options; use \`if\` for ranges and compound conditions.
- **Do not forget \`break\`** — without it, execution falls through into the next case.
- Always handle the unexpected case with \`default\` or a final \`else\`.

## Try it
Write a program that prints the number of days in a month using \`switch\`, treating February separately.`,
      },
      {
        title: 'Loops: for, while and do-while',
        duration_minutes: 35,
        description: 'Choose the right loop, avoid off-by-one errors, and stop loops correctly.',
        content: `## Three loops, three purposes
\`\`\`c
for (int i = 1; i <= 5; i++) printf("%d ", i);          /* counted */

int n = 5;
while (n > 0) { printf("%d ", n); n--; }                 /* condition first */

int attempt = 0;
do { attempt++; } while (attempt < 3);                   /* runs at least once */
\`\`\`

## Off-by-one
\`for (int i = 0; i < n; i++)\` visits \`n\` items (0..n-1). \`i <= n\` visits \`n+1\`. Decide which you mean before you type.

## Breaking out
- \`break\` leaves the loop now.
- \`continue\` skips to the next iteration.
- Prefer a clear loop condition over deeply nested breaks.

## Try it
Print a triangle of stars for a height read from the user. Then print it upside down without copying the loops.`,
      },
      {
        title: 'Writing and calling functions',
        duration_minutes: 35,
        description: 'Declare prototypes, pass arguments, and return values cleanly.',
        content: `## Declaration, definition, call
\`\`\`c
#include <stdio.h>

/* prototype: tells the compiler the shape before it is used */
int square(int x);

int main(void)
{
    printf("%d\\n", square(7));
    return 0;
}

int square(int x)
{
    return x * x;
}
\`\`\`

## Why prototypes matter
C reads top to bottom. Without a prototype the compiler assumes a default return type and you get confusing errors. Declare every function before you call it.

## Good function habits
- One job per function, described by its name.
- Prefer returning a value over printing inside the function — printing makes a function hard to reuse and test.
- Keep the parameter list short; if it grows past five, the function is usually doing too much.

## Try it
Move \`square\` into a second file \`math_utils.c\`, compile both files together, and see how the prototype keeps the two files compatible.`,
      },
      {
        title: 'Scope, storage and recursion',
        duration_minutes: 30,
        description: 'Block scope, the static keyword, and a safe first recursion.',
        content: `## Scope
A variable declared inside a block exists only in that block. Two functions can each have their own \`int count\` without interfering.

\`\`\`c
void counter(void)
{
    static int calls = 0;   /* keeps its value between calls */
    calls++;
    printf("called %d time(s)\\n", calls);
}
\`\`\`

## Recursion
\`\`\`c
long factorial(int n)
{
    if (n <= 1) return 1;       /* base case must come first */
    return n * factorial(n - 1);
}
\`\`\`

Every recursive function needs a base case that is guaranteed to be reached, otherwise the stack fills and the program crashes.

## Try it
Write \`fibonacci(int n)\` both recursively and with a loop, and compare how many calls the recursive version makes for n = 30. This is the clearest demonstration of why algorithmic cost matters.`,
      },
    ],
  },
  {
    title: 'Module 3 — Arrays, Strings and Pointers',
    description: 'Store many values, work with text, and understand memory addresses for real.',
    lessons: [
      {
        title: 'Arrays and iteration',
        duration_minutes: 30,
        description: 'Declare fixed-size arrays, loop over them, and avoid reading past the end.',
        content: `## Basics
\`\`\`c
int marks[5] = {72, 81, 66, 90, 58};
int total = 0;

for (int i = 0; i < 5; i++) total += marks[i];
printf("average = %.2f\\n", total / 5.0);
\`\`\`

## The one rule that prevents most crashes
C does not check array bounds. \`marks[5]\` on a five-element array is **outside** the array and is undefined behaviour. Your loop condition is your only protection — keep it strict (\`i < 5\`).

## Try it
Find the largest and smallest value in an array in a single pass, then reverse the array in place without creating a second array.`,
      },
      {
        title: 'Strings as character arrays',
        duration_minutes: 35,
        description: 'Null-terminated strings, string.h functions, and the classic overflow bug.',
        content: `## A string is a char array ending in '\\0'
\`\`\`c
#include <stdio.h>
#include <string.h>

int main(void)
{
    char name[32];
    printf("Name: ");
    if (scanf("%31s", name) != 1) return 1;   /* limit the width! */
    printf("%s has %zu characters\\n", name, strlen(name));
    return 0;
}
\`\`\`

## Why the width matters
\`scanf("%s", name)\` has no idea how big \`name\` is. A long input writes past the end of the array. \`%31s\` caps the input at 31 characters, leaving room for \`'\\0'\`.

## The functions you will use
\`strlen\`, \`strcmp\`, \`strcpy\`, \`strncpy\`, \`strcat\`, \`strchr\`. Prefer the \`n\` versions when copying, and remember \`strcmp\` returns 0 when strings are equal.

## Try it
Read a sentence with \`fgets\`, remove the trailing newline, and count vowels.`,
      },
      {
        title: 'Pointers: addresses made explicit',
        duration_minutes: 40,
        description: 'Take an address with &, follow it with *, and pass variables to functions by reference.',
        content: `## Two operators
\`\`\`c
int value = 42;
int *p = &value;      /* p holds the address of value */

printf("%d\\n", *p);   /* 42 — dereference reads through the pointer */
*p = 7;               /* writes through the pointer */
printf("%d\\n", value);/* 7 */
\`\`\`

## Why anyone wants this
\`\`\`c
void swap(int *a, int *b)
{
    int tmp = *a;
    *a = *b;
    *b = tmp;
}

int x = 1, y = 2;
swap(&x, &y);   /* now x == 2, y == 1 */
\`\`\`

C passes arguments by value. Pointers are how a function reaches back into the caller's variables — the same reason \`scanf\` needs \`&\`.

## Safety rules
- Initialise a pointer before you use it; an uninitialised pointer points somewhere random.
- \`NULL\` means "points at nothing" — check for it before dereferencing.
- Never return the address of a local variable; the storage disappears when the function returns.

## Try it
Write \`void min_max(const int *arr, int n, int *out_min, int *out_max)\` and use it from \`main\`.`,
      },
      {
        title: 'Pointers and arrays together',
        duration_minutes: 30,
        description: 'See why arr[i] and *(arr + i) are the same thing, and pass arrays to functions.',
        content: `## The equivalence
\`\`\`c
int arr[4] = {10, 20, 30, 40};
int *p = arr;             /* the array name decays to the address of arr[0] */

arr[2];    /* 30 */
*(arr+2);  /* 30 — exactly the same expression */
*(p+2);    /* 30 */
\`\`\`

## Arrays in function parameters
\`\`\`c
int sum(const int *values, int n)
{
    int total = 0;
    for (int i = 0; i < n; i++) total += values[i];
    return total;
}
\`\`\`

An array parameter is really a pointer: the function does **not** receive a copy of the data, and it does not know the length. That is why \`n\` must be passed separately — and why \`const\` is a good idea when you only read.

## Try it
Rewrite a loop using pointer arithmetic (\`p++\`) instead of an index, then confirm the output is identical.`,
      },
      {
        title: 'Dynamic memory: malloc and free',
        duration_minutes: 35,
        description: 'Allocate at run time, check the result, and free exactly once.',
        content: `## Allocating
\`\`\`c
#include <stdlib.h>
#include <stdio.h>

int main(void)
{
    int n = 0;
    if (scanf("%d", &n) != 1 || n <= 0) return 1;

    int *data = malloc((size_t)n * sizeof *data);
    if (!data) {                 /* allocation can fail */
        fprintf(stderr, "out of memory\\n");
        return 1;
    }

    for (int i = 0; i < n; i++) data[i] = i * i;
    printf("%d\\n", data[n - 1]);

    free(data);                  /* exactly once */
    data = NULL;                 /* do not leave a stale pointer behind */
    return 0;
}
\`\`\`

## Rules
1. \`malloc\` returns \`NULL\` on failure — always check.
2. Free every allocation exactly once; freeing twice is undefined behaviour.
3. After \`free\`, set the pointer to \`NULL\` so a later accidental use fails loudly instead of silently corrupting memory.

## Tooling tip
Run your program under \`valgrind ./yourprog\` (Linux/macOS) or AddressSanitizer (\`cc -fsanitize=address\`) and read the leak report.`,
      },
      {
        title: 'Mini project: word counter',
        duration_minutes: 45,
        description: 'Combine strings, arrays and pointers into a small tool you can actually use.',
        content: `## Goal
Read a line of text and report the number of words, the longest word, and the number of vowels.

## Starting point
\`\`\`c
#include <stdio.h>
#include <string.h>
#include <ctype.h>

int main(void)
{
    char line[512];
    if (!fgets(line, sizeof line, stdin)) return 1;
    line[strcspn(line, "\\n")] = '\\0';

    int words = 0, vowels = 0, longest = 0, current = 0;

    for (const char *p = line; *p; p++) {
        if (isspace((unsigned char)*p)) {
            if (current > 0) { words++; if (current > longest) longest = current; }
            current = 0;
        } else {
            current++;
            char c = (char)tolower((unsigned char)*p);
            if (c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u') vowels++;
        }
    }
    if (current > 0) { words++; if (current > longest) longest = current; }

    printf("words=%d vowels=%d longest=%d\\n", words, vowels, longest);
    return 0;
}
\`\`\`

## Extend it
1. Print the longest word itself, not just its length.
2. Ignore punctuation when counting words.
3. Read until EOF instead of a single line.

## Check yourself
Test with an empty line, a single word, and a line of 500 characters. A tool that survives all three is doing real work.`,
      },
    ],
  },
  {
    title: 'Module 4 — Structures, Files and a Capstone',
    description: 'Group related data, persist it to disk, and finish with a small working application.',
    lessons: [
      {
        title: 'Structures and typedef',
        duration_minutes: 30,
        description: 'Define your own types and access their members.',
        content: `## Declaring a struct
\`\`\`c
#include <stdio.h>
#include <string.h>

typedef struct {
    int id;
    char name[40];
    double marks;
} Student;

int main(void)
{
    Student s = { .id = 1, .marks = 78.5 };
    strncpy(s.name, "Asha", sizeof s.name - 1);

    printf("%d %s %.1f\\n", s.id, s.name, s.marks);
    return 0;
}
\`\`\`

## Notes
- \`typedef\` lets you write \`Student\` instead of \`struct Student\` everywhere.
- Designated initialisers (\`.id = 1\`) are clearer and safer than positional order.
- A struct is copied by value on assignment and when passed to a function. Pass a pointer (\`const Student *\`) for anything large.
- Struct members are laid out in memory in order, but padding can make the size larger than the sum of the fields — check with \`sizeof\`.

## Try it
Write \`void print_student(const Student *s)\` and call it from \`main\`.`,
      },
      {
        title: 'Arrays of structures: record keeping',
        duration_minutes: 35,
        description: 'Store many records, search them and compute aggregate results.',
        content: `## A small in-memory database
\`\`\`c
#include <stdio.h>

typedef struct { int id; char name[40]; double marks; } Student;
#define MAX_STUDENTS 100

int main(void)
{
    Student students[MAX_STUDENTS];
    int count = 0;

    students[count++] = (Student){ .id = 1, .name = "Asha",  .marks = 78.5 };
    students[count++] = (Student){ .id = 2, .name = "Ravi",  .marks = 91.0 };
    students[count++] = (Student){ .id = 3, .name = "Meera", .marks = 64.0 };

    double total = 0;
    for (int i = 0; i < count; i++) total += students[i].marks;

    printf("%d students, average %.2f\\n", count, total / count);
    return 0;
}
\`\`\`

## Try it
1. Find the student with the highest marks without sorting.
2. Add a function \`int find_by_id(const Student *list, int count, int id)\` that returns the index or \`-1\`.
3. Sort the array by marks using a simple selection sort, then print it ranking-style.

Always keep \`count\` in step with the data — an array plus a count is the standard C idiom before you learn dynamic containers.`,
      },
      {
        title: 'Reading and writing files',
        duration_minutes: 35,
        description: 'Open, check, read, write and always close a file.',
        content: `## Write, then read back
\`\`\`c
#include <stdio.h>

int main(void)
{
    FILE *out = fopen("students.txt", "w");
    if (!out) { perror("fopen for writing"); return 1; }
    fprintf(out, "1 Asha 78.5\\n");
    fclose(out);

    FILE *in = fopen("students.txt", "r");
    if (!in) { perror("fopen for reading"); return 1; }

    int id; char name[40]; double marks;
    while (fscanf(in, "%d %39s %lf", &id, name, &marks) == 3) {
        printf("%d %s %.1f\\n", id, name, marks);
    }
    fclose(in);
    return 0;
}
\`\`\`

## Habits that prevent data loss
- Check **every** \`fopen\` result; a silent failure then writes nowhere and you debug for an hour.
- Compare \`fscanf\`'s return value with the number of fields expected — that is your end-of-file test.
- Use \`"rb"\` / \`"wb"\` when the file is not text.
- \`fclose\` flushes buffered data. A missing \`fclose\` can truncate your output.

## Try it
Extend the program so a missing input file prints a friendly message instead of crashing.`,
      },
      {
        title: 'Debugging: gdb and printf',
        duration_minutes: 30,
        description: 'Find a real bug with a debugger build, breakpoints and step execution.',
        content: `## Build for debugging
\`\`\`bash
cc -g -O0 -Wall -Wextra -o app app.c
gdb ./app
\`\`\`

## Five commands that cover most sessions
\`\`\`
break main        # stop at a function
run               # start the program
next              # step over a line
step              # step into a function
print variable    # inspect a value
backtrace         # see how execution got here
\`\`\`

## When there is no debugger
A disciplined \`printf\` is still legitimate: print the values *just before* the line that misbehaves, with a label (\`printf("before loop: n=%d\\n", n);\`). Remove the prints once fixed.

## Segfault checklist
1. Dereferencing \`NULL\` or an uninitialised pointer.
2. Writing past the end of an array.
3. Missing \`&\` in \`scanf\`.
4. Using a pointer after \`free\`.
5. Format specifier that does not match the argument type.

## Try it
Take any earlier program, introduce one of these five bugs, and find it with gdb before reading the answer.`,
      },
      {
        title: 'Capstone: a small student-record CLI',
        duration_minutes: 60,
        description: 'Bring everything together: structs, files, functions and input validation.',
        content: `## Requirements
Build a console program that can:
1. add a student (id, name, marks) with validation,
2. list all students,
3. search by id,
4. save to \`records.txt\` and load from it on start.

## Suggested structure
\`\`\`
student_cli.c
├── typedef struct Student
├── int load(const char *path, Student *list, int max)
├── int save(const char *path, const Student *list, int count)
├── int find(const Student *list, int count, int id)
└── int main(void)          /* a simple menu loop */
\`\`\`

## Menu skeleton
\`\`\`c
int choice = 0;
while (1) {
    printf("1) add  2) list  3) find  4) save  0) quit\\n> ");
    if (scanf("%d", &choice) != 1) { printf("numbers only\\n"); break; }
    if (choice == 0) break;
    /* handle choice */
}
\`\`\`

## Definition of done
- Input of the wrong type does not crash the program.
- Adding the 101st record reports "list full" rather than writing out of bounds.
- The file survives a crash: save after every change.
- \`cc -Wall -Wextra -fsanitize=address\` reports no warnings or memory errors.

## After this course
Read other people's C: start with small utilities, then try a data-structure exercise such as a linked list and a hash table. Rewriting the same program in a second language is the fastest way to see what C made explicit.`,
      },
    ],
  },
];

/* ------------------------------------------------------------------- script */

function parseArgs(argv) {
  const args = { dryRun: false, draft: false, instructor: null };
  argv.forEach((raw) => {
    if (raw === '--dry-run') args.dryRun = true;
    else if (raw === '--draft') args.draft = true;
    else if (raw.startsWith('--instructor=')) args.instructor = raw.slice('--instructor='.length).trim();
    else if (raw === '--help' || raw === '-h') args.help = true;
  });
  return args;
}

function totals() {
  const lessonCount = MODULES.reduce((sum, module) => sum + module.lessons.length, 0);
  const minutes = MODULES.reduce(
    (sum, module) => sum + module.lessons.reduce((m, lesson) => m + lesson.duration_minutes, 0), 0,
  );
  return {
    modules: MODULES.length,
    lessons: lessonCount,
    minutes,
    hours: Math.max(1, Math.round((minutes / 60) * 10) / 10),
  };
}

async function findInstructor(email) {
  if (email) {
    const row = await q1(
      "SELECT id, full_name, email FROM users WHERE email = ? AND status = 'active' LIMIT 1",
      [email],
    );
    if (!row) throw new Error(`No active user with email ${email}`);
    return row;
  }
  const row = await q1(
    `SELECT u.id, u.full_name, u.email FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.status = 'active' AND r.slug IN ('owner','admin')
      ORDER BY FIELD(r.slug, 'owner', 'admin'), u.id LIMIT 1`,
  );
  if (!row) {
    throw new Error('No active owner/admin found. Create the first owner with `npm run owner:bootstrap`, '
      + 'or pass --instructor=email@example.com');
  }
  return row;
}

async function findOrCreateCategory(name) {
  const existing = await q1(
    "SELECT id FROM categories WHERE slug = ? AND type IN ('course','all') LIMIT 1",
    [name.toLowerCase().replace(/[^a-z0-9]+/g, '-')],
  );
  if (existing) return { id: Number(existing.id), created: false };
  const result = await tx(async (conn) => {
    const [rows] = await conn.query(
      "SELECT id FROM categories WHERE slug = ? AND type IN ('course','all') LIMIT 1",
      [name.toLowerCase().replace(/[^a-z0-9]+/g, '-')],
    );
    if (rows.length) return { id: Number(rows[0].id), created: false };
    const [insert] = await conn.query(
      "INSERT INTO categories (name, slug, type, description) VALUES (?, ?, 'course', ?)",
      [name, name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 'Programming courses'],
    );
    return { id: Number(insert.insertId), created: true };
  });
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stats = totals();

  if (args.help) {
    console.log('Usage: npm run seed:let-us-c -- [--dry-run] [--draft] [--instructor=email]');
    return;
  }

  console.log(`[let-us-c] plan: ${stats.modules} modules, ${stats.lessons} lessons, `
    + `${stats.minutes} minutes (~${stats.hours} h), status=${args.draft ? 'draft' : 'published'}`);

  if (args.dryRun) {
    MODULES.forEach((module, index) => {
      console.log(`${index + 1}. ${module.title} — ${module.lessons.length} lessons`);
      module.lessons.forEach((lesson, i) => console.log(`   ${index + 1}.${i + 1} ${lesson.title} (${lesson.duration_minutes} min)`));
    });
    console.log('[let-us-c] dry run only — nothing written to the database.');
    return;
  }

  const existing = await q1('SELECT id, status FROM courses WHERE slug = ? LIMIT 1', [SLUG]);
  if (existing) {
    console.log(`[let-us-c] course already exists (id ${existing.id}, status ${existing.status}). Nothing to do.`);
    return;
  }

  const instructor = await findInstructor(args.instructor);
  const category = await findOrCreateCategory('Programming');
  console.log(`[let-us-c] instructor: ${instructor.full_name} <${instructor.email}>`
    + ` · category: Programming (id ${category.id}${category.created ? ', created' : ''})`);

  const created = await tx(async (conn) => {
    const [courseResult] = await conn.query(
      `INSERT INTO courses (title, slug, summary, description, category_id, difficulty, language,
         duration_hours, lessons_count, instructor_id, price, status, is_featured, is_premium)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0)`,
      [TITLE, SLUG, SUMMARY, DESCRIPTION, category.id, 'beginner', 'English',
        stats.hours, stats.lessons, instructor.id, 0, args.draft ? 'draft' : 'published'],
    );
    const courseId = Number(courseResult.insertId);

    for (let m = 0; m < MODULES.length; m += 1) {
      const module = MODULES[m];
      // eslint-disable-next-line no-await-in-loop
      const [moduleResult] = await conn.query(
        'INSERT INTO course_modules (course_id, title, description, position) VALUES (?,?,?,?)',
        [courseId, module.title, module.description, m + 1],
      );
      const moduleId = Number(moduleResult.insertId);

      for (let l = 0; l < module.lessons.length; l += 1) {
        const lesson = module.lessons[l];
        // eslint-disable-next-line no-await-in-loop
        await conn.query(
          `INSERT INTO lessons (module_id, course_id, title, description, content, duration_minutes, position, is_preview)
           VALUES (?,?,?,?,?,?,?,?)`,
          [moduleId, courseId, lesson.title, lesson.description, lesson.content,
            lesson.duration_minutes, l + 1, lesson.is_preview ? 1 : 0],
        );
      }
    }
    return courseId;
  });

  console.log(`[let-us-c] done. Course id ${created} → /courses/${SLUG}`);
  console.log('  Modules and lessons are editable from Admin → Modules & Lessons.');
  if (args.draft) console.log('  Created as DRAFT — publish it from Admin → Courses when you have reviewed it.');
}

main()
  .then(() => { const { pool } = require('../config/db'); return pool.end(); })
  .catch((error) => {
    console.error(`[let-us-c] failed: ${error.message}`);
    process.exitCode = 1;
    const { pool } = require('../config/db');
    return pool.end().catch(() => {});
  });
