// Pembaca file Excel "Laporan Relap SPPT" (format rekap/sortir SPPT kembali UPTD).
// Semua pembacaan terjadi di peramban; file tidak diunggah ke mana pun selain baris yang diimpor ke database.
(function () {
  "use strict";
  const cl = v => (v === null || v === undefined) ? "" : String(v).replace(/\s+/g, " ").trim();
  const isNop = v => /^64\.72\./.test(cl(v));

  async function readWorkbook(file) {
    if (!window.XLSX) throw new Error("Pustaka pembaca Excel belum termuat. Muat ulang halaman.");
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
    return wb.SheetNames.map(name => {
      const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, blankrows: true, raw: true });
      const layout = findLayout(rows);
      const nopCount = layout ? rows.slice(layout.start).filter(r => isNop(r[layout.c])).length : 0;
      return { name, rows, layout, nopCount };
    });
  }

  // Cari baris judul kolom ("No | | Nop | Nama | Alamat Wp ...") dan posisi kolom NOP.
  function findLayout(rows) {
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const r = rows[i] || [];
      const c = r.findIndex(v => /^nop$/i.test(cl(v)));
      if (c >= 0) return { header: i, start: i + 1, c, o: c - 2 };
    }
    // tanpa judul: tebak dari baris pertama yang berisi NOP
    for (let i = 0; i < rows.length; i++) {
      const c = (rows[i] || []).findIndex(isNop);
      if (c >= 0) return { header: -1, start: i, c, o: c - 2 };
    }
    return null;
  }

  // Penyebab awal ditebak dari alamat WP; petugas bisa mengubahnya setelah verifikasi.
  function guessPenyebab(alamatWp) {
    const a = cl(alamatWp).toUpperCase();
    const m = a.match(/RT\.?\s*(\d+)\s+(.*)$/);
    const kel = m ? m[2].trim() : "";
    if (kel && !kel.startsWith("SEMPAJA")) return "wp_luar_wilayah";
    if (kel === "SEMPAJA") return "pemekaran";
    if (/RT\.?\s*000/.test(a) || a.includes(" - RT")) return "alamat_tidak_jelas";
    return "pemekaran";
  }

  // Sheet register (mis. "SORTIR Sppt S. Barat"): satu objek per baris, dengan baris judul lokasi di antaranya.
  function parseRegister(sheet) {
    const L = sheet.layout; if (!L) return [];
    const g = (r, i) => r[i + L.o];
    let lokasi = ""; const out = [];
    for (let i = L.start; i < sheet.rows.length; i++) {
      const r = sheet.rows[i] || [];
      const nop = cl(r[L.c]);
      if (!isNop(nop)) {
        const vals = r.filter(v => cl(v) !== "");
        if (vals.length === 1 && typeof vals[0] === "string" && !/^\d+$/.test(cl(vals[0]))) lokasi = cl(vals[0]);
        continue;
      }
      const aop = cl(g(r, 8)), gang = cl(g(r, 9)), blok0 = cl(g(r, 10)), blok = blok0 === "-" ? "" : blok0;
      let alamat = aop;
      if (gang && !aop.toUpperCase().includes(gang.toUpperCase())) alamat += /^(GG|LORONG)/i.test(gang) ? " " + gang : " GG " + gang;
      if (blok) alamat += " " + blok;
      const ket = cl(g(r, 16));
      const no = typeof g(r, 0) === "number" ? g(r, 0) : null;
      const lt = g(r, 14), lb = g(r, 15);
      out.push({
        id: nop.replace(/[^A-Za-z0-9_\-.~:@+]/g, ""),
        sheet: {
          nop, nama: cl(g(r, 3)), alamat, rt: cl(g(r, 13)), alamatWp: cl(g(r, 4)), blokNo: blok, lokasi, no,
          nib: cl(g(r, 12)), luasTanah: typeof lt === "number" ? lt : null, luasBangunan: typeof lb === "number" ? lb : null,
          ketAwal: ket, sumber: sheet.name
        },
        tersampaikan: /^tersampaikan/i.test(ket),
        penyebab: guessPenyebab(g(r, 4))
      });
    }
    return out;
  }

  // Sheet rekap induk (mis. "Rekap SPPT Kembali S Selatan"): hitung total dan jumlah per blok NOP.
  function parseRekap(sheet) {
    const L = sheet.layout; if (!L) return null;
    const perBlok = {}; let total = 0; const seen = new Set();
    for (let i = L.start; i < sheet.rows.length; i++) {
      const nop = cl((sheet.rows[i] || [])[L.c]);
      if (!isNop(nop) || seen.has(nop)) continue;
      seen.add(nop); total++;
      const b = (nop.split(".")[4] || "").split("-")[0];
      if (b) perBlok[b] = (perBlok[b] || 0) + 1;
    }
    return { totalKembali: total, perBlok };
  }

  window.SAPA_EXCEL = { readWorkbook, parseRegister, parseRekap, guessPenyebab };
})();
