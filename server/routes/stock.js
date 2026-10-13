import { Router } from 'express';
import { getDb } from '../db.js';

// Rounds to 3 decimals to avoid floating point errors (0.1 + 0.2 = 0.30000000000000004)
const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
// Adds stock and recalculates weighted average cost
function stockIn(db, productId, qty, unitCost) {
  const p = db
    .prepare('SELECT quantity, avg_cost FROM products WHERE id = ?')
    .get(productId);
  if (!p) return;

  const curQty = Number(p.quantity) || 0;
  const baseQty = Math.max(curQty, 0); // المخزون السالب لا يدخل في الحساب
  const baseCost = Number(p.avg_cost) || 0;
  const newQty = round3(curQty + qty);
  const denom = baseQty + qty;
  const avg = denom > 0 ? (baseQty * baseCost + qty * unitCost) / denom : unitCost;

  db.prepare('UPDATE products SET quantity = ?, avg_cost = ? WHERE id = ?').run(
    newQty,
    Math.round(avg * 10000) / 10000,
    productId
  );
}
function mapEntry(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    ref_number: row.ref_number,
    supplier: row.supplier,
    note: row.note,
    user_id: row.user_id,
    user: row.user_name,
    total_cost: row.total_cost,
    created_at: row.created_at,
    item_count: row.item_count ?? undefined,
    units: row.units ?? undefined,
  };
}

function mapItem(row) {
  return {
    id: row.id,
    entry_id: row.entry_id,
    product_id: row.product_id,
    product_name: row.product_name,
    barcode: row.barcode,
    quantity: row.quantity,
    unit_cost: row.unit_cost,
  };
}
// Reverts the quantities of an entry's lines. Returns an error string if any product would go negative.
function revertEntry(db, entryId) {
  const items = db
    .prepare(
      'SELECT product_id, product_name, quantity, unit_cost FROM stock_entry_items WHERE entry_id = ?'
    )
    .all(entryId);
  const getP = db.prepare('SELECT quantity, avg_cost FROM products WHERE id = ?');
  const upd = db.prepare('UPDATE products SET quantity = ?, avg_cost = ? WHERE id = ?');

  for (const it of items) {
    const p = getP.get(it.product_id);
    if (!p) continue;

    const newQty = round3(p.quantity - it.quantity);
    if (newQty < 0) {
      throw new Error(
        `Cannot revert "${it.product_name}": part of this stock was already sold (current ${p.quantity}, entry ${it.quantity})`
      );
    }

    const curAvg = Number(p.avg_cost) || 0;
    let newAvg = curAvg;
    if (newQty > 0) {
      const value = p.quantity * curAvg - it.quantity * it.unit_cost;
      newAvg = Math.max(0, value / newQty);
    }
    upd.run(newQty, Math.round(newAvg * 10000) / 10000, it.product_id);
  }
}

export default function stockRouter() {
  const router = Router();

  // List latest entries (summary only)
  router.get('/entries', (_req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT e.*,
                (SELECT COUNT(*) FROM stock_entry_items i WHERE i.entry_id = e.id) AS item_count,
                (SELECT COALESCE(ROUND(SUM(i.quantity), 3), 0) FROM stock_entry_items i WHERE i.entry_id = e.id) AS units
           FROM stock_entries e
          ORDER BY e.id DESC
          LIMIT 200`
      )
      .all();
    res.json(rows.map(mapEntry));
  });

  // One entry with its lines
  router.get('/entries/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const db = getDb();
    const row = db.prepare('SELECT * FROM stock_entries WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Stock entry not found' });
    const items = db
      .prepare('SELECT * FROM stock_entry_items WHERE entry_id = ? ORDER BY id')
      .all(id);
    res.json({ ...mapEntry(row), items: items.map(mapItem) });
  });

  // Receive stock: creates the entry and increases product quantities atomically
  router.post('/entries', (req, res) => {
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) {
      return res.status(400).json({ error: 'No items provided' });
    }

    const db = getDb();
    const getProduct = db.prepare('SELECT id, name, barcode, stock FROM products WHERE id = ?');

    // Validate everything before touching the database
    const lines = [];
    for (const it of rawItems) {
      const productId = parseInt(it.product_id, 10);
      const quantity = round3(Number(it.quantity));
      const unitCost = Math.max(0, parseFloat(it.unit_cost) || 0);

      if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ error: 'Invalid product id' });
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ error: 'Quantity must be a number greater than 0' });
      }
      const product = getProduct.get(productId);
      if (!product) {
        return res.status(400).json({ error: `Product #${productId} not found` });
      }
      if (!product.stock) {
        return res.status(400).json({
          error: `"${product.name}" does not track inventory. Enable "Track inventory" in Catalog first.`,
        });
      }
      lines.push({
        productId,
        name: product.name,
        barcode: product.barcode || '',
        quantity,
        unitCost,
      });
    }

    const totalCost = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    const userId = parseInt(body.user_id, 10) || 0;
    const userName = String(body.user || '').slice(0, 100);
    const supplier = String(body.supplier || '').trim().slice(0, 200);
    const note = String(body.note || '').trim().slice(0, 1000);

    let entryId = 0;
    try {
      db.transaction(() => {
        const ins = db
          .prepare(
            `INSERT INTO stock_entries (supplier, note, user_id, user_name, total_cost, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(supplier, note, userId, userName, totalCost, new Date().toISOString());
        entryId = ins.lastInsertRowid;

        db.prepare('UPDATE stock_entries SET ref_number = ? WHERE id = ?').run(
          `SE-${String(entryId).padStart(5, '0')}`,
          entryId
        );

        const insItem = db.prepare(
          `INSERT INTO stock_entry_items (entry_id, product_id, product_name, barcode, quantity, unit_cost)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        // في POST /entries
        for (const l of lines) {
          insItem.run(entryId, l.productId, l.name, l.barcode, l.quantity, l.unitCost);
          stockIn(db, l.productId, l.quantity, l.unitCost);
        }

       
      })();
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Could not save stock entry' });
    }

    const row = db.prepare('SELECT * FROM stock_entries WHERE id = ?').get(entryId);
    const items = db
      .prepare('SELECT * FROM stock_entry_items WHERE entry_id = ? ORDER BY id')
      .all(entryId);
    res.status(201).json({ ...mapEntry(row), items: items.map(mapItem) });
  });
    // Update an entry: revert old lines, insert new lines (all in one transaction)
  router.put('/entries/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) {
      return res.status(400).json({ error: 'No items provided' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT * FROM stock_entries WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Stock entry not found' });

    const getProduct = db.prepare('SELECT id, name, barcode, stock FROM products WHERE id = ?');

    const lines = [];
    for (const it of rawItems) {
      const productId = parseInt(it.product_id, 10);
      const quantity = round3(Number(it.quantity));
      const unitCost = Math.max(0, parseFloat(it.unit_cost) || 0);

      if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ error: 'Invalid product id' });
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ error: 'Quantity must be a number greater than 0' });
      }
      const product = getProduct.get(productId);
      if (!product) {
        return res.status(400).json({ error: `Product #${productId} not found` });
      }
      if (!product.stock) {
        return res.status(400).json({
          error: `"${product.name}" does not track inventory. Enable "Track inventory" in Catalog first.`,
        });
      }
      lines.push({
        productId,
        name: product.name,
        barcode: product.barcode || '',
        quantity,
        unitCost,
      });
    }

    const totalCost = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0);
    const supplier = String(body.supplier || '').trim().slice(0, 200);
    const note = String(body.note || '').trim().slice(0, 1000);

    try {
      db.transaction(() => {
        // 1) Undo the old quantities (throws if it would make stock negative)
        revertEntry(db, id);

        // 2) Replace the lines
        db.prepare('DELETE FROM stock_entry_items WHERE entry_id = ?').run(id);

        const insItem = db.prepare(
          `INSERT INTO stock_entry_items (entry_id, product_id, product_name, barcode, quantity, unit_cost)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
       // في PUT /entries/:id
          for (const l of lines) {
            insItem.run(id, l.productId, l.name, l.barcode, l.quantity, l.unitCost);
            stockIn(db, l.productId, l.quantity, l.unitCost);
          }
      
        // 3) Update the header (keep ref_number, user_id, user_name, created_at)
        db.prepare(
          'UPDATE stock_entries SET supplier = ?, note = ?, total_cost = ? WHERE id = ?'
        ).run(supplier, note, totalCost, id);
      })();
    } catch (err) {
      console.error(err);
      const isRevert = String(err.message).startsWith('Cannot revert');
      return res
        .status(isRevert ? 400 : 500)
        .json({ error: isRevert ? err.message : 'Could not update stock entry' });
    }

    const row = db.prepare('SELECT * FROM stock_entries WHERE id = ?').get(id);
    const items = db
      .prepare('SELECT * FROM stock_entry_items WHERE entry_id = ? ORDER BY id')
      .all(id);
    res.json({ ...mapEntry(row), items: items.map(mapItem) });
  });

  // Delete an entry: revert quantities, then remove entry and lines
  router.delete('/entries/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const db = getDb();
    const existing = db.prepare('SELECT id FROM stock_entries WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Stock entry not found' });

    try {
      db.transaction(() => {
        revertEntry(db, id);
        db.prepare('DELETE FROM stock_entry_items WHERE entry_id = ?').run(id);
        db.prepare('DELETE FROM stock_entries WHERE id = ?').run(id);
      })();
    } catch (err) {
      console.error(err);
      const isRevert = String(err.message).startsWith('Cannot revert');
      return res
        .status(isRevert ? 400 : 500)
        .json({ error: isRevert ? err.message : 'Could not delete stock entry' });
    }

    res.json({ ok: true });
  });
  return router;
}