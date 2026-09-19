# GeoTanah Dairi — Cadastral WebGIS & Field Survey

![Next.js 16](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat-square&logo=typescript)
![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8?style=flat-square&logo=tailwindcss)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL_%2B_PostGIS-3ecf8e?style=flat-square&logo=supabase)
![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?style=flat-square&logo=vercel)
![PostGIS](https://img.shields.io/badge/PostGIS-Spatial_Engine-blue?style=flat-square)

Sistem informasi geografis berbasis web (*WebGIS*) untuk sensus pertanahan, validasi spasial, dan dokumentasi lapangan di Kabupaten Dairi. Mendukung percepatan pendaftaran tanah tematik untuk Wakaf, Rumah Ibadah, dan Masyarakat Berpenghasilan Rendah (MBR).

🔗 **Live Demo:** [geotanah-deliserdang.vercel.app](https://geotanah-deliserdang.vercel.app)  
📦 **Repositori:** [github.com/nesar123sbr/geotanah-deliserdang](https://github.com/nesar123sbr/geotanah-deliserdang)

---

## Latar Belakang

Pelaksanaan pendaftaran tanah massal dan sensus pertanahan di lingkungan Kantor Pertanahan Kabupaten Dairi (khususnya wilayah Sidikalang dan sekitarnya) menghadapi tantangan geografis serta teknis yang dinamis. Seringkali ditemui permasalahan tumpang tindih batas kepemilikan (*spatial overlap*), selisih luas antara dokumen warkah yuridis dengan kenyataan fisik lapangan (*area deviation*), serta proses pencatatan survei manual yang memakan waktu dan berisiko kehilangan dokumentasi bukti fisik.

Untuk mengatasi kesenjangan tersebut, GeoTanah Dairi dikembangkan sebagai platform WebGIS terintegrasi yang menghubungkan kerja juru ukur di lapangan dengan meja verifikator pimpinan di kantor pertanahan secara *real-time*. Awalnya diinisiasi sebagai prototipe riset kadastral, sistem ini kini difokuskan sepenuhnya untuk memenuhi standar operasional kadastral dan target sensus pertanahan tematik di Kabupaten Dairi.

Melalui perpaduan komputasi geometri spasial PostGIS di sisi server (*cloud database*) dan antarmuka web modern yang responsif di sisi klien, sistem ini mengotomatisasi pengecekan topologi batas, memverifikasi akurasi koordinat GPS, mengompresi bukti foto patok secara adaptif, serta menyediakan *bulk export geodatabase* siap pakai untuk diserahkan ke unit kerja.

---

## Fitur Utama

### 1. Dashboard Pimpinan & Verifikator
- **Digital Cadastral Viewer:** Tampilan visual bidang-bidang tanah di atas citra satelit resolusi tinggi ESRI World Imagery terintegrasi layer vektor jalan.
- **Deteksi Otomatis Tumpang Tindih:** Validasi topologi dua arah (`ST_Relate` dan `ST_Intersects`) di basis data; bidang yang bersengketa batas otomatis ditandai status merah (*Overlap*).
- **Kalkulasi Deviasi Luas Spheroid:** Menghitung luas permukaan bumi riil dalam meter persegi ($m^2$) menggunakan kalkulasi geodesi WGS84, lalu membandingkannya dengan luas yuridis (toleransi deviasi $\le 2\%$).
- **Multi-Filter Terpadu:** Penyaringan cepat berdasarkan kategori KKP (KW 1, KW 4, KW 5, KW 6) serta kategori program tematik (Wakaf, Rumah Ibadah, MBR, Hibah, Reguler).
- **Realtime Sync:** Pembaruan metrik dan posisi bidang secara instan memanfaatkan Supabase Realtime WebSocket tanpa perlu memuat ulang halaman.
- **Bulk Export Geodatabase:** Unduh seluruh paket data dalam satu berkas `.zip` berisi GeoJSON spasial poligon, CSV tabular atribut, berkas rekapitulasi, dan dokumentasi foto lapangan.

### 2. Mode Sensus Lapangan (Mobile-Friendly)
- **Pengambilan GPS Terverifikasi:** Mengunci titik koordinat GPS perangkat lapangan dengan indikator akurasi satelit (maksimal toleransi 1000 meter).
- **Kompresi Foto Adaptif:** Reduksi ukuran foto patok/bidang tanah di browser secara adaptif hingga 96% (dari ~3,5 MB menjadi ~120 KB) dengan format WebP tajam guna menghemat kuota dan penyimpanan *cloud*.
- **Delineasi Poligon Interaktif:** Fitur digitasi patok batas langsung di atas peta kerja satelit dengan kalkulasi luas poligon *real-time*.
- **Import Berkas GPS Eksternal:** Mendukung unggah langsung berkas hasil survei dari Avenza Maps, Locus Map, atau GPS Handheld Garmin (format `.geojson`, `.json`, `.gpx`, `.kml`) dengan komputasi centroid otomatis (0 KB dependensi eksternal).
- **Auto-Deteksi NIB:** Ekstraksi otomatis atribut NIB dari metadata properti berkas GPS yang diimpor untuk mempercepat proses entri.

### 3. Optimasi & Keamanan
- **Smart CDN Transformation:** Penyajian gambar dengan resolusi dan kompresi optimal menggunakan Supabase Storage Image Transform (menghemat hingga 90% *bandwidth* unduhan).
- **Row Level Security (RLS):** Pembatasan akses pembacaan dan manipulasi data di tingkat baris database PostgreSQL.
- **Audit Trail Terintegrasi:** Pencatatan otomatis setiap riwayat penambahan, pengubahan, dan penghapusan bidang tanah ke dalam tabel audit log via *database trigger*.

---

## Screenshot

[Screenshot: Dashboard WebGIS Cadastral Viewer dengan visualisasi poligon bidang tanah dan 3 status verifikasi]

[Screenshot: Cadastral Inspector dengan rincian deviasi luas, KKP, program pendaftaran, dan foto dokumentasi]

[Screenshot: Mode Sensus Lapangan mobile dengan delineasi batas patok di peta kerja satelit]

[Screenshot: Fitur Import Berkas Spasial GPS dari Avenza/Locus dan Modal Export Geodatabase ZIP]

---

## Tech Stack

| Lapisan | Teknologi | Keterangan |
| :--- | :--- | :--- |
| **Frontend Framework** | Next.js 16 (App Router), React 19 | Server & Client Components, Turbopack Engine |
| **Bahasa Pemrograman** | TypeScript 5 | Strict static typing untuk keandalan kode |
| **Styling & UI** | Tailwind CSS v4, Lucide React | Modern responsive design & icon set |
| **Mesin Peta (GIS)** | Leaflet 1.9, React-Leaflet | Visualisasi layer raster satelit & vektor poligon |
| **Database & Spasial** | PostgreSQL + PostGIS (Supabase) | Tipe `GEOGRAPHY(Polygon, 4326)`, spatial indexing |
| **Storage & CDN** | Supabase Storage | Penyimpanan foto survei teroptimasi WebP |
| **Autentikasi** | Supabase Auth & RLS | Keamanan multi-peran pengguna (*upcoming*) |
| **Kompresi Gambar** | Native Canvas Web API | Kompresi adaptif WebP di sisi klien (0 KB library) |
| **Arsip & Ekspor** | fflate (8 KB) | Kompresi ZIP performa tinggi dan hemat memori |
| **Deployment** | Vercel | Otomasi CI/CD & global edge caching |

---

## Arsitektur

```text
+-----------------------------------------------------------------------+
|                         KLIEN / BROWSER                               |
|                                                                       |
|  [ Dashboard Pimpinan (/) ]           [ Mode Sensus (/survey) ]       |
|  - Leaflet Cadastral Map              - GPS Geolocation               |
|  - Filter KKP & Program               - Delineasi Poligon Patok       |
|  - Inspector Deviasi & Foto           - Import Avenza/GPX/KML         |
|  - Bulk Export ZIP (fflate)           - Adaptive WebP Compression     |
+-----------------------------------+-----------------------------------+
                                    | HTTPS / REST / WebSockets
                                    v
+-----------------------------------------------------------------------+
|                    SUPABASE CLOUD INFRASTRUCTURE                      |
|                                                                       |
|  +-----------------------------------------------------------------+  |
|  | PostgreSQL Database + PostGIS Extension                         |  |
|  | - public.parcels (data yuridis, koordinat, geom geography)      |  |
|  | - public.profiles & public.audit_log (audit trail perubahan)    |  |
|  | - RPC get_parcels_with_metrics_v2 (analisis deviasi & overlap)  |  |
|  | - RPC submit_survey_data_v2 (transaksi spasial & centroid)      |  |
|  +-----------------------------------------------------------------+  |
|  | Storage Bucket: parcel-photos (CDN Caching & Transformation)    |  |
+-----------------------------------------------------------------------+
```

---

## Cara Menjalankan Lokal

1. **Clone repositori:**
   ```bash
   git clone https://github.com/nesar123sbr/geotanah-deliserdang.git
   cd geotanah-deliserdang
   ```

2. **Install dependensi:**
   ```bash
   npm install
   ```

3. **Setup environment variables:**
   Buat file `.env.local` pada direktori *root* proyek:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. **Jalankan server pengembangan:**
   ```bash
   npm run dev
   ```

5. **Buka aplikasi di peramban:**
   Akses `http://localhost:3000` untuk Dashboard atau `http://localhost:3000/survey` untuk Mode Sensus Lapangan.

---

## Environment Variables

| Variabel | Deskripsi |
| :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL endpoint proyek Supabase Anda |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Kunci anon/publik Supabase untuk akses sisi klien |
| `SUPABASE_SERVICE_ROLE_KEY` | *(Opsional)* Kunci service role untuk skrip pemeliharaan admin |

---

## Struktur Folder

```text
geotanah-deliserdang/
├── app/
│   ├── layout.tsx            # Root layout aplikasi
│   ├── page.tsx              # Dashboard utama WebGIS & metrik kadastral
│   └── survey/
│       └── page.tsx          # Antarmuka survei & sensus lapangan mobile
├── components/
│   ├── ExportModal.tsx       # Dialog opsi export geodatabase ZIP
│   ├── ParcelMap.tsx         # Komponen peta dashboard & visualisasi layer
│   └── SurveyDrawMap.tsx     # Komponen peta kerja digitasi & delineasi patok
├── lib/
│   ├── exportGeodatabase.ts  # Logika pembuatan paket ZIP geodatabase (fflate)
│   ├── parseGeoFile.ts       # Parser spasial native (GeoJSON, GPX, KML)
│   └── supabase.ts           # Inisialisasi klien Supabase
├── public/                   # Asset statis, ikon, dan manifest web
├── supabase_rpc_fix_v2.sql   # Skrip DDL tabel, trigger audit, dan fungsi RPC
└── package.json              # Manifes paket dan dependensi proyek
```

---

## Skema Database (Ringkas)

Data spasial dan yuridis disimpan dalam tabel inti `public.parcels`:

- **Identifikasi:** `nib` (Format: `02.06.01.01.XXXXX`), `owner_name`, `sub_district`, `village`
- **Metrik Luas:** `legal_area_m2` (luas yuridis warkah) vs `spatial_area_m2` (luas hitungan PostGIS)
- **Geometri:** `geom` dengan tipe `geography(Polygon, 4326)`
- **Klasifikasi KKP:** `kkp_category` (`KW 1`, `KW 4`, `KW 5`, `KW 6`)
- **Klasifikasi Program:** `program_type` (`Reguler`, `Wakaf`, `Rumah Ibadah`, `MBR`, `Hibah`)
- **Metadata Lapangan:** `gps_lat`, `gps_lng`, `gps_accuracy_m`, `photo_path`, `surveyed_at`
- **Audit Pengguna:** `created_by_user`, `updated_by_user` terelasi ke `auth.users`

*Skrip migrasi dan definisi lengkap tersedia pada berkas [`supabase_rpc_fix_v2.sql`](supabase_rpc_fix_v2.sql).*

---

## Roadmap Pengembangan

- [x] Dashboard WebGIS interaktif dengan peta citra satelit
- [x] Validasi topologi spasial dua arah (deteksi tumpang tindih)
- [x] Analisis deviasi luas fisik vs yuridis berbasis model spheroid
- [x] Mode sensus lapangan mobile-friendly
- [x] Perekaman titik GPS dengan validasi akurasi
- [x] Kompresi adaptif foto patok berbasis WebP (hemat kuota 96%)
- [x] Delineasi poligon batas bidang di peta kerja
- [x] Import berkas spasial GPS eksternal (GeoJSON, GPX, KML dari Avenza/Locus)
- [x] Bulk export paket geodatabase ZIP lengkap (Shape-ready GeoJSON + CSV)
- [ ] Implementasi form autentikasi petugas (Supabase Auth UI)
- [ ] Penomoran dan generasi Berita Acara Pemeriksaan (BAP) format PDF
- [ ] Integrasi layer batas administrasi desa & peta pendaftaran resmi KKP
- [ ] Fitur revisi/editing poligon batas eksisting di lapangan

---

## Kontribusi

Proyek ini dikembangkan sebagai bagian dari kontribusi inovasi teknis survei, pemetaan, dan pendaftaran tanah pada Kantor Pertanahan Kabupaten Dairi. Jika Anda menemukan *bug* atau ingin mengajukan saran perbaikan, silakan buat *issue* atau kirimkan *pull request*.

---

## Lisensi

Didistribusikan di bawah lisensi **MIT License**. Lihat berkas `LICENSE` untuk informasi selengkapnya.

---

## Kontak & Pengembang

- **Pengembang:** Gada Prima Siburian
- **Email:** [Hubungi via GitHub](https://github.com/nesar123sbr)
- **LinkedIn:** [Profil LinkedIn](https://www.linkedin.com/in/gada-prima-siburian-71a004202/)

