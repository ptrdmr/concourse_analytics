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

export interface PaymentRecord {
  date: string;
  paymentType: 'PaymentCash' | 'PaymentCredit' | 'PaymentStoredValue';
  name: string;
  amount: number;
  transactions: number;
}

export interface PackageRecord {
  date: string;
  name: string;
  department: string;
  subdepartment: string;
  category: string;
  quantity: number;
  revenue: number;
  transactions: number;
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

export interface IntradayRecord {
  date: string;
  slot: number;
  name: string;
  department: string;
  subdepartment: string;
  category: string;
  quantity: number;
  revenue: number;
  transactions: number;
}

export interface VoidRecord {
  date: string;
  slot: number;
  name: string;
  department: string;
  quantity: number;
  value: number;
  type: 'voided' | 'deleted';
}

export interface IntradayIndex {
  departments: string[];
  years: string[];
  generated: string;
  voidYears: string[];
  counts?: Record<string, number>;
}

export interface LaborDay {
  laborCost: number;
  laborHours: number;
  punchCount?: number;
  tips?: number;
  source?: string;
}

export interface LaborData {
  generatedAt: string;
  timezone?: string;
  companyId?: string;
  source?: string;
  dateRange: [string, string];
  days: Record<string, LaborDay>;
}

export interface IntradayLaborSlot {
  cost: number;
  headcount: number;
}

export interface IntradayLaborDay {
  factor: number;
  slots: Record<string, IntradayLaborSlot>;
}

export interface IntradayLaborReconciliation {
  mean: number | null;
  min: number | null;
  max: number | null;
  stddev: number | null;
  dayCount: number;
  flaggedDays: Array<{
    date: string;
    reason: string;
    factor?: number;
    rawCost?: number;
    targetCost?: number;
  }>;
}

export interface IntradayLaborData {
  generatedAt: string;
  timezone?: string;
  source?: string;
  slotResolution: number;
  dateRange: [string, string];
  reconciliation: IntradayLaborReconciliation;
  roles?: Record<string, string>;
  days: Record<string, IntradayLaborDay>;
}

export interface LaborDayShapePoint {
  slot: number;
  avgCost: number;
  avgHeadcount: number;
}

export interface DailySalesLaborPoint {
  date: string;
  label: string;
  sales: number;
  laborCost: number;
  laborHours: number;
  laborPct: number | null;
}

export interface SalesLaborSummary {
  totalSales: number;
  totalLaborCost: number;
  totalLaborHours: number;
  laborPct: number | null;
  salesPerLaborHour: number | null;
  avgTicket: number | null;
  totalTransactions: number;
  daily: DailySalesLaborPoint[];
  chartGranularity: 'day' | 'month';
  chart: DailySalesLaborPoint[];
  laborAvailable: boolean;
  laborThrough: string | null;
}

export interface EmployeeDaily {
  sales: number;
  tickets: number;
  gratuity: number;
  serviceChargeVip: number;
  serviceChargeParty: number;
  serviceChargeOther: number;
  hours: number;
  laborCost: number;
  scheduledShifts: number;
  lateMinutes: number;
  noShow: number;
}

export interface EmployeeTopItem {
  name: string;
  revenue: number;
}

export interface EmployeeProfile {
  id: string;
  displayName: string;
  posNames: string[];
  sevenShiftsUserId: number | null;
  roles: string[];
  wage: number;
  hiredAt: string;
  active: boolean;
  days: Record<string, EmployeeDaily>;
  deptMix: Record<string, number>;
  topItems: EmployeeTopItem[];
}

export interface EmployeesData {
  generatedAt: string;
  dateRange: [string, string];
  laborDateRange?: [string, string];
  employees: EmployeeProfile[];
}

export type EmployeePeriod = 30 | 90 | 365 | 'all';

export interface EmployeeRollup {
  employeeId: string;
  displayName: string;
  roles: string[];
  wage: number;
  hiredAt: string;
  active: boolean;
  periodStart: string;
  periodEnd: string;
  laborPeriodStart: string;
  laborPeriodEnd: string;
  laborSales: number;
  laborTips: number;
  sales: number;
  tickets: number;
  gratuity: number;
  serviceChargeVip: number;
  serviceChargeParty: number;
  serviceChargeOther: number;
  totalTips: number;
  hours: number;
  laborCost: number;
  shiftCount: number;
  scheduledShifts: number;
  lateMinutes: number;
  noShows: number;
  avgCheck: number | null;
  salesPerHour: number | null;
  tipsPerHour: number | null;
  tipRate: number | null;
  salesPerWageDollar: number | null;
  personalLaborPct: number | null;
  avgHoursPerWeek: number | null;
  avgShiftLength: number | null;
  dailyTrend: Array<{ date: string; sales: number; tips: number; hours: number }>;
  deptMix: Record<string, number>;
  topItems: EmployeeTopItem[];
  bestDay: { date: string; sales: number } | null;
  laborLinked: boolean;
}

export interface EmployeeRankings {
  salesRank: number | null;
  salesPercentile: number | null;
  tipsPerHourRank: number | null;
  tipsPerHourPercentile: number | null;
  splhRank: number | null;
  splhPercentile: number | null;
  hoursRank: number | null;
  hoursPercentile: number | null;
  peerCount: number;
  roleLabel: string | null;
}
