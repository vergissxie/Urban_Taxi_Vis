import { apiClient } from './api';

export type AssistantActionType = 'zoom_in' | 'zoom_out' | 'set_map_style';

export interface AssistantRequestContext {
  mode?: string;
  activeFeature?: string;
  mapStyle?: string;
  zoom?: number | null;
}

export interface AssistantChatRequest {
  question: string;
  topK?: number;
  context?: AssistantRequestContext;
}

export interface AssistantSource {
  title: string;
  path: string;
  heading: string;
  score: number;
}

export interface AssistantAction {
  type: AssistantActionType;
  label: string;
  value?: string | null;
}

export interface AssistantChatResponse {
  answer: string;
  sources: AssistantSource[];
  suggested_actions: AssistantAction[];
  meta?: {
    retrieval?: string;
    chunk_count?: number;
    matched_chunk_count?: number;
    context?: Record<string, unknown>;
  };
}

export async function askAssistant(payload: AssistantChatRequest): Promise<AssistantChatResponse> {
  const response = await apiClient.post<AssistantChatResponse>(
    '/api/v1/assistant/chat',
    {
      question: payload.question,
      top_k: payload.topK ?? 5,
      context: payload.context ?? {},
    },
    {
      timeout: 30000,
      suppressErrorToast: true,
    } as any,
  );
  return response.data;
}
