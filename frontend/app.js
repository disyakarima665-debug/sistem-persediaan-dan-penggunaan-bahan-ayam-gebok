const SUPABASE_URL = 'https://fpcusvafmzpqbqtqolit.supabase.co';
const SUPABASE_KEY = 'sb_publishable_A7fsjdICRHP6N-dfOWw5Bg_5mYdXx0J';
const BRANCHES = ['Gayamsari', 'Ngaliyan', 'Pedurungan'];
const $ = (selector, root = document) => root.querySelector(selector);
const money = (value) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
const number = (value) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(value) || 0);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const makeId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const app = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let data = { items: [], transactions: [], payments: [] };
let currentPage = 'dashboard';
let cloudBusy = false;
let cloudReady = false;
let migrationPending = false;
let selectedItemId = '';

function normalizeData(value) {
  const normalized = {
    items: Array.isArray(value?.items) ? value.items : [],
    transactions: Array.isArray(value?.transactions) ? value.transactions : [],
    payments: Array.isArray(value?.payments) ? value.payments : [],
  };
  for (const transaction of normalized.transactions) {
    if (transaction.branch === 'Badak') { transaction.branch = 'Gayamsari'; migrationPending = true; }
  }
  for (const payment of normalized.payments) {
    if (payment.branch === 'Badak') { payment.branch = 'Gayamsari'; migrationPending = true; }
  }
  for (const item of normalized.items) {
    item.stock = Number(item.stock) || 0;
    item.min = Number(item.min) || 0;
    item.price = Number(item.price) || 0;
    if (item.active === undefined) item.active = true;
  }
  return normalized;
}

function setCloudStatus(message, error = false) {
  $('#cloud-status').textContent = message;
  $('#cloud-status').classList.toggle('is-error', error);
}

async function saveCloud() {
  if (!cloudReady || cloudBusy) return;
  cloudBusy = true;
  setCloudStatus('Menyimpan...');
  try {
    const { error } = await app.from('app_state').upsert({ id: 1, data, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw error;
    migrationPending = false;
    setCloudStatus('Online • tersimpan');
  } catch (error) {
    setCloudStatus('Gagal menyimpan ke Supabase', true);
    toast(error.message || 'Periksa koneksi Supabase.');
  } finally {
    cloudBusy = false;
  }
}
let saveTimer;
function save() {
  renderPage();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCloud, 250);
}

function itemById(id) { return data.items.find((item) => item.id === id); }
function itemName(id) { return itemById(id)?.name || 'Barang dihapus'; }
function activeItems() { return data.items.filter((item) => item.active !== false); }
function transactionRows() { return [...data.transactions].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); }
function totalByBranch(branch, date) {
  return data.transactions.filter((item) => item.type === 'keluar' && item.branch === branch && item.date === date).reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
}
function quantityByBranch(branch, date) {
  return data.transactions.filter((item) => item.type === 'keluar' && item.branch === branch && item.date === date).reduce((sum, item) => sum + Number(item.qty || 0), 0);
}
function outstandingByBranch(branch, date) {
  const total = data.transactions.filter((item) => item.type === 'keluar' && item.branch === branch && item.date <= date).reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  const paid = data.payments.filter((item) => item.branch === branch && item.date <= date).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return Math.max(0, total - paid);
}
function branchOptions(selected = '') {
  return `<option value="">Pilih cabang</option>${BRANCHES.map((branch) => `<option value="${branch}"${branch === selected ? ' selected' : ''}>${branch}</option>`).join('')}`;
}
function itemOptions(selected = '') {
  return `<option value="">Pilih barang</option>${activeItems().map((item) => `<option value="${escapeHtml(item.id)}"${item.id === selected ? ' selected' : ''}>${escapeHtml(item.name)} (${number(item.stock)} ${escapeHtml(item.unit)})</option>`).join('')}`;
}
function statusFor(item) {
  if (Number(item.stock) <= 0) return { label: 'Habis', className: 'empty' };
  if (Number(item.stock) <= Number(item.min)) return { label: 'Menipis', className: 'low' };
  return { label: 'Aman', className: 'safe' };
}
function renderDashboard() {
  const items = activeItems();
  const todayTransactions = data.transactions.filter((item) => item.date === today());
  const incoming = todayTransactions.filter((item) => item.type === 'masuk').reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const outgoing = todayTransactions.filter((item) => item.type === 'keluar').reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const alerts = items.filter((item) => Number(item.stock) <= Number(item.min));
  return `<section class="welcome-panel"><div><h2>Selamat Datang 👋</h2><p>Kelola stok, barang masuk, barang keluar, dan rekap transaksi dengan lebih rapi.</p></div><img class="welcome-logo" src="./logo.png" alt="Logo Ayam Gebok Mas Bule"></section>
    <section class="stats-grid">
      <article class="stat-card"><span>📦</span><div><p>Total Jenis Barang</p><h2>${items.length}</h2></div></article>
      <article class="stat-card"><span>📥</span><div><p>Barang Masuk Hari Ini</p><h2>${number(incoming)}</h2></div></article>
      <article class="stat-card"><span>📤</span><div><p>Barang Keluar Hari Ini</p><h2>${number(outgoing)}</h2></div></article>
      <article class="stat-card"><span>⚠️</span><div><p>Stok Menipis/Habis</p><h2>${alerts.length}</h2></div></article>
    </section>
    <section class="content-card alert-card"><header><div><h2>🔔 Pengingat Stok</h2><p>Barang yang perlu segera diperhatikan.</p></div><button class="button secondary" data-go="inventory">Lihat Semua</button></header>
      ${alerts.length ? `<div class="alert-list">${alerts.slice(0, 10).map((item) => { const status = statusFor(item); return `<div class="alert-row"><div class="alert-main"><span class="alert-icon">⚠️</span><strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong></div><span class="alert-stock">${number(item.stock)} ${escapeHtml(item.unit)}</span><span class="badge status-pill ${status.className}">${status.label}</span></div>`; }).join('')}</div>` : '<div class="empty-message">Semua stok dalam kondisi aman 🎉</div>'}
    </section>`;
}
function renderInventory() {
  const filter = $('#inventory-filter')?.value || 'semua';
  const items = activeItems().filter((item) => filter === 'semua' || statusFor(item).className === filter);
  return `<section class="content-card"><header><div><h2>📦 Data Persediaan</h2><p>Tambahkan barang dan atur stok minimum.</p></div><div class="export-actions"><button class="button secondary" data-action="export" data-source="inventory" data-format="xlsx">Excel</button><button class="button secondary" data-action="export" data-source="inventory" data-format="pdf">PDF</button><button class="button primary" data-action="add-item">＋ Tambah Barang</button></div></header>
    <div class="filter-bar"><label>Status<select id="inventory-filter"><option value="semua"${filter === 'semua' ? ' selected' : ''}>Semua Status</option><option value="safe"${filter === 'safe' ? ' selected' : ''}>Aman</option><option value="low"${filter === 'low' ? ' selected' : ''}>Stok Menipis</option><option value="empty"${filter === 'empty' ? ' selected' : ''}>Habis</option></select></label><span class="small-count">${items.length} barang</span></div>
    <div class="table-wrap"><table><thead><tr><th>No</th><th>Nama Barang</th><th>Satuan</th><th>Stok</th><th>Stok Minimum</th><th>Harga Satuan</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${items.length ? items.map((item, index) => { const status = statusFor(item); return `<tr><td>${index + 1}</td><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.unit)}</td><td>${number(item.stock)}</td><td>${number(item.min)}</td><td>${money(item.price)}</td><td><span class="badge status-pill ${status.className}">${status.label}</span></td><td><div class="action-group"><button class="text-action" data-action="edit-item" data-id="${escapeHtml(item.id)}">Edit</button><button class="text-action danger" data-action="delete-item" data-id="${escapeHtml(item.id)}">Hapus</button></div></td></tr>`; }).join('') : '<tr><td colspan="8" class="empty-message">Belum ada barang.</td></tr>'}</tbody></table></div>
  </section>`;
}
function renderTransactionForm(type) {
  const incoming = type === 'masuk';
  return `<section class="content-card form-card"><header><div><h2>${incoming ? '📥 Barang Masuk' : '📤 Barang Keluar'}</h2><p>${incoming ? 'Pilih barang dari daftar. Stok akan otomatis bertambah.' : 'Pilih barang, cabang tujuan, dan jumlah. Harga satuan otomatis mengikuti harga di persediaan.'}</p></div></header>
    <form id="transaction-form" class="entry-form" data-type="${type}">
      <label>Barang<select name="itemId" required>${itemOptions()}</select></label>
      ${incoming ? '' : `<label>Cabang<select name="branch" required>${branchOptions()}</select></label>`}
      <label>${incoming ? 'Jumlah Masuk' : 'Jumlah Keluar'}<input name="qty" type="number" min="0.01" step="0.01" placeholder="Masukkan jumlah" required></label>
      ${incoming ? '' : `<label>Harga per Satuan<input name="unitPrice" type="number" min="0" step="1" placeholder="Rp 0" required></label><label>Total Harga<output id="transaction-total">Rp 0</output></label>`}
      <label>Tanggal<input name="date" type="date" value="${today()}" required></label>
      <label class="wide-field">Keterangan (opsional)<input name="note" maxlength="160" placeholder="Contoh: Pembelian supplier"></label>
      ${incoming ? '' : '<p class="form-hint wide-field">Total harga otomatis = jumlah × harga per satuan.</p>'}
      <button class="button primary wide-field" type="submit">Simpan Barang ${incoming ? 'Masuk' : 'Keluar'}</button>
    </form>
  </section>`;
}
function renderRecap() {
  const date = $('#recap-date')?.value || today();
  const outgoing = data.transactions.filter((item) => item.type === 'keluar' && item.date === date);
  const grouped = BRANCHES.map((branch) => ({ branch, qty: quantityByBranch(branch, date), total: totalByBranch(branch, date), unpaid: outstandingByBranch(branch, date) }));
  return `<section class="content-card recap-card"><header><div><h2>📊 Rekap Barang Keluar per Hari</h2><p>Total harga dikelompokkan berdasarkan cabang.</p></div><div class="recap-controls"><label>Tanggal<input id="recap-date" type="date" value="${date}"></label><div class="export-actions"><button class="button secondary" data-action="export" data-source="recap" data-format="xlsx">Excel</button><button class="button secondary" data-action="export" data-source="recap" data-format="pdf">PDF</button></div></div></header>
    <div class="branch-summary">${grouped.map((item) => `<article class="branch-card"><h3>🏪 ${item.branch}</h3><div>Hari ini: <strong>${money(item.total)}</strong></div><small>${number(item.qty)} unit/item keluar</small><div class="unpaid">Belum dibayar (akumulasi): <strong>${money(item.unpaid)}</strong></div><button class="button secondary" data-action="mark-paid" data-branch="${item.branch}" data-date="${date}"${item.unpaid <= 0 ? ' disabled' : ''}>✓ Sudah Dibayar</button></article>`).join('')}</div>
    <div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Cabang</th><th>Total Jumlah</th><th>Total Harga</th></tr></thead><tbody>${outgoing.length ? grouped.filter((item) => item.qty > 0).map((item) => `<tr><td>${formatDate(date)}</td><td>${item.branch}</td><td>${number(item.qty)}</td><td>${money(item.total)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-message">Tidak ada barang keluar pada tanggal ini.</td></tr>'}</tbody></table></div>
  </section>
  <section class="content-card"><header><div><h2>💳 Riwayat Pembayaran Rekap</h2><p>Pembayaran yang sudah dilakukan tetap tersimpan di sini.</p></div></header><div class="table-wrap"><table><thead><tr><th>No</th><th>Tanggal Rekap</th><th>Cabang</th><th>Jumlah Dibayar</th><th>Waktu Pembayaran</th></tr></thead><tbody>${data.payments.length ? [...data.payments].sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0)).map((payment, index) => `<tr><td>${index + 1}</td><td>${formatDate(payment.date)}</td><td>${escapeHtml(payment.branch)}</td><td>${money(payment.amount)}</td><td>${payment.paidAt ? new Date(payment.paidAt).toLocaleString('id-ID') : '-'}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-message">Belum ada pembayaran.</td></tr>'}</tbody></table></div></section>`;
}
function renderHistory() {
  const filter = $('#history-filter')?.value || 'semua';
  const rows = transactionRows().filter((item) => filter === 'semua' || item.type === filter);
  return `<section class="content-card"><header><div><h2>📋 Riwayat Transaksi</h2><p>Barang masuk dan barang keluar tercatat di sini.</p></div><div class="export-actions"><label>Jenis<select id="history-filter"><option value="semua"${filter === 'semua' ? ' selected' : ''}>Semua Jenis</option><option value="masuk"${filter === 'masuk' ? ' selected' : ''}>Barang Masuk</option><option value="keluar"${filter === 'keluar' ? ' selected' : ''}>Barang Keluar</option></select></label><button class="button secondary" data-action="export" data-source="history" data-format="xlsx">Excel</button><button class="button secondary" data-action="export" data-source="history" data-format="pdf">PDF</button></div></header><div class="table-wrap"><table><thead><tr><th>No</th><th>Tanggal</th><th>Barang</th><th>Jenis</th><th>Jumlah</th><th>Cabang</th><th>Harga</th><th>Total Harga</th><th>Aksi</th></tr></thead><tbody>${rows.length ? rows.slice(0, 250).map((item, index) => `<tr><td>${index + 1}</td><td>${formatDate(item.date)}</td><td>${escapeHtml(itemName(item.itemId))}</td><td><span class="badge ${item.type === 'masuk' ? 'safe' : 'low'}">${item.type === 'masuk' ? 'Masuk' : 'Keluar'}</span></td><td>${number(item.qty)} ${escapeHtml(item.unit || itemById(item.itemId)?.unit || '')}</td><td>${escapeHtml(item.branch || '-')}</td><td>${item.type === 'keluar' ? money(item.unitPrice) : '-'}</td><td>${item.type === 'keluar' ? money(item.totalPrice) : '-'}</td><td><div class="action-group"><button class="text-action" data-action="edit-transaction" data-id="${escapeHtml(item.id)}">Edit</button><button class="text-action danger" data-action="delete-transaction" data-id="${escapeHtml(item.id)}">Hapus</button></div></td></tr>`).join('') : '<tr><td colspan="9" class="empty-message">Belum ada transaksi.</td></tr>'}</tbody></table></div></section>`;
}
function renderPage() {
  $('#page-title').textContent = ({ dashboard: 'Dashboard', inventory: 'Persediaan', incoming: 'Barang Masuk', outgoing: 'Barang Keluar', recap: 'Rekap Harian', history: 'Riwayat Transaksi' })[currentPage];
  const content = $('#page-content');
  if (currentPage === 'dashboard') content.innerHTML = renderDashboard();
  else if (currentPage === 'inventory') content.innerHTML = renderInventory();
  else if (currentPage === 'incoming') content.innerHTML = renderTransactionForm('masuk');
  else if (currentPage === 'outgoing') content.innerHTML = renderTransactionForm('keluar');
  else if (currentPage === 'recap') content.innerHTML = renderRecap();
  else content.innerHTML = renderHistory();
  document.querySelectorAll('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === currentPage));
}

function transactionById(id) { return data.transactions.find((item) => item.id === id); }
function applyTransaction(transaction, direction) {
  const item = itemById(transaction.itemId);
  if (!item) throw new Error('Barang tidak ditemukan.');
  const sign = transaction.type === 'masuk' ? 1 : -1;
  const nextStock = Number(item.stock) + sign * Number(transaction.qty) * direction;
  if (nextStock < 0) throw new Error(`Stok ${item.name} tidak cukup untuk mengubah transaksi ini.`);
  item.stock = nextStock;
}
function transactionFormSubmit(form) {
  const fields = new FormData(form);
  const type = form.dataset.type;
  const item = itemById(fields.get('itemId'));
  const qty = Number(fields.get('qty'));
  if (!item || !Number.isFinite(qty) || qty <= 0) throw new Error('Pilih barang dan masukkan jumlah yang valid.');
  if (type === 'keluar' && qty > item.stock) throw new Error(`Stok ${item.name} tidak cukup. Tersedia ${number(item.stock)} ${item.unit}.`);
  const unitPrice = type === 'keluar' ? Number(fields.get('unitPrice') || item.price || 0) : 0;
  if (type === 'keluar' && !fields.get('branch')) throw new Error('Pilih cabang tujuan.');
  if (type === 'keluar') item.stock -= qty;
  else item.stock += qty;
  data.transactions.push({ id: makeId(), type, itemId: item.id, qty, date: fields.get('date'), branch: type === 'keluar' ? fields.get('branch') : '', unit: item.unit, unitPrice, totalPrice: type === 'keluar' ? qty * unitPrice : 0, note: String(fields.get('note') || '').trim(), createdAt: Date.now() });
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2800);
}
function formatDate(value) {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}
function exportRows(source) {
  if (source === 'inventory') {
    return {
      title: 'Persediaan Ayam Gebok Mas Bule',
      filename: 'persediaan-ayam-gebok',
      headers: ['No', 'Nama Barang', 'Satuan', 'Stok', 'Stok Minimum', 'Harga Satuan', 'Status'],
      rows: activeItems().map((item, index) => [index + 1, item.name, item.unit, Number(item.stock), Number(item.min), Number(item.price), statusFor(item).label]),
    };
  }
  if (source === 'recap') {
    const date = $('#recap-date')?.value || today();
    const rows = BRANCHES.map((branch) => [formatDate(date), branch, quantityByBranch(branch, date), totalByBranch(branch, date)]);
    return { title: `Rekap Barang Keluar ${date}`, filename: `rekap-ayam-gebok-${date}`, headers: ['Tanggal', 'Cabang', 'Total Jumlah', 'Total Harga'], rows };
  }
  const filter = $('#history-filter')?.value || 'semua';
  const rows = transactionRows().filter((item) => filter === 'semua' || item.type === filter).map((item, index) => [
    index + 1, formatDate(item.date), itemName(item.itemId), item.type === 'masuk' ? 'Barang Masuk' : 'Barang Keluar',
    Number(item.qty), item.unit || itemById(item.itemId)?.unit || '', item.branch || '-',
    Number(item.unitPrice || 0), Number(item.totalPrice || 0), item.note || '',
  ]);
  return { title: 'Riwayat Transaksi Ayam Gebok Mas Bule', filename: 'riwayat-transaksi-ayam-gebok', headers: ['No', 'Tanggal', 'Barang', 'Jenis', 'Jumlah', 'Satuan', 'Cabang', 'Harga Satuan', 'Total Harga', 'Keterangan'], rows };
}
function exportReport(source, format) {
  const report = exportRows(source);
  if (!report.rows.length) throw new Error('Tidak ada data untuk diekspor.');
  if (format === 'xlsx') {
    if (!window.XLSX) throw new Error('Library Excel belum termuat. Periksa koneksi internet lalu muat ulang halaman.');
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([report.headers, ...report.rows]);
    worksheet['!cols'] = report.headers.map((header) => ({ wch: Math.max(14, Math.min(30, header.length + 5)) }));
    XLSX.utils.book_append_sheet(workbook, worksheet, source === 'inventory' ? 'Persediaan' : source === 'recap' ? 'Rekap' : 'Riwayat');
    XLSX.writeFile(workbook, `${report.filename}.xlsx`);
    return;
  }
  if (!window.jspdf?.jsPDF) throw new Error('Library PDF belum termuat. Periksa koneksi internet lalu muat ulang halaman.');
  const pdf = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  pdf.setFontSize(15);
  pdf.text(report.title, 14, 15);
  pdf.autoTable({ head: [report.headers], body: report.rows, startY: 22, styles: { fontSize: 8, cellPadding: 2.5 }, headStyles: { fillColor: [181, 18, 27] }, margin: { left: 14, right: 14 } });
  pdf.save(`${report.filename}.pdf`);
}
function openItemDialog(item = null) {
  selectedItemId = item?.id || '';
  const form = $('#item-form');
  form.reset();
  $('#item-title').textContent = item ? 'Edit Barang' : 'Tambah Barang';
  form.elements.name.value = item?.name || '';
  form.elements.unit.value = item?.unit || '';
  form.elements.stock.value = item && Number(item.stock) !== 0 ? item.stock : '';
  form.elements.min.value = item ? (Number(item.min) === 0 ? '' : item.min) : 1;
  form.elements.price.value = item && Number(item.price) !== 0 ? item.price : '';
  $('#item-dialog').showModal();
}
function setTransactionTotal(form) {
  const qty = Number(form.elements.qty?.value) || 0;
  const price = Number(form.elements.unitPrice?.value) || 0;
  const output = $('#transaction-total');
  if (output) output.textContent = money(qty * price);
}
function editTransactionDialog(transaction) {
  const form = $('#transaction-edit-form');
  form.reset();
  form.elements.id.value = transaction.id;
  form.elements.itemId.innerHTML = itemOptions(transaction.itemId);
  form.elements.type.value = transaction.type;
  form.elements.branch.innerHTML = branchOptions(transaction.branch || '');
  form.elements.qty.value = transaction.qty;
  form.elements.unitPrice.value = Number(transaction.unitPrice) > 0 ? transaction.unitPrice : '';
  form.elements.date.value = transaction.date || today();
  form.elements.note.value = transaction.note || '';
  const outgoing = transaction.type === 'keluar';
  $('#edit-branch-field').hidden = !outgoing;
  $('#edit-price-field').hidden = !outgoing;
  $('#transaction-edit-dialog').showModal();
}

const navButtons = document.querySelectorAll('[data-page]');
navButtons.forEach((button) => button.addEventListener('click', () => { currentPage = button.dataset.page; renderPage(); }));
$('#page-content').addEventListener('click', async (event) => {
  const goButton = event.target.closest('[data-go]');
  if (goButton) {
    currentPage = goButton.dataset.go;
    renderPage();
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const item = itemById(button.dataset.id);
  if (button.dataset.action === 'add-item') openItemDialog();
  if (button.dataset.action === 'edit-item' && item) openItemDialog(item);
  if (button.dataset.action === 'delete-item' && item && confirm(`Hapus ${item.name} dari daftar barang? Riwayat transaksi tetap disimpan.`)) {
    item.active = false;
    save();
  }
  if (button.dataset.action === 'edit-transaction') {
    const transaction = transactionById(button.dataset.id);
    if (transaction) editTransactionDialog(transaction);
  }
  if (button.dataset.action === 'delete-transaction') {
    const transaction = transactionById(button.dataset.id);
    if (transaction && confirm('Hapus transaksi ini dan koreksi stok?')) {
      try {
        applyTransaction(transaction, -1);
        data.transactions = data.transactions.filter((row) => row.id !== transaction.id);
        save();
      } catch (error) { toast(error.message); }
    }
  }
  if (button.dataset.action === 'mark-paid') {
    const outstanding = outstandingByBranch(button.dataset.branch, button.dataset.date);
    if (outstanding > 0 && confirm(`Catat pembayaran ${money(outstanding)} untuk ${button.dataset.branch}?`)) {
      data.payments.push({ id: makeId(), branch: button.dataset.branch, date: button.dataset.date, amount: outstanding, paidAt: Date.now() });
      save();
    }
  }
  if (button.dataset.action === 'print-week' || button.dataset.action === 'print-month') window.print();
  if (button.dataset.action === 'export') {
    try { exportReport(button.dataset.source, button.dataset.format); toast(`File ${button.dataset.format.toUpperCase()} berhasil dibuat.`); }
    catch (error) { toast(error.message); }
  }
  if (button.dataset.go) { currentPage = button.dataset.go; renderPage(); }
});
$('#page-content').addEventListener('input', (event) => {
  if (event.target.id === 'inventory-filter' || event.target.id === 'history-filter' || event.target.id === 'recap-date') renderPage();
  if (event.target.form?.id === 'transaction-form' && ['qty', 'unitPrice', 'itemId'].includes(event.target.name)) setTransactionTotal(event.target.form);
});
$('#page-content').addEventListener('change', (event) => {
  if (event.target.id === 'inventory-filter' || event.target.id === 'history-filter' || event.target.id === 'recap-date') renderPage();
  if (event.target.form?.id === 'transaction-form' && event.target.name === 'itemId' && event.target.form.dataset.type === 'keluar') {
    const item = itemById(event.target.value);
    if (item) event.target.form.elements.unitPrice.value = Number(item.price) > 0 ? item.price : '';
    setTransactionTotal(event.target.form);
  }
});
$('#page-content').addEventListener('submit', (event) => {
  if (event.target.id !== 'transaction-form') return;
  event.preventDefault();
  try { transactionFormSubmit(event.target); save(); toast(`Barang ${event.target.dataset.type === 'masuk' ? 'masuk' : 'keluar'} berhasil dicatat.`); }
  catch (error) { toast(error.message); }
});
$('#item-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);
  const itemData = { name: String(fields.get('name')).trim(), unit: String(fields.get('unit')).trim(), stock: Number(fields.get('stock')), min: Number(fields.get('min')), price: Number(fields.get('price')) };
  if (!itemData.name || !itemData.unit || Object.values(itemData).some(value => typeof value === 'number' && (!Number.isFinite(value) || value < 0))) return toast('Isi data barang dengan benar.');
  if (selectedItemId) Object.assign(itemById(selectedItemId), itemData);
  else data.items.push({ id: makeId(), ...itemData, active: true });
  $('#item-dialog').close();
  save();
  toast('Barang berhasil disimpan.');
});
$('#transaction-edit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const fields = new FormData(form);
  const transaction = transactionById(fields.get('id'));
  if (!transaction) return;
  const originalStocks = new Map(data.items.map((item) => [item.id, item.stock]));
  try {
    applyTransaction(transaction, -1);
    const item = itemById(fields.get('itemId'));
    const qty = Number(fields.get('qty'));
    const type = fields.get('type');
    if (!item || qty <= 0 || (type === 'keluar' && qty > item.stock)) throw new Error('Periksa barang dan jumlah. Stok tidak cukup.');
    const updated = { ...transaction, itemId: item.id, type, qty, date: fields.get('date'), branch: type === 'keluar' ? fields.get('branch') : '', unit: item.unit, unitPrice: type === 'keluar' ? Number(fields.get('unitPrice')) : 0, totalPrice: type === 'keluar' ? qty * Number(fields.get('unitPrice')) : 0, note: String(fields.get('note') || '').trim() };
    if (type === 'keluar' && !updated.branch) throw new Error('Pilih cabang tujuan.');
    applyTransaction(updated, 1);
    Object.assign(transaction, updated);
    $('#transaction-edit-dialog').close();
    save();
    toast('Transaksi berhasil diperbarui.');
  } catch (error) {
    data.items.forEach((item) => { if (originalStocks.has(item.id)) item.stock = originalStocks.get(item.id); });
    toast(error.message);
  }
});
$('#transaction-edit-form [name="type"]').addEventListener('change', (event) => {
  const outgoing = event.target.value === 'keluar';
  $('#edit-branch-field').hidden = !outgoing;
  $('#edit-price-field').hidden = !outgoing;
});
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));

async function loadCloudData() {
  setCloudStatus('Menghubungkan...');
  try {
    const { data: row, error } = await app.from('app_state').select('data').eq('id', 1).maybeSingle();
    if (error) throw error;
    const previous = JSON.stringify(row?.data || {});
    data = normalizeData(row?.data || {});
    cloudReady = true;
    setCloudStatus('Online • sinkron aktif');
    renderPage();
    if (!row || migrationPending || JSON.stringify(data) !== previous) await saveCloud();
    app.channel('app_state_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state', filter: 'id=eq.1' }, (payload) => {
        if (!payload.new?.data || cloudBusy) return;
        const next = normalizeData(payload.new.data);
        if (JSON.stringify(next) !== JSON.stringify(data)) { data = next; renderPage(); setCloudStatus('Online • diperbarui otomatis'); }
      })
      .subscribe((status) => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setCloudStatus('Online • sinkron 5 detik', false); });
    setInterval(async () => {
      if (document.hidden || cloudBusy) return;
      const { data: latest, error: refreshError } = await app.from('app_state').select('data').eq('id', 1).maybeSingle();
      if (!refreshError && latest?.data) {
        const next = normalizeData(latest.data);
        if (JSON.stringify(next) !== JSON.stringify(data)) { data = next; renderPage(); setCloudStatus('Online • diperbarui otomatis'); }
      }
    }, 5000);
  } catch (error) {
    cloudReady = false;
    setCloudStatus('Gagal konek Supabase', true);
    $('#page-content').innerHTML = `<section class="content-card"><h2>Koneksi Supabase gagal</h2><p>${escapeHtml(error.message)}</p><button class="button primary" onclick="location.reload()">Coba lagi</button></section>`;
  }
}
function migrateBadak() {
  let changed = false;
  for (const record of [...data.transactions, ...data.payments]) {
    if (record.branch === 'Badak') { record.branch = 'Gayamsari'; changed = true; }
  }
  migrationPending ||= changed;
}
$('#date-label').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
renderPage();
loadCloudData();

window.addEventListener('online', () => loadCloudData());
window.addEventListener('beforeunload', () => { if (migrationPending && cloudReady) void saveCloud(); });
