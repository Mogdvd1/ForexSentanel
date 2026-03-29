export interface Trade {
  id: string;
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice?: number;
  stopLoss: number;
  takeProfit?: number;
  status: 'OPEN' | 'CLOSED';
  entryTime: number;
  exitTime?: number;
  profit?: number;
  size: number;
}

export interface MarketData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  smma10?: number;
  smma30?: number;
  trend?: 'UP' | 'DOWN';
  atr?: number;
}

export interface BotState {
  isActive: boolean;
  balance: number;
  equity: number;
  trades: Trade[];
  currentData: MarketData[];
}
