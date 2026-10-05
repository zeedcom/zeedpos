import { useState } from "react";

export default function LicenseActivation({
  onActivated
}) {
  const [licenseKey, setLicenseKey] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  async function activate() {
    if (!licenseKey.trim()) {
      setError(
        "Please enter your license key."
      );

      return;
    }

    setLoading(true);
    setError("");

    try {
      const result =
        await window.license.activate(
          licenseKey.trim()
        );

      if (!result.success) {
        setError(
          result.message ||
          "Activation failed."
        );

        return;
      }

      onActivated(result.license);

    } catch (error) {
      setError(
        error.message ||
        "Could not activate license."
      );

    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-8">

        <h1 className="text-2xl font-bold mb-2">
          Activate ZeedPOS
        </h1>

        <p className="text-gray-500 mb-6">
          Enter your license key to activate
          this installation.
        </p>

        <input
          type="text"
          value={licenseKey}
          onChange={e =>
            setLicenseKey(e.target.value)
          }
          placeholder="ZEEDPOS-AAAA-BBBB-CCCC"
          className="w-full border rounded-lg px-4 py-3 mb-4"
        />

        {error && (
          <div className="bg-red-50 text-red-600 rounded-lg p-3 mb-4">
            {error}
          </div>
        )}

        <button
          onClick={activate}
          disabled={loading}
          className="w-full bg-black text-white rounded-lg py-3 disabled:opacity-50"
        >
          {loading
            ? "Activating..."
            : "Activate License"}
        </button>

      </div>
    </div>
  );
}