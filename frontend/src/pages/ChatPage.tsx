import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import MarkdownContent from '../components/MarkdownContent';
import { api, getAccessToken, handleUnauthorizedResponse } from '../lib/api';
import { loadChatMessages, saveChatMessages, type ChatMessage } from '../lib/chatStore';

interface Plant {
  id: number;
  nickname: string;
  species: string;
}

const SUGGESTIONS = [
  'كم مرة أروي نبتة الورد؟',
  'ما أسباب اصفرار الأوراق؟',
  'ما أفضل تربة لنبات الألوفيرا؟',
  'كيف أزيد الرطوبة للنباتات الاستوائية؟',
  'ما علامات الإفراط في الري مقارنة بنقص الري؟',
  'كم تحتاج النباتات العصارية من ضوء الشمس؟',
];

export default function ChatPage() {
  const [plantId, setPlantId] = useState<number | ''>('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChatMessages());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    saveChatMessages(messages);
  }, [messages]);

  const { data: plants = [] } = useQuery({
    queryKey: ['plants'],
    queryFn: () => api<Plant[]>('/api/v1/plants'),
  });

  const selectedPlant = plants.find((p) => p.id === plantId);

  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleSend = useCallback(
    async (text?: string) => {
      const message = text || input.trim();
      if (!message || streaming) return;

      // Start a fresh assistant message and append tokens as they arrive.
      const assistantIndex = messages.length + 1;
      setMessages((prev) => [...prev, { role: 'user', content: message }, { role: 'assistant', content: '' }]);
      setInput('');
      setStreaming(true);

      // Abort any in-flight request so a new send starts clean.
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      let receivedAny = false;

      // --- TEMPORARY TIMING LOGS (diagnostics) ---
      const t0 = performance.now();
      const log = (label: string) =>
        console.log(`[CHAT-TIMING] ${label} +${(performance.now() - t0).toFixed(1)}ms`);
      // ------------------------------------------

      try {
        log('before getAccessToken');
        const token = await getAccessToken();
        log('after getAccessToken');
        log('before fetch');
        const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ plant_id: plantId || null, message }),
          signal: controller.signal,
        });
        log('after fetch resolved');
        log(`res.status=${res.status}`);
        log(`content-type=${res.headers.get('content-type')}`);
        log(`transfer-encoding=${res.headers.get('transfer-encoding')}`);
        log(`content-encoding=${res.headers.get('content-encoding')}`);

        if (res.status === 401) {
          const err = await res.json().catch(() => ({ detail: 'Unauthorized' }));
          await handleUnauthorizedResponse(err.detail);
          throw new Error('انتهت صلاحية الجلسة — يرجى تسجيل الدخول مرة أخرى.');
        }
        if (!res.ok || !res.body) {
          throw new Error(`Request failed with status ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 0) {
            receivedAny = true;
            const chunk = buffer;
            buffer = '';
            log('first non-empty chunk received');
            setMessages((prev) =>
              prev.map((m, i) =>
                i === assistantIndex ? { ...m, content: m.content + chunk } : m,
              ),
            );
            log('after setMessages (first chunk)');
          }
        }

        if (buffer.length > 0) {
          receivedAny = true;
          setMessages((prev) =>
            prev.map((m, i) =>
              i === assistantIndex ? { ...m, content: m.content + buffer } : m,
            ),
          );
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Cancelled by a new request — keep partial text already shown.
          return;
        }
        if (!receivedAny) {
          setMessages((prev) =>
            prev.map((m, i) =>
              i === assistantIndex
                ? { ...m, content: 'عذرًا، حدث خطأ. يرجى المحاولة مرة أخرى.' }
                : m,
            ),
          );
        } else {
          setMessages((prev) =>
            prev.map((m, i) =>
              i === assistantIndex
                ? { ...m, content: m.content + '\n\n(انقطع الاتصال — هذا جزء من الرد. يرجى المحاولة مرة أخرى.)' }
                : m,
            ),
          );
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setStreaming(false);
      }
    },
    [input, messages.length, streaming, plantId],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px';
    }
  }, [input]);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-4xl mx-auto">
      <div className="flex items-center justify-between pb-4 border-b border-gray-100">
        <div>
          <h1 className="text-xl font-bold text-gray-900">🌿 مساعد العناية بالنباتات</h1>
          <p className="text-sm text-gray-500">مدعوم بالذكاء الاصطناعي — اسأل عن أي شيء يتعلق بصحة نباتاتك</p>
        </div>
        <div className="flex items-center gap-2">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => setMessages([])}
              className="text-xs text-gray-500 hover:text-red-600 px-3 py-2 rounded-lg border border-gray-200 hover:border-red-200 transition-colors"
            >
              مسح المحادثة
            </button>
          )}
          {selectedPlant && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-green-100 text-green-700 rounded-full">
              {selectedPlant.nickname}
            </span>
          )}
          <select
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
            value={plantId}
            onChange={(e) => setPlantId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">لا يوجد سياق لنبتة</option>
            {plants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nickname} ({p.species})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-6 space-y-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-5 text-4xl">🌿</div>
            <h2 className="text-lg font-semibold text-gray-800 mb-2">كيف يمكنني مساعدتك في العناية بنباتاتك اليوم؟</h2>
            <p className="text-gray-500 text-sm mb-6 max-w-md">
              اسأل عن الري، والأمراض، والتربة، والإضاءة، أو نصائح العناية العامة.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
              {SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="text-right px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:border-green-300 hover:bg-green-50 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-5 py-3.5 ${
                    msg.role === 'user'
                      ? 'bg-green-600 text-white rounded-br-md'
                      : 'bg-white border border-gray-100 shadow-sm rounded-bl-md'
                  }`}
                >
                  {msg.role === 'assistant' && (
                    <div className="flex flex-row-reverse items-center gap-1.5 mb-2">
                      <span className="text-xs font-medium text-gray-400">مساعد رَيّ الذكي</span>
                    </div>
                  )}
                  {msg.role === 'assistant' ? (
                    <MarkdownContent content={msg.content} />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {streaming && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.content && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-md px-4 py-3">
                  <p className="text-xs text-gray-400 mb-2">مساعد رَيّ يكتب...</p>
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <div className="border-t border-gray-100 pt-4 pb-2">
        <div className="flex flex-row-reverse items-end gap-3 bg-white border border-gray-200 rounded-2xl p-3 shadow-sm focus-within:ring-2 focus-within:ring-green-500">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selectedPlant ? `اسأل عن ${selectedPlant.nickname}...` : 'اسأل عن العناية بالنباتات...'}
            rows={1}
            className="flex-1 resize-none border-0 bg-transparent text-sm text-right text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-0"
          />
<button
              type="button"
              onClick={() => handleSend()}
              disabled={!input.trim() || streaming}
              className="flex-shrink-0 w-9 h-9 bg-green-600 hover:bg-green-700 disabled:bg-gray-200 rounded-xl flex items-center justify-center transition-colors"
            >
              <svg className={`w-4 h-4 ${input.trim() && !streaming ? 'text-white' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m0 0l7-7m-7 7l-7-7" />
              </svg>
            </button>
        </div>
      </div>
    </div>
  );
}
