import axios from 'axios';
import { message } from 'antd';
import { APP_CONFIG } from '../config/appConfig';
import { demoAxiosAdapter } from '../demo/mockApi';

type RequestConfigWithFlags = {
  suppressErrorToast?: boolean;
};

const request = axios.create({
  baseURL: APP_CONFIG.backendBaseUrl,
  timeout: 15000,
  ...(APP_CONFIG.demoMode ? { adapter: demoAxiosAdapter } : {}),
});

request.interceptors.response.use(
  (response) => response,
  (error) => {
    const suppress = Boolean(
      (error?.config as RequestConfigWithFlags | undefined)?.suppressErrorToast,
    );
    if (!suppress) {
      const isTimeout = String(error?.code || '').toUpperCase() === 'ECONNABORTED';
      const text = isTimeout
        ? '请求超时，请缩小范围后重试'
        : error?.response?.data?.detail || error?.message || '网络异常，请稍后重试';
      message.error(String(text));
    }
    return Promise.reject(error);
  },
);

export default request;
