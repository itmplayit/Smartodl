'use strict';
/**
 * AI Content Generator
 * ---------------------
 * Generates courses, quizzes, and coding problems (with test cases) using an LLM.
 * Supports: Gemini (default / free-friendly), OpenAI, Anthropic Claude.
 * Configure via .env:
 *   AI_PROVIDER = 'gemini' | 'openai' | 'anthropic'
 *   AI_API_KEY  = <your API key>
 *   AI_MODEL    = (optional) overrides the default model
 *   AI_BASE_URL = (optional) for self-hosted / OpenAI-compatible endpoints
 *
 * All responses are requested as strict JSON so we can validate & insert directly.
 * No key configured → helpful error message.
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

const PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const API_KEY = process.env.AI_API_KEY || '';
const MODEL = process.env.AI_MODEL || defaultModel(PROVIDER);
const BASE_URL = process.env.AI_BASE_URL || defaultBase(PROVIDER);

function defaultModel(p) {
  if (p === 'openai') return 'gpt-4o-mini';
  if (p === 'anthropic') return 'claude-sonnet-4-5-20250929';
  return 'gemini-2.5-flash';
}
function defaultBase(p) {
  if (p === 'openai') return 'https://api.openai.com/v1';
  if (p === 'anthropic') return 'https://api.anthropic.com/v1';
  return 'https://generativelanguage.googleapis.com/v1beta';
}

function postJson(url, headers, body, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const data = Buffer.from(JSON.stringify(body));
    const req = lib.request({
      method: 'POST', hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...headers },
      timeout: timeoutMs,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(buf);
          if (res.statusCode >= 400) {
            const err = new Error(`AI ${res.statusCode}: ${(json && json.error && json.error.message) || JSON.stringify(json).slice(0, 300)}`);
            err.httpStatus = res.statusCode;
            err.providerBody = json;
            return reject(err);
          }
          resolve(json);
        } catch (e) { reject(new Error(`Non-JSON response: ${buf.slice(0, 500)}`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('AI request timed out')));
    req.on('error', reject);
    req.write(data); req.end();
  });
}

function buildPrompt(type, params) {
  if (type === 'course') {
    const { title, level = 'beginner', modulesCount = 4, language = 'English' } = params;
    return {
      system: 'You are an expert curriculum designer for an online coding academy. Output ONLY valid JSON, no markdown, no commentary.',
      user: `Build a structured course titled "${title}" for ${level} level students.
Return JSON exactly matching this TypeScript type:
{
  "course": { "title": string, "short_description": string, "description": string, "level": "beginner"|"intermediate"|"advanced", "duration_hours": number, "tags": string[] },
  "modules": Array<{
    "title": string, "order_index": number,
    "lessons": Array<{ "title": string, "order_index": number, "content_markdown": string }>
  }>
}
- Modules count: ${modulesCount}
- Each module must contain 2-4 lessons.
- Each lesson.content_markdown must be valid Markdown, 200-500 words, with 1-2 code examples where relevant.
- Language: ${language}
- Do NOT wrap the JSON in markdown code fences.`
    };
  }
  if (type === 'quiz') {
    const { topic, questionCount = 10, difficulty = 'medium', language = 'English' } = params;
    return {
      system: 'You are a professional quiz author for a coding academy. Output ONLY valid JSON.',
      user: `Create a multiple-choice quiz on "${topic}" (${difficulty} difficulty).
Return JSON exactly matching:
{
  "quiz": { "title": string, "description": string, "duration_minutes": number, "difficulty": "easy"|"medium"|"hard", "quiz_type": "practice"|"graded" },
  "questions": Array<{
    "question_text": string, "question_type": "mcq"|"true_false", "marks": number,
    "options": Array<{ "option_text": string, "is_correct": boolean }>,
    "explanation": string
  }>
}
- Generate exactly ${questionCount} questions.
- MCQ questions must have exactly 4 options with exactly one correct.
- Include a concise explanation after each question.
- Language: ${language}`
    };
  }
  if (type === 'problem') {
    const { title, difficulty = 'medium', language = 'English' } = params;
    return {
      system: 'You are an expert competitive programming problem setter. Output ONLY valid JSON.',
      user: `Create a coding problem titled "${title}" (${difficulty}).
Return JSON exactly matching:
{
  "problem": {
    "title": string, "description": string, "difficulty": "easy"|"medium"|"hard", "points": number,
    "constraints": string, "input_format": string, "output_format": string, "sample_input": string, "sample_output": string, "solution_explanation": string
  },
  "test_cases": Array<{ "input": string, "expected_output": string, "is_sample": boolean, "weight": number }>,
  "starter_code": { "python": string, "javascript": string, "cpp": string, "java": string }
}
- Provide exactly 5 test cases: 2 samples (is_sample:true), 3 edge/hidden cases.
- starter_code must contain working function stubs reading from stdin.
- Constraints, input & output format must be precise.
- Language: ${language}`
    };
  }
  throw new Error('Unknown AI generate type: ' + type);
}

/** Map a provider HTTP/network failure to a friendly, client-visible error. */
function friendlyAiError(e) {
  const status = Number(e && e.httpStatus) || 0;
  const providerMsg = String(
    (e && e.providerBody && e.providerBody.error && e.providerBody.error.message)
    || (e && e.message) || '',
  ).slice(0, 220);
  let hint;
  if (status === 429) {
    hint = 'The AI rate limit or quota has been exhausted. Wait one or two minutes and click Generate again.';
  } else if (status === 401 || status === 403) {
    hint = 'AI_API_KEY is incorrect or expired. Put a new key in backend/.env (a free key is available from aistudio.google.com/apikey) and restart the backend.';
  } else if (status === 404) {
    hint = `AI model "${MODEL}" is not available for this API key. Set AI_MODEL=gemini-1.5-flash in backend/.env, restart the backend, and try again.`;
  } else if (status === 400) {
    hint = /key|credential|permission|not valid/i.test(providerMsg)
      ? 'AI_API_KEY appears to be invalid. Create a new free key at aistudio.google.com/apikey, put it in backend/.env, and restart the backend.'
      : 'The AI provider rejected the request. Check the AI_MODEL and prompt settings.';
  } else if (/timed out/i.test(providerMsg)) {
    hint = 'The AI request timed out. Reduce the number of modules or questions and try again.';
  } else {
    hint = 'A connection to the AI service could not be established. Check the internet connection and try again.';
  }
  const err = new Error(`${hint}${providerMsg ? ` (AI provider said: ${providerMsg})` : ''}`);
  err.statusCode = status === 429 ? 503 : 502;
  err.expose = true;
  return err;
}

/** Provider call with unified friendly error mapping. */
function guarded(promise) {
  return promise.catch((e) => { throw friendlyAiError(e); });
}

async function callLLM(messages, temperature = 0.4) {
  if (!API_KEY) {
    const err = new Error('AI provider not configured. Set AI_PROVIDER and AI_API_KEY in the backend .env file (e.g., AI_PROVIDER=gemini, AI_API_KEY=... from aistudio.google.com).');
    err.statusCode = 503; err.expose = true; throw err;
  }
  if (PROVIDER === 'gemini') {
    const url = `${BASE_URL}/models/${MODEL}:generateContent?key=${API_KEY}`;
    const body = {
      generationConfig: { temperature, responseMimeType: 'application/json' },
      contents: [{ role: 'user', parts: [{ text: messages.system + '\n\n' + messages.user }] }],
    };
    const res = await guarded(postJson(url, {}, body));
    const text = res?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return extractJson(text);
  }
  if (PROVIDER === 'openai') {
    const url = `${BASE_URL}/chat/completions`;
    const res = await guarded(postJson(url, { Authorization: `Bearer ${API_KEY}` }, {
      model: MODEL, temperature, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: messages.system }, { role: 'user', content: messages.user }],
    }));
    return extractJson(res.choices?.[0]?.message?.content || '');
  }
  if (PROVIDER === 'anthropic') {
    const url = `${BASE_URL}/messages`;
    const res = await guarded(postJson(url, {
      'x-api-key': API_KEY, 'anthropic-version': '2023-06-01',
    }, {
      model: MODEL, temperature, max_tokens: 8000,
      system: messages.system,
      messages: [{ role: 'user', content: messages.user }],
    }));
    return extractJson(res.content?.[0]?.text || '');
  }
  throw new Error('Unsupported AI_PROVIDER: ' + PROVIDER);
}

function extractJson(text) {
  if (!text) throw new Error('Empty AI response');
  // Strip markdown fences if LLM ignores instructions
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  try { return JSON.parse(raw); }
  catch (e) {
    // Last-ditch: grab first {...} block
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('AI did not return valid JSON. Raw start: ' + raw.slice(0, 200));
  }
}

module.exports = {
  provider: PROVIDER, model: MODEL, hasKey: Boolean(API_KEY),
  async generate(type, params) {
    try {
      return await callLLM(buildPrompt(type, params));
    } catch (e) {
      if (e && (e.expose || e.statusCode)) throw e;
      const err = new Error('The AI response could not be understood because valid JSON was not returned. Click Generate again; if it happens again, try a different AI_MODEL.');
      err.statusCode = 502; err.expose = true;
      throw err;
    }
  },
};
