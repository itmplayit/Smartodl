import { Link } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import { Loader } from './ui';

/**
 * Route-level gate for feature toggles. When the admin switches a feature OFF
 * in the Feature Control panel, every gated page shows this notice instead of
 * the feature — and the backend blocks the same APIs, so nothing half-loads.
 */
export default function FeatureGate({ setting, label, children }) {
  const { isOn, loading } = useSettings();
  if (loading) return <Loader label="Checking…" />;
  if (!isOn(setting, false)) {
    return (
      <div className="container section">
        <div className="card center" style={{ maxWidth: 580, margin: '0 auto' }}>
          <div style={{ fontSize: '3rem' }}>🚧</div>
          <h1 style={{ fontSize: '1.6rem' }}>{label} is not currently available</h1>
          <p className="muted">
            An administrator has temporarily disabled this feature.
            This page will start working automatically when it is enabled again.
          </p>
          <div className="row mt" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary" to="/">← Home</Link>
          </div>
        </div>
      </div>
    );
  }
  return children;
}
