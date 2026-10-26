import { useRef, useState } from 'react';

/** Reusable validated file input (client-side type + size guard mirroring the server). */
export default function FileUploadField({ name, label, accept = '.pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.zip', maxMb = 25, onChange, required, hint }) {
  const ref = useRef(null);
  const [info, setInfo] = useState('');

  const pick = (e) => {
    const file = e.target.files[0];
    if (!file) { setInfo(''); onChange(name, null); return; }
    if (file.size > maxMb * 1024 * 1024) {
      setInfo(`❌ ${file.name} is larger than ${maxMb} MB`);
      ref.current.value = '';
      onChange(name, null);
      return;
    }
    setInfo(`✅ ${file.name} • ${(file.size / 1024 / 1024).toFixed(2)} MB`);
    onChange(name, file);
  };

  return (
    <label className="field full">
      {label}{required ? ' *' : ''}
      <input ref={ref} className="input" type="file" accept={accept} onChange={pick} required={required} />
      {hint && <span className="tiny muted">{hint}</span>}
      {info && <span className="tiny">{info}</span>}
    </label>
  );
}
