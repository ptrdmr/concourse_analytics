'use client';

import { type ReactNode, useEffect } from 'react';
import { DataContextProvider, useDataContext } from '@/context/DataContext';
import { useTransactions } from '@/hooks/useTransactions';
import { ChatWidget } from '@/components/ChatWidget';

function TransactionLoader({ children }: { children: ReactNode }) {
  const { raw, loading } = useTransactions();
  const { setTransactions } = useDataContext();

  useEffect(() => {
    if (!loading && raw.length > 0) {
      setTransactions(raw);
    }
  }, [loading, raw, setTransactions]);

  return <>{children}</>;
}

export function ClientShell({ children }: { children: ReactNode }) {
  return (
    <DataContextProvider>
      <TransactionLoader>
        {children}
        <ChatWidget />
      </TransactionLoader>
    </DataContextProvider>
  );
}
