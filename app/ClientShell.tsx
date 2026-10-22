'use client';

import { type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { DataContextProvider } from '@/context/DataContext';
import { ChatWidget } from '@/components/ChatWidget';
import { BookingPaceSection } from '@/components/dashboard/BookingPaceSection';

export function ClientShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const onReservations = path === '/reservations' || path === '/reservations/';
  return (
    <DataContextProvider>
      {children}
      {onReservations && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-16">
          <BookingPaceSection />
        </div>
      )}
      <ChatWidget />
    </DataContextProvider>
  );
}
