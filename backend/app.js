const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://omdmodqihcsektodrylc.supabase.co').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_KEY);
const publicDir = path.join(__dirname, '..', 'frontend');
const branches = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Gayamsari', code: 'GYS' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Ngaliyan', code: 'NGL' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Pedurungan', code: 'PDR' },
];
const ingredients = [
  ['20000000-0000-4000-8000-000000000001', 'Ayam potong', 'kg', 'Protein', 5],
  ['20000000-0000-4000-8000-000000000002', 'Beras', 'kg', 'Pokok', 8],
  ['20000000-0000-4000-8000-000000000003', 'Minyak goreng', 'liter', 'Bumbu', 4],
  ['20000000-0000-4000-8000-000000000004', 'Cabai rawit', 'kg', 'Bumbu', 1],
  ['20000000-0000-4000-8000-000000000005', 'Tepung bumbu', 'kg', 'Bumbu', 3],
  ['20000000-0000-4000-8000-000000000006', 'Gas LPG', 'tabung', 'Operasional', 2],
].map(([id, name, unit, category, minimum_stock]) => ({ id, name, unit, category, minimum_stock, is_active: true }));
const demoStocks = [];
const costs = [];
const initialQty = [12, 18, 9, 0.8, 6, 3];
const initialCost = [32000, 14500, 18000, 42000, 22000, 22000];
branches.forEach((branch, branchIndex) => ingredients.forEach((ingredient, index) => demoStocks.push({
  id: `${branchIndex}-${index}`, branch_id: branch.id, ingredient_id: ingredient.id,
  quantity: Math.max(0, initialQty[index] - branchIndex), unit_cost: initialCost[index],
  updated_at: new Date().toISOString(), ingredients: ingredient,
})));

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function validId(value) { return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value); }
async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20000) throw new Error('Ukuran permintaan terlalu besar.');
  }
  return body ? JSON.parse(body) : {};
}
async function db(table, { method = 'GET', query = '', body, prefer } = {}) {
  const authHeader = SUPABASE_KEY.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${SUPABASE_KEY}` };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      ...authHeader,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(result?.message || result?.hint || 'Permintaan database gagal.');
  return result;
}
async function api(req, res, url) {
  const { pathname, searchParams } = url;
  if (pathname === '/api/health') return json(res, 200, { mode: supabaseEnabled ? 'supabase' : 'demo' });
  if (pathname === '/api/branches' && req.method === 'GET') {
    const data = supabaseEnabled ? await db('branches', { query: 'select=id,name,code&is_active=eq.true&order=name' }) : branches;
    return json(res, 200, data);
  }
  if (pathname === '/api/ingredients' && req.method === 'GET') {
    const data = supabaseEnabled ? await db('ingredients', { query: 'select=id,name,unit,category,minimum_stock&is_active=eq.true&order=name' }) : ingredients.filter((item) => item.is_active !== false);
    return json(res, 200, data);
  }
  if (pathname === '/api/ingredients' && req.method === 'POST') {
    const body = await readBody(req);
    if (typeof body.name !== 'string' || !body.name.trim() || typeof body.unit !== 'string' || !body.unit.trim()) return json(res, 400, { error: 'Nama bahan dan satuan wajib diisi.' });
    const minimum = Number(body.minimum_stock || 0);
    if (!Number.isFinite(minimum) || minimum < 0) return json(res, 400, { error: 'Batas stok minimum tidak valid.' });
    const item = { id: randomUUID(), name: body.name.trim(), unit: body.unit.trim(), category: String(body.category || 'Lainnya').trim(), minimum_stock: minimum, is_active: true };
    if (supabaseEnabled) {
      const inserted = await db('ingredients', { method: 'POST', query: 'select=id,name,unit,category,minimum_stock', body: { name: item.name, unit: item.unit, category: item.category, minimum_stock: minimum }, prefer: 'return=representation' });
      return json(res, 201, inserted[0]);
    }
    ingredients.push(item);
    branches.forEach((branch) => demoStocks.push({ id: randomUUID(), branch_id: branch.id, ingredient_id: item.id, quantity: 0, unit_cost: 0, updated_at: new Date().toISOString(), ingredients: item }));
    return json(res, 201, item);
  }
  const ingredientMatch = pathname.match(/^\/api\/ingredients\/([0-9a-f-]{36})$/i);
  if (ingredientMatch && ['PATCH', 'DELETE'].includes(req.method)) {
    const ingredientId = ingredientMatch[1];
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const unit = typeof body.unit === 'string' ? body.unit.trim() : '';
      const minimum = Number(body.minimum_stock);
      if (!name || !unit || !Number.isFinite(minimum) || minimum < 0) return json(res, 400, { error: 'Nama, satuan, dan stok minimum wajib valid.' });
      const changes = { name, unit, category: String(body.category || 'Lainnya').trim(), minimum_stock: minimum };
      if (supabaseEnabled) {
        const updated = await db('ingredients', { method: 'PATCH', query: `id=eq.${ingredientId}&is_active=eq.true&select=id,name,unit,category,minimum_stock`, body: changes, prefer: 'return=representation' });
        if (!updated.length) return json(res, 404, { error: 'Bahan tidak ditemukan.' });
        return json(res, 200, updated[0]);
      }
      const item = ingredients.find((ingredient) => ingredient.id === ingredientId && ingredient.is_active !== false);
      if (!item) return json(res, 404, { error: 'Bahan tidak ditemukan.' });
      Object.assign(item, changes);
      demoStocks.filter((stock) => stock.ingredient_id === ingredientId).forEach((stock) => { stock.ingredients = item; });
      return json(res, 200, item);
    }
    if (supabaseEnabled) {
      const updated = await db('ingredients', { method: 'PATCH', query: `id=eq.${ingredientId}&is_active=eq.true&select=id`, body: { is_active: false }, prefer: 'return=representation' });
      if (!updated.length) return json(res, 404, { error: 'Bahan tidak ditemukan.' });
    } else {
      const item = ingredients.find((ingredient) => ingredient.id === ingredientId && ingredient.is_active !== false);
      if (!item) return json(res, 404, { error: 'Bahan tidak ditemukan.' });
      item.is_active = false;
    }
    return json(res, 200, { success: true });
  }
  if (pathname === '/api/inventory' && req.method === 'GET') {
    const branchId = searchParams.get('branch_id');
    if (!validId(branchId)) return json(res, 400, { error: 'Cabang tidak valid.' });
    if (supabaseEnabled) {
      const query = new URLSearchParams({ select: 'id,branch_id,ingredient_id,quantity,unit_cost,updated_at,ingredients!inner(id,name,unit,category,minimum_stock,is_active)', branch_id: `eq.${branchId}`, 'ingredients.is_active': 'eq.true', order: 'updated_at.desc' });
      return json(res, 200, await db('stock_items', { query: query.toString() }));
    }
    return json(res, 200, demoStocks.filter((item) => item.branch_id === branchId && item.ingredients.is_active !== false));
  }
  if (pathname === '/api/inventory/adjust' && req.method === 'POST') {
    const body = await readBody(req);
    const quantity = Number(body.quantity);
    const unitCost = Number(body.unit_cost || 0);
    if (!validId(body.branch_id) || !validId(body.ingredient_id) || !['in', 'out'].includes(body.direction)) return json(res, 400, { error: 'Cabang, bahan, atau transaksi tidak valid.' });
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0 || (body.direction === 'in' && unitCost <= 0)) return json(res, 400, { error: 'Jumlah harus lebih dari nol. Stok masuk wajib memiliki harga satuan.' });
    if (supabaseEnabled) {
      const result = await db('rpc/adjust_stock', { method: 'POST', body: { p_branch_id: body.branch_id, p_ingredient_id: body.ingredient_id, p_direction: body.direction, p_quantity: quantity, p_unit_cost: unitCost } });
      return json(res, 200, result);
    }
    const item = demoStocks.find((row) => row.branch_id === body.branch_id && row.ingredient_id === body.ingredient_id);
    if (!item) return json(res, 404, { error: 'Bahan tidak ditemukan.' });
    if (body.direction === 'out' && item.quantity < quantity) return json(res, 400, { error: 'Stok tidak mencukupi.' });
    const previousQuantity = Number(item.quantity);
    const amount = quantity * (body.direction === 'in' ? unitCost : Number(item.unit_cost));
    if (body.direction === 'in') {
      item.unit_cost = ((previousQuantity * Number(item.unit_cost)) + (quantity * unitCost)) / (previousQuantity + quantity);
      item.quantity += quantity;
    } else item.quantity -= quantity;
    item.updated_at = new Date().toISOString();
    costs.unshift({ id: randomUUID(), branch_id: body.branch_id, ingredient_id: body.ingredient_id, entry_type: body.direction === 'in' ? 'purchase' : 'usage', description: `${body.direction === 'in' ? 'Pembelian' : 'Pemakaian'} ${item.ingredients.name}`, quantity, amount, created_at: item.updated_at });
    return json(res, 200, item);
  }
  if (pathname === '/api/costs' && req.method === 'GET') {
    const branchId = searchParams.get('branch_id');
    if (!validId(branchId)) return json(res, 400, { error: 'Cabang tidak valid.' });
    if (supabaseEnabled) {
      const query = new URLSearchParams({ select: 'id,branch_id,ingredient_id,entry_type,description,quantity,amount,created_at,ingredients(name,unit)', branch_id: `eq.${branchId}`, order: 'created_at.desc' });
      if (/^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('from') || '')) query.set('created_at', `gte.${searchParams.get('from')}T00:00:00Z`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('to') || '')) query.append('created_at', `lte.${searchParams.get('to')}T23:59:59Z`);
      return json(res, 200, await db('cost_entries', { query: query.toString() }));
    }
    const from = searchParams.get('from'); const to = searchParams.get('to');
    return json(res, 200, costs.filter((entry) => entry.branch_id === branchId && (!from || entry.created_at >= `${from}T00:00:00.000Z`) && (!to || entry.created_at <= `${to}T23:59:59.999Z`)));
  }
  if (pathname === '/api/costs' && req.method === 'POST') {
    const body = await readBody(req); const amount = Number(body.amount);
    if (!validId(body.branch_id) || typeof body.description !== 'string' || !body.description.trim() || !Number.isFinite(amount) || amount <= 0) return json(res, 400, { error: 'Cabang, keterangan, dan biaya yang valid wajib diisi.' });
    const entry = { branch_id: body.branch_id, entry_type: 'operational', description: body.description.trim(), amount };
    if (supabaseEnabled) {
      const inserted = await db('cost_entries', { method: 'POST', query: 'select=id,branch_id,entry_type,description,amount,created_at', body: entry, prefer: 'return=representation' });
      return json(res, 201, inserted[0]);
    }
    const saved = { id: randomUUID(), ...entry, ingredient_id: null, quantity: null, created_at: new Date().toISOString() };
    costs.unshift(saved);
    return json(res, 201, saved);
  }
  const costMatch = pathname.match(/^\/api\/costs\/([0-9a-f-]{36})$/i);
  if (costMatch && ['PATCH', 'DELETE'].includes(req.method)) {
    const costId = costMatch[1];
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const amount = Number(body.amount);
      if (!description || !Number.isFinite(amount) || amount <= 0) return json(res, 400, { error: 'Keterangan dan jumlah biaya wajib valid.' });
      if (supabaseEnabled) {
        const updated = await db('cost_entries', { method: 'PATCH', query: `id=eq.${costId}&entry_type=eq.operational&select=id,branch_id,entry_type,description,amount,created_at`, body: { description, amount }, prefer: 'return=representation' });
        if (!updated.length) return json(res, 404, { error: 'Biaya operasional tidak ditemukan.' });
        return json(res, 200, updated[0]);
      }
      const entry = costs.find((item) => item.id === costId && item.entry_type === 'operational');
      if (!entry) return json(res, 404, { error: 'Biaya operasional tidak ditemukan.' });
      entry.description = description;
      entry.amount = amount;
      return json(res, 200, entry);
    }
    if (supabaseEnabled) {
      const deleted = await db('cost_entries', { method: 'DELETE', query: `id=eq.${costId}&entry_type=eq.operational&select=id`, prefer: 'return=representation' });
      if (!deleted.length) return json(res, 404, { error: 'Biaya operasional tidak ditemukan.' });
    } else {
      const index = costs.findIndex((item) => item.id === costId && item.entry_type === 'operational');
      if (index < 0) return json(res, 404, { error: 'Biaya operasional tidak ditemukan.' });
      costs.splice(index, 1);
    }
    return json(res, 200, { success: true });
  }
  return json(res, 404, { error: 'Endpoint tidak ditemukan.' });
}

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const requested = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.resolve(publicDir, requested);
    if (!file.startsWith(`${publicDir}${path.sep}`)) return json(res, 403, { error: 'Akses ditolak.' });
    fs.readFile(file, (error, data) => {
      if (error) return json(res, 404, { error: 'Halaman tidak ditemukan.' });
      res.writeHead(200, { 'Content-Type': mimeTypes[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (error) {
    json(res, 400, { error: error.message || 'Permintaan tidak dapat diproses.' });
  }
});
server.listen(PORT, () => console.log(`Aplikasi berjalan di http://localhost:${PORT} (${supabaseEnabled ? 'Supabase' : 'mode demo'})`));
