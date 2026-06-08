'use client';

import { ItemDetailTable, type ItemData } from '@/components/dashboard/ItemDetailTable';

interface Props {
  items: ItemData[];
  colors: Record<string, string>;
  onItemClick?: (item: ItemData) => void;
}

export function PackageDetailTable({ items, colors, onItemClick }: Props) {
  return (
    <ItemDetailTable
      title="Package Detail"
      clickHint="Click any package to see monthly sales"
      searchPlaceholder="Search packages..."
      emptyLabel="packages"
      items={items}
      colors={colors}
      onItemClick={onItemClick}
    />
  );
}
