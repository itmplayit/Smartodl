import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../context/ToastContext';

/** Curated question bank — interview practice without any backend dependency. */
const BANK = {
  dsa: {
    label: 'Data Structures & Algorithms', icon: '🧮',
    questions: [
      { q: 'What is the difference between an array and a linked list? When would you use each one?', hint: 'Contiguous memory versus nodes; random access O(1) versus insertion/deletion O(1) at a known position.' },
      { q: 'How does a HashMap work internally? How are collisions handled?', hint: 'Hash function → bucket array; chaining or open addressing; load factor and rehashing.' },
      { q: 'What is the time complexity of binary search, and under what condition does it work?', hint: 'O(log n); the data must be sorted; each midpoint comparison eliminates half of the remaining range.' },
      { q: 'Give real-world use cases for a stack and a queue.', hint: 'Stack: undo, recursion, expression evaluation. Queue: BFS, task scheduling, buffering.' },
      { q: 'What is the difference between BFS and DFS? Which situations favour each approach?', hint: 'BFS explores level by level (shortest path in an unweighted graph); DFS explores depth first (topological ordering and cycle detection).' },
      { q: 'Name an algorithm with O(n log n) time complexity.', hint: 'Merge sort and heap sort; divide-and-conquer partitioning.' },
      { q: 'What are the trade-offs between recursion and iteration?', hint: 'Readability versus stack-overflow risk and performance; tail-call optimisation.' },
      { q: 'When is the two-pointer technique used? Give an example.', hint: 'Pairs in a sorted array, container with most water, and removing duplicates in place.' },
      { q: 'What is the difference between greedy algorithms and dynamic programming?', hint: 'Greedy makes a locally optimal choice; dynamic programming solves overlapping subproblems with memoisation or tabulation.' },
      { q: 'How would you detect a cycle in a graph?', hint: 'DFS with visited state and a recursion stack for directed graphs; Union-Find or a parent check for undirected graphs.' },
    ],
  },
  js: {
    label: 'JavaScript / Frontend', icon: '⚛️',
    questions: [
      { q: 'What is a closure? Give a practical example.', hint: 'A function together with its lexical scope; counters, memoisation, and data-privacy patterns.' },
      { q: 'What is the difference between var, let, and const?', hint: 'Function scope versus block scope; hoisting; the temporal dead zone; reassignment rules.' },
      { q: 'How does the JavaScript event loop work? What is the difference between microtasks and macrotasks?', hint: 'Call stack and task queues; promises and MutationObserver callbacks are microtasks; setTimeout callbacks are macrotasks.' },
      { q: 'What is the role of the dependency array in React useEffect?', hint: 'An empty array runs on mount only; listed dependencies trigger a re-run when they change; cleanup runs before re-runs and on unmount.' },
      { q: 'What is the virtual DOM, and how does reconciliation work?', hint: 'A lightweight JavaScript representation of the UI; diffing, keys, and batched DOM updates.' },
      { q: 'What is the difference between == and ===?', hint: 'Type coercion versus strict comparison; remember that null == undefined is true.' },
      { q: 'How are Promises related to async/await?', hint: 'async/await is syntax built over Promises; use try/catch instead of .catch for awaited operations.' },
      { q: 'When would you use debouncing and throttling?', hint: 'Debounce search input; throttle scroll and resize handlers; both are controlled with timers.' },
      { q: 'What is the difference between localStorage, sessionStorage, and cookies?', hint: 'Persistence, per-tab scope, automatic transmission to the server, and size limits.' },
      { q: 'How is CSS specificity calculated?', hint: 'Inline styles rank above IDs, which rank above classes, attributes, and pseudo-classes, which rank above elements; understand the role of !important.' },
    ],
  },
  sql: {
    label: 'SQL & Databases', icon: '🗄️',
    questions: [
      { q: 'What is the difference between INNER JOIN and LEFT JOIN? Explain with an example.', hint: 'An inner join returns matching rows only; a left join returns every row from the left table and fills unmatched right-side columns with NULL.' },
      { q: 'What is the difference between a primary key, a unique key, and a foreign key?', hint: 'Uniqueness and NOT NULL; only one primary key per table; a foreign key enforces referential integrity.' },
      { q: 'What is an index, and how does it improve query performance?', hint: 'Usually a B-tree structure; the trade-off is additional write cost and storage.' },
      { q: 'Briefly explain the ACID properties.', hint: 'Atomicity, consistency, isolation, and durability; together they define transaction guarantees.' },
      { q: 'What is GROUP BY, and what is the difference between WHERE and HAVING?', hint: 'WHERE filters rows before aggregation; HAVING filters groups after aggregation.' },
      { q: 'What is normalisation? Briefly describe 1NF, 2NF, and 3NF.', hint: 'Reduce redundancy by removing repeating groups, partial dependencies, and transitive dependencies.' },
      { q: 'What is the difference between DELETE, TRUNCATE, and DROP?', hint: 'DML versus DDL; rollback behaviour; removal of rows versus removal of the schema object.' },
      { q: 'What is the difference between a stored procedure and a function?', hint: 'Return values, invocation style, and transaction support.' },
      { q: 'What is the N+1 query problem, and how do you solve it?', hint: 'A lazy-loading loop issues one query per row; solve it with eager joins, batching, or IN queries.' },
      { q: 'What are transaction isolation levels? What is a dirty read?', hint: 'READ UNCOMMITTED through SERIALIZABLE; dirty, non-repeatable, and phantom reads describe different anomalies.' },
    ],
  },
  hr: {
    label: 'HR & Behavioral', icon: '🤝',
    questions: [
      { q: 'Tell me about yourself in a two-minute introduction.', hint: 'Structure it as background → skills and projects → why this role. Use STAR-style examples.' },
      { q: 'What are your greatest strength and weakness?', hint: 'Support the strength with evidence; present the weakness with an honest but strategic improvement plan.' },
      { q: 'Give an example of a difficult bug or conflict that you resolved.', hint: 'Use STAR: Situation, Task, Action, Result — include measurable impact.' },
      { q: 'How would you prioritise when the deadline is tight and there is too much work?', hint: 'Use an impact-versus-effort view, communicate early, scope an MVP, and ask for help when needed.' },
      { q: 'Why do you want this company and role?', hint: 'Show company research, alignment with your goals, and specific interest in the product or technology.' },
      { q: 'How do you handle disagreement within a team?', hint: 'Listen first, discuss using data, and be ready to disagree and commit.' },
      { q: 'Have you ever taught yourself something new? How did you do it?', hint: 'Describe the learning process: documentation, projects, iteration, timeframe, and outcome.' },
      { q: 'Where do you see yourself in five years?', hint: 'Show growth orientation, a realistic leadership or specialist path, and alignment with the company.' },
      { q: 'Give an example of a failure and explain what you learned from it.', hint: 'Show ownership, identify the root cause, and describe the concrete change you made afterwards.' },
      { q: 'Do you have any questions for us?', hint: 'Ask about team culture, success metrics, and technical challenges to show genuine interest.' },
    ],
  },
};

const STORE_KEY = 'smartodl-mock-interviews';
const loadHistory = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; } };
const saveHistory = (h) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(h.slice(0, 20))); } catch { /* full */ } };

export default function MockInterviews() {
  const toast = useToast();
  const [topic, setTopic] = useState(null); // key of BANK
  const [session, setSession] = useState(null); // active session object
  const [history, setHistory] = useState(loadHistory);
  const [showHint, setShowHint] = useState(false);
  const [selfRating, setSelfRating] = useState(0);
  const [note, setNote] = useState('');

  const questions = useMemo(() => (topic ? [...BANK[topic].questions].sort(() => Math.random() - 0.5).slice(0, 5) : []), [topic, session?.startedAt]);

  const start = (key) => {
    setTopic(key);
    setSession({ startedAt: Date.now(), answers: [] });
    setShowHint(false); setSelfRating(0); setNote('');
  };

  const current = session ? questions[session.answers.length] : null;

  const rate = (stars) => {
    if (!current) return;
    const answers = [...session.answers, { q: current.q, stars, note }];
    setSelfRating(0); setNote(''); setShowHint(false);
    if (answers.length >= questions.length) {
      const avg = answers.reduce((a, x) => a + x.stars, 0) / answers.length;
      const record = { topic, label: BANK[topic].label, at: new Date().toISOString(), avg: Number(avg.toFixed(1)), count: answers.length, answers };
      const next = [record, ...history];
      setHistory(next); saveHistory(next);
      setSession({ ...session, answers, done: true, avg });
      toast.success('Interview practice complete — your history has been saved');
    } else {
      setSession({ ...session, answers });
    }
  };

  /* ------------------------------ summary screen ------------------------------ */
  if (session && session.done) {
    return (
      <div className="container section" style={{ maxWidth: 860 }}>
        <div className="card center">
          <div style={{ fontSize: '3rem' }}>{session.avg >= 4 ? '🌟' : session.avg >= 2.5 ? '👍' : '💪'}</div>
          <h1>Session complete!</h1>
          <p className="muted">{BANK[topic].label} • {session.answers.length} questions</p>
          <div style={{ fontSize: '2.4rem', fontWeight: 800, color: 'var(--brand-3)' }}>{session.avg.toFixed(1)} / 5</div>
          <p className="small muted">Average self-rating</p>
          <div className="row mt" style={{ justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => start(topic)}>🔁 Practice again</button>
            <button className="btn btn-ghost" onClick={() => { setSession(null); setTopic(null); }}>← All topics</button>
          </div>
        </div>
        <div className="card mt">
          <h3>Review your answers</h3>
          <div className="stack" style={{ gap: 8 }}>
            {session.answers.map((a, i) => (
              <div className="panel" key={i}>
                <div className="between"><strong className="small">Q{i + 1}. {a.q}</strong><span className="tag">{'★'.repeat(a.stars)}{'☆'.repeat(5 - a.stars)}</span></div>
                {a.note && <p className="tiny muted" style={{ marginBottom: 0 }}>📝 {a.note}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------ active session ------------------------------ */
  if (session && current) {
    const idx = session.answers.length;
    return (
      <div className="container section" style={{ maxWidth: 860 }}>
        <div className="between mb">
          <span className="tag">{BANK[topic].icon} {BANK[topic].label}</span>
          <span className="small muted">Question {idx + 1} / {questions.length}</span>
        </div>
        <div className="progress mb"><i style={{ width: `${(idx / questions.length) * 100}%` }} /></div>
        <div className="card">
          <h2 style={{ fontSize: '1.3rem' }}>{current.q}</h2>
          <p className="small muted">🎤 Answer aloud or in writing, then rate yourself — practise the answer you would give in a real interview.</p>
          <details className="mt-s" open={showHint} onToggle={(e) => setShowHint(e.target.open)}>
            <summary className="small" style={{ cursor: 'pointer' }}>💡 View answer hints</summary>
            <div className="soft mt-s small">{current.hint}</div>
          </details>
          <label className="field mt">Write the key points of your answer (optional)
            <textarea className="textarea" rows="3" placeholder="What I covered…" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="between mt">
            <span className="small muted">How was your answer?</span>
            <div className="row" style={{ gap: 4 }}>
              {[1, 2, 3, 4, 5].map((i) => (
                <button key={i} onClick={() => rate(i)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', padding: 2, color: i <= selfRating ? '#fbbf24' : 'var(--muted)' }}
                  onMouseEnter={() => setSelfRating(i)}>
                  ★
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------------- home --------------------------------- */
  return (
    <div className="container section">
      <div className="section-head">
        <div><span className="eyebrow">Interview prep</span><h2>🎤 Mock Interviews</h2></div>
        <Link className="btn btn-ghost btn-sm" to="/student">← Dashboard</Link>
      </div>
      <p className="muted">Choose a topic to receive five questions. Answer aloud or in writing, rate yourself with stars, and compare your answer with the hints. Your history is saved in this browser.</p>
      <div className="grid g4 mt">
        {Object.entries(BANK).map(([key, b]) => (
          <button className="card hover" key={key} onClick={() => start(key)} style={{ textAlign: 'left', cursor: 'pointer' }}>
            <div style={{ fontSize: '2rem' }}>{b.icon}</div>
            <h3 style={{ fontSize: '1rem' }}>{b.label}</h3>
            <span className="tiny muted">{b.questions.length} questions in bank • 5 per session</span>
          </button>
        ))}
      </div>

      {history.length > 0 && (
        <div className="card mt">
          <h3>📜 Past sessions</h3>
          <div className="table-wrap" tabIndex={0}>
            <table className="table">
              <thead><tr><th>Topic</th><th>Date</th><th>Questions</th><th>Avg rating</th></tr></thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}>
                    <td>{h.label}</td>
                    <td className="small">{new Date(h.at).toLocaleString()}</td>
                    <td>{h.count}</td>
                    <td><span className={`badge ${h.avg >= 4 ? 'green' : h.avg >= 2.5 ? 'amber' : 'red'}`}>{h.avg} / 5</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
