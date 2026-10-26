import { useState } from 'react';
import { quizApi } from '../services/api';

export const unlockKey = (id) => `quiz_unlock_${id}`;
export const getUnlock = (id) => sessionStorage.getItem(unlockKey(id)) || '';
export const setUnlock = (id, token) => sessionStorage.setItem(unlockKey(id), token);
export const clearUnlock = (id) => sessionStorage.removeItem(unlockKey(id));

/**
 * 🔒 Private-quiz password gate. When an administrator makes a quiz private, the student
 * must enter the access password before joining. After the correct password is supplied, the server
 * returns a signed unlock token that is retained for the browser session.
 */
export default function PrivateQuizGate({ quiz, onUnlocked }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!password) return setError('Enter the password first');
    setBusy(true);
    setError('');
    try {
      const { data } = await quizApi.unlock(quiz.id, password);
      const token = data.data.token;
      if (token) setUnlock(quiz.id, token);
      onUnlocked && onUnlocked(token);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qz-gate">
      <form className="qz-gate-card" onSubmit={submit}>
        <div style={{ fontSize: '2.2rem' }}>🔒</div>
        <h3 style={{ margin: '8px 0 2px' }}>Private Quiz</h3>
        <p className="small muted" style={{ margin: 0 }}>
          “{quiz.title}” is private — enter the access password provided by the administrator to join.
        </p>
        <input
          className="input mt"
          type="password"
          autoFocus
          placeholder="Access password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="small" style={{ color: 'var(--red)', marginTop: 6 }}>{error}</div>}
        <button className="btn btn-primary mt" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Checking…' : '🔓 Unlock & Join'}
        </button>
      </form>
    </div>
  );
}
