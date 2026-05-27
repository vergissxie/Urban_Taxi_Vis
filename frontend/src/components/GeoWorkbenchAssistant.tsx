import React from 'react';
import { Bot, FileText, GripHorizontal, Loader2, Play, Send, X } from 'lucide-react';
import {
  askAssistant,
  type AssistantAction,
  type AssistantRequestContext,
  type AssistantSource,
} from '../services/assistantService';

interface GeoWorkbenchAssistantProps {
  open: boolean;
  context: AssistantRequestContext;
  onRunAction: (action: AssistantAction) => void;
  onClose: () => void;
}

interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  sources?: AssistantSource[];
  actions?: AssistantAction[];
}

const QUICK_PROMPTS = [
  'F4 网格密度分析是怎么做的？',
  'F8 怎么找 A/B 高频路线？',
  'F7-F9 没有结果该检查什么？',
  '帮我放大地图',
];

const MIN_PANEL_HEIGHT = 360;
const DEFAULT_PANEL_HEIGHT = 640;

function makeMessageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clampPanelHeight(value: number) {
  const maxHeight = Math.max(MIN_PANEL_HEIGHT, window.innerHeight - 96);
  return Math.min(maxHeight, Math.max(MIN_PANEL_HEIGHT, value));
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${part}-${index}`} className="font-semibold text-slate-100">{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
  });
}

function renderMessageText(text: string) {
  return text.split('\n').map((line, index, lines) => {
    const trimmed = line.trim();
    const compact = trimmed.replace(/^[-*]\s+/, '• ');
    const next = lines[index + 1]?.trim() ?? '';
    const isHeading = /^\d+[.、]\s*\*\*.+\*\*$/.test(trimmed) || /^\*\*.+\*\*$/.test(trimmed);
    const spacing = !trimmed
      ? 'my-1.5 h-0'
      : isHeading
        ? 'mb-1 mt-3 first:mt-0'
        : !next
          ? 'mb-1'
          : 'mb-1.5 last:mb-0';
    return (
      <p key={`${line}-${index}`} className={spacing}>
        {trimmed ? renderInlineMarkdown(compact) : null}
      </p>
    );
  });
}

export default function GeoWorkbenchAssistant({
  open,
  context,
  onRunAction,
  onClose,
}: GeoWorkbenchAssistantProps) {
  const [input, setInput] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [messages, setMessages] = React.useState<AssistantMessage[]>([]);
  const [panelHeight, setPanelHeight] = React.useState(DEFAULT_PANEL_HEIGHT);
  const [resizing, setResizing] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, loading]);

  React.useEffect(() => {
    const handleWindowResize = () => {
      setPanelHeight((height) => clampPanelHeight(height));
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  const submitQuestion = React.useCallback(async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setInput('');
    setLoading(true);
    setMessages((current) => [
      ...current,
      { id: makeMessageId(), role: 'user', text: trimmed },
    ]);

    try {
      const response = await askAssistant({
        question: trimmed,
        topK: 5,
        context,
      });
      setMessages((current) => [
        ...current,
        {
          id: makeMessageId(),
          role: 'assistant',
          text: response.answer,
          sources: response.sources,
          actions: response.suggested_actions,
        },
      ]);
    } catch (error) {
      const text = error instanceof Error ? error.message : '助手请求失败，请确认后端服务已启动。';
      setMessages((current) => [
        ...current,
        {
          id: makeMessageId(),
          role: 'assistant',
          text: `没有拿到助手响应：${text}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [context, loading]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void submitQuestion(input);
  };

  const startVerticalResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (loading) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = panelHeight;
    setResizing(true);

    const handleMove = (moveEvent: PointerEvent) => {
      setPanelHeight(clampPanelHeight(startHeight + moveEvent.clientY - startY));
    };
    const handleUp = () => {
      setResizing(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  }, [loading, panelHeight]);

  if (!open) return null;

  return (
    <section
      className="pointer-events-auto flex w-[min(360px,calc(100vw-7.5rem))] min-w-[320px] flex-col overflow-hidden rounded-[18px] bg-[#20242d]/86 text-slate-200 shadow-[0_24px_72px_rgba(0,0,0,0.50)] backdrop-blur-2xl [font-family:'Noto_Sans_SC','Manrope',ui-sans-serif,system-ui,sans-serif]"
      style={{ height: panelHeight }}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid h-7 w-7 shrink-0 place-items-center text-cyan-200">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-slate-100">AI 项目助手</div>
            <div className="truncate text-[10px] text-slate-500">GPT · 文档检索增强</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/[0.06] hover:text-slate-100"
          aria-label="关闭 AI 项目助手"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col justify-end gap-4">
            <div className="px-1 py-1 text-[12px] leading-6 text-slate-300">
              可以问 F1-F9、接口、算法和排查问题。回答会先检索项目文档，再由 GPT 组织语言，并保留来源。
            </div>
            <div className="grid gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => { void submitQuestion(prompt); }}
                  className="rounded-lg bg-transparent px-1 py-2 text-left text-[12px] font-medium text-slate-300 transition hover:bg-white/[0.04] hover:text-cyan-100"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((message) => (
              <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'block'}>
                {message.role === 'user' ? (
                  <div className="max-w-[86%] px-0 py-1 text-left text-[13px] leading-6 text-cyan-50">
                    {renderMessageText(message.text)}
                  </div>
                ) : (
                  <article className="max-w-none">
                    <div className="mb-2 flex items-center gap-2 text-[10px] text-slate-500">
                      <Bot className="h-3 w-3 text-cyan-300/80" />
                      <span>AI 项目助手</span>
                    </div>
                    <div className="text-[13px] font-normal leading-6 text-slate-200">
                      {renderMessageText(message.text)}
                    </div>
                    {message.actions?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {message.actions.map((action) => (
                          <button
                            key={`${action.type}-${action.value ?? ''}`}
                            type="button"
                            onClick={() => onRunAction(action)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/18 bg-cyan-300/[0.07] px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:bg-cyan-300/14"
                          >
                            <Play className="h-3 w-3" />
                            {action.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {message.sources?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2 pt-1">
                        {message.sources.slice(0, 3).map((source) => (
                          <div
                            key={`${source.path}-${source.heading}`}
                            className="min-w-0 max-w-full px-0 py-0.5 text-[10px] leading-4 text-slate-500"
                            title={`${source.path} / ${source.heading}`}
                          >
                            <span className="inline-flex max-w-[310px] items-center gap-1.5 truncate align-bottom">
                              <FileText className="h-3 w-3 shrink-0 text-slate-600" />
                              <span className="truncate text-slate-400">{source.title} · {source.heading}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                )}
              </div>
            ))}
            {loading ? (
              <div className="inline-flex items-center gap-2 px-0 py-1 text-[11px] text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-200" />
                正在生成回答
              </div>
            ) : null}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="shrink-0 bg-transparent px-3 pb-3 pt-3">
        <div className="flex items-end gap-2 rounded-2xl bg-transparent px-0 py-1 transition">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submitQuestion(input);
              }
            }}
            rows={2}
            maxLength={500}
            placeholder="问 F1-F9、接口、算法或地图操作"
            className="max-h-28 min-h-[44px] flex-1 resize-none bg-transparent px-1 text-[14px] leading-7 text-slate-100 outline-none placeholder:text-slate-600"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cyan-300/12 text-cyan-100 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="发送问题"
            title="发送"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-disabled={loading}
          onPointerDown={startVerticalResize}
          className={`mx-auto mt-2 flex h-4 w-24 items-center justify-center rounded-full text-slate-600 transition ${
            loading
              ? 'cursor-not-allowed opacity-35'
              : resizing
                ? 'cursor-row-resize bg-cyan-300/10 text-cyan-200'
                : 'cursor-row-resize hover:bg-white/[0.04] hover:text-slate-400'
          }`}
        >
          <GripHorizontal className="h-4 w-4" />
        </div>
      </form>
    </section>
  );
}
