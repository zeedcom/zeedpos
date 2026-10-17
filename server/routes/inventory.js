import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { getDb, mapProduct, barcodeExists, generateUniqueBarcode } from '../db.js';
import { requirePerm } from '../auth.js';

// Parse numbers safely: accepts "0,5" and "0.5", never returns NaN.
const toNum = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const n = parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
};

// Returns 0/1, or undefined if the client did not send the field.
const parseStock = (value) => {
  if (value === undefined || value === null) return undefined;
  if (value === 'on' || value === 0 || value === '0' || value === false || value === 'false') {
    return 0;
  }
  return 1;
};

export default function inventoryRouter(uploadsPath) {
  const router = Router();

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsPath),
    filename: (_req, _file, cb) => cb(null, `${Date.now()}.jpg`),
  });
  const upload = multer({ storage });

  const removeFile = (name) => {
    if (!name) return;
    const filePath = path.join(uploadsPath, name);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      console.error(err);
    }
  };

  router.get('/products', (_req, res) => {
    const rows = getDb().prepare('SELECT * FROM products ORDER BY name').all();
    res.json(rows.map(mapProduct));
  });

  router.get('/barcode/generate', requirePerm('perm_products'), (_req, res) => {
    try {
      res.json({ barcode: generateUniqueBarcode() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/product/:productId', (req, res) => {
    const row = getDb()
      .prepare('SELECT * FROM products WHERE id = ?')
      .get(parseInt(req.params.productId, 10));
    if (!row) return res.status(404).json({ error: 'Product not found' });
    res.json(mapProduct(row));
  });

  router.post('/product/sku', (req, res) => {
    const sku = String(req.body?.skuCode ?? '').trim();
    const db = getDb();

    let row = sku ? db.prepare('SELECT * FROM products WHERE barcode = ?').get(sku) : undefined;

    if (!row) {
      row = db
        .prepare('SELECT * FROM products WHERE id = ? OR name = ?')
        .get(parseInt(sku, 10) || -1, sku);
    }
    res.json(mapProduct(row));
  });

  router.post(
    '/product',
    requirePerm('perm_products'),
    upload.single('imagename'),
    (req, res) => {
      const body = req.body || {};
      const db = getDb();
      const editingId = body.id ? parseInt(body.id, 10) : null;
      const uploadedName = req.file ? req.file.filename : null;

      // If we fail after multer saved a new file, don't leave an orphan behind.
      const fail = (status, error) => {
        removeFile(uploadedName);
        return res.status(status).json({ error });
      };

      const barcode = String(body.barcode ?? '').trim() || null;
      if (barcode && barcodeExists(barcode, editingId)) {
        return fail(409, 'Barcode already used by another product');
      }

      // ---------- CREATE ----------
      if (!editingId) {
        const name = String(body.name ?? '').trim();
        if (!name) return fail(400, 'Product name is required');

        const result = db
          .prepare(
            `INSERT INTO products (name, price, category, quantity, stock, img, barcode, avg_cost)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            name,
            toNum(body.price),
            body.category || '',
            toNum(body.quantity),
            parseStock(body.stock) ?? 1,
            uploadedName || body.img || '',
            barcode,
            toNum(body.cost)
          );

        const row = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
        return res.json(mapProduct(row));
      }

      // ---------- UPDATE ----------
      const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(editingId);
      if (!existing) return fail(404, 'Product not found');

      // Image: keep the current one unless a new file is uploaded or removal is requested.
      let image = existing.img || '';
      if (uploadedName) {
        removeFile(existing.img); // delete the replaced image
        image = uploadedName;
      } else if (String(body.remove) === '1') {
        removeFile(existing.img);
        image = '';
      }

      // Fields not sent by the client keep their current value (no accidental reset to 0).
      const name = body.name !== undefined ? String(body.name).trim() : existing.name;
      if (!name) return fail(400, 'Product name is required');

      const price = body.price !== undefined ? toNum(body.price) : Number(existing.price) || 0;
      const category = body.category !== undefined ? body.category || '' : existing.category || '';
      const quantity =
        body.quantity !== undefined ? toNum(body.quantity) : Number(existing.quantity) || 0;
      const stock = parseStock(body.stock) ?? existing.stock;
      const newBarcode = body.barcode !== undefined ? barcode : existing.barcode;

      // Weighted-average cost is kept once set; the form cost only fills it when empty.
      const avgCost =
        Number(existing.avg_cost) > 0 ? Number(existing.avg_cost) : toNum(body.cost);

      db.prepare(
        `UPDATE products
         SET name = ?, price = ?, category = ?, quantity = ?, stock = ?, img = ?, barcode = ?, avg_cost = ?
         WHERE id = ?`
      ).run(name, price, category, quantity, stock, image, newBarcode, avgCost, editingId);

      // Return JSON (not plain "OK") so clients calling res.json() don't break.
      const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(editingId);
      res.json(mapProduct(updated));
    }
  );

  router.delete('/product/:productId', requirePerm('perm_products'), (req, res) => {
    const id = parseInt(req.params.productId, 10);
    const row = getDb().prepare('SELECT img FROM products WHERE id = ?').get(id);
    getDb().prepare('DELETE FROM products WHERE id = ?').run(id);
    removeFile(row?.img);
    res.sendStatus(200);
  });

  router.post('/products/bulk-delete', requirePerm('perm_products'), (req, res) => {
    const ids = (req.body?.ids || [])
      .map((id) => parseInt(id, 10))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (!ids.length) {
      return res.status(400).json({ error: 'No product ids provided' });
    }

    const db = getDb();
    let deleted = 0;
    db.transaction(() => {
      const getImg = db.prepare('SELECT img FROM products WHERE id = ?');
      const del = db.prepare('DELETE FROM products WHERE id = ?');
      for (const id of ids) {
        const row = getImg.get(id);
        const result = del.run(id);
        if (result.changes) deleted += 1;
        removeFile(row?.img);
      }
    })();

    res.json({ ok: true, deleted });
  });

  return router;
}