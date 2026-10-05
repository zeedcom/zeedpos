import { useEffect, useState } from 'react';

import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import PosPage from './pages/PosPage';
import LicensePage from './pages/LicensePage';

export default function App() {
  const { ready, user } = useAuth();

  const [licenseReady, setLicenseReady] = useState(false);
  const [licenseChecking, setLicenseChecking] = useState(true);

  const [apiReady, setApiReady] = useState(false);
  const [apiChecking, setApiChecking] = useState(false);

  useEffect(() => {
    checkLicense();
  }, []);

  async function checkLicense() {
    try {
      const result = await window.pos.getLicenseStatus();


      setLicenseReady(result.valid === true);
    } catch (error) {
      console.error('License check failed:', error);
      setLicenseReady(false);
    } finally {
      setLicenseChecking(false);
    }
  }

  async function waitForApi() {
    setApiChecking(true);

    for (let i = 0; i < 20; i++) {
      try {
        const info = await window.pos.getApiInfo();


        const response = await fetch(info.healthUrl, {
          method: 'GET',
        });

        if (response.ok) {

          setApiReady(true);
          setApiChecking(false);

          return;
        }
      } catch (error) {
        console.log(
          `Waiting for API... ${i + 1}/20`
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 500)
      );
    }

    setApiChecking(false);
    console.error('Local API did not become ready');
  }

  useEffect(() => {
    if (licenseReady) {
      waitForApi();
    }
  }, [licenseReady]);

  if (licenseChecking) {
    return (
      <div className="login-wrap">
        <div className="panel login-card">
          <h1>ZeedPOS</h1>
          <p>Checking license…</p>
        </div>
      </div>
    );
  }

  if (!licenseReady) {
    return (
      <LicensePage
        onActivated={() => {
          setLicenseReady(true);
        }}
      />
    );
  }

  if (apiChecking || !apiReady) {
    return (
      <div className="login-wrap">
        <div className="panel login-card">
          <h1>ZeedPOS</h1>
          <p>Starting local server…</p>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="login-wrap">
        <div className="panel login-card">
          <h1>ZeedPOS</h1>
          <p>Starting…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <PosPage />;
}