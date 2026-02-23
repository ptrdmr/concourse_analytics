'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface DataContextValue {
  summary: string;
  setDataSummary: (summary: string) => void;
}

const DataContext = createContext<DataContextValue>({
  summary: '',
  setDataSummary: () => {},
});

export function DataContextProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState('');

  const setDataSummary = useCallback((s: string) => {
    setSummary(prev => prev === s ? prev : s);
  }, []);

  return (
    <DataContext.Provider value={{ summary, setDataSummary }}>
      {children}
    </DataContext.Provider>
  );
}

export function useDataContext() {
  return useContext(DataContext);
}
