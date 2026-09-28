// Lapisan penyimpanan SAPA PAJAK di atas Supabase.
// Menyediakan antarmuka yang sama dengan yang dipakai dashboard (window.claude.use("db"|"user"|"downloads")),
// sehingga logika dashboard tidak perlu tahu apakah datanya di Supabase atau di tempat lain.
(function () {
  "use strict";
  const cfg = window.SAPA_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !/ISI-/.test(cfg.SUPABASE_URL) && cfg.SUPABASE_ANON_KEY && !/ISI-/.test(cfg.SUPABASE_ANON_KEY);
  const sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const PAGE = 1000;

  function mapErr(e) {
    const msg = (e && (e.message || e.details)) || "Gagal";
    const pg = e && e.code;
    if (pg === "42501" || /row-level security|permission denied/i.test(msg)) return { code: "not_allowed", message: msg };
    if (pg === "23505") return { code: "invalid_argument", message: msg };
    return { code: "unavailable", message: msg };
  }
  const snapDoc = (id, data) => ({ id, exists: !!data, data: () => data || undefined, metadata: { fromCache: false, hasPendingWrites: false } });

  // ---------- koleksi SPPT ----------
  const sppt = { map: new Map(), listeners: new Set(), channel: null, loaded: false };
  function emitSppt() {
    const docs = [...sppt.map.entries()].map(([id, d]) => snapDoc(id, d));
    const snap = { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
    sppt.listeners.forEach(l => { try { l.next(snap); } catch (_) {} });
  }
  async function loadSppt() {
    const m = new Map();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from("sapa_sppt").select("id,data,updated_at,updated_by").order("id").range(from, from + PAGE - 1);
      if (error) throw mapErr(error);
      data.forEach(r => m.set(r.id, withMeta(r)));
      if (data.length < PAGE) break;
    }
    sppt.map = m; sppt.loaded = true; emitSppt();
  }
  function withMeta(r) { return { ...(r.data || {}), updatedAt: r.updated_at || (r.data && r.data.updatedAt), updatedBy: r.updated_by || (r.data && r.data.updatedBy) || null }; }
  function subscribeSppt() {
    if (sppt.channel) return;
    sppt.channel = sb.channel("sapa_sppt_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sapa_sppt" }, p => {
        if (p.eventType === "DELETE") sppt.map.delete(p.old.id);
        else sppt.map.set(p.new.id, withMeta(p.new));
        emitSppt();
      })
      .subscribe(st => { if (st === "SUBSCRIBED" && sppt.loaded) loadSppt().catch(() => {}); });
  }
  const clean = body => { const b = { ...body }; delete b.id; delete b.updatedBy; return b; };
  async function upsertSppt(id, body) {
    const { error } = await sb.from("sapa_sppt").upsert({ id, data: clean(body) });
    if (error) throw mapErr(error);
    sppt.map.set(id, { ...clean(body), updatedAt: new Date().toISOString(), updatedBy: STATE.userId }); emitSppt();
  }
  async function bulkUpsert(rows) { // rows: [{id, data}]
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200).map(r => ({ id: r.id, data: clean(r.data) }));
      const { error } = await sb.from("sapa_sppt").upsert(chunk);
      if (error) throw mapErr(error);
      chunk.forEach(r => sppt.map.set(r.id, { ...r.data, updatedAt: new Date().toISOString(), updatedBy: STATE.userId }));
      if (STATE.onProgress) STATE.onProgress(Math.min(rows.length, i + 200), rows.length);
    }
    emitSppt();
  }

  // ---------- konfigurasi (pilot, rekap) ----------
  const conf = { vals: {}, listeners: {}, channel: null };
  async function loadConf() {
    const { data, error } = await sb.from("sapa_config").select("key,value");
    if (error) throw mapErr(error);
    conf.vals = {}; data.forEach(r => conf.vals[r.key] = r.value);
    Object.keys(conf.listeners).forEach(emitConf);
  }
  function emitConf(key) { (conf.listeners[key] || []).forEach(fn => { try { fn(snapDoc(key, conf.vals[key])); } catch (_) {} }); }
  function subscribeConf() {
    if (conf.channel) return;
    conf.channel = sb.channel("sapa_config_live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sapa_config" }, p => {
        if (p.eventType === "DELETE") delete conf.vals[p.old.key]; else conf.vals[p.new.key] = p.new.value;
        emitConf(p.eventType === "DELETE" ? p.old.key : p.new.key);
      }).subscribe();
  }

  // ---------- antarmuka db ----------
  function docRef(path) {
    const [col, id] = path.split("/");
    if (col === "config") return {
      id, path,
      onSnapshot(next) { (conf.listeners[id] = conf.listeners[id] || []).push(next); next(snapDoc(id, conf.vals[id])); return () => { conf.listeners[id] = conf.listeners[id].filter(f => f !== next); }; },
      async get() { return snapDoc(id, conf.vals[id]); },
      async set(v) { const { error } = await sb.from("sapa_config").upsert({ key: id, value: v }); if (error) throw mapErr(error); conf.vals[id] = v; emitConf(id); },
      async delete() { const { error } = await sb.from("sapa_config").delete().eq("key", id); if (error) throw mapErr(error); delete conf.vals[id]; emitConf(id); }
    };
    return {
      id, path,
      async get() { return snapDoc(id, sppt.map.get(id)); },
      set: body => upsertSppt(id, body),
      async update(part) { const cur = sppt.map.get(id); if (!cur) throw { code: "invalid_argument", message: "Dokumen tidak ada" }; return upsertSppt(id, { ...cur, ...part }); },
      async delete() { const { error } = await sb.from("sapa_sppt").delete().eq("id", id); if (error) throw mapErr(error); sppt.map.delete(id); emitSppt(); }
    };
  }
  const db = {
    doc: docRef,
    collection(name) {
      return {
        path: name,
        doc: id => docRef(name + "/" + id),
        onSnapshot(next, error) {
          const l = { next, error }; sppt.listeners.add(l);
          if (sppt.loaded) emitSppt(); else loadSppt().catch(e => error && error(e));
          subscribeSppt(); return () => sppt.listeners.delete(l);
        }
      };
    }
  };

  // ---------- pengguna ----------
  const STATE = { userId: null, peran: null, nama: "", names: {}, onProgress: null };
  const user = {
    async id() { return STATE.userId; },
    async isOwner() { return STATE.peran === "admin"; },
    async canEdit() { return STATE.peran === "admin"; },
    async can(c) { return c === "data.write" ? (STATE.peran === "admin" || STATE.peran === "petugas") : null; },
    async profiles(ids) {
      const need = ids.filter(i => !(i in STATE.names));
      if (need.length) {
        const { data } = await sb.from("sapa_petugas").select("user_id,nama").in("user_id", need);
        need.forEach(i => STATE.names[i] = "");
        (data || []).forEach(r => STATE.names[r.user_id] = r.nama || "");
      }
      const out = {}; ids.forEach(i => out[i] = { id: i, name: STATE.names[i] || "" }); return out;
    }
  };
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return { status: "saved" };
    }
  };

  // ---------- login ----------
  let resolveReady; const ready = new Promise(r => resolveReady = r);
  async function afterLogin(session) {
    STATE.userId = session.user.id;
    const { data, error } = await sb.from("sapa_petugas").select("nama,peran").eq("user_id", session.user.id).maybeSingle();
    if (error || !data) return { ok: false, email: session.user.email };
    STATE.peran = data.peran; STATE.nama = data.nama; STATE.names[session.user.id] = data.nama;
    await loadConf().catch(() => {}); subscribeConf();
    resolveReady(); return { ok: true, nama: data.nama, peran: data.peran, email: session.user.email };
  }

  window.SAPA = {
    configured: !!sb, client: sb, state: STATE, bulkUpsert, ready,
    async currentSession() { if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(email, password) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; return afterLogin(data.session); },
    afterLogin,
    async signOut() { await sb.auth.signOut(); location.reload(); },
    async resetPassword(email) { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }); if (error) throw error; }
  };
  window.claude = { use: async name => { await ready; return name === "db" ? db : name === "user" ? user : name === "downloads" ? downloads : null; } };
})();
