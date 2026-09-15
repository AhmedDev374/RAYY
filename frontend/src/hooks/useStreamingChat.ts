import { useCallback, useRef, useState } from 'react';
import { getAccessToken, handleUnauthorizedResponse } from '../lib/api';

export interface UseStreamingChatOptions {
  endpoint?: string;
  onError?: (message: string) => void;
}

/**
 * Sends a chat message to the streaming endpoint and appends tokens to a
 * single assistant message as they arrive.
 *
 * The backend streams plain text chunks from `POST /api/v1/chat/stream`.
 * We read the response body line-by-line and append each chunk to the
 * accumulator, so the UI shows the reply progressively instead of waiting
 * for the entire model response.
 */
export function useStreamingChat({
  endpoint = '/api/v1/chat/stream',
  onError,
}: UseStreamingChatOptions = {}) {
  const [isPending, setIsPending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const send = useCallback(
    async (
      message: string,
      plantId: number | null,
      onChunk: (text: string) => void,
      onDone: () => void,
    ) => {
      stop();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsPending(true);

      let receivedAny = false;

      try {
        const token = await getAccessToken();
        const res = await fetch(`${import.meta.env.VITE_API_URL || ''}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ plant_id: plantId, message }),
          signal: controller.signal,
        });

        if (res.status === 401) {
          const err = await res.json().catch(() => ({ detail: 'Unauthorized' }));
          await handleUnauthorizedResponse(err.detail);
          throw new Error('Session expired — please log in again.');
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

          // The streaming endpoint emits plain text chunks; flush whatever
          // complete text we have so far so the UI updates immediately.
          if (buffer.length > 0) {
            receivedAny = true;
            onChunk(buffer);
            buffer = '';
          }
        }

        // Flush any trailing bytes after the stream closes.
        if (buffer.length > 0) {
          receivedAny = true;
          onChunk(buffer);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // User cancelled or started a new request — silent.
          return;
        }
        if (!receivedAny) {
          onError?.(
            err instanceof Error
              ? err.message
              : 'Sorry, I encountered an error. Please try again.',
          );
        } else {
          onError?.('Connection lost — partial response shown. Please try again.');
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        setIsPending(false);
        onDone();
      }
    },
    [endpoint, onError, stop],
  );

  return { send, isPending, stop };
}