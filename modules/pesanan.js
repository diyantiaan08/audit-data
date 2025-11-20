const { getSaldoCollection } = require("./_saldoSelector");
const { doEncrypt } = require("../lib/encryption");

module.exports = {
  name: "pesanan",

  async run(db, auditDate, isClosedStore, logMismatch) {
    console.log("🔍 [PESANAN] Memulai pemeriksaan...");

    // gunakan isClosedStore dari index.js (JANGAN override)
    const saldoCol = await getSaldoCollection(db, isClosedStore);

    // ======================================================
    // Fungsi validasi kas
    // ======================================================
    async function validateCash(expected, detail) {
      const kas = await db.collection("tt_cash_daily").findOne(expected);

      if (!kas) {
        logMismatch("pesanan", {
          reason: "Data keuangan tidak ditemukan",
          expected,
          detail
        });
        return;
      }

      if (expected.jumlah_in != null && kas.jumlah_in !== expected.jumlah_in) {
        logMismatch("pesanan", {
          reason: "jumlah_in tidak sesuai",
          expected: expected.jumlah_in,
          found: kas.jumlah_in,
          detail
        });
      }

      if (expected.jumlah_out != null && kas.jumlah_out !== expected.jumlah_out) {
        logMismatch("pesanan", {
          reason: "jumlah_out tidak sesuai",
          expected: expected.jumlah_out,
          found: kas.jumlah_out,
          detail
        });
      }
    }

    // ======================================================
    // 1️⃣ PESANAN MASUK (DP)
    // ======================================================
    const pesananMasuk = await db.collection("tt_pesanan").find({
      tanggal: auditDate,
      status_validasi: "CLOSE",
      status_pesanan: "OPEN"
    }).toArray();

    for (const ps of pesananMasuk) {
      for (const pay of ps.pembayaran) {

        // 🆕 Tambahan syarat:
        // Pembayaran DIHARUSKAN punya property deskripsi = "A474CB75C590B9C4"
        if (!("deskripsi" in pay)) continue;
        if (pay.deskripsi !== "A474CB75C590B9C4") continue;

        await validateCash(
          {
            tanggal: ps.tanggal,
            status: "OPEN",
            deskripsi: ps.no_pesanan,
            kategori: "B278C575C1B1C3",  // kategori DP pesanan
            jenis: pay.jenis,
            jumlah_in: pay.jumlah_rp
          },
          {
            jenis: "PESANAN MASUK",
            no_pesanan: ps.no_pesanan,
            jenis_pembayaran: pay.jenis,
            jumlah_rp: pay.jumlah_rp
          }
        );
      }
    }

    // ======================================================
    // 2️⃣ PESANAN SELESAI (VERSI SIMPLE SESUAI PERMINTAAN)
    // ======================================================
    const pesananSelesai = await db.collection("tt_pesanan").find({
      tanggal: auditDate,
      status_pesanan: "DONE"
    }).toArray();

    for (const ps of pesananSelesai) {
      // 1. Cari semua barang pesanan berdasarkan no_pesanan
      const barang = await db.collection("tm_barang").find({
        no_pesanan: ps.no_pesanan
      }).toArray();

      // Kalau tidak ada barang sama sekali → mismatch
      if (barang.length === 0) {
        logMismatch("pesanan", {
          no_pesanan: ps.no_pesanan,
          reason: "Barang pesanan tidak ditemukan di tm_barang"
        });
        continue;
      }

      // 2. Cek saldo untuk setiap barcode barang pesanan
      for (const b of barang) {
        const saldo = await saldoCol.findOne(
          {
            ...(isClosedStore ? { tanggal: auditDate } : {}),
            kode_barcode: b.kode_barcode
          },
          { sort: { _id: -1 } }
        );

        // Kalau saldo tidak ditemukan sama sekali → mismatch
        if (!saldo) {
          logMismatch("pesanan", {
            no_pesanan: ps.no_pesanan,
            kode_barcode: b.kode_barcode,
            reason: "Saldo tidak ditemukan untuk barang pesanan"
          });
        }
      }
    }

    // ======================================================
    // 3️⃣ AMBIL PESANAN
    // ======================================================
    const pesananAmbil = await db.collection("tt_pesanan").find({
      tanggal: auditDate,
      status_pesanan: "FINISH"
    }).toArray();

    for (const ps of pesananAmbil) {
      const tm = await db.collection("tm_barang").findOne(
        {
          no_pesanan: ps.no_pesanan,
          stock_on_hand: 0
        },
        { sort: { _id: -1 } }
      );

      if (!tm) {
        logMismatch("pesanan", {
          no_pesanan: ps.no_pesanan,
          reason: "Barang belum hilang dari tm_barang"
        });
      }

      const jual = await db.collection("tt_jual_detail").findOne(
        {
          no_pesanan: ps.no_pesanan,
          status_valid: "DONE",
          status_kembali: "OPEN"
        },
        { sort: { _id: -1 } }
      );

      if (!jual) {
        logMismatch("pesanan", {
          no_pesanan: ps.no_pesanan,
          reason: "Transaksi penjualan tidak ditemukan"
        });
        continue;
      }

      const saldo = await saldoCol.findOne(
        {
          ...(isClosedStore ? { tanggal: jual.tgl_system } : {}),
          kode_barcode: tm.kode_barcode
        },
        { sort: { _id: -1 } }
      );

      if (!saldo || saldo.stock_jual !== 1 || saldo.stock_akhir !== 0) {
        logMismatch("pesanan", {
          no_pesanan: ps.no_pesanan,
          kode_barcode: tm.kode_barcode,
          reason: "Saldo jual tidak sesuai"
        });
      }

      for (const pay of jual.pembayaran) {
        await validateCash(
          {
            tanggal: jual.tgl_system,
            status: "OPEN",
            deskripsi: jual.no_faktur_group,
            kategori: "B278C07EC8B1C1B57F",
            jenis: pay.jenis,
            jumlah_in: pay.jumlah_rp
          },
          {
            jenis: "AMBIL PESANAN",
            no_pesanan: ps.no_pesanan,
            jenis_pembayaran: pay.jenis,
            jumlah_rp: pay.jumlah_rp
          }
        );
      }
    }

    // ======================================================
    // 4️⃣ BATAL PESANAN
    // ======================================================
    const pesananBatal = await db.collection("tt_pesanan").find({
      tanggal: auditDate,
      status_validasi: "CLOSE",
      status_pesanan: "CLOSE"
    }).toArray();

    for (const ps of pesananBatal) {

      // 🆕 Skip jika pembayaran kosong atau tidak ada array pembayaran
      if (!ps.pembayaran || ps.pembayaran.length === 0) {
        console.log(`   ➤ BATAL PESANAN tanpa pembayaran — skip kas (${ps.no_pesanan})`);
        continue;
      }

      await validateCash(
        {
          tanggal: ps.tanggal,
          status: "OPEN",
          deskripsi: ps.no_pesanan,
          kategori: "A474C675BF90C5B984A981B382",
          jumlah_out: ps.jumlah_bayar
        },
        {
          jenis: "BATAL PESANAN",
          no_pesanan: ps.no_pesanan,
          jumlah_bayar: ps.jumlah_bayar
        }
      );
    }


    // ======================================================
    // 5️⃣ TAMBAH DP PESANAN
    // ======================================================
    const pesananUntukTambahDP = await db.collection("tt_pesanan").find({
      tanggal: auditDate
    }).toArray();

    for (const ps of pesananUntukTambahDP) {
      for (const pay of ps.pembayaran) {

        // 💡 Syarat baru:
        // Ambil pembayaran TAMBAH DP jika TIDAK ada property `deskripsi`
        if (!("deskripsi" in pay)) {

          await validateCash(
            {
              tanggal: ps.tanggal,
              status: "OPEN",
              deskripsi: ps.no_pesanan,
              kategori: "B674BF76B4B895B8818883B787B4BEB6C2",
              jenis: doEncrypt(pay.jenis),
              // jenis: pay.jenis,
              jumlah_in: pay.jumlah_rp
            },
            {
              jenis: "TAMBAH DP PESANAN",
              no_pesanan: ps.no_pesanan,
              jenis_pembayaran: pay.jenis,
              jumlah_rp: pay.jumlah_rp
            }
          );
        }
      }
    }

    console.log("   ✔ Pemeriksaan Pesanan selesai.");
  }
};
