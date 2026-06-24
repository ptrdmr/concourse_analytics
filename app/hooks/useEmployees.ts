'use client';

import { useState, useEffect, useMemo } from 'react';
import type { EmployeesData, EmployeeProfile } from '@/types';

const LOAD_TIMEOUT_MS = 15000;

function fetchWithTimeout(url: string, timeout = LOAD_TIMEOUT_MS): Promise<Response> {
  return Promise.race([
    fetch(url),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Load timeout')), timeout),
    ),
  ]);
}

export function useEmployees() {
  const [data, setData] = useState<EmployeesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    fetchWithTimeout('/data/employees.json')
      .then((res) => {
        if (res.status === 404) {
          setAvailable(false);
          setLoading(false);
          return null;
        }
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        return res.json();
      })
      .then((json: EmployeesData | null) => {
        if (json?.employees) {
          setData(json);
          setAvailable(true);
        }
        setLoading(false);
      })
      .catch(() => {
        setAvailable(false);
        setLoading(false);
      });
  }, []);

  const employees = useMemo((): EmployeeProfile[] => data?.employees ?? [], [data]);
  const dateRange = useMemo((): [string, string] => data?.dateRange ?? ['', ''], [data]);
  const laborDateRange = useMemo((): [string, string] => {
    if (data?.laborDateRange?.[0] && data?.laborDateRange?.[1]) {
      return data.laborDateRange;
    }
    return ['', ''];
  }, [data]);

  return {
    data,
    employees,
    dateRange,
    laborDateRange,
    loading,
    available,
  };
}
