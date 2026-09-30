# SAPA PAJAK versi Google Apps Script

Dashboard ini tidak memerlukan server, Supabase, Vercel, atau GitHub. **Spreadsheet Anda sendiri menjadi databasenya**, dan websitenya dijalankan oleh Google Apps Script.

## Cara kerja

| Sheet | Isi | Diubah oleh |
|---|---|---|
| `SORTIR Sppt S. Barat` | Daftar SPPT yang ditindaklanjuti (objek di Kel. Sempaja Barat) | Anda, seperti biasa |
| `Rekap SPPT Kembali S Selatan` | Seluruh SPPT kembali Kel. Sempaja Selatan (rekap induk) | Anda, seperti biasa |
| `SAPA_TindakLanjut` *(dibuat otomatis)* | Satu baris per NOP berisi tahap, status, hasil, PIC, kendala, catatan, waktu, dan siapa yang mengubah | Petugas lewat dashboard (bisa juga diedit langsung) |
| `SAPA_Pengaturan` *(dibuat otomatis)* | Tanggal data, periode, pilot, email admin tambahan, dan alamat halaman publik | Admin |

- Angka **2.654**, **632**, dan per blok **dihitung langsung dari sheet**. Kalau sheet diubah, dashboard ikut berubah setelah dimuat ulang (otomatis setiap 1 menit).
- Sheet asli **tidak pernah diubah** oleh script.
- Untuk menambah atau menghapus SPPT, cukup tambah atau hapus barisnya di sheet `SORTIR Sppt S. Barat`.

## Langkah pemasangan (sekitar 15 menit)

### 1. Ubah file Excel menjadi Google Spreadsheet
1. Upload *Rekap SPPT Kembali Sempaja Selatan.xlsx* ke Google Drive.
2. Klik kanan file, pilih **Buka dengan → Google Spreadsheet**, lalu **File → Simpan sebagai Google Spreadsheet**.
3. Pakai file Google Spreadsheet hasil konversi itu (bukan yang .xlsx) untuk langkah berikutnya.

> Apps Script tidak bisa menulis ke file `.xlsx`, jadi databasenya harus berupa Google Spreadsheet. Kalau perlu file Excel, gunakan **File → Download → Microsoft Excel** kapan saja.

### 2. Tempel script
1. Di spreadsheet, buka **Extensions → Apps Script**.
2. Ganti isi `Code.gs` dengan isi file [`Code.gs`](Code.gs).
3. Buat 2 file HTML: klik **+ → HTML**, beri nama **persis** seperti berikut (tanpa `.html`), lalu tempel isinya:
   - `Index` ← [Index.html](Index.html)
   - `Publik` ← [Publik.html](Publik.html)
4. Klik **Simpan**.
5. Kembali ke spreadsheet dan muat ulang halamannya. Akan muncul menu **SAPA PAJAK → Siapkan sheet SAPA**. Klik menu itu dan izinkan akses saat diminta. Sheet `SAPA_TindakLanjut` dan `SAPA_Pengaturan` akan dibuat otomatis.

Kalau nama sheet Anda berbeda, ubah `SHEET_REGISTER` dan `SHEET_INDUK` di baris atas `Code.gs`.

### 3. Deploy dua alamat web

Di editor Apps Script, pilih **Deploy → New deployment → Select type: Web app**.

**a. Dashboard petugas**
- Description: `Dashboard petugas`
- Execute as: **User accessing the web app**
- Who has access: **Anyone with Google account**

Salin URL-nya. Ini alamat untuk Tim Efektif.

**b. Halaman publik** (buat deployment baru lagi)
- Description: `Ringkasan publik`
- Execute as: **Me**
- Who has access: **Anyone**

Salin URL-nya, tambahkan `?page=publik` di belakangnya, lalu tempel di sheet `SAPA_Pengaturan` pada baris `publikUrl`. Halaman ini hanya menampilkan angka, tanpa nama, alamat, atau NOP.

### 4. Beri akses ke tim

Hak akses dashboard **mengikuti sharing spreadsheet**. Klik **Bagikan** di spreadsheet:

| Peran di dashboard | Atur di spreadsheet |
|---|---|
| **Admin** (atur tanggal, periode, pilot) | Pemilik spreadsheet, atau email yang ditulis di `SAPA_Pengaturan` baris `admin` |
| **Petugas** (update tindak lanjut) | Bagikan sebagai **Editor** |
| **Pemantau** (mentor, coach, pimpinan) | Bagikan sebagai **Viewer** |

Orang yang tidak diberi akses ke spreadsheet tidak bisa membuka dashboard petugas.

Saat pertama kali membuka dashboard, setiap petugas akan diminta izin oleh Google dan mungkin melihat peringatan *"Google hasn't verified this app"*. Klik **Advanced → Go to … (unsafe)**, lalu **Allow**. Peringatan ini wajar untuk script buatan sendiri, dan izin hanya diminta sekali.

## Memperbarui script

Setelah mengubah kode, pilih **Deploy → Manage deployments**, klik ikon pensil di tiap deployment, pilih **Version: New version**, lalu **Deploy**. URL-nya tetap sama.

## Batasan dibanding versi Supabase/Vercel

- Perubahan dari petugas lain muncul dalam **±1 menit**, tidak seketika. Bisa juga dengan menekan **Muat ulang data**.
- Setiap simpan butuh sekitar 1–3 detik, karena Apps Script menulis ke spreadsheet.
- Cocok untuk ratusan sampai beberapa ribu SPPT dan tim kecil. Untuk puluhan ribu baris atau banyak pengguna bersamaan, versi Supabase lebih tepat.

## Memperbarui kode dengan SAPA Updater

Kode di folder `apps-script/` pada repo GitHub `fakhirmr/sapa-pajak` adalah versi resmi. Script kecil **SAPA Updater** (folder [`updater/`](../updater/)) mengambil kode itu dan memasangnya ke project Apps Script SAPA PAJAK, termasuk memperbarui kedua web app ke versi baru. URL-nya tetap sama.

### Pasang sekali

1. Repo GitHub `sapa-pajak` harus **Public**: Settings → *Danger Zone* → **Change visibility → Public**. Repo hanya berisi kode, tanpa data wajib pajak.
2. **Apps Script API** harus *On* di https://script.google.com/home/usersettings.
3. Buka https://script.google.com → **New project**, lalu beri nama `SAPA Updater`.
4. Ganti isi `Code.gs` dengan isi [`updater/Updater.gs`](../updater/Updater.gs).
5. Klik ⚙️ **Project Settings**, lalu centang **Show "appsscript.json" manifest file in editor**. Kembali ke **Editor**, buka `appsscript.json`, dan ganti isinya dengan [`updater/appsscript.json`](../updater/appsscript.json).
6. Klik **Simpan**, pilih fungsi `perbarui`, lalu klik **Run**. Saat diminta izin: **Review permissions → pilih akun → Advanced → Go to SAPA Updater (unsafe) → Allow**.

### Setiap ada perubahan kode

Buka project **SAPA Updater**, pilih `perbarui`, lalu klik **Run**. *Execution log* akan menampilkan versi yang dipasang ke tiap web app.

Akun yang menjalankan updater harus akun pemilik (atau editor) project Apps Script SAPA PAJAK.
