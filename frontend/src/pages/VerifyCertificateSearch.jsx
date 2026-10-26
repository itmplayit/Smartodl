import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';

export default function VerifyCertificateSearch() {
  const [value, setValue] = useState('');
  const navigate = useNavigate();
  const submit = (event) => {
    event.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    const token = raw.includes('/cert/') ? raw.split('/cert/').pop().split(/[?#]/)[0] : raw;
    navigate(`/cert/${encodeURIComponent(token)}`);
  };
  return (
    <div className="container section verify-search-page">
      <div className="verify-search-card card">
        <span className="verify-search-icon"><Icon name="certificate" size={34} /></span>
        <span className="eyebrow">Credential verification</span>
        <h1>Verify an SmartODL certificate</h1>
        <p className="muted">Enter the certificate number, token, or paste the verification link printed on the credential.</p>
        <form onSubmit={submit} className="verify-search-form">
          <label className="field" htmlFor="certificate-token">Certificate number, token or URL</label>
          <div className="row wrap">
            <input id="certificate-token" className="input" value={value} onChange={(event) => setValue(event.target.value)} placeholder="e.g. SOD-CRS-202610-ABC123… or verification URL" autoComplete="off" />
            <button className="btn btn-primary" type="submit" disabled={!value.trim()}><Icon name="check" size={17} />Verify certificate</button>
          </div>
        </form>
        <div className="security-note"><Icon name="shield" size={17} /><span>Verification confirms the issue status and details stored by SmartODL.</span></div>
      </div>
    </div>
  );
}
