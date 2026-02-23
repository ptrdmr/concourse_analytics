'use client';

import { useState, useCallback, useRef } from 'react';
import { useDataContext } from '@/context/DataContext';
import { executeToolCall } from '@/lib/query-tools';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type ChatStatus = 'idle' | 'thinking' | 'searching';

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { summary: dataContext, transactions } = useDataContext();

  const send = useCallback(async (userMessage: string) => {
    const trimmed = userMessage.trim();
    if (!trimmed || status !== 'idle') return;

    setError(null);
    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setStatus('thinking');

    const controller = new AbortController();
    abortRef.current = controller;

    const MAX_TOOL_ROUNDS = 5;

    try {
      let apiMessages: Array<Record<string, unknown>> = updatedMessages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: apiMessages, dataContext }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `Request failed (${res.status})`);
        }

        const response = await res.json();

        if (response.type === 'tool_calls') {
          setStatus('searching');

          const toolCalls = response.calls as Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;

          const toolResults = toolCalls.map(call => {
            let args: Record<string, unknown>;
            try {
              args = JSON.parse(call.function.arguments);
            } catch {
              args = {};
            }
            const result = executeToolCall(
              { name: call.function.name, arguments: args },
              transactions
            );
            return {
              role: 'tool' as const,
              tool_call_id: call.id,
              content: result,
            };
          });

          apiMessages = [...apiMessages, response.message, ...toolResults];
          continue;
        }

        setMessages(prev => [...prev, { role: 'assistant', content: response.content }]);
        break;
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setMessages(prev => {
        if (prev.length > 0 && prev[prev.length - 1].role === 'assistant' && !prev[prev.length - 1].content) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      setStatus('idle');
      abortRef.current = null;
    }
  }, [messages, status, dataContext, transactions]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStatus('idle');
  }, []);

  const streaming = status !== 'idle';

  return { messages, status, streaming, error, send, clear };
}
