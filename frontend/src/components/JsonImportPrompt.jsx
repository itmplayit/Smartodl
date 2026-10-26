import { useMemo, useState } from 'react';
import { Modal } from './ui';
import { useToast } from '../context/ToastContext';

const ROOT_RULES = `Return ONLY one strict raw JSON object. Do not use Markdown fences, comments, trailing commas, NaN, undefined, or explanatory text outside JSON. Internally verify that JSON.parse succeeds before answering. Do not include database IDs, slugs, status, creator data, users, access passwords, submissions, attempts, participants, rankings, or results.`;

export const JSON_IMPORT_PROMPTS = [
  {
    id: 'coding',
    label: 'Standalone Coding Problems',
    description: 'For Coding Arena → Problem Management: problem statements, starter code, public examples and hidden judge tests.',
    text: `You are generating a production-ready SmartODL coding-problem JSON import package.

Create [NUMBER_OF_PROBLEMS] original coding problem(s) about [TOPIC].
Difficulty: [easy / medium / hard / mixed].
Languages: [python, c, cpp, java, javascript].
Content language: [English / Hindi / bilingual].

${ROOT_RULES}

Use exactly this root structure:
{
  "schema": "smartodl-transfer",
  "version": 1,
  "kind": "coding-problems",
  "items": [
    {
      "problem": {
        "title": "Unique title",
        "description": "Complete unambiguous statement",
        "difficulty": "easy",
        "category": { "slug": "algorithms", "name": "Algorithms" },
        "points": 10,
        "constraints": "Complete constraints",
        "input_format": "Exact stdin format",
        "output_format": "Exact stdout format",
        "explanation": "Explain public examples without revealing a full solution",
        "starter_code": {
          "python": "import sys\\n\\ndef solve():\\n    pass\\n\\nif __name__ == '__main__':\\n    solve()\\n",
          "c": "#include <stdio.h>\\nint main(void) { return 0; }\\n",
          "cpp": "#include <bits/stdc++.h>\\nusing namespace std;\\nint main() { return 0; }\\n",
          "java": "public class Main { public static void main(String[] args) { } }\\n",
          "javascript": "const fs = require('fs');\\nconst input = fs.readFileSync(0, 'utf8').trim();\\n"
        },
        "tags": ["tag-one", "tag-two"],
        "hints": "A useful hint without the complete answer",
        "time_limit_ms": 2000,
        "memory_limit_kb": 262144,
        "time_limit_minutes": null
      },
      "test_cases": [
        { "input": "exact input", "expected_output": "exact output", "is_hidden": false, "points": 5, "position": 1 }
      ]
    }
  ]
}

Mandatory rules:
- Use only easy, medium, or hard difficulty.
- Every problem needs at least 2 public and 5 hidden deterministic tests.
- Cover normal, boundary, duplicate, maximum-size and overflow-sensitive cases where relevant.
- expected_output is mandatory and must exactly match the stated logic.
- Test positions start at 1 and increase without gaps.
- Starter code must compile but must not contain the solution.
- Escape all line breaks inside JSON strings as \\n.
- Keep time_limit_ms between 100 and 60000 and memory_limit_kb between 16384 and 4194304.`,
  },
  {
    id: 'quiz',
    label: 'Normal / Practice Quiz',
    description: 'MCQ, multiple-correct, true/false and short-answer question bank.',
    text: `Create a SmartODL [normal / practice] quiz about [TOPIC] for [TARGET_LEVEL].
Question count: [COUNT]. Language: [English / Hindi / bilingual].
Difficulty mix: [for example 40% easy, 40% medium, 20% hard].
Use a balanced mix of mcq, multiple, true_false and short_answer.

${ROOT_RULES}

Use this structure:
{
  "schema": "smartodl-transfer",
  "version": 1,
  "kind": "quizzes",
  "items": [{
    "quiz": {
      "title": "Quiz title",
      "description": "Instructions and syllabus",
      "category": { "slug": "general", "name": "General" },
      "difficulty": "medium",
      "quiz_type": "normal",
      "negative_marking": 0.25,
      "time_limit_minutes": 30,
      "passing_score": 40,
      "start_at": null,
      "end_at": null,
      "max_participants": null,
      "shuffle_questions": true,
      "show_answers_after": true,
      "allow_reattempt": true,
      "is_private": false
    },
    "questions": [{
      "type": "mcq",
      "question_text": "Question text",
      "question_image": null,
      "code_snippet": null,
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correct_answer": "Option A",
      "marks": 2,
      "negative_marks": 0.25,
      "difficulty": "easy",
      "explanation": "Why this answer is correct",
      "position": 1,
      "coding_languages": [],
      "starter_code": {},
      "test_cases": [],
      "time_limit_ms": 2000,
      "memory_limit_kb": 262144,
      "time_limit_seconds": null
    }]
  }]
}

Answer rules:
- mcq: 4 distinct options; correct_answer is one exact option string.
- multiple: 4–6 options; correct_answer is an array of every correct exact option string.
- true_false: options are ["True","False"]; correct_answer is exactly "True" or "False".
- short_answer: options are []; correct_answer is an array of accepted equivalent answers.
- Non-coding questions use coding_languages: [], starter_code: {}, test_cases: [].
- Every question needs a concise factual explanation.
- Positions start at 1 and increase without gaps. Avoid duplicate, ambiguous or opinion-based questions.`,
  },
  {
    id: 'live',
    label: 'Live Quiz',
    description: 'Classroom-ready synchronized live quiz package.',
    text: `Generate a classroom-ready SmartODL LIVE quiz.
Topic: [TOPIC]. Audience: [CLASS_OR_LEVEL].
Question count: [COUNT]. Duration: [MINUTES] minutes.
Language: [English / Hindi / bilingual]. Difficulty mix: [DISTRIBUTION].
Question types: [mcq / multiple / true_false / short_answer / coding / mixed].

${ROOT_RULES}
Important: this is a Live Quiz package. The root kind must be "quizzes" and quiz.quiz_type must be "live". Never return kind "coding-problems".

Return this structure:
{
  "schema": "smartodl-transfer",
  "version": 1,
  "kind": "quizzes",
  "items": [{
    "quiz": {
      "title": "Live quiz title",
      "description": "Clear student instructions",
      "category": { "slug": "live-assessment", "name": "Live Assessment" },
      "difficulty": "medium",
      "quiz_type": "live",
      "negative_marking": 0,
      "time_limit_minutes": 15,
      "passing_score": 40,
      "start_at": null,
      "end_at": null,
      "max_participants": 100,
      "shuffle_questions": true,
      "show_answers_after": true,
      "allow_reattempt": false,
      "is_private": false
    },
    "questions": []
  }]
}

Each question must include: type, question_text, question_image, code_snippet, options, correct_answer, marks, negative_marks, difficulty, explanation, position, coding_languages, starter_code, test_cases, time_limit_ms, memory_limit_kb and time_limit_seconds.
Use the same answer typing rules as SmartODL: mcq=one exact string, multiple=array of exact strings, true_false=True/False, short_answer=array of accepted answers. For coding questions use type "coding", options [], correct_answer null, coding_languages, starter_code, and at least 2 public plus 5 hidden tests shaped exactly as {"input":"...","expected_output":"...","hidden":false}. Keep shuffle_questions true. Create only one canonical question set—SmartODL automatically gives every live participant a stable individualized order and displayed numbering. Positions are continuous from 1. Questions must be answerable within the shared duration. The imported live quiz intentionally remains a draft until the host reviews and opens its lobby.`,
  },
  {
    id: 'coding-quiz',
    label: 'Quiz with Coding Questions',
    description: 'For Quiz Management: coding questions graded through public and hidden tests.',
    text: `Create a SmartODL quiz with [COUNT] original coding questions about [TOPIC].
Quiz mode: [normal / practice / live]. If live is selected, quiz.quiz_type must be exactly "live".
Level: [beginner / intermediate / advanced].
Languages: [python, c, cpp, java, javascript].

${ROOT_RULES}

Use schema "smartodl-transfer", version 1, kind "quizzes", and items [{"quiz":{...},"questions":[...]}]. Never use kind "coding-problems". The quiz object must include title, description, category {slug,name}, difficulty, quiz_type set to the selected Quiz mode, negative_marking, time_limit_minutes, passing_score, start_at:null, end_at:null, max_participants:null, shuffle_questions:false, show_answers_after:true, allow_reattempt:false, is_private:false.

Every question must use this exact shape:
{
  "type": "coding",
  "question_text": "Complete statement with input/output and constraints",
  "question_image": null,
  "code_snippet": null,
  "options": [],
  "correct_answer": null,
  "marks": 10,
  "negative_marks": 0,
  "difficulty": "medium",
  "explanation": "Conceptual explanation without a copy-paste solution",
  "position": 1,
  "coding_languages": ["python", "c", "cpp", "java", "javascript"],
  "starter_code": { "python": "import sys\\n\\ndef solve():\\n    pass\\n", "c": "#include <stdio.h>\\nint main(void) { return 0; }\\n", "cpp": "#include <bits/stdc++.h>\\nusing namespace std;\\nint main() { return 0; }\\n", "java": "public class Main { public static void main(String[] args) { } }\\n", "javascript": "const fs = require('fs');\\nconst input = fs.readFileSync(0, 'utf8').trim();\\n" },
  "test_cases": [
    { "input": "input", "expected_output": "output", "hidden": false },
    { "input": "edge input", "expected_output": "edge output", "hidden": true }
  ],
  "time_limit_ms": 2000,
  "memory_limit_kb": 262144,
  "time_limit_seconds": null
}

Every coding question needs at least 2 public and 5 hidden deterministic tests covering normal and boundary cases. expected_output must be exact. correct_answer stays null because the judge grades code through test cases. Escape line breaks as \\n.`,
  },
  {
    id: 'source',
    label: 'Notes → Quiz',
    description: 'Convert pasted syllabus, notes or a question paper into import JSON.',
    text: `Convert the material after SOURCE into a SmartODL quiz JSON package.
Quiz type: [normal / practice / live]. Language: [English / Hindi / bilingual].
Create exactly [COUNT] questions using [QUESTION_TYPES]. Preserve source meaning, remove duplicates and ambiguity, and do not invent unsupported facts.

${ROOT_RULES}

Use schema "smartodl-transfer", version 1, kind "quizzes", items [{"quiz":{...},"questions":[...]}]. Include every required quiz field: title, description, category {slug,name} or null, difficulty, quiz_type, negative_marking, time_limit_minutes, passing_score, start_at, end_at, max_participants, shuffle_questions, show_answers_after, allow_reattempt, is_private.

Every question includes type, question_text, question_image, code_snippet, options, correct_answer, marks, negative_marks, difficulty, explanation, position, coding_languages, starter_code, test_cases, time_limit_ms, memory_limit_kb, time_limit_seconds.
mcq answer=one exact option; multiple answer=array; true_false options=["True","False"]; short_answer answer=array; coding answer=null with {input,expected_output,hidden} tests.

SOURCE:
[PASTE NOTES, SYLLABUS OR QUESTION PAPER HERE]`,
  },
  {
    id: 'repair',
    label: 'Repair Rejected JSON',
    description: 'Fix a package after SmartODL reports an import error.',
    text: `Repair the SmartODL package after PACKAGE using the ERROR message.

Return ONLY corrected strict JSON. Preserve educational content where possible. Use schema "smartodl-transfer", version 1, and either kind "coding-problems" with items [{problem,test_cases}] or kind "quizzes" with items [{quiz,questions}]. Never mix kinds.

Remove IDs, slugs, status, creators, users, access passwords, submissions, attempts, participants, rankings and results. Coding-problem tests use {input,expected_output,is_hidden,points,position}. Coding-quiz tests use {input,expected_output,hidden}. Ensure every quiz question has a supported type and correctly typed correct_answer. Set quiz is_private=false. Fix escaping, quotes, commas and all malformed JSON.

ERROR:
[PASTE SMARTODL IMPORT ERROR]

PACKAGE:
[PASTE REJECTED JSON]`,
  },
];

function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('Clipboard is unavailable');
}

export default function JsonImportPrompt({ defaultPrompt = 'quiz', compact = false }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(defaultPrompt);
  const selected = useMemo(
    () => JSON_IMPORT_PROMPTS.find((prompt) => prompt.id === active) || JSON_IMPORT_PROMPTS[0],
    [active],
  );

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(selected.text);
      else fallbackCopy(selected.text);
      toast.success(`${selected.label} ChatGPT prompt copied`);
    } catch (error) { toast.error(error.message || 'Could not copy prompt'); }
  };

  const download = () => {
    const blob = new Blob([`${selected.text}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `smartodl-${selected.id}-chatgpt-prompt.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <button className={`btn ${compact ? 'btn-sm ' : ''}btn-ghost`} type="button" onClick={() => { setActive(defaultPrompt); setOpen(true); }}>
        ✨ ChatGPT prompts
      </button>
      <Modal open={open} title="ChatGPT JSON prompt library" onClose={() => setOpen(false)} wide>
        <p className="small muted">Choose a prompt, replace the square-bracket placeholders, save the raw response in a <code>.json</code> file, and then use Import JSON.</p>
        <div className="tabs" style={{ overflowX: 'auto' }}>
          {JSON_IMPORT_PROMPTS.map((prompt) => (
            <button key={prompt.id} type="button" className={`tab ${active === prompt.id ? 'active' : ''}`} onClick={() => setActive(prompt.id)}>
              {prompt.label}
            </button>
          ))}
        </div>
        <div className="soft small mt-s"><strong>{selected.label}:</strong> {selected.description}</div>
        <textarea className="textarea code mt" rows="18" readOnly value={selected.text} aria-label={`${selected.label} ChatGPT prompt`} />
        <div className="row wrap mt" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" type="button" onClick={download}>⬇ Download prompt</button>
          <button className="btn btn-primary" type="button" onClick={copy}>📋 Copy prompt</button>
        </div>
      </Modal>
    </>
  );
}
