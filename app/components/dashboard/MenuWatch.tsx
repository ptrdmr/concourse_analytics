'use client';

import type { ItemFindingDetail } from '@/lib/verdict';
import { formatVerdictDollars } from '@/lib/verdict';

interface Props {
  items: ItemFindingDetail[];
  loading?: boolean;
}

export function MenuWatch({ items, loading }: Props) {
  if (loading || !items.length) return null;

  return (
    <section className="card p-5 sm:p-6 mt-8 print:shadow-none print:border print:border-black print:bg-white print:text-black">
      <div className="mb-4">
        <h3 className="text-lg font-semibold print:text-black">Menu Watch</h3>
        <p className="text-xs text-muted mt-1 print:text-gray-700">
          By revenue and sales velocity — not margin. Cheap fast sellers and pricey slow movers can both be fine.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-secondary border-b border-overlay/10 print:text-gray-700">
              <th className="py-2 pr-3 font-medium">Item</th>
              <th className="py-2 pr-3 font-medium">This week</th>
              <th className="py-2 pr-3 font-medium">Typical</th>
              <th className="py-2 pr-3 font-medium">Streak</th>
              <th className="py-2 font-medium">Rough annual</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 12).map((item) => (
              <tr
                key={item.itemName}
                className="border-b border-overlay/5 last:border-0 print:text-black"
              >
                <td className="py-2 pr-3 font-medium">{item.itemName}</td>
                <td className="py-2 pr-3 font-mono">{Math.round(item.currentUnits)}</td>
                <td className="py-2 pr-3 font-mono">{Math.round(item.baselineUnits)}</td>
                <td className="py-2 pr-3">{item.streak} wks</td>
                <td className="py-2 font-mono">
                  {formatVerdictDollars(item.dollarImpactWeekly * 52)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
