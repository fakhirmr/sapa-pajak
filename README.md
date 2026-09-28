# Dashboard Kendali SAPA PAJAK

Website pemantauan SPPT PBB-P2 kembali di **Kel. Sempaja Selatan** yang objeknya ternyata berada di **Kel. Sempaja Barat** akibat pemekaran wilayah (Perda Kota Samarinda No. 6 Tahun 2014). Website ini disusun untuk Aksi Perubahan SAPA PAJAK di UPTD Pendapatan Daerah Wilayah III, Bapenda Kota Samarinda.

| Halaman | Alamat | Isi | Akses |
|---|---|---|---|
| Dashboard petugas | `/` | Perbandingan, register SPPT, tindak lanjut, KPI, impor Excel, ekspor CSV | Login, hanya petugas terdaftar |
| Ringkasan publik | `/publik` | Angka agregat, grafik per blok dan per lokasi | Terbuka, **tanpa** nama, alamat, atau NOP WP |

Data disimpan di project Supabase **pbb** (tabel berawalan `sapa_`). Website di-hosting di Vercel sebagai situs statis.

> **Data wajib pajak tidak disimpan di repo ini.** Repo ini publik. Data diimpor langsung dari file Excel lewat website ke database Supabase.

---

## Langkah pemasangan

### 1. Siapkan database di Supabase (project "pbb")

1. Buka **Supabase Dashboard**, pilih project **pbb**.
2. Buka **SQL Editor**, klik **New query**, lalu tempel seluruh isi [`supabase/schema.sql`](supabase/schema.sql) dan klik **Run**.
   File ini aman dijalankan ulang. Isinya membuat tabel `sapa_petugas`, `sapa_sppt`, `sapa_config`, aturan akses (Row Level Security), fungsi ringkasan publik, dan pembaruan langsung (Realtime).
3. Buka **Project Settings → API** dan salin **Project URL** serta **anon public key**.

### 2. Isi `config.js`

Buka [`config.js`](config.js), lalu ganti dua nilai berikut:

```js
window.SAPA_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi..."
};
```

Anon key memang boleh terlihat publik. Yang melindungi data adalah aturan akses di database, bukan kerahasiaan key ini. **Jangan pernah** mengisi `service_role` key di sini.

### 3. Pasang di Vercel

1. Buka [vercel.com/new](https://vercel.com/new) dan impor repo **fakhirmr/wealthflow**.
2. Di **Root Directory**, klik **Edit** lalu pilih folder **`sapa-pajak`**. Langkah ini penting agar tidak tercampur dengan aplikasi WealthFlow.
3. Pilih **Framework Preset: Other**. Build Command dan Output Directory dibiarkan kosong.
4. Pilih branch yang berisi folder `sapa-pajak`, lalu klik **Deploy**. Website akan tersedia di alamat seperti `https://sapa-pajak.vercel.app`. Nama project bisa diatur saat impor.
5. (Opsional) Tambahkan domain sendiri di **Settings → Domains**.

### 4. Atur alamat website di Supabase

Di **Authentication → URL Configuration**, isi **Site URL** dengan alamat Vercel dari langkah 3. Ini diperlukan agar tautan "Lupa kata sandi" mengarah ke website yang benar.

Untuk mencegah orang mendaftar sendiri, buka **Authentication → Sign In / Providers → Email** dan matikan **Allow new users to sign up**. Akun cukup dibuat oleh admin (langkah 5).

### 5. Buat akun petugas

Untuk setiap orang:

1. Buka **Authentication → Users → Add user → Create new user**. Isi email dan kata sandi, lalu centang **Auto Confirm User**.
2. Di **SQL Editor**, daftarkan akun tersebut beserta perannya:

```sql
insert into public.sapa_petugas (user_id, nama, peran)
select id, 'Nama Lengkap', 'admin' from auth.users where email = 'email@contoh.go.id'
on conflict (user_id) do update set nama = excluded.nama, peran = excluded.peran;
```

| Peran | Bisa melakukan |
|---|---|
| `admin` | Semua hal, termasuk mengatur pilot, memperbarui rekap induk, dan menghapus SPPT |
| `petugas` | Melihat register, memperbarui tahap/status/catatan, dan mengimpor SPPT |
| `pemantau` | Hanya melihat (untuk mentor, coach, atau pimpinan) |

Akun yang bisa login tetapi belum didaftarkan di `sapa_petugas` tidak akan melihat data apa pun.

### 6. Impor data dari Excel

1. Masuk sebagai **admin**, lalu klik **Impor** di bagian Register.
2. Pilih file rekap, misalnya *Rekap SPPT Kembali Sempaja Selatan.xlsx*.
3. Pastikan pilihan sheet sudah benar:
   - **Sheet SPPT yang ditindaklanjuti:** `SORTIR Sppt S. Barat`
   - **Sheet rekap induk:** `Rekap SPPT Kembali S Selatan`
4. Klik **Impor dari Excel**.

Hasil yang diharapkan untuk file saat ini:
- 632 SPPT masuk ke register, 11 di antaranya langsung berstatus *Sudah tersampaikan*.
- Rekap induk berisi 2.654 SPPT kembali di 24 blok.
- Target pilot menjadi 632.

Mengimpor ulang file yang sudah diperbarui aman. Data dari Excel (nama, alamat, blok, keterangan) diperbarui, sedangkan tahap, status, dan catatan hasil kerja petugas tidak ditimpa.

---

## Susunan file

| File | Fungsi |
|---|---|
| `index.html` | Halaman login dan dashboard petugas |
| `publik.html` | Halaman ringkasan publik (hanya angka agregat) |
| `styles.css` | Tampilan bersama kedua halaman |
| `config.js` | Alamat dan anon key Supabase |
| `store.js` | Penghubung dashboard ke Supabase (login, baca/tulis register, pembaruan langsung) |
| `excel.js` | Pembaca file Excel "Laporan Relap SPPT" di peramban |
| `supabase/schema.sql` | Tabel, aturan akses, dan fungsi ringkasan publik |
| `vercel.json` | Pengaturan hosting (URL rapi, header keamanan, `noindex` untuk dashboard) |

## Keamanan data

- Dashboard petugas memakai login Supabase. Setiap baca/tulis diperiksa di database sesuai peran, jadi pembatasan ini tidak bisa dilewati dari peramban.
- Kolom "diperbarui oleh" dan "waktu" diisi oleh database, bukan oleh peramban.
- Halaman publik hanya memanggil fungsi `sapa_ringkasan_publik()`, yang mengembalikan jumlah per status, per blok, dan per lokasi. Nama, alamat, NOP, dan luas tanah tidak pernah dikirim ke pengunjung tanpa login.
- Hasil ekspor CSV berisi data WP. Simpan dan bagikan hanya di lingkungan tim.
