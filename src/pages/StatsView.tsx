import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { api, Product, Transaction } from '../api/client';

type Props = {
  products: Product[];
  symbol: string;
};

const RANGES = [
  { id: 'today', label: 'Today', days: 1 },
  { id: '7d', label: '7 days', days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
] as const;

type Range = (typeof RANGES)[number];

const LOW_STOCK = 5;
const ACCENT = 'var(--accent, #3b82f6)';

const startOfDay = (daysBack: number) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d;
};

// Local-date key (avoids UTC shifts from toISOString)
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;

// "2026-10-12" -> local midnight of that day
const parseDateInput = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
};

type Period = {
  start: Date; // inclusive
  end: Date; // exclusive
  prevStart: Date;
  days: number;
};

// Either a preset range ending now, or one specific calendar day.
const getPeriod = (range: Range, selectedDate: string): Period => {
  if (selectedDate) {
    const start = parseDateInput(selectedDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const prevStart = new Date(start);
    prevStart.setDate(prevStart.getDate() - 1);
    return { start, end, prevStart, days: 1 };
  }
  const days = range.days;
  return {
    start: startOfDay(days - 1),
    end: new Date(Date.now() + 1000),
    prevStart: startOfDay(2 * days - 1),
    days,
  };
};

const grid = (min: number): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))`,
  gap: '1rem',
  alignItems: 'start',
});

const right: CSSProperties = { textAlign: 'right' };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export default function StatsView({ products, symbol }: Props) {
  const [range, setRange] = useState<Range>(RANGES[1]);
  const [selectedDate, setSelectedDate] = useState(''); // '' = use preset range
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [bounds, setBounds] = useState<{
    start: number;
    end: number;
    prevStart: number;
    days: number;
  } | null>(null);
  const [stockCost, setStockCost] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayKey = dayKey(new Date());

  const money = (n: number) =>
    `${symbol}${n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const period = getPeriod(range, selectedDate);

    try {
      const list = await api.getByDate({
        start: period.prevStart.toISOString(),
        end: period.end.toISOString(),
        user: 0,
        till: 0,
        status: 1,
      });
      setTxs(list);
      setBounds({
        start: period.start.getTime(),
        end: period.end.getTime(),
        prevStart: period.prevStart.getTime(),
        days: period.days,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load statistics');
    } finally {
      setLoading(false);
    }

    // Stock purchases (needs products permission; silently skipped otherwise)
    try {
      const entries = await api.getStockEntries();
      setStockCost(
        entries
          .filter((e) => {
            const t = new Date(e.created_at).getTime();
            return t >= period.start.getTime() && t < period.end.getTime();
          })
          .reduce((s, e) => s + Number(e.total_cost || 0), 0)
      );
    } catch {
      setStockCost(null);
    }
  }, [range, selectedDate]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    if (!bounds) return null;

    // Current weighted average cost per product (used for COGS)
    const costOf = new Map(products.map((p) => [p.id, Number(p.avg_cost) || 0]));

    const time = (t: Transaction) => new Date(t.date).getTime();
    const cur = txs.filter((t) => time(t) >= bounds.start && time(t) < bounds.end);
    const prev = txs.filter((t) => time(t) >= bounds.prevStart && time(t) < bounds.start);

    const summarize = (list: Transaction[]) => {
      const revenue = list.reduce((s, t) => s + Number(t.total || 0), 0);
      const tax = list.reduce((s, t) => s + Number(t.tax || 0), 0);
      const items = list.reduce(
        (s, t) => s + (t.items || []).reduce((n, i) => n + Number(i.quantity || 0), 0),
        0
      );
      const cost = list.reduce(
        (s, t) =>
          s +
          (t.items || []).reduce(
            (n, i) => n + (costOf.get(i.id) ?? 0) * Number(i.quantity || 0),
            0
          ),
        0
      );
      return {
        revenue,
        orders: list.length,
        items: round3(items),
        net: revenue - tax - cost,
      };
    };

    // Chart buckets: hours for a single day, days otherwise (zero-filled)
    const daily: { key: string; label: string; revenue: number }[] = [];
    if (bounds.days === 1) {
      const byHour = new Array<number>(24).fill(0);
      for (const t of cur) {
        byHour[new Date(t.date).getHours()] += Number(t.total || 0);
      }
      for (let h = 0; h < 24; h++) {
        daily.push({
          key: `h${h}`,
          label: `${String(h).padStart(2, '0')}:00`,
          revenue: byHour[h],
        });
      }
    } else {
      const byDay = new Map<string, number>();
      for (const t of cur) {
        const k = dayKey(new Date(t.date));
        byDay.set(k, (byDay.get(k) || 0) + Number(t.total || 0));
      }
      for (let i = 0; i < bounds.days; i++) {
        const d = new Date(bounds.start);
        d.setDate(d.getDate() + i);
        daily.push({
          key: dayKey(d),
          label:
            bounds.days <= 7
              ? d.toLocaleDateString(undefined, { weekday: 'short' })
              : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
          revenue: byDay.get(dayKey(d)) || 0,
        });
      }
    }

    // Top products
    const prodMap = new Map<number, { name: string; qty: number; revenue: number }>();
    for (const t of cur) {
      for (const i of t.items || []) {
        const row = prodMap.get(i.id) || { name: i.name, qty: 0, revenue: 0 };
        row.qty += Number(i.quantity || 0);
        row.revenue += Number(i.price || 0) * Number(i.quantity || 0);
        prodMap.set(i.id, row);
      }
    }
    const top = [...prodMap.values()]
      .map((p) => ({ ...p, qty: round3(p.qty) }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    // Payment split
    const pay = { cash: 0, card: 0, other: 0 };
    for (const t of cur) {
      const v = Number(t.total || 0);
      if (t.payment_type === 1) pay.cash += v;
      else if (t.payment_type === 3) pay.card += v;
      else pay.other += v;
    }

    return {
      now: summarize(cur),
      before: summarize(prev),
      daily,
      top,
      pay,
    };
  }, [txs, bounds, products]);

  const lowStock = useMemo(
    () =>
      products
        .filter((p) => p.stock && p.quantity <= LOW_STOCK)
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 10),
    [products]
  );

  const prevLabel = selectedDate
    ? 'previous day'
    : range.days === 1
    ? 'yesterday'
    : `previous ${range.days} days`;
  const maxDaily = stats ? Math.max(...stats.daily.map((d) => d.revenue), 0) : 0;
  const payTotal = stats ? stats.pay.cash + stats.pay.card + stats.pay.other : 0;
  const singleDay = bounds?.days === 1;

  const selectedLabel = selectedDate
    ? parseDateInput(selectedDate).toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '';

  const Delta = ({ cur, prev }: { cur: number; prev: number }) => {
    if (!prev) {
      return <span className="muted">{cur ? `new vs ${prevLabel}` : '—'}</span>;
    }
    // Math.abs so a negative previous value does not flip the arrow
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    const up = pct >= 0;
    return (
      <span style={{ color: up ? '#16a34a' : '#dc2626' }}>
        {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%{' '}
        <span className="muted">vs {prevLabel}</span>
      </span>
    );
  };

  const Kpi = ({ label, value, foot }: { label: string; value: string; foot?: ReactNode }) => (
    <div className="panel" style={{ padding: '1rem', minWidth: 0 }}>
      <div className="muted" style={{ fontSize: '0.8rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, margin: '0.2rem 0' }}>{value}</div>
      <div style={{ fontSize: '0.8rem', minHeight: '1.2em' }}>{foot}</div>
    </div>
  );

  return (
    <div>
      {/* Range + date selector */}
      <div
        className="chips"
        style={{
          paddingLeft: 0,
          border: 0,
          marginBottom: '1rem',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`chip ${!selectedDate && range.id === r.id ? 'active' : ''}`}
            onClick={() => {
              setSelectedDate('');
              setRange(r);
            }}
          >
            {r.label}
          </button>
        ))}

        <label
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', marginLeft: '0.5rem' }}
        >
          
          <div className="field">
          <label>Date</label>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
        </div>
        </label>
        {selectedDate && (
          <button type="button" className="btn btn-ghost" onClick={() => setSelectedDate('')}>
            Clear
          </button>
        )}

        <div style={{ marginLeft: 'auto' }}>
          <button type="button" className="btn" disabled={loading} onClick={load}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {selectedDate && (
        <div className="muted" style={{ marginBottom: '0.75rem' }}>
          Showing stats for <strong>{selectedLabel}</strong>
        </div>
      )}

      {error && (
        <div className="error">
          {error}{' '}
          <button type="button" className="btn btn-ghost" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}

      {!stats ? (
        <div className="empty">{loading ? 'Loading statistics…' : 'No data'}</div>
      ) : (
        <>
          {/* KPIs */}
          <div style={{ ...grid(190), marginBottom: '1rem' }}>
            <Kpi
              label="Revenue"
              value={money(stats.now.revenue)}
              foot={<Delta cur={stats.now.revenue} prev={stats.before.revenue} />}
            />
            <Kpi
              label="Orders"
              value={String(stats.now.orders)}
              foot={<Delta cur={stats.now.orders} prev={stats.before.orders} />}
            />
            <Kpi
              label="Net revenue"
              value={money(stats.now.net)}
              foot={<Delta cur={stats.now.net} prev={stats.before.net} />}
            />
            <Kpi
              label="Items sold"
              value={String(stats.now.items)}
              foot={<Delta cur={stats.now.items} prev={stats.before.items} />}
            />
            {stockCost !== null && (
              <Kpi
                label="Stock purchased"
                value={money(stockCost)}
                foot={<span className="muted">cost of received stock</span>}
              />
            )}
          </div>

          {/* Revenue chart (hourly for a single day, daily otherwise) */}
          <div className="panel" style={{ padding: '1rem', marginBottom: '1rem' }}>
            <h3 style={{ marginTop: 0 }}>{singleDay ? 'Revenue by hour' : 'Revenue by day'}</h3>
            {maxDaily === 0 ? (
              <div className="empty">No sales in this period</div>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: stats.daily.length > 45 ? 1 : 3,
                    height: 160,
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  {stats.daily.map((d) => (
                    <div
                      key={d.key}
                      title={`${d.label}: ${money(d.revenue)}`}
                      style={{
                        flex: 1,
                        minWidth: 1,
                        height: `${Math.max((d.revenue / maxDaily) * 100, d.revenue ? 3 : 0.8)}%`,
                        background: ACCENT,
                        opacity: d.revenue ? 1 : 0.25,
                        borderRadius: '3px 3px 0 0',
                      }}
                    />
                  ))}
                </div>
                {stats.daily.length <= 10 ? (
                  <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
                    {stats.daily.map((d) => (
                      <div
                        key={d.key}
                        className="muted"
                        style={{ flex: 1, textAlign: 'center', fontSize: '0.7rem' }}
                      >
                        {d.label}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    className="muted"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: 4,
                      fontSize: '0.7rem',
                    }}
                  >
                    <span>{stats.daily[0].label}</span>
                    <span>{stats.daily[stats.daily.length - 1].label}</span>
                  </div>
                )}
              </>
            )}
          </div>

          <div style={grid(420)}>
            {/* Top products */}
            <div className="panel" style={{ padding: '1rem', minWidth: 0 }}>
              <h3 style={{ marginTop: 0 }}>Top products</h3>
              {stats.top.length ? (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Product</th>
                        <th style={right}>Qty</th>
                        <th style={right}>Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.top.map((p, i) => (
                        <tr key={`${p.name}-${i}`}>
                          <td>{i + 1}</td>
                          <td>{p.name}</td>
                          <td style={right}>{p.qty}</td>
                          <td style={right}>{money(p.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">No sales in this period</div>
              )}
            </div>

            <div style={{ display: 'grid', gap: '1rem', minWidth: 0 }}>
              {/* Payment split */}
              <div className="panel" style={{ padding: '1rem' }}>
                <h3 style={{ marginTop: 0 }}>Payment methods</h3>
                {payTotal > 0 ? (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        height: 14,
                        borderRadius: 7,
                        overflow: 'hidden',
                        border: '1px solid var(--line)',
                        marginBottom: '0.6rem',
                      }}
                    >
                      <div style={{ flex: stats.pay.cash, background: ACCENT }} />
                      <div style={{ flex: stats.pay.card, background: '#f59e0b' }} />
                      <div style={{ flex: stats.pay.other, background: '#9ca3af' }} />
                    </div>
                    {(
                      [
                        ['Cash', stats.pay.cash, ACCENT],
                        ['Card', stats.pay.card, '#f59e0b'],
                        ['Other', stats.pay.other, '#9ca3af'],
                      ] as const
                    )
                      .filter(([, v]) => v > 0)
                      .map(([label, v, color]) => (
                        <div
                          key={label}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '0.15rem 0',
                          }}
                        >
                          <span>
                            <span
                              style={{
                                display: 'inline-block',
                                width: 10,
                                height: 10,
                                borderRadius: 3,
                                background: color,
                                marginRight: 6,
                              }}
                            />
                            {label}
                          </span>
                          <span>
                            {money(v)}{' '}
                            <span className="muted">({((v / payTotal) * 100).toFixed(0)}%)</span>
                          </span>
                        </div>
                      ))}
                  </>
                ) : (
                  <div className="empty">No payments in this period</div>
                )}
              </div>

              {/* Low stock */}
              <div className="panel" style={{ padding: '1rem' }}>
                <h3 style={{ marginTop: 0 }}>Low stock</h3>
                {lowStock.length ? (
                  <table className="table">
                    <tbody>
                      {lowStock.map((p) => (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td style={right}>
                            <span
                              style={{
                                color: p.quantity <= 0 ? '#dc2626' : '#d97706',
                                fontWeight: 600,
                              }}
                            >
                              {p.quantity <= 0 ? 'Out of stock' : `${p.quantity} left`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty">All tracked products are well stocked</div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}