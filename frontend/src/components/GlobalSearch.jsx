import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { miscApi } from '../services/api';
import Icon from './Icon';

const ICONS = { course: 'book', note: 'file', quiz: 'quiz', problem: 'code', contest: 'trophy', developer: 'teacher' };

export default function GlobalSearch({ compact }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [shortcut, setShortcut] = useState('Ctrl K');
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const timer = useRef(null);
  const requestSequence = useRef(0);
  const listId = useId();
  const navigate = useNavigate();

  useEffect(() => {
    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    setShortcut(/mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K');
  }, []);

  useEffect(() => {
    const onPointer = (event) => { if (boxRef.current && !boxRef.current.contains(event.target)) { setOpen(false); setActive(-1); } };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, []);

  useEffect(() => {
    if (!compact) return undefined;
    const onShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && inputRef.current?.offsetParent !== null) {
        event.preventDefault();
        inputRef.current.focus();
      }
    };
    document.addEventListener('keydown', onShortcut);
    return () => document.removeEventListener('keydown', onShortcut);
  }, [compact]);

  useEffect(() => {
    clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) { setItems([]); setOpen(false); setActive(-1); return undefined; }
    const sequence = ++requestSequence.current;
    timer.current = setTimeout(async () => {
      try {
        const { data } = await miscApi.suggestions(term);
        if (sequence !== requestSequence.current) return;
        setItems(data.data || []);
        setOpen(true);
        setActive(-1);
      } catch (_) {
        if (sequence === requestSequence.current) { setItems([]); setOpen(false); }
      }
    }, 220);
    return () => clearTimeout(timer.current);
  }, [q]);

  const options = [...items.map((item) => item.link), `/search?q=${encodeURIComponent(q)}`];
  const choose = (index) => {
    const target = options[index];
    if (!target) return;
    setOpen(false); setActive(-1); setQ(''); navigate(target);
  };
  const submit = (event) => {
    event.preventDefault();
    if (q.trim()) choose(active >= 0 ? active : options.length - 1);
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { setOpen(false); setActive(-1); return; }
    if (!open || !options.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => (value + 1) % options.length); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => (value <= 0 ? options.length - 1 : value - 1)); }
    if (event.key === 'Enter' && active >= 0) { event.preventDefault(); choose(active); }
  };

  return (
    <div className={`search-box${compact ? ' is-compact' : ''}`} ref={boxRef}>
      <form onSubmit={submit} role="search">
        <span className="search-icon" aria-hidden="true"><Icon name="search" size={16} /></span>
        <input
          ref={inputRef}
          className="input search-input"
          type="search"
          aria-label="Search SmartODL"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="Search courses, notes, problems…"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          onFocus={() => q.trim().length >= 2 && setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <kbd className="search-kbd" aria-hidden="true">{shortcut}</kbd>
      </form>
      {open && options.length > 0 && (
        <div className="search-pop" id={listId} role="listbox" aria-label="Search suggestions">
          {items.map((item, index) => (
            <Link
              id={`${listId}-${index}`}
              key={`${item.type}-${item.link}-${index}`}
              className={`search-item ${active === index ? 'is-active' : ''}`}
              role="option"
              aria-selected={active === index}
              to={item.link}
              onMouseEnter={() => setActive(index)}
              onClick={() => { setOpen(false); setQ(''); }}
            >
              <span><Icon name={ICONS[item.type] || 'search'} size={17} />{item.label}</span>
              <span className="tag">{item.type}</span>
            </Link>
          ))}
          <Link
            id={`${listId}-${items.length}`}
            className={`search-item ${active === items.length ? 'is-active' : ''}`}
            role="option"
            aria-selected={active === items.length}
            to={`/search?q=${encodeURIComponent(q)}`}
            onMouseEnter={() => setActive(items.length)}
            onClick={() => setOpen(false)}
          >
            <span><Icon name="search" size={17} />See all results for “{q}”</span><span className="tag">search</span>
          </Link>
        </div>
      )}
    </div>
  );
}
