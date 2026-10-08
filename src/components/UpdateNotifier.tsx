import { useEffect, useState } from 'react';

type Status = 'idle' | 'downloading' | 'ready';

export default function UpdateNotifier() {
  const [status, setStatus] = useState<Status>('idle');
  const [version, setVersion] = useState('');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const u = window.updater;
    if (!u) return; // خارج Electron (المتصفح أثناء التطوير)

    const offs = [
      u.onAvailable((v) => { setVersion(v); setStatus('downloading'); }),
      u.onProgress((p) => setProgress(p)),
      u.onDownloaded((v) => { setVersion(v); setStatus('ready'); }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  if (status === 'idle') return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-lg bg-white p-4 shadow-lg border">
      {status === 'downloading' && (
        <>
          <p className="text-sm font-medium">جارٍ تنزيل الإصدار {version}...</p>
          <div className="mt-2 h-2 w-full rounded bg-gray-200">
            <div
              className="h-2 rounded bg-blue-600 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">{progress}%</p>
        </>
      )}

      {status === 'ready' && (
        <>
          <p className="text-sm font-medium">الإصدار {version} جاهز للتثبيت</p>
          <button
            onClick={() => window.updater?.install()}
            className="mt-3 w-full rounded bg-blue-600 py-1.5 text-sm text-white hover:bg-blue-700"
          >
            إعادة التشغيل والتحديث
          </button>
        </>
      )}
    </div>
  );
}