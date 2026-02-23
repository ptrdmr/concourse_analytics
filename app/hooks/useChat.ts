'use client';

import { useState, useCallback, useRef } from 'react';
import { useDataContext } from '@/context/DataContext';
import { executeToolCall } from '@/lib/query-tools';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type ChatStatus = 'idle' | 'thinking' | 'searching' | 'streaming';

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { summary: dataContext, transactions } = useDataContext();

  const streamResponse = async (res: Response, controller: AbortController) => {
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response stream');

    const decoder = new TextDecoder();
    let assistantContent = '';
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
    setStatus('streaming');

    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (controller.signal.aborted) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;
        const data = trimmedLine.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            assistantContent += delta;
            setMessages(prev => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: 'assistant', content: assistantContent };
              return copy;
            });
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }
  };

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

    try {
      const apiMessages = updatedMessages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          dataContext,
          mode: 'with_tools',
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Request failed (${res.status})`);
      }

      const firstResponse = await res.json();

      if (firstResponse.type === 'tool_calls') {
        setStatus('searching');

        const toolCalls = firstResponse.calls as Array<{
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

        const followUpMessages = [
          ...apiMessages,
          firstResponse.message,
          ...toolResults,
        ];

        const followUpRes = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: followUpMessages,
            dataContext,
            mode: 'follow_up',
          }),
          signal: controller.signal,
        });

        if (!followUpRes.ok) {
          const errBody = await followUpRes.json().catch(() => ({}));
          throw new Error(errBody.error || `Follow-up request failed (${followUpRes.status})`);
        }

        await streamResponse(followUpRes, controller);
      } else if (firstResponse.type === 'content') {
        setMessages(prev => [...prev, { role: 'assistant', content: firstResponse.content }]);
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

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setStatus('idle');
  }, []);

  const streaming = status !== 'idle';

  return { messages, status, streaming, error, send, stop, clear };
}
