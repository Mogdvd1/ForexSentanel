import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  ReferenceLine, AreaChart, Area, ComposedChart, Bar
} from 'recharts';
import { 
  Play, Pause, RefreshCw, TrendingUp, TrendingDown, 
  ShieldAlert, Activity, History, Settings, Calendar,
  AlertCircle, CheckCircle2, Info, Code, Download, PlayCircle
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from './lib/utils';
import { generateMockData } from './lib/indicators';
import { BotState, Trade, MarketData } from './types';
import { MQL5_EA_CODE } from './lib/mql5';
import { motion, AnimatePresence } from 'motion/react';

const INITIAL_BALANCE = 5000;
const RISK_PER_TRADE_PERCENT = 0.005; // 0.5%
const MAX_EXPOSURE_PERCENT = 0.015; // 1.5%

export default function App() {
  const [botState, setBotState] = useState<BotState>({
    isActive: false,
    balance: INITIAL_BALANCE,
    equity: INITIAL_BALANCE,
    trades: [],
    currentData: generateMockData(150),
  });

  const [lastUpdate, setLastUpdate] = useState<number>(Date.now());
  const [activeTab, setActiveTab] = useState<'live' | 'mt5' | 'backtest'>('live');
  const [isBacktesting, setIsBacktesting] = useState(false);
  const dataRef = useRef<MarketData[]>(botState.currentData);

  const handleDownloadEA = () => {
    const blob = new Blob([MQL5_EA_CODE], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ForexSentinel.mq5';
    a.click();
    URL.revokeObjectURL(url);
  };

  const runBacktest = () => {
    setIsBacktesting(true);
    // Reset state for backtest
    setBotState(s => ({
      ...s,
      balance: INITIAL_BALANCE,
      equity: INITIAL_BALANCE,
      trades: [],
      currentData: generateMockData(500), // More data for backtest
    }));
    
    // Simulate fast-forward backtest
    setTimeout(() => {
      setIsBacktesting(false);
      setActiveTab('live');
    }, 2000);
  };

  // Bot Logic Engine
  useEffect(() => {
    if (!botState.isActive) return;

    const interval = setInterval(() => {
      setBotState(prev => {
        const lastData = prev.currentData[prev.currentData.length - 1];
        
        // Simulate new tick
        const volatility = 0.0004;
        const change = (Math.random() - 0.5) * volatility;
        const newClose = lastData.close + change;
        const newHigh = Math.max(lastData.high, newClose);
        const newLow = Math.min(lastData.low, newClose);
        
        const newDataPoint: MarketData = {
          time: lastData.time + 60000,
          open: lastData.close,
          high: newHigh,
          low: newLow,
          close: newClose,
          volume: Math.floor(Math.random() * 1000),
        };

        const updatedData = [...prev.currentData.slice(1), newDataPoint];
        
        // Recalculate indicators for the new set
        const closes = updatedData.map(d => d.close);
        const highs = updatedData.map(d => d.high);
        const lows = updatedData.map(d => d.low);
        
        // Simplified SMMA update for performance in mock
        const smma10 = prev.currentData[prev.currentData.length - 1].smma10 || lastData.close;
        const smma30 = prev.currentData[prev.currentData.length - 1].smma30 || lastData.close;
        const atr = prev.currentData[prev.currentData.length - 1].atr || 0.001;
        const trend = prev.currentData[prev.currentData.length - 1].trend || 'UP';

        newDataPoint.smma10 = smma10 * 0.9 + newClose * 0.1;
        newDataPoint.smma30 = smma30 * 0.95 + newClose * 0.05;
        newDataPoint.atr = atr * 0.99 + Math.abs(newHigh - newLow) * 0.01;
        newDataPoint.trend = trend; // Trend changes slowly in indicators.ts simulation

        let newTrades = [...prev.trades];
        let newBalance = prev.balance;
        let openTrades = newTrades.filter(t => t.status === 'OPEN');

        // Check Exit Conditions
        openTrades.forEach(trade => {
          const isLong = trade.type === 'LONG';
          const exitBullish = isLong && newDataPoint.smma10! < newDataPoint.smma30!;
          const exitBearish = !isLong && newDataPoint.smma10! > newDataPoint.smma30!;
          
          // Stop Loss / Take Profit
          const hitSL = isLong ? newClose <= trade.stopLoss : newClose >= trade.stopLoss;
          const hitTP = isLong ? newClose >= trade.takeProfit! : newClose <= trade.takeProfit!;
          
          // Move to Break-even if 1:2 RR reached
          if (trade.takeProfit && !trade.status.includes('BE')) {
            const risk = Math.abs(trade.entryPrice - trade.stopLoss);
            const reward = Math.abs(newClose - trade.entryPrice);
            if (reward >= risk * 2) {
              trade.stopLoss = trade.entryPrice;
              trade.status = 'OPEN (BE)';
            }
          }

          if (exitBullish || exitBearish || hitSL || hitTP) {
            trade.status = 'CLOSED';
            trade.exitPrice = newClose;
            trade.exitTime = newDataPoint.time;
            const pnl = isLong 
              ? (newClose - trade.entryPrice) * trade.size 
              : (trade.entryPrice - newClose) * trade.size;
            trade.profit = pnl;
            newBalance += pnl;
          }
        });

        // Check Entry Conditions (Only if within exposure limits)
        const currentExposure = openTrades.reduce((acc, t) => acc + (t.size * newClose), 0);
        const canTrade = currentExposure < INITIAL_BALANCE * MAX_EXPOSURE_PERCENT;
        
        // Session Check (Mon-Fri)
        const day = new Date(newDataPoint.time).getDay();
        const isWeekend = day === 0 || day === 6;

        if (canTrade && !isWeekend) {
          const prevPoint = prev.currentData[prev.currentData.length - 1];
          const crossUp = prevPoint.smma10! <= prevPoint.smma30! && newDataPoint.smma10! > newDataPoint.smma30!;
          const crossDown = prevPoint.smma10! >= prevPoint.smma30! && newDataPoint.smma10! < newDataPoint.smma30!;

          if (crossUp && newDataPoint.trend === 'UP') {
            // Bullish Entry
            const sl = newClose - (newDataPoint.atr! * 1.5);
            const risk = newClose - sl;
            const tp = newClose + (risk * 2); 
            newTrades.push({
              id: Math.random().toString(36).substr(2, 9),
              type: 'LONG',
              entryPrice: newClose,
              stopLoss: sl,
              takeProfit: tp,
              status: 'OPEN',
              entryTime: newDataPoint.time,
              size: (INITIAL_BALANCE * RISK_PER_TRADE_PERCENT) / risk
            });
          } else if (crossDown && newDataPoint.trend === 'DOWN') {
            // Bearish Entry
            const sl = newClose + (newDataPoint.atr! * 1.5);
            const risk = sl - newClose;
            const tp = newClose - (risk * 2);
            newTrades.push({
              id: Math.random().toString(36).substr(2, 9),
              type: 'SHORT',
              entryPrice: newClose,
              stopLoss: sl,
              takeProfit: tp,
              status: 'OPEN',
              entryTime: newDataPoint.time,
              size: (INITIAL_BALANCE * RISK_PER_TRADE_PERCENT) / risk
            });
          }
        }

        const openTradesAfter = newTrades.filter(t => t.status === 'OPEN');
        const unrealizedPnl = openTradesAfter.reduce((acc, t) => {
          const pnl = t.type === 'LONG' 
            ? (newClose - t.entryPrice) * t.size 
            : (t.entryPrice - newClose) * t.size;
          return acc + pnl;
        }, 0);

        return {
          ...prev,
          balance: newBalance,
          equity: newBalance + unrealizedPnl,
          trades: newTrades,
          currentData: updatedData
        };
      });
      setLastUpdate(Date.now());
    }, 2000);

    return () => clearInterval(interval);
  }, [botState.isActive]);

  const openTrades = useMemo(() => botState.trades.filter(t => t.status === 'OPEN'), [botState.trades]);
  const closedTrades = useMemo(() => botState.trades.filter(t => t.status === 'CLOSED').reverse(), [botState.trades]);
  const totalProfit = useMemo(() => botState.balance - INITIAL_BALANCE, [botState.balance]);
  const winRate = useMemo(() => {
    const closed = closedTrades;
    if (closed.length === 0) return 0;
    const wins = closed.filter(t => (t.profit || 0) > 0).length;
    return (wins / closed.length) * 100;
  }, [closedTrades]);

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Header */}
      <header className="border-b border-[#141414] p-6 flex justify-between items-center bg-white/50 backdrop-blur-sm sticky top-0 z-50">
        <div>
          <h1 className="text-2xl font-bold tracking-tighter flex items-center gap-2">
            <Activity className="w-6 h-6" />
            FOREX SENTINEL <span className="text-xs font-mono opacity-50 border border-[#141414] px-1 rounded">V1.0.4</span>
          </h1>
          <p className="text-xs font-serif italic opacity-60">Automated SMMA Trend-Following Strategy</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase tracking-widest opacity-50 font-bold">Status</span>
            <div className={cn(
              "flex items-center gap-2 px-3 py-1 rounded-full border border-[#141414] text-xs font-bold transition-all",
              botState.isActive ? "bg-[#141414] text-[#E4E3E0]" : "bg-transparent text-[#141414]"
            )}>
              <div className={cn("w-2 h-2 rounded-full animate-pulse", botState.isActive ? "bg-green-400" : "bg-red-400")} />
              {botState.isActive ? "BOT ACTIVE" : "BOT STANDBY"}
            </div>
          </div>
          
          <button 
            onClick={() => setBotState(s => ({ ...s, isActive: !s.isActive }))}
            className={cn(
              "w-12 h-12 rounded-full border-2 border-[#141414] flex items-center justify-center transition-all active:scale-95",
              botState.isActive ? "bg-white hover:bg-red-50" : "bg-[#141414] text-white hover:bg-black/90"
            )}
          >
            {botState.isActive ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
          </button>
        </div>
      </header>

      <main className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-[1600px] mx-auto">
        
        {/* Navigation Tabs */}
        <div className="lg:col-span-12 flex gap-2 mb-2">
          <TabButton active={activeTab === 'live'} onClick={() => setActiveTab('live')} icon={<Activity className="w-4 h-4" />} label="Live Dashboard" />
          <TabButton active={activeTab === 'backtest'} onClick={() => setActiveTab('backtest')} icon={<PlayCircle className="w-4 h-4" />} label="Strategy Backtest" />
          <TabButton active={activeTab === 'mt5'} onClick={() => setActiveTab('mt5')} icon={<Code className="w-4 h-4" />} label="MT5 Integration" />
        </div>

        {activeTab === 'mt5' ? (
          <div className="lg:col-span-12 space-y-6">
            <div className="bg-white border border-[#141414] rounded-xl overflow-hidden shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
              <div className="p-6 border-b border-[#141414] bg-[#f8f8f8] flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-bold tracking-tight">MetaTrader 5 Expert Advisor (EA)</h2>
                  <p className="text-sm opacity-60">Deploy your strategy directly to MT5 for H1 timeframe trading.</p>
                </div>
                <button 
                  onClick={handleDownloadEA}
                  className="flex items-center gap-2 bg-[#141414] text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-black transition-all active:scale-95"
                >
                  <Download className="w-4 h-4" /> Download .mq5 File
                </button>
              </div>
              <div className="p-6 bg-[#1a1a1a] text-green-400 font-mono text-xs overflow-x-auto max-h-[600px]">
                <pre>{MQL5_EA_CODE}</pre>
              </div>
              <div className="p-6 border-t border-[#141414] bg-blue-50">
                <h3 className="text-sm font-bold mb-2 flex items-center gap-2">
                  <Info className="w-4 h-4 text-blue-600" /> How to install on MT5:
                </h3>
                <ol className="text-xs space-y-2 list-decimal list-inside opacity-80">
                  <li>Open your MetaTrader 5 Terminal.</li>
                  <li>Go to <b>File {'>'} Open Data Folder</b>.</li>
                  <li>Navigate to <b>MQL5 {'>'} Experts</b>.</li>
                  <li>Paste the downloaded <b>ForexSentinel.mq5</b> file there.</li>
                  <li>Restart MT5 or right-click <b>Experts</b> in the Navigator and select <b>Refresh</b>.</li>
                  <li>Drag the EA onto a <b>EUR/USD H1</b> chart.</li>
                  <li>Enable <b>Algo Trading</b> in the top toolbar.</li>
                </ol>
              </div>
            </div>
          </div>
        ) : activeTab === 'backtest' ? (
          <div className="lg:col-span-12 space-y-6">
            <div className="bg-white border border-[#141414] rounded-xl overflow-hidden shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] p-12 text-center">
              <div className="max-w-md mx-auto space-y-6">
                <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto border-2 border-[#141414]">
                  <PlayCircle className="w-10 h-10" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">Strategy Backtester</h2>
                  <p className="text-sm opacity-60 mt-2">Run a high-speed simulation of the Sentinel strategy over 500 hours of historical market data.</p>
                </div>
                <button 
                  onClick={runBacktest}
                  disabled={isBacktesting}
                  className={cn(
                    "w-full py-4 rounded-xl border-2 border-[#141414] font-bold text-lg transition-all flex items-center justify-center gap-3",
                    isBacktesting ? "bg-gray-100 opacity-50 cursor-not-allowed" : "bg-[#141414] text-white hover:bg-black"
                  )}
                >
                  {isBacktesting ? (
                    <>
                      <RefreshCw className="w-6 h-6 animate-spin" />
                      SIMULATING...
                    </>
                  ) : (
                    <>
                      <Play className="w-6 h-6" />
                      START BACKTEST
                    </>
                  )}
                </button>
                <div className="grid grid-cols-2 gap-4 text-left">
                  <div className="p-4 bg-gray-50 rounded-lg border border-[#141414]/10">
                    <div className="text-[10px] font-bold uppercase opacity-50">Timeframe</div>
                    <div className="text-sm font-bold">H1 (1 Hour)</div>
                  </div>
                  <div className="p-4 bg-gray-50 rounded-lg border border-[#141414]/10">
                    <div className="text-[10px] font-bold uppercase opacity-50">Data Points</div>
                    <div className="text-sm font-bold">500 Candles</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Stats Row */}
        <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard label="Account Balance" value={`$${botState.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} icon={<TrendingUp className="w-4 h-4" />} />
          <StatCard label="Current Equity" value={`$${botState.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} icon={<Activity className="w-4 h-4" />} />
          <StatCard label="Total Profit/Loss" value={`$${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} subValue={`${((totalProfit/INITIAL_BALANCE)*100).toFixed(2)}%`} trend={totalProfit >= 0 ? 'up' : 'down'} />
          <StatCard label="Win Rate" value={`${winRate.toFixed(1)}%`} subValue={`${closedTrades.length} Trades Closed`} icon={<History className="w-4 h-4" />} />
        </div>

        {/* Main Chart Area */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white border border-[#141414] rounded-xl overflow-hidden shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="p-4 border-b border-[#141414] flex justify-between items-center bg-[#f8f8f8]">
              <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> Market Analysis (EUR/USD)
              </h2>
              <div className="flex gap-4 text-[10px] font-mono">
                <span className="flex items-center gap-1"><div className="w-2 h-2 bg-blue-500 rounded-full" /> SMMA 10</span>
                <span className="flex items-center gap-1"><div className="w-2 h-2 bg-orange-500 rounded-full" /> SMMA 30</span>
              </div>
            </div>
            <div className="h-[400px] w-full p-4">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={botState.currentData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" vertical={false} />
                  <XAxis 
                    dataKey="time" 
                    hide 
                  />
                  <YAxis 
                    domain={['auto', 'auto']} 
                    orientation="right"
                    tick={{ fontSize: 10, fontFamily: 'monospace' }}
                    tickFormatter={(val) => val.toFixed(4)}
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#141414', border: 'none', borderRadius: '8px', color: '#E4E3E0', fontSize: '12px' }}
                    itemStyle={{ color: '#E4E3E0' }}
                    labelFormatter={(label) => format(label, 'HH:mm:ss')}
                  />
                  <Area type="monotone" dataKey="close" stroke="none" fill="#141414" fillOpacity={0.05} />
                  <Line type="monotone" dataKey="close" stroke="#141414" strokeWidth={2} dot={false} animationDuration={300} />
                  <Line type="monotone" dataKey="smma10" stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="5 5" />
                  <Line type="monotone" dataKey="smma30" stroke="#f97316" strokeWidth={1.5} dot={false} strokeDasharray="5 5" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white border border-[#141414] rounded-xl overflow-hidden shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="p-4 border-b border-[#141414] flex justify-between items-center bg-[#f8f8f8]">
              <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                <Activity className="w-4 h-4" /> H4 Trend Filter
              </h2>
              <div className="text-[10px] font-mono opacity-50">
                Higher Timeframe Confirmation
              </div>
            </div>
            <div className="h-[100px] w-full p-4 flex items-center justify-center">
              <div className={cn(
                "px-8 py-3 rounded-xl border-2 font-bold text-xl flex items-center gap-3 transition-all",
                botState.currentData[botState.currentData.length - 1].trend === 'UP' 
                  ? "bg-green-100 text-green-800 border-green-800" 
                  : "bg-red-100 text-red-800 border-red-800"
              )}>
                {botState.currentData[botState.currentData.length - 1].trend === 'UP' ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
                H4 TREND: {botState.currentData[botState.currentData.length - 1].trend}
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-4 space-y-6">
          {/* Active Trades */}
          <div className="bg-white border border-[#141414] rounded-xl overflow-hidden shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="p-4 border-b border-[#141414] bg-[#141414] text-[#E4E3E0] flex justify-between items-center">
              <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" /> Active Positions
              </h2>
              <span className="text-[10px] font-mono bg-white/20 px-2 py-0.5 rounded">{openTrades.length}</span>
            </div>
            <div className="p-0 max-h-[300px] overflow-y-auto">
              {openTrades.length === 0 ? (
                <div className="p-8 text-center opacity-40 italic text-sm">No active positions</div>
              ) : (
                openTrades.map(trade => (
                  <div key={trade.id} className="p-4 border-b border-[#141414] last:border-0 hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded border border-[#141414]",
                          trade.type === 'LONG' ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                        )}>
                          {trade.type}
                        </span>
                        <span className="text-xs font-mono font-bold">EUR/USD</span>
                      </div>
                      <span className="text-[10px] font-mono opacity-50">{format(trade.entryTime, 'HH:mm')}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                      <div>Entry: <span className="font-bold">{trade.entryPrice.toFixed(4)}</span></div>
                      <div>SL: <span className="font-bold text-red-600">{trade.stopLoss.toFixed(4)}</span></div>
                      <div className="col-span-2 mt-1">
                        <div className="flex justify-between mb-1">
                          <span>Unrealized P/L</span>
                          <span className={cn("font-bold", (botState.currentData[botState.currentData.length-1].close - trade.entryPrice) * (trade.type === 'LONG' ? 1 : -1) >= 0 ? "text-green-600" : "text-red-600")}>
                            ${((botState.currentData[botState.currentData.length-1].close - trade.entryPrice) * (trade.type === 'LONG' ? trade.size : -trade.size)).toFixed(2)}
                          </span>
                        </div>
                        <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                          <motion.div 
                            className={cn("h-full", (botState.currentData[botState.currentData.length-1].close - trade.entryPrice) * (trade.type === 'LONG' ? 1 : -1) >= 0 ? "bg-green-500" : "bg-red-500")}
                            initial={{ width: '50%' }}
                            animate={{ width: `${Math.max(10, Math.min(90, 50 + ((botState.currentData[botState.currentData.length-1].close - trade.entryPrice) / 0.002) * 100))}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Strategy Rules */}
          <div className="bg-white border border-[#141414] rounded-xl overflow-hidden shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="p-4 border-b border-[#141414] bg-[#f8f8f8]">
              <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                <Settings className="w-4 h-4" /> Strategy Parameters
              </h2>
            </div>
            <div className="p-4 space-y-4">
              <RuleItem label="Entry" desc="SMMA(10) Cross SMMA(30) + H4 Trend Filter" />
              <RuleItem label="Risk" desc="0.5% per trade ($25 max)" />
              <RuleItem label="Stop Loss" desc="1.5x ATR (Dynamic Volatility)" />
              <RuleItem label="Take Profit" desc="1:2 Risk-Reward Ratio" />
              <RuleItem label="Session" desc="Mon-Fri (Auto-Holiday Filter)" />
            </div>
          </div>

          {/* Recent History */}
          <div className="bg-white border border-[#141414] rounded-xl overflow-hidden shadow-[4px_4px_0px_0px_rgba(20,20,20,1)]">
            <div className="p-4 border-b border-[#141414] bg-[#f8f8f8] flex justify-between items-center">
              <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                <History className="w-4 h-4" /> Trade History
              </h2>
              <button className="text-[10px] font-bold hover:underline">View All</button>
            </div>
            <div className="p-0 max-h-[400px] overflow-y-auto">
              {closedTrades.length === 0 ? (
                <div className="p-8 text-center opacity-40 italic text-sm">No history yet</div>
              ) : (
                closedTrades.map(trade => (
                  <div key={trade.id} className="p-3 border-b border-[#141414] last:border-0 flex justify-between items-center hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center border border-[#141414]",
                        (trade.profit || 0) > 0 ? "bg-green-100" : "bg-red-100"
                      )}>
                        {(trade.profit || 0) > 0 ? <TrendingUp className="w-4 h-4 text-green-700" /> : <TrendingDown className="w-4 h-4 text-red-700" />}
                      </div>
                      <div>
                        <div className="text-[10px] font-bold">{trade.type} EUR/USD</div>
                        <div className="text-[9px] font-mono opacity-50">{format(trade.exitTime!, 'MMM dd, HH:mm')}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={cn("text-xs font-bold font-mono", (trade.profit || 0) > 0 ? "text-green-600" : "text-red-600")}>
                        {(trade.profit || 0) > 0 ? '+' : ''}${(trade.profit || 0).toFixed(2)}
                      </div>
                      <div className="text-[9px] font-mono opacity-40">RR: 1:{(Math.abs((trade.exitPrice! - trade.entryPrice) / (trade.entryPrice - trade.stopLoss))).toFixed(1)}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </>
    )}
  </main>

      {/* Footer / Status Bar */}
      <footer className="mt-12 border-t border-[#141414] p-4 bg-white/80 backdrop-blur-sm flex justify-between items-center text-[10px] font-mono uppercase tracking-widest font-bold">
        <div className="flex gap-6">
          <span className="flex items-center gap-2"><Calendar className="w-3 h-3" /> Market: <span className="text-green-600">Open</span></span>
          <span className="flex items-center gap-2"><Info className="w-3 h-3" /> Server: <span className="text-blue-600">Synced</span></span>
        </div>
        <div>
          Last Update: {format(lastUpdate, 'HH:mm:ss')}
        </div>
      </footer>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold border transition-all",
        active ? "bg-[#141414] text-white border-[#141414]" : "bg-white text-[#141414] border-[#141414]/20 hover:border-[#141414]"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function StatCard({ label, value, subValue, icon, trend }: { label: string, value: string, subValue?: string, icon?: React.ReactNode, trend?: 'up' | 'down' }) {
  return (
    <div className="bg-white border border-[#141414] p-4 rounded-xl shadow-[4px_4px_0px_0px_rgba(20,20,20,1)] relative overflow-hidden group hover:-translate-y-1 transition-transform">
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] uppercase tracking-widest font-bold opacity-50">{label}</span>
        {icon && <div className="opacity-20 group-hover:opacity-100 transition-opacity">{icon}</div>}
      </div>
      <div className="text-2xl font-bold tracking-tighter">{value}</div>
      {subValue && (
        <div className={cn(
          "text-[10px] font-mono font-bold mt-1 flex items-center gap-1",
          trend === 'up' ? "text-green-600" : trend === 'down' ? "text-red-600" : "opacity-40"
        )}>
          {trend === 'up' && <TrendingUp className="w-3 h-3" />}
          {trend === 'down' && <TrendingDown className="w-3 h-3" />}
          {subValue}
        </div>
      )}
    </div>
  );
}

function RuleItem({ label, desc }: { label: string, desc: string }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="mt-1"><CheckCircle2 className="w-3 h-3 text-green-600" /></div>
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider">{label}</div>
        <div className="text-[11px] font-serif italic opacity-60">{desc}</div>
      </div>
    </div>
  );
}
