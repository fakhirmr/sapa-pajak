-- ══════════════════════════════════════════════════════════════
-- SAPA PAJAK — Dashboard Kendali SPPT PBB-P2 Kembali
-- Jalankan SEKALI di project Supabase "pbb":
--   Supabase Dashboard → SQL Editor → New query → tempel isi file ini → Run
-- Aman dijalankan ulang (idempoten). Semua objek berawalan sapa_
-- sehingga tidak bentrok dengan tabel PBB lain di project yang sama.
-- ══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1) Tabel
-- ─────────────────────────────────────────────────────────────

-- Petugas yang boleh masuk dashboard. Akun dibuat di Authentication → Users,
-- lalu didaftarkan di sini (lihat bagian 6).
--   admin    : semua hak, termasuk mengatur pilot, rekap induk, dan menghapus SPPT
--   petugas  : melihat dan memperbarui register (tahap, status, catatan, impor)
--   pemantau : hanya melihat (mis. mentor, coach, pimpinan)
create table if not exists public.sapa_petugas (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nama       text not null,
  peran      text not null default 'petugas' check (peran in ('admin','petugas','pemantau')),
  created_at timestamptz not null default now()
);

-- Register SPPT kembali. id = NOP. Isi lengkap ada di kolom data (jsonb);
-- beberapa kolom turunan disediakan agar mudah dibaca/difilter di Table Editor.
create table if not exists public.sapa_sppt (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  nop        text generated always as (data->>'nop') stored,
  nama_wp    text generated always as (data->>'nama') stored,
  lokasi     text generated always as (data->>'lokasi') stored,
  blok       text generated always as (split_part(split_part(id, '.', 5), '-', 1)) stored,
  status     text generated always as (coalesce(nullif(data->>'status', ''), 'belum')) stored,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists sapa_sppt_status_idx on public.sapa_sppt (status);
create index if not exists sapa_sppt_blok_idx   on public.sapa_sppt (blok);

-- Pengaturan: key 'pilot' (kelurahan, target, mulai, hari) dan
-- key 'rekap' (totalKembali, perBlok, tanggal, periode).
create table if not exists public.sapa_config (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- ─────────────────────────────────────────────────────────────
-- 2) Siapa yang mengubah & kapan (diisi server, tidak bisa dipalsukan klien)
-- ─────────────────────────────────────────────────────────────
create or replace function public.sapa_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists sapa_sppt_touch on public.sapa_sppt;
create trigger sapa_sppt_touch before insert or update on public.sapa_sppt
  for each row execute function public.sapa_touch();

drop trigger if exists sapa_config_touch on public.sapa_config;
create trigger sapa_config_touch before insert or update on public.sapa_config
  for each row execute function public.sapa_touch();

-- ─────────────────────────────────────────────────────────────
-- 3) Hak akses (Row Level Security)
-- ─────────────────────────────────────────────────────────────
create or replace function public.sapa_peran() returns text
language sql stable security definer set search_path = public as $$
  select peran from public.sapa_petugas where user_id = auth.uid()
$$;
revoke all on function public.sapa_peran() from public;
grant execute on function public.sapa_peran() to authenticated;

alter table public.sapa_petugas enable row level security;
alter table public.sapa_sppt    enable row level security;
alter table public.sapa_config  enable row level security;

drop policy if exists sapa_petugas_baca  on public.sapa_petugas;
drop policy if exists sapa_petugas_admin on public.sapa_petugas;
create policy sapa_petugas_baca  on public.sapa_petugas for select to authenticated using (public.sapa_peran() is not null);
create policy sapa_petugas_admin on public.sapa_petugas for all    to authenticated using (public.sapa_peran() = 'admin') with check (public.sapa_peran() = 'admin');

drop policy if exists sapa_sppt_baca   on public.sapa_sppt;
drop policy if exists sapa_sppt_tambah on public.sapa_sppt;
drop policy if exists sapa_sppt_ubah   on public.sapa_sppt;
drop policy if exists sapa_sppt_hapus  on public.sapa_sppt;
create policy sapa_sppt_baca   on public.sapa_sppt for select to authenticated using (public.sapa_peran() is not null);
create policy sapa_sppt_tambah on public.sapa_sppt for insert to authenticated with check (public.sapa_peran() in ('admin','petugas'));
create policy sapa_sppt_ubah   on public.sapa_sppt for update to authenticated using (public.sapa_peran() in ('admin','petugas')) with check (public.sapa_peran() in ('admin','petugas'));
create policy sapa_sppt_hapus  on public.sapa_sppt for delete to authenticated using (public.sapa_peran() = 'admin');

drop policy if exists sapa_config_baca  on public.sapa_config;
drop policy if exists sapa_config_admin on public.sapa_config;
create policy sapa_config_baca  on public.sapa_config for select to authenticated using (public.sapa_peran() is not null);
create policy sapa_config_admin on public.sapa_config for all    to authenticated using (public.sapa_peran() = 'admin') with check (public.sapa_peran() = 'admin');

-- Pengunjung tanpa login (anon) tidak punya policy apa pun → tidak bisa membaca tabel.

-- ─────────────────────────────────────────────────────────────
-- 4) Ringkasan untuk halaman publik /publik
--    Hanya angka agregat: tidak ada nama, alamat, NOP, atau luas tanah WP.
-- ─────────────────────────────────────────────────────────────
create or replace function public.sapa_ringkasan_publik() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'rekap',  (select jsonb_build_object('totalKembali', value->'totalKembali', 'perBlok', value->'perBlok',
                                         'tanggal', value->'tanggal', 'periode', value->'periode')
               from public.sapa_config where key = 'rekap'),
    'pilot',  (select jsonb_build_object('kelurahan', value->'kelurahan', 'target', value->'target',
                                         'mulai', value->'mulai', 'hari', value->'hari')
               from public.sapa_config where key = 'pilot'),
    'total',  (select count(*) from public.sapa_sppt),
    'status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
               from (select status, count(*) n from public.sapa_sppt group by status) t),
    'perBlok', (select coalesce(jsonb_object_agg(blok, n), '{}'::jsonb)
               from (select blok, count(*) n from public.sapa_sppt group by blok) t),
    'perLokasi', (select coalesce(jsonb_agg(jsonb_build_object('lokasi', l, 'n', n, 'selesai', s) order by n desc), '[]'::jsonb)
               from (select coalesce(nullif(lokasi, ''), '–') l, count(*) n, count(*) filter (where status = 'hijau') s
                     from public.sapa_sppt group by 1) t),
    'diperbarui', (select max(updated_at) from public.sapa_sppt)
  )
$$;
revoke all on function public.sapa_ringkasan_publik() from public;
grant execute on function public.sapa_ringkasan_publik() to anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5) Pembaruan langsung (Realtime): perubahan satu petugas langsung
--    terlihat di layar petugas lain
-- ─────────────────────────────────────────────────────────────
do $$
begin
  begin alter publication supabase_realtime add table public.sapa_sppt;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.sapa_config; exception when duplicate_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 6) Mendaftarkan petugas (jalankan terpisah, setelah akun dibuat di
--    Authentication → Users → Add user → Create new user)
--    Ganti email dan nama di bawah, lalu jalankan per orang.
-- ─────────────────────────────────────────────────────────────
-- insert into public.sapa_petugas (user_id, nama, peran)
-- select id, 'Nama Admin', 'admin' from auth.users where email = 'admin@contoh.go.id'
-- on conflict (user_id) do update set nama = excluded.nama, peran = excluded.peran;
--
-- insert into public.sapa_petugas (user_id, nama, peran)
-- select id, 'Nama Petugas Lapangan', 'petugas' from auth.users where email = 'petugas1@contoh.go.id'
-- on conflict (user_id) do update set nama = excluded.nama, peran = excluded.peran;
