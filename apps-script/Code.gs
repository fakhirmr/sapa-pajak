/**
 * SAPA PAJAK — Dashboard Kendali SPPT PBB-P2 Kembali (versi Google Apps Script)
 *
 * Database = Google Spreadsheet tempat script ini ditempel (Extensions → Apps Script).
 *  - Sheet SHEET_REGISTER : daftar SPPT yang ditindaklanjuti (objek di Kel. Sempaja Barat). TIDAK diubah script.
 *  - Sheet SHEET_INDUK    : rekap induk seluruh SPPT kembali Kel. Sempaja Selatan. TIDAK diubah script.
 *  - Sheet SAPA_TindakLanjut : dibuat otomatis; satu baris per NOP berisi hasil kerja petugas.
 *  - Sheet SAPA_Pengaturan   : dibuat otomatis; tanggal data, periode, pilot, admin, alamat halaman publik.
 *
 * Hak akses mengikuti sharing spreadsheet (lihat PANDUAN.md):
 *  - Editor spreadsheet  → petugas (bisa memperbarui tindak lanjut)
 *  - Viewer spreadsheet  → pemantau (hanya melihat)
 *  - Pemilik / email di pengaturan "admin" → admin (bisa mengatur pilot & tanggal/periode)
 */

// ─── Sesuaikan bila nama sheet berbeda ───
var SHEET_REGISTER = 'SORTIR Sppt S. Barat';
var SHEET_INDUK = 'Rekap SPPT Kembali S Selatan';
var SHEET_TL = 'SAPA_TindakLanjut';
var SHEET_CFG = 'SAPA_Pengaturan';

var TAHAP = ['PETAKAN', 'SAPA', 'LAYANI', 'EDUKASI', 'DATAKAN', 'DAMPINGI', 'TINDAK LANJUT', 'PANTAU'];
var STATUS_LABEL = { belum: 'Belum disapa', kuning: 'Proses', hijau: 'Selesai', merah: 'Perlu tindak lanjut' };
var PENYEBAB_LABEL = {
  alamat_tidak_jelas: 'Alamat tidak jelas/tidak lengkap', pemekaran: 'Perubahan alamat akibat pemekaran',
  wp_pindah: 'WP pindah alamat', wp_luar_wilayah: 'Alamat WP di luar wilayah', kepemilikan: 'Kepemilikan berubah, belum dilaporkan',
  objek_berubah: 'Kondisi objek berubah', lainnya: 'Lainnya', belum_diketahui: 'Belum diketahui'
};
var HASIL_LABEL = {
  '': 'Belum jelas', tersampaikan: 'Berhasil tersampaikan', alamat_tidak_ditemukan: 'Alamat tidak ditemukan/tidak lengkap',
  wp_pindah: 'WP pindah', perubahan_data: 'Perubahan kepemilikan/data', perlu_tindak_lanjut: 'Memerlukan tindak lanjut'
};
var KEPUASAN_LABEL = { '': '', sangat_puas: 'Sangat puas', puas: 'Puas', cukup: 'Cukup', tidak_puas: 'Tidak puas' };

// Kolom sheet SAPA_TindakLanjut: [judul, kunci, jenis]
var TL_COLS = [
  ['NOP', 'id', 'text'], ['Penyebab', 'penyebab', PENYEBAB_LABEL], ['Tahap', 'tahap', 'tahap'], ['Status', 'status', STATUS_LABEL],
  ['Hasil', 'hasil', HASIL_LABEL], ['Layak disampaikan ulang', 'layakUlang', 'bool'], ['Sudah disampaikan ulang', 'tersampaikanUlang', 'bool'],
  ['Temuan perubahan data', 'temuanData', 'bool'], ['Perubahan data diproses', 'dataDiproses', 'bool'], ['Perlu tindak lanjut PIC', 'perluTL', 'bool'],
  ['PIC', 'pic', 'text'], ['Kepuasan WP', 'kepuasan', KEPUASAN_LABEL], ['Kendala', 'kendala', 'text'], ['Catatan', 'catatan', 'text'],
  ['Diperbarui', 'updatedAt', 'date'], ['Oleh', 'updatedBy', 'text']
];
var CFG_DEFAULT = [
  ['tanggal', '', 'Data per tanggal (YYYY-MM-DD)'], ['periode', '', 'Periode / tahun pajak'],
  ['kelurahan', 'Sempaja Barat', 'Kelurahan lokus pilot'], ['target', '', 'Jumlah SPPT sasaran (kosong = jumlah di sheet register)'],
  ['mulai', '', 'Tanggal mulai implementasi (YYYY-MM-DD)'], ['hari', 60, 'Lama implementasi (hari)'],
  ['admin', '', 'Email admin tambahan, pisahkan dengan koma'], ['publikUrl', '', 'Alamat deployment halaman publik (diisi setelah deploy)']
];

// ═════════════════════════ Halaman ═════════════════════════
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || '';
  if (page === 'publik' || !isStaffContext_()) {
    return HtmlService.createTemplateFromFile('Publik').evaluate()
      .setTitle('Ringkasan SAPA PAJAK').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  var t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate().setTitle('Dashboard Kendali SAPA PAJAK').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

/** Menu di spreadsheet untuk admin. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('SAPA PAJAK')
    .addItem('Siapkan sheet SAPA', 'siapkanSheet')
    .addItem('Cek ringkasan', 'cekRingkasan')
    .addToUi();
}
function siapkanSheet() { ensureSheets_(); SpreadsheetApp.getActive().toast('Sheet SAPA_TindakLanjut dan SAPA_Pengaturan siap.', 'SAPA PAJAK'); }
function cekRingkasan() {
  var r = getRingkasan();
  SpreadsheetApp.getUi().alert('Rekap induk: ' + r.rekap.totalKembali + ' SPPT kembali\nObjek di Sempaja Barat: ' + r.total +
    '\nSelesai: ' + (r.status.hijau || 0) + '\nBelum disapa: ' + (r.status.belum || 0));
}

// ═════════════════════════ Hak akses ═════════════════════════
/** Dashboard lengkap hanya dijalankan sebagai pengguna yang membukanya (deployment "User accessing"),
 *  atau oleh pemilik sendiri. Di deployment publik ("Me" + "Anyone"), pengunjung lain hanya mendapat ringkasan. */
function isStaffContext_() {
  var active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  var eff = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  return !!active && active === eff;
}
function me_() {
  if (!isStaffContext_()) throw new Error('TIDAK_BERHAK: buka dashboard petugas dengan akun Google yang diberi akses spreadsheet.');
  var email = Session.getActiveUser().getEmail();
  var ss = SpreadsheetApp.getActive();
  var e = email.toLowerCase(), canWrite = false, admin = false;
  try { canWrite = ss.getEditors().some(function (u) { return u.getEmail().toLowerCase() === e; }); } catch (err) { canWrite = false; }
  try { var o = ss.getOwner(); admin = !!o && o.getEmail().toLowerCase() === e; } catch (err) {}
  var extra = String(readConfig_().admin || '').toLowerCase().split(/[,;\s]+/).filter(String);
  if (extra.indexOf(e) >= 0) admin = true;
  if (admin) canWrite = true;
  return { email: email, nama: email.split('@')[0], peran: admin ? 'admin' : canWrite ? 'petugas' : 'pemantau', canWrite: canWrite };
}

// ═════════════════════════ Pembacaan sheet sumber ═════════════════════════
function cl_(v) { return v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim(); }
function isNop_(v) { return /^64\.72\./.test(cl_(v)); }
function layout_(rows) {
  for (var i = 0; i < Math.min(rows.length, 40); i++) {
    for (var c = 0; c < rows[i].length; c++) if (/^nop$/i.test(cl_(rows[i][c]))) return { start: i + 1, c: c, o: c - 2 };
  }
  for (i = 0; i < rows.length; i++) for (c = 0; c < rows[i].length; c++) if (isNop_(rows[i][c])) return { start: i, c: c, o: c - 2 };
  return null;
}
function sheetRows_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" tidak ditemukan. Sesuaikan SHEET_REGISTER / SHEET_INDUK di Code.gs.');
  return sh.getDataRange().getValues();
}
function guessPenyebab_(alamatWp) {
  var a = cl_(alamatWp).toUpperCase(), m = a.match(/RT\.?\s*(\d+)\s+(.*)$/), kel = m ? m[2].trim() : '';
  if (kel && kel.indexOf('SEMPAJA') !== 0) return 'wp_luar_wilayah';
  if (kel === 'SEMPAJA') return 'pemekaran';
  if (/RT\.?\s*000/.test(a) || a.indexOf(' - RT') >= 0) return 'alamat_tidak_jelas';
  return 'pemekaran';
}
function readRegister_() {
  var rows = sheetRows_(SHEET_REGISTER), L = layout_(rows), out = [], lokasi = '';
  if (!L) return out;
  function g(r, i) { return r[i + L.o]; }
  for (var i = L.start; i < rows.length; i++) {
    var r = rows[i], nop = cl_(r[L.c]);
    if (!isNop_(nop)) {
      var vals = r.filter(function (v) { return cl_(v) !== ''; });
      if (vals.length === 1 && typeof vals[0] === 'string' && !/^\d+$/.test(cl_(vals[0]))) lokasi = cl_(vals[0]);
      continue;
    }
    var aop = cl_(g(r, 8)), gang = cl_(g(r, 9)), blok = cl_(g(r, 10)); if (blok === '-') blok = '';
    var alamat = aop;
    if (gang && aop.toUpperCase().indexOf(gang.toUpperCase()) < 0) alamat += /^(GG|LORONG)/i.test(gang) ? ' ' + gang : ' GG ' + gang;
    if (blok) alamat += ' ' + blok;
    var ket = cl_(g(r, 16)), lt = g(r, 14), lb = g(r, 15), no = g(r, 0);
    out.push({
      id: nop, nop: nop, nama: cl_(g(r, 3)), alamat: alamat, rt: cl_(g(r, 13)), alamatWp: cl_(g(r, 4)), blokNo: blok, lokasi: lokasi,
      no: typeof no === 'number' ? no : null, nib: cl_(g(r, 12)), luasTanah: typeof lt === 'number' ? lt : null,
      luasBangunan: typeof lb === 'number' ? lb : null, ketAwal: ket, sumber: SHEET_REGISTER
    });
  }
  return out;
}
function readInduk_() {
  var rows = sheetRows_(SHEET_INDUK), L = layout_(rows), perBlok = {}, seen = {}, total = 0;
  if (!L) return { totalKembali: 0, perBlok: {} };
  for (var i = L.start; i < rows.length; i++) {
    var nop = cl_(rows[i][L.c]);
    if (!isNop_(nop) || seen[nop]) continue;
    seen[nop] = 1; total++;
    var b = (nop.split('.')[4] || '').split('-')[0];
    if (b) perBlok[b] = (perBlok[b] || 0) + 1;
  }
  return { totalKembali: total, perBlok: perBlok };
}

// ═════════════════════════ Sheet SAPA_* ═════════════════════════
function ensureSheets_() {
  var ss = SpreadsheetApp.getActive();
  var tl = ss.getSheetByName(SHEET_TL);
  if (!tl) {
    tl = ss.insertSheet(SHEET_TL);
    tl.getRange(1, 1, 1, TL_COLS.length).setValues([TL_COLS.map(function (c) { return c[0]; })]).setFontWeight('bold').setBackground('#DCE6F5');
    tl.setFrozenRows(1); tl.getRange('A:A').setNumberFormat('@');
  }
  var cf = ss.getSheetByName(SHEET_CFG);
  if (!cf) {
    cf = ss.insertSheet(SHEET_CFG);
    cf.getRange(1, 1, 1, 3).setValues([['Kunci', 'Nilai', 'Keterangan']]).setFontWeight('bold').setBackground('#DCE6F5');
    cf.getRange(2, 1, CFG_DEFAULT.length, 3).setValues(CFG_DEFAULT);
    cf.getRange('B:B').setNumberFormat('@'); cf.setFrozenRows(1);
  }
  return { tl: tl, cf: cf };
}
function readConfig_() {
  var cf = SpreadsheetApp.getActive().getSheetByName(SHEET_CFG), out = {};
  CFG_DEFAULT.forEach(function (d) { out[d[0]] = d[1]; });
  if (!cf) return out;
  cf.getDataRange().getDisplayValues().slice(1).forEach(function (r) { if (r[0]) out[cl_(r[0])] = r[1]; });
  return out;
}
function writeConfig_(obj) {
  var cf = ensureSheets_().cf, vals = cf.getDataRange().getValues(), idx = {};
  vals.forEach(function (r, i) { if (i) idx[cl_(r[0])] = i + 1; });
  Object.keys(obj).forEach(function (k) {
    var v = obj[k] === null || obj[k] === undefined ? '' : String(obj[k]);
    if (idx[k]) cf.getRange(idx[k], 2).setValue(v);
    else { cf.appendRow([k, v, '']); idx[k] = cf.getLastRow(); }
  });
}
function invert_(map) { var o = {}; Object.keys(map).forEach(function (k) { o[String(map[k]).toLowerCase()] = k; }); return o; }
function readTL_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_TL), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, TL_COLS.length).getValues();
  vals.forEach(function (r, i) {
    var id = cl_(r[0]); if (!id) return;
    var o = { _row: i + 2 };
    TL_COLS.forEach(function (c, j) {
      if (j === 0) return;
      var v = r[j], t = c[2];
      if (t === 'bool') o[c[1]] = v === true || /^(ya|y|true|1)$/i.test(cl_(v));
      else if (t === 'tahap') { var ix = TAHAP.indexOf(cl_(v).toUpperCase()); o[c[1]] = ix < 0 ? 0 : ix; }
      else if (t === 'date') o[c[1]] = v instanceof Date ? v.toISOString() : cl_(v);
      else if (typeof t === 'object') { var inv = invert_(t); o[c[1]] = inv[cl_(v).toLowerCase()] !== undefined ? inv[cl_(v).toLowerCase()] : (t[cl_(v)] !== undefined ? cl_(v) : ''); }
      else o[c[1]] = cl_(v);
    });
    out[id] = o;
  });
  return out;
}
function tlRowValues_(id, d) {
  return TL_COLS.map(function (c, j) {
    if (j === 0) return id;
    var v = d[c[1]], t = c[2];
    if (t === 'bool') return v ? 'Ya' : 'Tidak';
    if (t === 'tahap') return TAHAP[Number(v) || 0];
    if (t === 'date') return v ? new Date(v) : '';
    if (typeof t === 'object') return t[v || ''] !== undefined ? t[v || ''] : (v || '');
    return v === null || v === undefined ? '' : String(v);
  });
}

// Keadaan awal SPPT yang belum punya baris tindak lanjut, diturunkan dari sheet register.
function defaultTL_(s) {
  var ters = /^tersampaikan/i.test(s.ketAwal);
  return {
    penyebab: guessPenyebab_(s.alamatWp), tahap: ters ? 7 : 0, status: ters ? 'hijau' : 'belum', hasil: ters ? 'tersampaikan' : '',
    layakUlang: ters, tersampaikanUlang: ters, temuanData: false, dataDiproses: false, perluTL: false, pic: '', kepuasan: '', kendala: '',
    catatan: /tunggakan/i.test(s.ketAwal) ? 'Tidak ada tunggakan (keterangan awal).' : '', updatedAt: '', updatedBy: ''
  };
}
function mergedRows_() {
  var reg = readRegister_(), tl = readTL_();
  return reg.map(function (s) {
    var t = tl[s.id], base = defaultTL_(s), o = {};
    Object.keys(s).forEach(function (k) { o[k] = s[k]; });
    Object.keys(base).forEach(function (k) { o[k] = t && t[k] !== undefined ? t[k] : base[k]; });
    return o;
  });
}
function configOut_(cfg, reg) {
  var induk = readInduk_();
  return {
    pilot: { kelurahan: cfg.kelurahan || 'Sempaja Barat', target: Number(cfg.target) || reg.length, mulai: cfg.mulai || '', hari: Number(cfg.hari) || 60 },
    rekap: { totalKembali: induk.totalKembali, perBlok: induk.perBlok, tanggal: cfg.tanggal || '', periode: cfg.periode || '', sumber: SHEET_INDUK },
    publikUrl: cfg.publikUrl || ''
  };
}

// ═════════════════════════ Fungsi yang dipanggil halaman ═════════════════════════
function getData() {
  var me = me_(); ensureSheetsIfWriter_(me);
  var rows = mergedRows_(), cfg = readConfig_();
  return { me: me, rows: rows, config: configOut_(cfg, rows), serverTime: new Date().toISOString() };
}
function ensureSheetsIfWriter_(me) { if (me.canWrite) ensureSheets_(); }

function saveTL(id, body) {
  var me = me_();
  if (!me.canWrite) throw new Error('TIDAK_BERHAK: akun ini hanya punya akses lihat ke spreadsheet.');
  id = cl_(id);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = ensureSheets_().tl, tl = readTL_();
    var exists = readRegister_().some(function (s) { return s.id === id; });
    if (!exists) throw new Error('NOP ' + id + ' tidak ada di sheet ' + SHEET_REGISTER + '.');
    var d = {}; TL_COLS.forEach(function (c) { d[c[1]] = body[c[1]]; });
    d.updatedAt = new Date().toISOString(); d.updatedBy = me.email;
    var values = [tlRowValues_(id, d)];
    if (tl[id]) sh.getRange(tl[id]._row, 1, 1, TL_COLS.length).setValues(values);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, TL_COLS.length).setValues(values);
    return { id: id, updatedAt: d.updatedAt, updatedBy: d.updatedBy };
  } finally { lock.releaseLock(); }
}

function saveConfig(key, value) {
  var me = me_();
  if (me.peran !== 'admin') throw new Error('TIDAK_BERHAK: hanya admin yang dapat mengubah pengaturan.');
  value = value || {};
  if (key === 'pilot') writeConfig_({ kelurahan: value.kelurahan, target: value.target, mulai: value.mulai, hari: value.hari });
  else if (key === 'rekap') writeConfig_({ tanggal: value.tanggal, periode: value.periode }); // total & per blok selalu dihitung dari sheet induk
  else throw new Error('Pengaturan tidak dikenal: ' + key);
  return configOut_(readConfig_(), readRegister_());
}

/** Ringkasan untuk halaman publik: hanya angka agregat, tanpa nama/alamat/NOP. */
function getRingkasan() {
  var rows = mergedRows_(), cfg = readConfig_(), induk = readInduk_(), status = {}, perBlok = {}, lok = {};
  rows.forEach(function (r) {
    var s = r.status || 'belum'; status[s] = (status[s] || 0) + 1;
    var b = (String(r.id).split('.')[4] || '').split('-')[0]; perBlok[b] = (perBlok[b] || 0) + 1;
    var l = r.lokasi || '–'; lok[l] = lok[l] || { lokasi: l, n: 0, selesai: 0 }; lok[l].n++; if (s === 'hijau') lok[l].selesai++;
  });
  var upd = rows.map(function (r) { return r.updatedAt; }).filter(String).sort().pop() || '';
  return {
    rekap: { totalKembali: induk.totalKembali, perBlok: induk.perBlok, tanggal: cfg.tanggal || '', periode: cfg.periode || '' },
    total: rows.length, status: status, perBlok: perBlok,
    perLokasi: Object.keys(lok).map(function (k) { return lok[k]; }).sort(function (a, b) { return b.n - a.n; }),
    diperbarui: upd
  };
}
