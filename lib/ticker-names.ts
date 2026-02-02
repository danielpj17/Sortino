/**
 * Ticker symbol to company name mapping for DOW 30 and common stocks.
 * Used in trade log display when Alpaca/API data doesn't include company names.
 */
export const TICKER_NAMES: Record<string, string> = {
  AAPL: 'Apple',
  AMGN: 'Amgen',
  AXP: 'American Express',
  BA: 'Boeing',
  CAT: 'Caterpillar',
  CRM: 'Salesforce',
  CSCO: 'Cisco',
  CVX: 'Chevron',
  DIS: 'Walt Disney',
  DOW: 'Dow Inc.',
  GS: 'Goldman Sachs',
  HD: 'Home Depot',
  HON: 'Honeywell',
  IBM: 'IBM',
  INTC: 'Intel',
  JNJ: 'Johnson & Johnson',
  JPM: 'JPMorgan Chase',
  KO: 'Coca-Cola',
  MCD: "McDonald's",
  MMM: '3M',
  MRK: 'Merck',
  MSFT: 'Microsoft',
  NKE: 'Nike',
  PG: 'Procter & Gamble',
  TRV: 'Travelers',
  UNH: 'UnitedHealth',
  V: 'Visa',
  VZ: 'Verizon',
  WMT: 'Walmart',
};

export function getCompanyName(ticker: string, fallback?: string): string {
  const upper = (ticker || '').toUpperCase();
  return TICKER_NAMES[upper] ?? fallback ?? upper;
}
