// ============================================================
// INVESTOR TRACKER - INVESTOR PORTAL
// Backend: Supabase
// ============================================================

const SUPABASE_URL = 'https://ismjupxoiywttkrekmfg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzbWp1cHhvaXl3dHRrcmVrbWZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzc4MDEsImV4cCI6MjA5NDg1MzgwMX0.WVwqEdkPQ_x9NWR8QXTm85mIAvN8d9V2FaMJ2NiAMC0';
const SESSION_KEY = 'investor_tracker_portal_session';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const rp = (n) => `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(Number(n || 0)))}`;
const now = () => new Date();
const dateKey = (d = now()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthKey = (d = now()) => dateKey(d).slice(0, 7);
const normName = (v) => String(v || '').replace(/\s+/g, ' ').trim().toUpperCase();

function last12Months() {
  const out = [];
  const base = now();
  for (let i = 0; i < 12; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    out.push(monthKey(d));
  }
  return out;
}

const state = {
  page: 'dashboard',
  me: null, // Data investor yang login
  batches: [],
  investorProducts: [],
  distributions: [],
  batchStats: {}, // batchId -> stats
  statsRange: 1, // default 1 bulan
};

function toast(msg, err = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (err ? ' err' : '');
  setTimeout(() => { el.className = 'toast'; }, 3000);
}
function setBusy(v) { 
  const el = $('loading');
  if (el) el.className = v ? 'loading-overlay show' : 'loading-overlay'; 
}

// ============ AUTH (PIN) ============
let pinBuffer = '';
function renderPinScreen() {
  $('app').innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <div class="logo-icon"><i class="fas fa-chart-line"></i></div>
        <h1 class="mb-1 text-primary">Investor Portal</h1>
        <div class="text-muted mb-4">Masukkan Username dan PIN Anda</div>
        
        <div style="display:flex; flex-direction:column; gap:12px; margin-bottom: 24px;">
          <input type="text" id="loginUsername" class="input" placeholder="Username (contoh: aji)" style="text-align:center;font-weight:bold;text-transform:lowercase; padding:12px">
          <div style="position:relative">
            <input type="password" pattern="[0-9]*" inputmode="numeric" id="loginPin" class="input" placeholder="PIN Angka" style="text-align:center;font-weight:bold;letter-spacing:4px; padding:12px; width:100%; box-sizing:border-box" onkeydown="if(event.key==='Enter') attemptLogin()">
            <button onclick="togglePin()" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--text-muted); cursor:pointer"><i id="eyeIcon" class="fas fa-eye"></i></button>
          </div>
        </div>
        <button class="btn success full" style="padding:14px" onclick="attemptLogin()"><i class="fas fa-sign-in-alt"></i> Masuk</button>
      </div>
    </div>
  `;
}

window.togglePin = function() {
  const pinInput = $('loginPin');
  const eyeIcon = $('eyeIcon');
  if (pinInput.type === 'password') {
    pinInput.type = 'text'; 
    eyeIcon.className = 'fas fa-eye-slash';
  } else {
    pinInput.type = 'password';
    eyeIcon.className = 'fas fa-eye';
  }
};

window.attemptLogin = async function () {
  const username = ($('loginUsername')?.value || '').trim();
  const pin = ($('loginPin')?.value || '').trim();
  
  if (!username) return toast('Masukkan Username dulu!', true);
  if (!pin) return toast('Masukkan PIN Anda!', true);

  setBusy(true);
  try {
    const { data, error } = await sb.from('investors').select('*').ilike('name', username).eq('pin', pin).single();
    if (data) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
      boot();
    } else {
      toast('Username atau PIN salah', true);
    }
  } catch (e) {
    toast('Username atau PIN salah', true);
  } finally {
    setBusy(false);
  }
};

window.logout = function () {
  sessionStorage.removeItem(SESSION_KEY);
  state.me = null;
  renderPinScreen();
};

// ============ DATA LOADERS ============
async function loadBatches() {
  const { data, error } = await sb.from('investment_batches').select('*').eq('investor_id', state.me.id).order('created_at', { ascending: false });
  if (!error) state.batches = data || [];
}

async function loadInvestorProducts() {
  const { data, error } = await sb.from('produk')
    .select('*')
    .eq('is_investor', true);
  if (!error) state.investorProducts = data || [];
}

async function loadDistributions() {
  const batchIds = state.batches.map(b => b.id);
  if (!batchIds.length) { state.distributions = []; return; }
  
  const { data, error } = await sb.from('profit_distributions')
    .select('*, investment_batches(batch_name)')
    .in('batch_id', batchIds)
    .order('created_at', { ascending: false });
  if (!error) state.distributions = data || [];
}

async function fetchMonthTransactions(mk) {
  const out = [];
  let from = 0;
  const pageSize = 1000;
  for (let i = 0; i < 10; i++) {
    const to = from + pageSize - 1;
    const { data, error } = await sb.from('transactions').select('id,data')
      .eq('data->>monthKey', mk).range(from, to);
    if (error) break;
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out.map(r => ({ id: r.id, ...(r.data || {}) }));
}

function parseNoteLines(note) {
  return String(note || '').split(/\r?\n/).map(line => {
    const parts = line.split(/ qty /i);
    const name = normName(parts[0] || '');
    const qty = parts.length > 1 ? (parseInt(parts[1], 10) || 1) : 1;
    return { name, qty };
  }).filter(l => l.name);
}

async function computeAllBatchStats(monthsBack = 3) {
  // Kumpulkan modal per Proyek (Nama Batch) dari SELURUH batch (bukan cuma milik investor ini)
  // Note: we need created_at to filter batches chronologically
  const { data: allBatchesData } = await sb.from('investment_batches').select('id, batch_name, amount_invested, status, created_at, investors(name)');
  const allBatches = allBatchesData || [];

  const projectMembers = new Map();
  const activeBatches = allBatches.filter(b => String(b.status).toUpperCase() === 'ACTIVE');
  for (const b of activeBatches) {
    const bName = String(b.batch_name).trim().toLowerCase();
    const amt = Number(b.amount_invested || 0);
    
    if (!projectMembers.has(bName)) projectMembers.set(bName, []);
    projectMembers.get(bName).push({ id: b.id, name: b.investors?.name || 'Unknown', modal: amt });
  }

  const finalStats = {};
  allBatches.forEach(b => {
    const bName = String(b.batch_name).trim().toLowerCase();
      finalStats[b.id] = { 
        omzet: 0, 
        modal: 0, 
        netProfit: 0, 
        investorShare: 0, 
        ownerShare: 0, 
        projectOmzet: 0,
        projectModal: 0,
        projectInvestorShare: 0,
        txCount: 0, 
        persen: 30, 
        batchName: b.batch_name,
        members: projectMembers.get(bName) || [],
        totalProjectCapital: 0 
      };
  });

  const productMap = new Map(state.investorProducts.map(p => [normName(p.nama_produk), p]));
  if (!productMap.size) { state.batchStats = finalStats; return; }

  const months = last12Months().slice(0, monthsBack);

  for (const mk of months) {
    const txs = await fetchMonthTransactions(mk);
    for (const t of txs) {
      if (t.deleted) continue;
      const lines = parseNoteLines(t.note);
      if (!lines.length) continue;
      
      let txAssignedToBatch = new Set();
      
      for (const line of lines) {
        const prod = productMap.get(line.name);
        if (!prod) continue;
        const bId = prod.investor_batch_id;
        if (!bId) continue;
        
        const assignedBatch = allBatches.find(x => x.id === bId);
        if (!assignedBatch) continue;
        
        const pName = String(assignedBatch.batch_name).trim().toLowerCase();
        
        const txTime = new Date(t.created_at || t.createdAt || t.dateKey || 0).getTime();
        const eligibleBatches = activeBatches.filter(b => {
          if (String(b.batch_name).trim().toLowerCase() !== pName) return false;
          const bTime = new Date(b.created_at || 0).getTime();
          return bTime <= txTime;
        });

        const eligibleProjCap = eligibleBatches.reduce((sum, b) => sum + Number(b.amount_invested || 0), 0);
        if (eligibleProjCap === 0) continue; 

        const omzetLine = line.qty * Number(prod.harga_jual || 0);
        const modalLine = line.qty * Number(prod.modal || 0);
        const persen = Number(prod.persentase_keuntungan_investor || 30);
        const netProfitLine = omzetLine - modalLine;
        const invShareLine = netProfitLine * (persen / 100);
        
        for (const pb of eligibleBatches) {
          const ratio = Number(pb.amount_invested || 0) / eligibleProjCap;
          
          finalStats[pb.id].omzet += (omzetLine * ratio);
          finalStats[pb.id].projectOmzet += omzetLine;
          finalStats[pb.id].projectModal += modalLine;
          finalStats[pb.id].projectInvestorShare += invShareLine;
          finalStats[pb.id].modal += (modalLine * ratio);
          finalStats[pb.id].netProfit += (netProfitLine * ratio);
          finalStats[pb.id].investorShare += (invShareLine * ratio);
          finalStats[pb.id].ownerShare += ((netProfitLine - invShareLine) * ratio);
          finalStats[pb.id].txCount += 1;
          finalStats[pb.id].persen = persen;
          finalStats[pb.id].totalProjectCapital = eligibleProjCap;
          
          txAssignedToBatch.add(pb.id);
        }
      }
    }
  }

  state.batchStats = finalStats;
}

// ============ RENDER ============
function renderHeader() {
  const hasActive = state.batches && state.batches.some(b => b.status === 'active');
  const badgeHtml = hasActive ? `<div class="badge success" style="padding: 0.4rem 0.8rem; font-size:0.8rem; display:flex; align-items:center; justify-content:center; box-sizing:border-box;">AKTIF</div>` : '';
  return `
      <div class="header-top" style="flex-wrap: wrap; gap: 12px;">
        <div>
          <h2 class="text-primary" style="margin:0; line-height:1; font-size:1.5rem; text-transform:uppercase;">Halo, ${esc(state.me.name)}</h2>
          <div class="text-muted" style="font-size:0.8rem; margin-top:4px; font-weight:600;">Investor Portal</div>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          ${badgeHtml}
          <select class="input" style="padding: 0.4rem 1.5rem 0.4rem 0.5rem; width: auto; font-weight:800; font-size:0.8rem;" onchange="state.statsRange=Number(this.value); refreshStats()">
            ${[1,2,3,6,12].map(n => `<option value="${n}" ${state.statsRange===n?'selected':''}>${n} Bln</option>`).join('')}
          </select>
          <button class="btn" style="padding: 0.4rem 0.8rem;" onclick="refreshStats()" title="Refresh Data"><i class="fas fa-rotate"></i></button>
          <button class="logout-btn" style="width:36px; height:36px; font-size:1rem;" onclick="logout()" title="Keluar"><i class="fas fa-right-from-bracket"></i></button>
        </div>
      </div>
  `;
}

function renderTabBar() {
  return `
    <div class="tabs" style="margin-bottom: 12px;">
      <div class="tab ${state.page === 'dashboard' ? 'active' : ''}" onclick="go('dashboard')"><i class="fas fa-chart-pie mb-1" style="display:block"></i> Dashboard</div>
      <div class="tab ${state.page === 'history' ? 'active' : ''}" onclick="go('history')"><i class="fas fa-hand-holding-dollar mb-1" style="display:block"></i> Riwayat</div>
      <div class="tab ${state.page === 'info' ? 'active' : ''}" onclick="go('info')"><i class="fas fa-circle-info mb-1" style="display:block"></i> Cara Kerja</div>
    </div>
  `;
}

window.go = function(page) {
  state.page = page;
  render();
};

function render() {
  let body = '';
  if (state.page === 'dashboard') body = renderDashboard();
  else if (state.page === 'history') body = renderHistory();
  else if (state.page === 'info') body = renderInfo();
  
  $('app').innerHTML = `
    <div class="dashboard">
      ${renderHeader()}
      ${renderTabBar()}
      ${body}
    </div>
  `;
}

window.refreshStats = async function () {
  setBusy(true);
  try {
    await computeAllBatchStats(state.statsRange);
    render();
    toast('Data diperbarui');
  } catch (err) {
    console.error(err);
    toast('Gagal menyinkronkan data', true);
  } finally {
    setBusy(false);
  }
};

function renderDashboard() {
  const activeBatches = state.batches.filter(b => b.status === 'active');
  const totalInvested = state.batches.reduce((s, b) => s + Number(b.amount_invested || 0), 0);
  
  let totalProjectOmzet = 0;
  let totalInvestorShare = 0;
  const seenProjects = new Set();
  
  state.batches.forEach(b => {
    if (b.status === 'active') {
      const s = state.batchStats[b.id];
      if (s) {
        totalInvestorShare += s.investorShare;
        const bName = String(b.batch_name).trim().toLowerCase();
        if (!seenProjects.has(bName)) {
          seenProjects.add(bName);
          totalProjectOmzet += s.projectOmzet;
        }
      }
    }
  });

  const dateLimit = new Date();
  dateLimit.setMonth(dateLimit.getMonth() - state.statsRange);
  
  let totalWithdrawn = 0;
  state.distributions.forEach(d => {
    if (new Date(d.created_at) >= dateLimit) {
      totalWithdrawn += Number(d.investor_share_amount || 0);
    }
  });

  return `
    <div class="grid-2-always" style="margin-bottom: 12px;">
      <div class="card variant-2">
        <div class="stat-label">Investasi Aktif</div>
        <div class="stat-value text-main">${rp(totalInvested)}</div>
        <div class="text-main" style="font-size:0.75rem;margin-top:4px;font-weight:700">${activeBatches.length} Batch Aktif</div>
      </div>
      <div class="card variant-1">
        <div style="margin-bottom:6px">
          <div class="stat-label">Bagi Hasil (${state.statsRange} Bln)</div>
        </div>
        <div class="stat-value" style="margin-bottom:8px">${rp(totalInvestorShare)}</div>
        <div style="font-size:0.75rem; border-top:var(--b-width) dashed var(--border); padding-top:8px; font-weight:700">
          <div class="flex-between" style="margin-bottom:2px">
            <span>Dicairkan</span>
            <span>${rp(totalWithdrawn)}</span>
          </div>
          <div class="flex-between">
            <span>Sisa</span>
            <span style="font-weight:800; color:${totalInvestorShare - totalWithdrawn > 0 ? 'var(--danger)' : 'var(--success)'}">${rp(totalInvestorShare - totalWithdrawn)}</span>
          </div>
          </div>
        </div>
      </div>
      ${state.batches.length ? state.batches.map(b => {
        const s = state.batchStats[b.id];
        return `
        <div style="margin-bottom:12px;">
          <div style="background:#FFF; padding:12px; border-radius:8px; border:var(--b-width) solid var(--border); margin-bottom:12px;">
            <h2 style="font-size:1.125rem; margin:0 0 8px 0;">
              <span style="text-transform:uppercase">${esc(b.batch_name)}</span>
            </h2>
            <div class="text-muted" style="font-size: 0.9rem; display: flex; justify-content: space-between; align-items: center;">
              <span>Modal Anda: <strong style="color:var(--text-main)">${rp(b.amount_invested)}</strong></span>
              <span style="display:inline-flex; align-items:center; gap:4px;">Total Proyek: <span class="badge" style="background:var(--primary); color:#000; padding:2px 6px; font-size:0.8rem;">${rp(s ? s.totalProjectCapital : 0)}</span></span>
            </div>
          </div>
          ${s ? `
          <div class="batch-stats" style="background:var(--bg-body); padding:1rem; border-radius:8px; border:var(--b-width) solid var(--border); margin-bottom: 12px;">
          <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:12px; padding-bottom:12px; border-bottom:var(--b-width) dashed var(--border)">
            <div style="flex:1; min-width:120px;"><div class="stat-label">Total Omzet Proyek <i class="fas fa-circle-info text-muted" style="cursor:pointer" onclick="showInfo('projectOmzet')"></i></div><div style="font-weight:800;font-size:1.125rem">${rp(s.projectOmzet)}</div></div>
            <div style="flex:1; min-width:120px;"><div class="stat-label">Total Modal Proyek <i class="fas fa-circle-info text-muted" style="cursor:pointer" onclick="showInfo('projectModal')"></i></div><div style="font-weight:900;font-size:1.125rem;color:var(--danger)">- ${rp(s.projectModal)}</div></div>
          </div>
          <div style="font-size:0.875rem; font-weight:700">
            <div class="flex-between" style="margin-bottom:12px; padding-bottom:12px; border-bottom:var(--b-width) solid var(--border)">
              <span>Total Keuntungan Bersih Proyek <i class="fas fa-circle-info text-muted" style="cursor:pointer" onclick="showInfo('projectNetProfit')"></i></span>
              <span style="color:#059669; font-weight:800">${rp(s.projectOmzet - s.projectModal)}</span>
            </div>
            <div style="margin-bottom:16px;">
              <div class="flex-between" style="margin-bottom:6px; padding-left:12px; border-left:var(--b-width) solid var(--border)">
                <span>Porsi Pemilik Toko (${100 - s.persen}%) <i class="fas fa-circle-info text-muted" style="cursor:pointer" onclick="showInfo('projectOwnerShare')"></i></span>
                <span>${rp((s.projectOmzet - s.projectModal) * ((100 - s.persen) / 100))}</span>
              </div>
              <div class="flex-between" style="padding-left:12px; border-left:var(--b-width) solid var(--border)">
                <span>Porsi Gabungan Investor (${s.persen}%) <i class="fas fa-circle-info text-muted" style="cursor:pointer" onclick="showInfo('projectInvestorShare')"></i></span>
                <span style="color:#B45309">${rp(s.projectInvestorShare)}</span>
              </div>
            </div>
            <div style="border-top:var(--b-width) dashed var(--border); margin: 16px 0;"></div>
            <div class="flex-between" style="margin-bottom:4px;">
              <span style="font-weight:800">Porsi Saham Anda <i class="fas fa-circle-info text-muted" style="cursor:pointer" onclick="showInfo('investorRatio')"></i></span>
              <span style="font-weight:800">${(Number(b.amount_invested) / (s.totalProjectCapital || 1) * 100).toFixed(1)}%</span>
            </div>
            <div class="flex-between" style="margin-bottom:4px;">
              <span style="font-weight:800">Profit Anda <i class="fas fa-circle-info text-muted" style="cursor:pointer" onclick="showInfo('investorShare')"></i></span>
              <span style="font-weight:900">${rp(s.investorShare)}</span>
            </div>
          </div>
        </div>
        
        <div style="font-size:0.875rem; background: #FFF; padding: 12px; border-radius: 8px; border: var(--b-width) solid var(--border);">
          <div class="flex-between" style="margin-bottom:8px; border-bottom: var(--b-width) solid var(--border); padding-bottom: 4px">
            <span style="font-weight: 800">Daftar Pemegang Saham:</span>
            <span style="font-weight: 800">Total ${rp(s.members.reduce((sum, m) => sum + m.modal, 0))}</span>
          </div>
          ${s.members.map(m => {
            const currentTotalCapital = s.members.reduce((sum, mem) => sum + mem.modal, 0);
            const ratio = currentTotalCapital > 0 ? m.modal / currentTotalCapital : 0;
            const memberStat = state.batchStats[m.id];
            const profit = memberStat ? memberStat.investorShare : 0;
            return `
            <div class="flex-between" style="padding:8px 0; border-bottom: var(--b-width) dashed var(--border)">
              <div style="text-transform:capitalize; font-weight:800">${esc(m.name)}</div>
              <div style="text-align:right">
                <div style="font-weight:700">${rp(m.modal)} <span style="font-size:0.75rem">(${(ratio*100).toFixed(1)}%)</span></div>
                <div style="color:#059669; font-size:0.85rem; font-weight:800; margin-top:2px">Profit: ${rp(profit)}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
        ` : `<div class="text-center" style="background:#FFF; padding:1rem; border-radius:8px; border:var(--b-width) solid var(--border); font-weight:800">Menghitung data transaksi...</div>`}
      </div>
      `;
    }).join('') : `
      <div class="card empty-state">
        <i class="fas fa-folder-open"></i>
        <div style="font-weight:800">Belum ada batch investasi untuk saat ini.</div>
      </div>
    `}
  `;
}

function renderHistory() {
  return `
    <h2 class="text-main mb-3">Riwayat Pencairan</h2>
    ${state.distributions.length ? state.distributions.map(d => `
      <div class="card mb-3">
        <div class="row mb-2">
          <div>
            <h2 style="font-size:1.125rem">${esc(d.investment_batches?.batch_name || 'Batch')}</h2>
            <div class="text-muted" style="font-weight:700">Periode: ${esc(d.period)}</div>
          </div>
          <span class="badge ${d.paid_to_investor ? 'success' : 'pending'}">${d.paid_to_investor ? 'SUDAH CAIR' : 'PENDING'}</span>
        </div>
        <div class="row" style="background:var(--bg-body); padding:1rem; border-radius:8px; border:var(--b-width) solid var(--border); box-shadow: inset 3px 3px 0px rgba(0,0,0,0.05)">
          <div><div class="stat-label">Bagian Profit</div><div style="font-weight:900;font-size:1.125rem">${rp(d.investor_share_amount)}</div></div>
          ${d.note ? `<div style="font-size:0.875rem; text-align:right; font-weight:700">Catatan:<br>${esc(d.note)}</div>` : ''}
        </div>
      </div>
    `).join('') : `
      <div class="card empty-state">
        <i class="fas fa-receipt"></i>
        <div style="font-weight:800">Belum ada riwayat pencairan.</div>
      </div>
    `}
  `;
}

function renderInfo() {
  return `
    <h2 class="text-main mb-3">Cara Kerja & Bagi Hasil</h2>
    
    <div class="card variant-3 mb-3">
      <h2 style="font-size:1.25rem; margin-bottom: 0.5rem"><i class="fas fa-handshake"></i> 1. Sistem Kerja Sama</h2>
      <p style="font-size:0.95rem; font-weight:600">Kamu bertindak sebagai pemodal (investor) yang menyuntikkan dana pada sebuah <b>Batch Proyek</b>. Total Modal Proyek adalah gabungan dari modal kamu dan investor lain di batch tersebut. Persentase saham kamu dihitung dari (Modal Kamu / Total Modal Proyek).</p>
    </div>

    <div class="card variant-1 mb-3">
      <h2 style="font-size:1.25rem; margin-bottom: 0.5rem"><i class="fas fa-chart-pie"></i> 2. Skema Bagi Hasil (70:30)</h2>
      <p style="font-size:0.95rem; font-weight:600; margin-bottom: 12px">Omzet proyek yang didapat akan dikurangi dengan Modal Barang (HPP) untuk mendapatkan <b>Keuntungan Bersih (Net Profit)</b>.</p>
      <div style="background:#FFF; padding:12px; border-radius:8px; border:var(--b-width) solid var(--border); font-weight:700; box-shadow: inset 3px 3px 0px rgba(0,0,0,0.05)">
        <div class="flex-between" style="border-bottom:var(--b-width) dashed var(--border); padding-bottom:8px; margin-bottom:8px">
          <span>Porsi Pemilik Toko (Pengelola)</span>
          <span style="font-weight:900; font-size:1.1rem">70%</span>
        </div>
        <div class="flex-between">
          <span>Porsi Gabungan Investor</span>
          <span style="font-weight:900; font-size:1.1rem; color:#B45309">30%</span>
        </div>
      </div>
      <p style="font-size:0.85rem; font-weight:800; margin-top:12px; color:var(--text-muted)">*Dari porsi 30% tersebut, akan dibagi lagi ke masing-masing investor sesuai dengan persentase modal awal.</p>
    </div>

    <div class="card variant-2 mb-3">
      <h2 style="font-size:1.25rem; margin-bottom: 0.5rem"><i class="fas fa-money-bill-wave"></i> 3. Transparansi & Pencairan</h2>
      <p style="font-size:0.95rem; font-weight:600">Semua data omzet, modal barang yang terjual, dan keuntungan ditarik secara <b>real-time</b> dari sistem kasir. Pencairan (withdraw) dilakukan secara berkala dan akan tercatat pada tab <b>Riwayat</b> agar kamu bisa memantau "Sisa Belum Cair" kapan saja.</p>
    </div>

    <div class="card mb-5" style="background:#FFF0F0; border-color:var(--danger)">
      <h2 style="font-size:1.25rem; margin-bottom: 0.5rem; color:var(--danger)"><i class="fas fa-triangle-exclamation"></i> 4. Risiko Kerugian (Force Majeure)</h2>
      <p style="font-size:0.95rem; font-weight:700; color:var(--danger)">Seperti halnya bisnis nyata, investasi ini memiliki risiko kerugian. Jika sewaktu-waktu terjadi keadaan kahar (<i>force majeure</i>), bencana, kebangkrutan, atau kendala berat operasional di luar kendali pengelola, maka <b>risiko kerugian finansial sepenuhnya ditanggung oleh pihak investor</b> tanpa tuntutan ganti rugi. Pastikan Anda mengerti dan sepenuhnya setuju dengan aturan ini sebelum memutuskan untuk berinvestasi.</p>
    </div>
  `;
}

window.showInfo = function(type) {
  const modal = document.getElementById('info-modal');
  const title = document.getElementById('info-title');
  const body = document.getElementById('info-body');
  
  if (type === 'projectOmzet') {
    title.innerText = 'Total Omzet Proyek';
    body.innerHTML = 'Total keseluruhan omzet kotor dari penjualan proyek ini.<br><br><b>Simulasi:</b> Jika 10 jilbab laku Rp 50.000, maka Total Omzet = <b>Rp 500.000</b>.';
  } else if (type === 'projectModal') {
    title.innerText = 'Total Modal Proyek';
    body.innerHTML = 'Total Harga Pokok Penjualan (HPP) dari semua barang yang laku pada proyek ini.<br><br><b>Simulasi:</b> 10 jilbab laku, modal per jilbab Rp 30.000, Total Modal = <b>Rp 300.000</b>.';
  } else if (type === 'projectNetProfit') {
    title.innerText = 'Total Keuntungan Bersih Proyek';
    body.innerHTML = 'Total Omzet dikurangi Total Modal.<br><br><b>Simulasi:</b> Rp 500.000 - Rp 300.000 = <b>Rp 200.000</b>.';
  } else if (type === 'projectOwnerShare') {
    title.innerText = 'Porsi Pemilik Toko';
    body.innerHTML = 'Dari keuntungan bersih proyek, hak Pengelola (Pemilik Toko) adalah persentase mayoritas (contoh 70%).<br><br><b>Simulasi:</b> 70% x Rp 200.000 = <b>Rp 140.000</b>.';
  } else if (type === 'projectInvestorShare') {
    title.innerText = 'Porsi Gabungan Investor';
    body.innerHTML = 'Sisa persentase dari keuntungan bersih proyek (contoh 30%) yang menjadi HAK SELURUH INVESTOR (dikumpulkan jadi satu).<br><br><b>Simulasi:</b> 30% x Rp 200.000 = <b>Rp 60.000</b>.';
  } else if (type === 'investorRatio') {
    title.innerText = 'Porsi Saham Anda';
    body.innerHTML = 'Persentase saham milik Anda pribadi di batch proyek ini (Modal Anda / Total Modal Seluruh Investor di Proyek ini).<br><br><b>Simulasi:</b> Jika Anda invest Rp 8 Juta dari total Rp 10 Juta modal proyek, Porsi Anda = <b>80%</b>.';
  } else if (type === 'investorShare') {
    title.innerText = 'Profit Anda';
    body.innerHTML = 'Ini adalah keuntungan murni Anda! Dihitung dengan mengalikan Porsi Saham Anda dengan Porsi Gabungan Investor.<br><br><b>Simulasi:</b> 80% (Porsi Anda) x Rp 60.000 (Porsi Gabungan) = <b>Rp 48.000</b>.';
  }
  
  modal.style.display = 'flex';
};

window.closeInfo = function() {
  document.getElementById('info-modal').style.display = 'none';
};

// ============ BOOT ============
async function boot() {
  setBusy(true);
  try {
    const session = sessionStorage.getItem(SESSION_KEY);
    if (!session) return renderPinScreen();
    
    state.me = JSON.parse(session);
    
    await loadBatches();
    await loadInvestorProducts();
    await loadDistributions();
    
    render();
    
    // Auto-calculate stats in background
    await computeAllBatchStats(state.statsRange);
    render();
  } catch (err) {
    console.error(err);
    toast('Gagal memuat data', true);
  } finally {
    setBusy(false);
  }
}

boot();
