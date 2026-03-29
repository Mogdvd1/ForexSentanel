import { MarketData } from '../types';

/**
 * Calculates Smoothed Moving Average (SMMA)
 * Formula: SMMA(i) = (Sum - SMMA(i-1) + Close(i)) / N
 * First value is SMA.
 */
export function calculateSMMA(data: number[], period: number): number[] {
  const smma: number[] = new Array(data.length).fill(0);
  let sum = 0;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sum += data[i];
      smma[i] = 0;
    } else if (i === period - 1) {
      sum += data[i];
      smma[i] = sum / period;
    } else {
      smma[i] = (smma[i - 1] * (period - 1) + data[i]) / period;
    }
  }
  return smma;
}

/**
 * Calculates Relative Strength Index (RSI)
 */
export function calculateRSI(data: number[], period: number = 14): number[] {
  const rsi: number[] = new Array(data.length).fill(0);
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < data.length; i++) {
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi[i] = 100 - 100 / (1 + rs);

    avgGain = (avgGain * (period - 1) + gains[i - 1]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i - 1]) / period;
  }

  return rsi;
}

/**
 * Calculates Average True Range (ATR)
 */
export function calculateATR(highs: number[], lows: number[], closes: number[], period: number = 14): number[] {
  const tr: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const hl = highs[i] - lows[i];
    const hpc = Math.abs(highs[i] - closes[i - 1]);
    const lpc = Math.abs(lows[i] - closes[i - 1]);
    tr.push(Math.max(hl, hpc, lpc));
  }

  const atr: number[] = new Array(tr.length).fill(0);
  let sumTr = tr.slice(1, period + 1).reduce((a, b) => a + b, 0);
  atr[period] = sumTr / period;

  for (let i = period + 1; i < tr.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }

  return atr;
}

export function generateMockData(count: number = 200): MarketData[] {
  const data: MarketData[] = [];
  let price = 1.1234;
  const now = Date.now();
  const minute = 60 * 1000;

  for (let i = 0; i < count; i++) {
    const volatility = 0.0005;
    const change = (Math.random() - 0.5) * volatility;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    
    data.push({
      time: now - (count - i) * minute,
      open,
      high,
      low,
      close,
      volume: Math.floor(Math.random() * 1000)
    });
    price = close;
  }

  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);

  const smma10 = calculateSMMA(closes, 10);
  const smma30 = calculateSMMA(closes, 30);
  const atr = calculateATR(highs, lows, closes, 14);

  // Simulate H4 trend (changes slowly)
  let currentTrend: 'UP' | 'DOWN' = Math.random() > 0.5 ? 'UP' : 'DOWN';
  
  return data.map((d, i) => {
    if (i % 240 === 0) { // Change trend roughly every 4 hours (240 mins)
      currentTrend = Math.random() > 0.5 ? 'UP' : 'DOWN';
    }
    return {
      ...d,
      smma10: smma10[i],
      smma30: smma30[i],
      trend: currentTrend,
      atr: atr[i]
    };
  });
}
