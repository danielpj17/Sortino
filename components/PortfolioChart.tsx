
import React, { useState, useMemo } from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { TrendingUp, TrendingDown } from 'lucide-react';

type TimeRange = '1D' | '1W' | '1M' | '1Y' | 'YTD';

const CHART_DATA: Record<TimeRange, { time: string, value: number }[]> = {
  '1D': [
    { time: '09:00', value: 12000 }, { time: '11:00', value: 12150 }, { time: '13:00', value: 12050 }, 
    { time: '15:00', value: 12300 }, { time: '17:00', value: 12450 }
  ],
  '1W': [
    { time: 'Mon', value: 11800 }, { time: 'Tue', value: 12000 }, { time: 'Wed', value: 11900 }, 
    { time: 'Thu', value: 12200 }, { time: 'Fri', value: 12450 }
  ],
  '1M': [
    { time: '01 Mar', value: 10000 }, { time: '05 Mar', value: 10250 }, { time: '10 Mar', value: 9800 },
    { time: '15 Mar', value: 10500 }, { time: '20 Mar', value: 11200 }, { time: '25 Mar', value: 10900 },
    { time: '30 Mar', value: 11500 }, { time: '04 Apr', value: 12100 }, { time: '08 Apr', value: 11900 },
    { time: '12 Apr', value: 12450 }
  ],
  '1Y': [
    { time: 'Apr 23', value: 8500 }, { time: 'Jun 23', value: 9200 }, { time: 'Aug 23', value: 9800 },
    { time: 'Oct 23', value: 9400 }, { time: 'Dec 23', value: 10500 }, { time: 'Feb 24', value: 11200 },
    { time: 'Apr 24', value: 12450 }
  ],
  'YTD': [
    { time: 'Jan', value: 10500 }, { time: 'Feb', value: 11200 }, { time: 'Mar', value: 11800 },
    { time: 'Apr', value: 12450 }
  ]
};

const PortfolioChart: React.FC = () => {
  const [range, setRange] = useState<TimeRange>('1D');

  const stats = useMemo(() => {
    const data = CHART_DATA[range];
    const startValue = data[0].value;
    const endValue = data[data.length - 1].value;
    const diff = endValue - startValue;
    const percent = (diff / startValue) * 100;
    return { diff, percent };
  }, [range]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">Equity</h2>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Growth Curve</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1 bg-zinc-900/50 p-1 rounded-lg border border-zinc-800">
            {(['1D', '1W', '1M', '1Y', 'YTD'] as TimeRange[]).map((t) => (
              <button
                key={t}
                onClick={() => setRange(t)}
                className={`px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${
                  range === t 
                    ? 'bg-[#86c7f3] text-black shadow-lg shadow-[#86c7f3]/20' 
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-lg font-black tracking-tighter ${stats.diff >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {stats.diff >= 0 ? '+' : ''}${Math.abs(stats.diff).toLocaleString()}
            </span>
            <div className={`flex items-center gap-1 text-xs font-bold ${stats.diff >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {stats.diff >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {Math.abs(stats.percent).toFixed(2)}%
            </div>
          </div>
        </div>
      </div>

      <div className="h-[280px] w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={CHART_DATA[range]}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#86c7f3" stopOpacity={0.15}/>
                <stop offset="95%" stopColor="#86c7f3" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#262626" />
            <XAxis 
              dataKey="time" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#737373', fontSize: 10, fontWeight: 600 }} 
              dy={10}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#737373', fontSize: 10, fontWeight: 600 }} 
              tickFormatter={(val) => `$${(val/1000).toFixed(1)}k`}
              domain={['dataMin - 500', 'dataMax + 500']}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '12px', color: '#f5f5f5', fontSize: '11px', fontWeight: 'bold' }}
              itemStyle={{ color: '#86c7f3' }}
              cursor={{ stroke: '#404040', strokeWidth: 1 }}
              formatter={(value: number) => [`$${value.toLocaleString()}`, 'Portfolio Value']}
            />
            <Area 
              type="monotone" 
              dataKey="value" 
              stroke="#86c7f3" 
              strokeWidth={3}
              fillOpacity={1} 
              fill="url(#colorValue)" 
              animationDuration={800}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default PortfolioChart;
