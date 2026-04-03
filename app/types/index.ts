export interface Transaction {
  date: string;
  name: string;
  department: string;
  subdepartment: string;
  category: string;
  quantity: number;
  revenue: number;
  transactions: number;
}

export interface DepartmentSummary {
  revenue: number;
  quantity: number;
  transactions: number;
  uniqueItems: number;
  categories: string[];
  dateRange: [string, string];
}

export interface Summary {
  generatedAt: string;
  dateRange: [string, string];
  totalRevenue: number;
  departments: Record<string, DepartmentSummary>;
  categoryColors: Record<string, string>;
}

export interface Filters {
  department: string;
  dateRange: [string, string] | null;
  categories: string[];
  searchTerm: string;
}

export interface TicketLineItem {
  itemId: number;
  name: string;
  itemType: string;
  dept: string;
  subdept: string;
  qty: number;
  unitAmount: number;
  total: number;
  taxIncluded: boolean;
  soldInPackage: boolean;
  parentItemId?: number;
}

export interface Ticket {
  txnId: string;
  date: string;
  time: string;
  closedTime: string;
  total: number;
  user: string;
  terminal: string;
  type: string;
  items: TicketLineItem[];
}
