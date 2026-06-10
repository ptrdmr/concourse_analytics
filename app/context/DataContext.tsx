'use client';

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import type { Transaction } from '@/types';

const LOAD_TIMEOUT_MS = 60000;

function fetchWithTimeout(url: string, timeout = LOAD_TIMEOUT_MS): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Load timeout')), timeout)
    ),
  ]);
}

interface DataContextValue {
  summary: string;
  setDataSummary: (summary: string) => void;
  transactions: Transaction[];
  transactionsLoading: boolean;
  transactionsFetched: boolean;
  loadTransactions: () => void;
  modifierTransactions: Transaction[];
  modifierTransactionsLoading: boolean;
  modifierTransactionsFetched: boolean;
  loadModifierTransactions: () => void;
}

const DataContext = createContext<DataContextValue>({
  summary: '',
  setDataSummary: () => {},
  transactions: [],
  transactionsLoading: false,
  transactionsFetched: false,
  loadTransactions: () => {},
  modifierTransactions: [],
  modifierTransactionsLoading: false,
  modifierTransactionsFetched: false,
  loadModifierTransactions: () => {},
});

export function DataContextProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsFetched, setTransactionsFetched] = useState(false);
  const [modifierTransactions, setModifierTransactions] = useState<Transaction[]>([]);
  const [modifierTransactionsLoading, setModifierTransactionsLoading] = useState(false);
  const [modifierTransactionsFetched, setModifierTransactionsFetched] = useState(false);

  const transactionsLoadedRef = useRef(false);
  const transactionsFetchingRef = useRef(false);
  const modifierLoadedRef = useRef(false);
  const modifierFetchingRef = useRef(false);

  const setDataSummary = useCallback((s: string) => {
    setSummary(prev => (prev === s ? prev : s));
  }, []);

  const loadTransactions = useCallback(() => {
    if (transactionsLoadedRef.current || transactionsFetchingRef.current) return;
    transactionsFetchingRef.current = true;
    setTransactionsLoading(true);

    fetchWithTimeout('/data/transactions.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json();
      })
      .then((data: Transaction[]) => {
        transactionsLoadedRef.current = true;
        setTransactions(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        // Allow retry on failure
      })
      .finally(() => {
        transactionsFetchingRef.current = false;
        setTransactionsLoading(false);
        setTransactionsFetched(true);
      });
  }, []);

  const loadModifierTransactions = useCallback(() => {
    if (modifierLoadedRef.current || modifierFetchingRef.current) return;
    modifierFetchingRef.current = true;
    setModifierTransactionsLoading(true);

    fetchWithTimeout('/data/modifier_transactions.json')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json();
      })
      .then((rows: Transaction[]) => {
        modifierLoadedRef.current = true;
        setModifierTransactions(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        // Allow retry on failure
      })
      .finally(() => {
        modifierFetchingRef.current = false;
        setModifierTransactionsLoading(false);
        setModifierTransactionsFetched(true);
      });
  }, []);

  return (
    <DataContext.Provider
      value={{
        summary,
        setDataSummary,
        transactions,
        transactionsLoading,
        transactionsFetched,
        loadTransactions,
        modifierTransactions,
        modifierTransactionsLoading,
        modifierTransactionsFetched,
        loadModifierTransactions,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useDataContext() {
  return useContext(DataContext);
}
