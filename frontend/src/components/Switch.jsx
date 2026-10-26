import { useId } from 'react';

export default function Switch({ checked, onChange, label, disabled = false, id }) {
  const generatedId = useId();
  const controlId = id || generatedId;
  return (
    <button
      id={controlId}
      type="button"
      className={`switch-control ${checked ? 'is-on' : ''}`}
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
    >
      <span className="switch-control-thumb" aria-hidden="true" />
    </button>
  );
}
