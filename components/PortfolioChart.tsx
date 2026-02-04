
import React, { useState, useMemo, useEffect } from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { TrendingUp, TrendingDown } from 'lucide-react';

export type TimeRange = '1D' | '1W' | '1M' | '1Y' | 'YTD';

function formatDateOnly(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

function formatDateAndTime(iso: string): string {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  const timePart = m === 0 ? `${displayH}:00 ${ampm}` : `${displayH}:${m.toString().padStart(2, '0')} ${ampm}`;
  return `${datePart} ${timePart}`;
}

interface PortfolioChartProps {
  type?: 'Paper' | 'Live';
  accountId?: string | null;
  currentEquity?: number;
  /** Combined mode: pass pre-fetched history and control range from parent */
  history?: { time: string; value: number }[];
  range?: TimeRange;
  onRangeChange?: (r: TimeRange) => void;
  /** Accent color for combined mode: 'sky' (Paper) or 'rose' (Live) */
  accent?: 'sky' | 'rose';
  /** Combined mode: opening balance for backfill (e.g. sum of all accounts). When provided and > 0, used for range-start backfill and forward-fill. */
  openingBalance?: number;
}

const PortfolioChart: React.FC<PortfolioChartProps> = ({
  type = 'Paper',
  accountId,
  currentEquity,
  history: historyProp,
  range: rangeProp,
  onRangeChange,
  accent = 'sky',
  openingBalance: openingBalanceProp,
}) => {
  const [rangeLocal, setRangeLocal] = useState<TimeRange>('1D');
  const [chartData, setChartData] = useState<{ time: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);

  const isCombinedMode = Array.isArray(historyProp);
  const range = rangeProp ?? rangeLocal;
  const setRange = onRangeChange ?? setRangeLocal;
  const dataSource = isCombinedMode ? (historyProp ?? []) : chartData;

  useEffect(() => {
    if (isCombinedMode) {
      setLoading(false);
      return;
    }
    const fetchData = async () => {
      setLoading(true);
      try {
        if (accountId) {
          const res = await fetch(`/api/account-portfolio?account_id=${accountId}&include_portfolio_history=true&range=${range}`);
          if (res.ok) {
            const data = await res.json();
            const history = data.portfolioHistory || [];
            const useStatsFallback =
              (range === '1M' || range === '1Y' || range === 'YTD') && history.length === 0;
            if (useStatsFallback) {
              const statsRes = await fetch(
                `/api/stats?type=${type}&includeEquity=true&range=${range}&account_id=${accountId}`
              );
              if (statsRes.ok) {
                const statsData = await statsRes.json();
                setChartData(statsData.equityData || []);
              } else {
                setChartData(history);
              }
            } else {
              setChartData(history);
            }
          } else {
            setChartData([]);
          }
        } else {
          const res = await fetch(`/api/stats?type=${type}&includeEquity=true&range=${range}`);
          if (res.ok) {
            const data = await res.json();
            setChartData(data.equityData || []);
          } else {
            setChartData([]);
          }
        }
      } catch (error) {
        console.error('Failed to fetch portfolio equity data', error);
        setChartData([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [type, accountId, range, isCombinedMode]);

  // Extend chart data: backfill from range start with first recorded balance, extend to "now" so X-axis spans full timeframe
  const formattedChartData = useMemo(() => {
    if (dataSource.length === 0) return [];

    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PortfolioChart.tsx:formattedChartData:entry',message:'chart format entry',data:{range,isCombinedMode,openingBalanceProp,dataSourceLen:dataSource.length,firstPoint:dataSource[0]?{time:dataSource[0].time,value:dataSource[0].value}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion

    const now = new Date();
    let rangeStart = new Date();
    if (range === '1D') {
      rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    } else if (range === '1W') {
      rangeStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (range === '1M') {
      rangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (range === '1Y') {
      rangeStart = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    } else if (range === 'YTD') {
      rangeStart = new Date(now.getFullYear(), 0, 1);
    }
    const rangeEnd = now;

    const sorted = [...dataSource].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
    );
    // Use account type opening balance for backfill (Paper $100k, Live $10k) - Alpaca's early values can be wrong
    const isLive = type === 'Live' || accent === 'rose';
    const openingBalance = isLive ? 10000 : 100000;
    const firstMeaningful = sorted.find((p) => (p.value ?? 0) > 0) ?? null;
    // Combined mode: when parent passes openingBalance (e.g. combined opening), use it for backfill; otherwise infer from data or single-account default
    const firstMeaningfulValue =
      openingBalanceProp != null && openingBalanceProp > 0
        ? openingBalanceProp
        : firstMeaningful && firstMeaningful.value >= 5000
          ? firstMeaningful.value
          : openingBalance;
    const firstMeaningfulTime = firstMeaningful
      ? new Date(firstMeaningful.time).getTime()
      : sorted.length > 0
        ? new Date(sorted[0].time).getTime()
        : rangeStart.getTime();
    const lastPoint = sorted[sorted.length - 1];
    const lastTime = new Date(lastPoint.time).getTime();
    const rangeStartMs = rangeStart.getTime();
    const rangeEndMs = rangeEnd.getTime();

    const extended: { time: string; value: number }[] = [];
    // Combined mode: always add rangeStart with combined opening so curve starts at 200k (not 100k) when first data point is at rangeStart
    if (openingBalanceProp != null && openingBalanceProp > 0) {
      extended.push({ time: rangeStart.toISOString(), value: openingBalanceProp });
    } else if (firstMeaningfulTime > rangeStartMs) {
      extended.push({ time: rangeStart.toISOString(), value: firstMeaningfulValue });
    }
    // #region agent log
    fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PortfolioChart.tsx:afterRangeStart',message:'after rangeStart push',data:{rangeStartMs,rangeStartISO:rangeStart.toISOString(),extendedLen:extended.length,extendedFirst:extended[0],firstDataTime:sorted[0]?.time,firstDataValue:sorted[0]?.value,sameBucket:range=== '1W'? (Math.floor(rangeStartMs/(30*60*1000)) === (sorted[0]? Math.floor(new Date(sorted[0].time).getTime()/(30*60*1000)) : -1)) : null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    // Drop leading zero/negative points; for 1D also exclude points before rangeStart (today only)
    // When no positive value exists, exclude all raw points and show only backfill + end
    // Skip a point at rangeStart when we already added rangeStart with openingBalanceProp (avoid duplicate with wrong value)
    extended.push(
      ...sorted.filter((p) => {
        const t = new Date(p.time).getTime();
        if (!firstMeaningful) return false;
        if (openingBalanceProp != null && openingBalanceProp > 0 && t === rangeStartMs) return false;
        return t >= firstMeaningfulTime && t >= rangeStartMs;
      })
    );
    // Only append "now" if last point is at least 1 minute before rangeEnd to avoid duplicate end point
    if (lastTime < rangeEndMs - 60 * 1000) {
      const endValue = currentEquity ?? lastPoint.value;
      extended.push({ time: rangeEnd.toISOString(), value: endValue });
    }

    // For 1W: downsample to 30-minute buckets (keep last value per bucket)
    let toFormat = extended;
    if (range === '1W') {
      const bucketMs = 30 * 60 * 1000;
      const bucketMap = new Map<number, { time: string; value: number }>();
      for (const p of extended) {
        const t = new Date(p.time).getTime();
        const bucket = Math.floor(t / bucketMs) * bucketMs;
        bucketMap.set(bucket, { time: new Date(bucket).toISOString(), value: p.value });
      }
      toFormat = Array.from(bucketMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([, p]) => p);
      // #region agent log
      const rangeStartBucket = Math.floor(rangeStartMs / bucketMs) * bucketMs;
      fetch('http://127.0.0.1:7246/ingest/0a8c89bf-f00f-4c2f-93d1-5b6313920c49',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'PortfolioChart.tsx:after1Wbucket',message:'after 1W 30min bucket',data:{toFormatLen:toFormat.length,toFormatFirst:toFormat[0],rangeStartBucket,valueAtRangeStartBucket:bucketMap.get(rangeStartBucket)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H5'})}).catch(()=>{});
      // #endregion
    }

    // Forward-fill zero/negative/outlier equity (weekend bars or bad API snapshots) so the curve doesn't show fake dips
    if (range === '1W' || range === '1M' || range === '1Y' || range === 'YTD') {
      const floor = Math.min(5000, firstMeaningfulValue * 0.01);
      const maxDropRatio = 0.5; // treat as bad if value is less than 50% of previous good
      let lastGood = toFormat[0]?.value;
      if (typeof lastGood !== 'number' || !Number.isFinite(lastGood) || lastGood <= 0 || lastGood < floor) {
        lastGood = firstMeaningfulValue;
      }
      toFormat = toFormat.map((p) => {
        const v = p.value;
        const isFinitePositive = typeof v === 'number' && Number.isFinite(v) && v > 0;
        const aboveFloor = isFinitePositive && v >= floor;
        const notOutlierDrop = !lastGood || v >= lastGood * maxDropRatio;
        if (isFinitePositive && aboveFloor && notOutlierDrop) {
          lastGood = v;
          return p;
        }
        return { ...p, value: lastGood };
      });
    }

    const formatTimeLabel = (date: Date, includeTime: boolean) => {
      const hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      const timePart =
        minutes === 0
          ? `${displayHours}:00 ${ampm}`
          : `${displayHours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
      return includeTime ? timePart : '';
    };

    return toFormat
      .map((point: { time: string; value: number }) => {
        const date = new Date(point.time);
        let timeLabel = '';

        if (range === '1D') {
          timeLabel = formatTimeLabel(date, true);
        } else if (range === '1W') {
          timeLabel = `${date.toLocaleDateString('en-US', { weekday: 'short' })} ${date.getDate()} ${formatTimeLabel(date, true)}`;
        } else if (range === '1M' || range === 'YTD') {
          // Use ISO as unique category; axis will show date-only via tickFormatter; tooltip shows full date+time
          timeLabel = point.time;
        } else if (range === '1Y') {
          timeLabel = `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getDate()} '${String(date.getFullYear()).slice(-2)}`;
        } else {
          timeLabel = date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          });
        }

        return {
          time: timeLabel,
          value: point.value,
          timestamp: point.time,
        };
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [dataSource, range, currentEquity, type, accent, openingBalanceProp]);

  const stats = useMemo(() => {
    if (formattedChartData.length === 0) {
      return { diff: 0, percent: 0 };
    }
    const startValue = formattedChartData[0].value;
    const endValue = formattedChartData[formattedChartData.length - 1].value;
    const diff = endValue - startValue;
    const percent = startValue > 0 ? (diff / startValue) * 100 : 0;
    return { diff, percent };
  }, [formattedChartData]);

  const yAxisDomain = useMemo(() => {
    if (formattedChartData.length === 0) return undefined;
    const vals = formattedChartData.map((d) => d.value).filter((v) => typeof v === 'number' && !Number.isNaN(v));
    if (vals.length === 0) return undefined;
    const dataMin = Math.min(...vals);
    const dataMax = Math.max(...vals);
    return [Math.max(0, dataMin - 500), dataMax + 500] as [number, number];
  }, [formattedChartData]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-bold uppercase tracking-widest text-zinc-400">Equity</h2>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Growth Curve</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1 bg-zinc-900/60 p-1 rounded-lg border border-zinc-800">
            {(['1D', '1W', '1M', '1Y', 'YTD'] as TimeRange[]).map((t) => (
              <button
                key={t}
                onClick={() => setRange(t)}
                className={`px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${
                  range === t
                    ? accent === 'rose'
                      ? 'bg-[#B99DEB] text-white shadow-lg shadow-[#B99DEB]/20'
                      : 'bg-[#86c7f3] text-black shadow-lg shadow-[#86c7f3]/20'
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
        ) : formattedChartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
            No data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={formattedChartData}>
            <defs>
              <linearGradient id={accent === 'rose' ? 'colorValueRose' : 'colorValueSky'} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={accent === 'rose' ? '#f43f5e' : '#86c7f3'} stopOpacity={0.15}/>
                <stop offset="95%" stopColor={accent === 'rose' ? '#f43f5e' : '#86c7f3'} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#262626" />
            <XAxis 
              dataKey="time" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#737373', fontSize: 10, fontWeight: 600 }} 
              dy={10}
              interval="preserveStartEnd"
              tickFormatter={range === '1M' || range === 'YTD' ? (val: string) => formatDateOnly(val) : undefined}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#737373', fontSize: 10, fontWeight: 600 }} 
              tickFormatter={(val) => {
                if (val >= 1000) {
                  return `$${(val/1000).toFixed(1)}k`;
                }
                return `$${val.toLocaleString()}`;
              }}
              domain={yAxisDomain ?? ['auto', 'auto']}
            />
            {formattedChartData.length > 0 && (
              <ReferenceLine 
                y={formattedChartData[0].value} 
                stroke="#737373" 
                strokeDasharray="3 3" 
                strokeOpacity={0.5}
                label={{ value: `$${formattedChartData[0].value.toLocaleString()}`, position: 'right', fill: '#737373', fontSize: 10 }}
              />
            )}
            <Tooltip 
              contentStyle={{ backgroundColor: '#171717', border: '1px solid #262626', borderRadius: '12px', color: '#f5f5f5', fontSize: '11px', fontWeight: 'bold' }}
              itemStyle={{ color: accent === 'rose' ? '#f43f5e' : '#86c7f3' }}
              cursor={{ stroke: '#404040', strokeWidth: 1 }}
              formatter={(value: number) => [`$${value.toLocaleString()}`, 'Portfolio Value']}
              labelFormatter={
                range === '1M' || range === 'YTD'
                  ? (label: string) => formatDateAndTime(label)
                  : undefined
              }
            />
            <Area 
              type="linear" 
              dataKey="value" 
              stroke={accent === 'rose' ? '#f43f5e' : '#86c7f3'}
              strokeWidth={3}
              fillOpacity={1} 
              fill={`url(#${accent === 'rose' ? 'colorValueRose' : 'colorValueSky'})`}
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
