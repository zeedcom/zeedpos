import { Router } from 'express';
import { getDb } from '../db.js';

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

export default function stockRouter() {
  const router = Router();

  // List latest entries (summary only)
  router.get('/entries', (_req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT e.*,
                (SELECT COUNT(*) FROM stock_entry_items i WHERE i.entry_id = e.id) AS item_count,
                (SELECT COALESCE(SUM(i.quantity), 0) FROM stock_entry_items i WHERE i.entry_id = e.id) AS units
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
      const quantity = Number(it.quantity);
      const unitCost = Math.max(0, parseFloat(it.unit_cost) || 0);

      if (!Number.isInteger(productId) || productId <= 0) {
        return res.status(400).json({ error: 'Invalid product id' });
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        return res.status(400).json({ error: 'Quantity must be a positive whole number' });
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
        const addQty = db.prepare('UPDATE products SET quantity = quantity + ? WHERE id = ?');

        for (const l of lines) {
          insItem.run(entryId, l.productId, l.name, l.barcode, l.quantity, l.unitCost);
          addQty.run(l.quantity, l.productId);
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

  return router;
}