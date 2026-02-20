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
