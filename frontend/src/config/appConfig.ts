export const APP_CONFIG = {
  amap: {
    version: '2.0',
    key: (import.meta.env.VITE_AMAP_KEY || '').trim(),
    securityJsCode: (import.meta.env.VITE_AMAP_SECURITY_JS_CODE || '').trim(),
    plugins: 'AMap.MouseTool,AMap.Scale,AMap.ToolBar,AMap.HeatMap',
  },
  map: {
    center: [116.397428, 39.90923] as [number, number],
    zoom: 11,
    darkStyle: 'amap://styles/darkblue',
    blackStyle: 'amap://styles/dark',
    lightStyle: 'amap://styles/normal',
  },
  backendBaseUrl: import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:8000`,
  demoMode: String(import.meta.env.VITE_DEMO_MODE ?? 'false').toLowerCase() === 'true',
} as const;
