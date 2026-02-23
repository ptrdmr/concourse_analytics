'use client';

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import type { Transaction } from '@/types';

interface DataContextValue {
  summary: string;
  setDataSummary: (summary: string) => void;
  transactions: Transaction[];
  setTransactions: (txns: Transaction[]) => void;
}

const DataContext = createContext<DataContextValue>({
  summary: '',
  setDataSummary: () => {},
  transactions: [],
  setTransactions: () => {},
});

export function DataContextProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState('');
  const [transactions, setTxns] = useState<Transaction[]>([]);
  const loadedRef = useRef(false);

  const setDataSummary = useCallback((s: string) => {
    setSummary(prev => prev === s ? prev : s);
  }, []);

  const setTransactions = useCallback((txns: Transaction[]) => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setTxns(txns);
  }, []);

  return (
    <DataContext.Provider value={{ summary, setDataSummary, transactions, setTransactions }}>
      {children}
    </DataContext.Provider>
  );
}

export function useDataContext() {
  return useContext(DataContext);
}
