import { useState } from 'react';

export default function LicensePage({ onActivated }) {
  const [licenseKey, setLicenseKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleActivate(e) {
    e.preventDefault();

    const key = licenseKey.trim();

    if (!key) {
      setError('Please enter your license key.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const result =
        await window.pos.activateLicense(key);

      if (!result.success) {
        setError(
          result.message ||
            'License activation failed.'
        );
        return;
      }

      onActivated(result.license);

    } catch (err) {
      console.error(err);

      setError(
        err?.message ||
          'Unable to activate the license.'
      );
    } finally {
      
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="panel login-card">

        <h1>ZeedPOS</h1>

        <p>
          Activate your license to continue.
        </p>

        <form onSubmit={handleActivate}>

          <div style={{ marginTop: 20 }}>
            <input
              type="text"
              value={licenseKey}
              onChange={(e) =>
                setLicenseKey(e.target.value)
              }
              placeholder="ZEEDPOS-AAAA-BBBB-CCCC"
              disabled={loading}
              autoFocus
            />
          </div>

          {error && (
            <div
              style={{
                marginTop: 12,
                color: '#dc2626',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 20,
            }}
          >
            {loading
              ? 'Activating...'
              : 'Activate License'}
          </button>

        </form>

      </div>
    </div>
  );
}