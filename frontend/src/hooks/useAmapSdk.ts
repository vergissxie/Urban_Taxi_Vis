import { useEffect, useState } from 'react';
import { loadAmapSdk } from '../services/mapSdkService';

type SdkStatus = 'idle' | 'loading' | 'ready' | 'error';

export function useAmapSdk() {
  const [sdkStatus, setSdkStatus] = useState<SdkStatus>('idle');
  const [amap, setAmap] = useState<any | null>(null);
  const [sdkError, setSdkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setSdkStatus('loading');
    setSdkError(null);

    loadAmapSdk()
      .then((instance) => {
        if (cancelled) return;
        setAmap(instance);
        setSdkStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const text = error instanceof Error ? error.message : '地图 SDK 加载失败';
        setSdkError(text);
        setSdkStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    sdkStatus,
    sdkError,
    amap,
  };
}
