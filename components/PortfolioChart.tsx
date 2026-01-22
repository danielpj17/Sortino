
import React, { useState, useMemo, useEffect } from 'react';
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

interface PortfolioChartProps {
  type?: 'Paper' | 'Live';
  accountId?: string | null;
  currentEquity?: number;
}

const PortfolioChart: React.FC<PortfolioChartProps> = ({ type = 'Paper', accountId, currentEquity }) => {
  const [range, setRange] = useState<TimeRange>('1D');
  const [chartData, setChartData] = useState<{ time: string, value: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const accountParam = accountId ? `&account_id=${accountId}` : '';
        const res = await fetch(`/api/stats/${type}?includeEquity=true&range=${range}${accountParam}`);
        if (res.ok) {
          const data = await res.json();
          setChartData(data.equityData || []);
        } else {
          setChartData([]);
        }
      } catch (error) {
        console.error('Failed to fetch portfolio equity data', error);
        setChartData([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [type, accountId, range]);

  const stats = useMemo(() => {
    if (chartData.length === 0) {
      return { diff: 0, percent: 0 };
    }
    const startValue = chartData[0].value;
    const endValue = chartData[chartData.length - 1].value;
    const diff = endValue - startValue;
    const percent = startValue > 0 ? (diff / startValue) * 100 : 0;
    return { diff, percent };
  }, [chartData]);

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
        {loading ? (
          <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
            Loading chart data...
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
            No data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
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
        )}
      </div>
    </div>
  );
};

export default PortfolioChart;
