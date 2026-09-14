# GeoTanah Deli Serdang — Cadastral WebGIS & Spatial Validation

Sistem informasi geografis berbasis web (*WebGIS*) untuk pemantauan, validasi batas, dan kalkulasi deviasi luas bidang tanah program pendaftaran tanah (PTSL) di wilayah Lubuk Pakam, Kabupaten Deli Serdang.

🔗 **Live Demo:** [geotanah-deliserdang.vercel.app](https://geotanah-deliserdang.vercel.app)  
📦 **Repositori:** [github.com/nesar123sbr/geotanah-deliserdang](https://github.com/nesar123sbr/geotanah-deliserdang)

---

## 📌 Latar Belakang & Masalah

Dalam pelaksanaan pendaftaran tanah massal, terdapat dua kendala spasial yang kerap memicu sengketa agraria:
1. **Deviasi Luas Fisik vs Yuridis:** Selisih antara luas yang tercantum pada dokumen Surat Ukur dengan hasil komputasi koordinat lapangan.
2. **Tumpang Tindih Batas (Overlap):** Klaim bidang tanah yang beririsan dengan kepemilikan warga lain atau badan hukum.

Aplikasi ini menyajikan visualisasi data kadastral secara interaktif dan menjalankan validasi topologi otomatis di tingkat basis data.

---

## ✨ Fitur Utama

- **Digital Cadastral Viewer:** Tampilan poligon persil di atas peta citra satelit resolusi tinggi (ESRI World Imagery) terintegrasi layer vektor jalan.
- **Validasi Topologi Spasial Dua Arah (Symmetric ST_Intersects):** Mendeteksi irisan antarbidang tanah secara otomatis; jika terjadi sengketa batas, kedua bidang langsung dikunci dan ditandai merah.
- **Analisis Deviasi Luas Spheroid:** Menghitung luas permukaan bumi riil dalam meter persegi ($m^2$) menggunakan model spheroid PostGIS, membandingkannya dengan surat ukur fisik (toleransi deviasi $\le 2\%$).
- **Bento Dashboard & Cadastral Inspector:** Panel ringkasan metrik statistik bidang (Total NIB, Valid/K1, Perlu Verifikasi, Tumpang Tindih) serta rincian catatan juru ukur lapangan.

---

## 🛠️ Tumpukan Teknologi (Tech Stack)

- **Frontend:** Next.js (App Router), TypeScript, Tailwind CSS, Lucide React
- **Mesin Peta:** Leaflet, React-Leaflet, Tile Server ESRI & OpenStreetMap
- **Database & Spatial Engine:** PostgreSQL + PostGIS (Tipe `GEOGRAPHY`, WGS84) via Supabase
- **Keamanan Database:** Row Level Security (RLS) & Stored Functions (RPC) dengan mode `SECURITY INVOKER`
- **Deployment:** Vercel (CI/CD Production)

---

## 📖 Kamus Singkatan & Istilah Pertanahan

| Singkatan / Istilah | Kepanjangan | Penjelasan Singkat |
| :--- | :--- | :--- |
| **BPN** | Badan Pertanahan Nasional | Lembaga pemerintah nonkementerian yang mengelola urusan pertanahan di Indonesia. |
| **PTSL** | Pendaftaran Tanah Sistematis Lengkap | Program sertifikasi tanah massal serentak oleh pemerintah untuk seluruh objek pendaftaran tanah. |
| **NIB** | Nomor Identifikasi Bidang | Tanda pengenal unik (seperti NIK pada KTP) yang diberikan pada setiap bidang tanah. |
| **K1** | Klaster 1 | Status bidang tanah yang persyaratan fisik dan yuridisnya lengkap (*clean & clear*) sehingga siap diterbitkan sertifikat. |
| **WebGIS** | Web Geographic Information System | Sistem pemetaan dan analisis data geografis/kebumian yang diakses langsung melalui peramban web. |
| **PostGIS** | PostgreSQL Geospatial | Modul ekstensi untuk basis data PostgreSQL yang memungkinkannya mengolah data koordinat dan fungsi geometri/geografi. |
| **WGS84** | World Geodetic System 1984 | Standar referensi koordinat bumi global berbasis garis Lintang (*Latitude*) dan Bujur (*Longitude*) yang dipakai oleh sistem GPS. |
| **Spheroid** | Spheroid / Ellipsoid | Model bentuk bola bumi yang sedikit pepat di kutubnya; digunakan tipe `GEOGRAPHY` agar hitungan luas tanah presisi mengikuti lengkungan bumi tanpa terdistorsi. |
| **RLS** | Row Level Security | Fitur keamanan basis data untuk membatasi baris data mana yang boleh dibaca atau diubah oleh pengguna tertentu. |
| **RPC** | Remote Procedure Call | Pemanggilan fungsi yang tersimpan di dalam database (*stored procedure*) langsung dari kode web. |
| **PBT** | Peta Bidang Tanah | Gambar hasil pengukuran batas bidang-bidang tanah untuk keperluan pendaftaran tanah. |
| **BAP** | Berita Acara Pemeriksaan | Dokumen resmi pencatatan hasil verifikasi dan pengukuran lapangan oleh petugas juru ukur. |

---

## 🚀 Menjalankan Proyek Secara Lokal

1. **Clone repositori:**
   ```bash
   git clone [https://github.com/nesar123sbr/geotanah-deliserdang.git](https://github.com/nesar123sbr/geotanah-deliserdang.git)
   cd geotanah-deliserdang

2. **Install dependensi:**
   ```bash
   npm install

3. **Konfigurasi Environment Variables:**
   Buat file .env.local di root direktori:
   ```Code snippet
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

4. **Jalankan server pengembangan**
   ```Bash
   npm run dev
