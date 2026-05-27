import { APP_CONFIG } from '../config/appConfig';

let amapSdkPromise: Promise<any> | null = null;

export function loadAmapSdk(): Promise<any> {
  const w = window as Window & {
    AMap?: any;
    _AMapSecurityConfig?: { securityJsCode: string };
  };

  if (w.AMap) {
    return Promise.resolve(w.AMap);
  }

  if (amapSdkPromise) {
    return amapSdkPromise;
  }

  amapSdkPromise = new Promise((resolve, reject) => {
    if (!APP_CONFIG.amap.key || !APP_CONFIG.amap.securityJsCode) {
      reject(
        new Error(
          'AMap key or security code is missing. Please set VITE_AMAP_KEY and VITE_AMAP_SECURITY_JS_CODE in .env.',
        ),
      );
      return;
    }

    w._AMapSecurityConfig = {
      securityJsCode: APP_CONFIG.amap.securityJsCode,
    };

    const existing = document.querySelector(
      'script[data-amap-sdk="true"]',
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => {
        if (w.AMap) {
          resolve(w.AMap);
        } else {
          reject(new Error('地图 SDK 已加载但 AMap 不可用'));
        }
      });
      existing.addEventListener('error', () => reject(new Error('地图 SDK 加载失败')));
      return;
    }

    const script = document.createElement('script');
    script.dataset.amapSdk = 'true';
    script.src = `https://webapi.amap.com/maps?v=${APP_CONFIG.amap.version}&key=${APP_CONFIG.amap.key}&plugin=${APP_CONFIG.amap.plugins}`;
    script.async = true;

    script.onload = () => {
      if (!w.AMap) {
        reject(new Error('地图 SDK 已加载但 AMap 不可用'));
        return;
      }
      resolve(w.AMap);
    };

    script.onerror = () => {
      reject(new Error('地图 SDK 加载失败'));
    };

    document.head.appendChild(script);
  });

  return amapSdkPromise;
}
