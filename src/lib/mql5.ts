export const MQL5_EA_CODE = `//+------------------------------------------------------------------+
//|                                              ForexSentinel.mq5   |
//+------------------------------------------------------------------+
#property copyright "Copyright 2026, Forex Sentinel"
#property link      "https://sentinel.bot"
#property version   "1.06"
#property strict

#include <Trade\\Trade.mqh>

//--- Inputs
input int      InpSMMAFast   = 10;   // fast SMMA
input int      InpSMMASlow   = 30;   // slow SMMA
input double   InpRiskPercent = 0.5;
input double   InpMaxExposure = 1.5;
input int      InpATRPeriod   = 14;
input double   InpATRMultiplier = 1.5;
input ENUM_TIMEFRAMES InpTimeframe = PERIOD_H1;
input ENUM_TIMEFRAMES TrendTimeframe = PERIOD_H4; // higher timeframe trend filter

//--- Indicator Handles
int handleSMMAFast, handleSMMASlow, handleATR;
int handleTrendFast, handleTrendSlow;

//--- Global Variables
double balance;
CTrade trade;

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit()
{
   handleSMMAFast = iMA(_Symbol, InpTimeframe, InpSMMAFast, 0, MODE_SMMA, PRICE_CLOSE);
   handleSMMASlow = iMA(_Symbol, InpTimeframe, InpSMMASlow, 0, MODE_SMMA, PRICE_CLOSE);
   handleATR      = iATR(_Symbol, InpTimeframe, InpATRPeriod);

   handleTrendFast = iMA(_Symbol, TrendTimeframe, InpSMMAFast, 0, MODE_SMMA, PRICE_CLOSE);
   handleTrendSlow = iMA(_Symbol, TrendTimeframe, InpSMMASlow, 0, MODE_SMMA, PRICE_CLOSE);

   if(handleSMMAFast == INVALID_HANDLE || handleSMMASlow == INVALID_HANDLE ||
      handleATR == INVALID_HANDLE ||
      handleTrendFast == INVALID_HANDLE || handleTrendSlow == INVALID_HANDLE)
   {
      Print("Failed to initialize indicators");
      return(INIT_FAILED);
   }

   trade.SetExpertMagicNumber(123456);
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   static datetime last_bar_time = 0;
   datetime current_bar_time = iTime(_Symbol, InpTimeframe, 0);
   if(last_bar_time == current_bar_time) return;
   last_bar_time = current_bar_time;

   //--- Skip weekends only
   MqlDateTime dt;
   TimeGMT(dt);
   if(dt.day_of_week == 0 || dt.day_of_week == 6) return;

   //--- Get Indicator Values
   double smmaFast[], smmaSlow[], atr[];
   double trendFast[], trendSlow[];
   ArraySetAsSeries(smmaFast, true);
   ArraySetAsSeries(smmaSlow, true);
   ArraySetAsSeries(atr, true);
   ArraySetAsSeries(trendFast, true);
   ArraySetAsSeries(trendSlow, true);

   if(CopyBuffer(handleSMMAFast, 0, 0, 3, smmaFast) < 3) return;
   if(CopyBuffer(handleSMMASlow, 0, 0, 3, smmaSlow) < 3) return;
   if(CopyBuffer(handleATR, 0, 0, 3, atr) < 3) return;
   if(CopyBuffer(handleTrendFast, 0, 0, 3, trendFast) < 3) return;
   if(CopyBuffer(handleTrendSlow, 0, 0, 3, trendSlow) < 3) return;

   double price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   balance = AccountInfoDouble(ACCOUNT_BALANCE);

   ManageOpenPositions();

   bool crossUp   = (smmaFast[2] <= smmaSlow[2] && smmaFast[1] > smmaSlow[1]);
   bool crossDown = (smmaFast[2] >= smmaSlow[2] && smmaFast[1] < smmaSlow[1]);

   bool trendUp   = (trendFast[1] > trendSlow[1]);
   bool trendDown = (trendFast[1] < trendSlow[1]);

   double currentExposure = CalculateCurrentExposure();
   if(currentExposure >= balance * (InpMaxExposure / 100.0)) return;

   //--- Bullish Entry
   if(crossUp && trendUp)
   {
      double sl = price - (atr[1] * InpATRMultiplier);
      double risk = MathAbs(price - sl);
      double tp = price + (risk * 2.0);   // 1:2 RR
      double lotSize = CalculateLotSize(risk);
      if(lotSize > 0) trade.Buy(lotSize, _Symbol, price, sl, tp, "Sentinel Long");
   }
   //--- Bearish Entry
   else if(crossDown && trendDown)
   {
      double sl = price + (atr[1] * InpATRMultiplier);
      double risk = MathAbs(price - sl);
      double tp = price - (risk * 2.0);   // 1:2 RR
      double lotSize = CalculateLotSize(risk);
      if(lotSize > 0) trade.Sell(lotSize, _Symbol, price, sl, tp, "Sentinel Short");
   }
}

//+------------------------------------------------------------------+
//| Manage Open Positions                                            |
//+------------------------------------------------------------------+
void ManageOpenPositions()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket))
      {
         if(PositionGetInteger(POSITION_MAGIC) != 123456) continue;

         double entry = PositionGetDouble(POSITION_PRICE_OPEN);
         double currentPrice = PositionGetDouble(POSITION_PRICE_CURRENT);
         double sl = PositionGetDouble(POSITION_SL);

         double risk   = MathAbs(entry - sl);
         double profit = MathAbs(currentPrice - entry);

         //--- Break-even Logic (1:2 RR)
         if(profit >= risk * 2.0 && sl != entry)
         {
            trade.PositionModify(ticket, entry, PositionGetDouble(POSITION_TP));
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Calculate Lot Size                                               |
//+------------------------------------------------------------------+
double CalculateLotSize(double riskPoints)
{
   double riskAmount = balance * (InpRiskPercent / 100.0);
   double tickValue  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize   = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);

   if(riskPoints <= 0 || tickValue <= 0) return 0;

   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double lots    = riskAmount / (riskPoints / tickSize * tickValue);

   return MathFloor(lots / lotStep) * lotStep;
}

//+------------------------------------------------------------------+
//| Calculate Current Total Exposure                                 |
//+------------------------------------------------------------------+
double CalculateCurrentExposure()
{
   double total = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(PositionSelectByTicket(ticket))
      {
         if(PositionGetInteger(POSITION_MAGIC) == 123456)
         {
            double volume = PositionGetDouble(POSITION_VOLUME);
            double price  = PositionGetDouble(POSITION_PRICE_OPEN);
            total += volume * price;
         }
      }
   }
   return total;
}
//+------------------------------------------------------------------+
`;
