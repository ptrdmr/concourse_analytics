'use client';

import { type ReactNode } from 'react';
import { DataContextProvider } from '@/context/DataContext';
import { ChatWidget } from '@/components/ChatWidget';

export function ClientShell({ children }: { children: ReactNode }) {
  return (
    <DataContextProvider>
      {children}
      <ChatWidget />
    </DataContextProvider>
  );
}
