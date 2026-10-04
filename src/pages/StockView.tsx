import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { api, Product, StockEntry } from '../api/client';
import { useAuth } from '../context/AuthContext';
import Modal from '../components/Modal';

type Props = {
  products: Product[];
  symbol: string;
  onChanged: () => Promise<void>;
};

type Line = {
  productId: number;
  name: string;
  barcode: string;
  quantity: string;
  unitCost: string;
};

const numInput: CSSProperties = {
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  textAlign: 'right',
};

const right: CSSProperties = { textAlign: 'right' };

const invalidRing: CSSProperties = {
  boxShadow: '0 0 0 2px rgba(220, 50, 50, 0.45)',
};

const isValidQty = (q: string) => /^\d+$/.test(q.trim()) && parseInt(q, 10) > 0;

export default function StockView({ products, symbol, onChanged }: Props) {
  const { user } = useAuth();
  const scanRef = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<Line[]>([]);
  const [query, setQuery] = useState('');
  const [supplier, setSupplier] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<StockEntry[]>([]);
  const [historyFilter, setHistoryFilter] = useState('');
  const [detail, setDetail] = useState<StockEntry | null>(null);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const loadEntries = async () => {
    try {
      setEntries(await api.getStockEntries());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load stock history');
    }
  };

  useEffect(() => {
    loadEntries();
    scanRef.current?.focus();
  }, []);

  // Hide the success banner automatically
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 5000);
    return () => clearTimeout(t);
  }, [success]);

  const findProduct = (code: string): Product | undefined => {
    const c = code.trim();
    if (!c) return undefined;
    const lc = c.toLowerCase();
    return (
      products.find((p) => p.barcode && p.barcode.trim() === c) ||
      products.find((p) => String(p.id) === c) ||
      products.find((p) => p.name.toLowerCase() === lc)
    );
  };

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q) ||
          String(p.id) === q
      )
      .slice(0, 6);
  }, [products, query]);

  const addProduct = (p: Product) => {
    if (!p.stock) {
      setError(
        `“${p.name}” does not track inventory. Enable “Track inventory” in Catalog first.`
      );
      return;
    }
    setError(null);
    setSuccess(null);
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        return prev.map((l) =>
          l.productId === p.id
            ? { ...l, quantity: String((parseInt(l.quantity, 10) || 0) + 1) }
            : l
        );
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          barcode: p.barcode || '',
          quantity: '1',
          unitCost: '',
        },
      ];
    });
    setQuery('');
    scanRef.current?.focus();
  };

  const onScan = () => {
    const code = query.trim();
    if (!code) return;
    const exact = findProduct(code);
    if (exact) {
      addProduct(exact);
      return;
    }
    if (suggestions.length === 1) {
      addProduct(suggestions[0]);
      return;
    }
    setError(`No product for “${code}”`);
  };

  const updateLine = (productId: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  };

  const removeLine = (productId: number) => {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
    scanRef.current?.focus();
  };

  const totalUnits = lines.reduce((n, l) => n + (parseInt(l.quantity, 10) || 0), 0);
  const totalCost = lines.reduce(
    (s, l) => s + (parseInt(l.quantity, 10) || 0) * (parseFloat(l.unitCost) || 0),
    0
  );

  const saveEntry = async () => {
    setError(null);
    setSuccess(null);
    if (!lines.length) {
      setError('Add at least one product');
      return;
    }
    const bad = lines.find((l) => !isValidQty(l.quantity));
    if (bad) {
      setError(`Enter a valid whole quantity for “${bad.name}”`);
      return;
    }

    setBusy(true);
    try {
      const entry = await api.createStockEntry({
        supplier: supplier.trim(),
        note: note.trim(),
        user_id: user?._id || 0,
        user: user?.fullname || '',
        items: lines.map((l) => ({
          product_id: l.productId,
          quantity: parseInt(l.quantity, 10),
          unit_cost: parseFloat(l.unitCost) || 0,
        })),
      });
      setLines([]);
      setSupplier('');
      setNote('');
      setSuccess(`Stock entry ${entry?.ref_number ?? ''} saved`);
      await onChanged();
      await loadEntries();
      scanRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save stock entry');
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (id: number) => {
    try {
      setDetail(await api.getStockEntry(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load entry');
    }
  };

  const visibleEntries = entries.filter((e) => {
    const q = historyFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      (e.ref_number || '').toLowerCase().includes(q) ||
      (e.supplier || '').toLowerCase().includes(q)
    );
  });

  // Enter inside qty / cost goes back to the scan box for fast receiving
  const backToScan = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      scanRef.current?.focus();
    }
  };

  return (
    <div>
      {error && (
        <div className="error">
          {error}{' '}
          <button type="button" className="btn btn-ghost" onClick={() => setError(null)}>
            dismiss
          </button>
        </div>
      )}
      {success && (
        <div
          style={{
            padding: '0.6rem 0.9rem',
            marginBottom: '1rem',
            borderRadius: 8,
            border: '1px solid var(--line)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span>✓ {success}</span>
          <button type="button" className="btn btn-ghost" onClick={() => setSuccess(null)}>
            dismiss
          </button>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))',
          gap: '1rem',
          alignItems: 'start',
        }}
      >
        {/* ---------------- New entry ---------------- */}
        <div className="panel" style={{ padding: '1rem', minWidth: 0 }}>
          <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Receive stock</h3>

          <div className="field">
            <label>Scan barcode or search product</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                ref={scanRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onScan();
                }}
                placeholder="Scan or type — Enter to add"
                autoFocus
                style={{ flex: 1, minWidth: 0 }}
              />
              <button type="button" className="btn btn-primary" onClick={onScan}>
                Add
              </button>
            </div>

            {suggestions.length > 0 && (
              <div
                style={{
                  marginTop: '0.4rem',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                {suggestions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="btn btn-ghost"
                    style={{
                      display: 'flex',
                      width: '100%',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                      borderRadius: 0,
                      textAlign: 'left',
                    }}
                    onClick={() => addProduct(p)}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.name}
                    </span>
                    <span className="muted" style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                      {p.barcode || `#${p.id}`}
                      {p.stock ? ` · ${p.quantity} in stock` : ' · not tracked'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {lines.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th style={{ ...right, width: 56 }}>Now</th>
                    <th style={{ ...right, width: 84 }}>Qty in</th>
                    <th style={{ ...right, width: 100 }}>Unit cost</th>
                    <th style={{ ...right, width: 64 }}>After</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const current = byId.get(l.productId)?.quantity ?? 0;
                    const qty = parseInt(l.quantity, 10) || 0;
                    const valid = isValidQty(l.quantity);
                    return (
                      <tr key={l.productId}>
                        <td>
                          <div>{l.name}</div>
                          {l.barcode && (
                            <div className="muted" style={{ fontSize: '0.75rem' }}>
                              {l.barcode}
                            </div>
                          )}
                        </td>
                        <td style={right}>{current}</td>
                        <td>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={l.quantity}
                            style={{ ...numInput, ...(valid ? {} : invalidRing) }}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={backToScan}
                            onChange={(e) =>
                              updateLine(l.productId, { quantity: e.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={l.unitCost}
                            placeholder="0.00"
                            style={numInput}
                            onFocus={(e) => e.target.select()}
                            onKeyDown={backToScan}
                            onChange={(e) =>
                              updateLine(l.productId, { unitCost: e.target.value })
                            }
                          />
                        </td>
                        <td style={right}>
                          <strong>{current + qty}</strong>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-danger"
                            aria-label={`Remove ${l.name}`}
                            onClick={() => removeLine(l.productId)}
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">Scan or search a product to start</div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.75rem',
              marginTop: '1rem',
            }}
          >
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Supplier (optional)</label>
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Note (optional)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Invoice number, remarks…"
              />
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.75rem',
              marginTop: '1rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid var(--line)',
            }}
          >
            <div>
              <div>
                <strong>
                  {lines.length} product{lines.length === 1 ? '' : 's'} · {totalUnits} unit
                  {totalUnits === 1 ? '' : 's'}
                </strong>
              </div>
              <div className="muted">
                Cost {symbol}
                {totalCost.toFixed(2)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn"
                disabled={busy || !lines.length}
                onClick={() => setLines([])}
              >
                Clear
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !lines.length}
                onClick={saveEntry}
              >
                {busy ? 'Saving…' : 'Save entry'}
              </button>
            </div>
          </div>
        </div>

        {/* ---------------- History ---------------- */}
        <div className="panel" style={{ padding: '1rem', minWidth: 0 }}>
          <div className="field">
            <label>Stock entries</label>
            <input
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
              placeholder="Filter by reference or supplier"
            />
          </div>

          {visibleEntries.length > 0 ? (
            <div style={{ overflow: 'auto', maxHeight: '70vh' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Entry</th>
                    <th>Supplier</th>
                    <th style={right}>Units</th>
                    <th style={right}>Cost</th>
                    <th style={{ width: 64 }} />
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <div>
                          <strong>{e.ref_number || e.id}</strong>
                        </div>
                        <div className="muted" style={{ fontSize: '0.75rem' }}>
                          {new Date(e.created_at).toLocaleString()}
                        </div>
                      </td>
                      <td>{e.supplier || '—'}</td>
                      <td style={right}>{e.units ?? '—'}</td>
                      <td style={right}>
                        {symbol}
                        {Number(e.total_cost).toFixed(2)}
                      </td>
                      <td>
                        <button type="button" className="btn" onClick={() => openDetail(e.id)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No stock entries yet</div>
          )}
        </div>
      </div>

      {/* ---------------- Detail modal ---------------- */}
      <Modal
        title={detail ? `Stock entry ${detail.ref_number}` : 'Stock entry'}
        open={!!detail}
        onClose={() => setDetail(null)}
        wide
      >
        {detail && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              {new Date(detail.created_at).toLocaleString()}
              {detail.user ? ` · ${detail.user}` : ''}
              {detail.supplier ? ` · ${detail.supplier}` : ''}
            </p>
            {detail.note && <p>{detail.note}</p>}
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Barcode</th>
                    <th style={right}>Qty</th>
                    <th style={right}>Unit cost</th>
                    <th style={right}>Line cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.items || []).map((i) => (
                    <tr key={i.id}>
                      <td>{i.product_name}</td>
                      <td>{i.barcode || '—'}</td>
                      <td style={right}>{i.quantity}</td>
                      <td style={right}>
                        {symbol}
                        {Number(i.unit_cost).toFixed(2)}
                      </td>
                      <td style={right}>
                        {symbol}
                        {(i.quantity * i.unit_cost).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ textAlign: 'right', marginBottom: 0 }}>
              Total{' '}
              <strong>
                {symbol}
                {Number(detail.total_cost).toFixed(2)}
              </strong>
            </p>
          </>
        )}
      </Modal>
    </div>
  );
}