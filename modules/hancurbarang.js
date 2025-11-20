const { getSaldoCollection } = require("./_saldoSelector");

module.exports = {
  name: "hancurbarang",

  // FORMAT BENAR → compat dgn engine
  run: async (db, auditDate, isClosedStore, logMismatch) => {
    console.log("🔍 [HANCUR BARANG] Checking...");

    // ============================================================
    // 1️⃣ Ambil semua transaksi hancur di tanggal audit
    // ============================================================
    const hancurList = await db.collection("tt_hancur_detail").find({
      tgl_system: auditDate,
      kode_group: { $ne: "ACC" }   
    }).toArray();

    if (hancurList.length === 0) {
      console.log("   ➤ Tidak ada data hancur hari ini.");
      return;
    }

    // Koleksi saldo (tt_barang_saldo atau th_barang_saldo)
    const saldoCol = getSaldoCollection(db, isClosedStore);

    // ============================================================
    // 2️⃣ Loop setiap transaksi hancur
    // ============================================================
    for (const h of hancurList) {
      const barcode = h.kode_barcode;
      const beratHancur = h.berat || 0;

      // ============================================================
      // 3️⃣ Validasi di tm_barang (harus sudah stock_on_hand = 0 dan status_hancur = true)
      // ============================================================
      const tm = await db.collection("tm_barang").findOne(
        { kode_barcode: barcode },
        { sort: { _id: -1 } }
      );

      if (!tm) {
        logMismatch("hancurbarang", {
          kode_barcode: barcode,
          reason: "tm_barang tidak ditemukan"
        });
        continue;
      }

      // tm_barang HARUS berubah status setelah dihancurkan
      if (tm.status_hancur !== true || tm.stock_on_hand !== 0) {
        logMismatch("hancurbarang", {
          kode_barcode: barcode,
          reason: "tm_barang tidak sesuai (status_hancur/stock_on_hand tidak benar)",
          expected: {
            status_hancur: true,
            stock_on_hand: 0
          },
          found: {
            status_hancur: tm.status_hancur,
            stock_on_hand: tm.stock_on_hand
          }
        });
      }

      // ============================================================
      // 4️⃣ Validasi saldo (tt/th barang saldo)
      // ============================================================
      const saldoQuery = isClosedStore
        ? { tanggal: auditDate, kode_barcode: barcode }
        : { kode_barcode: barcode };

      const saldo = await saldoCol.findOne(saldoQuery, { sort: { _id: -1 } });

      if (!saldo) {
        logMismatch("hancurbarang", {
          kode_barcode: barcode,
          reason: "saldo tidak ditemukan (tt/th_barang_saldo)",
          isClosedStore
        });
        continue;
      }

      // ============================================================
      // 5️⃣ Validasi field saldo
      // ============================================================
      const fail =
        !(saldo.stock_hancur > 0) ||                                            // harus ada stock_hancur
        Math.abs((saldo.berat_hancur || 0) - beratHancur) > 0.001 ||            // berat mismatch
        saldo.stock_akhir !== 0 ||                                             // barang harus keluar dari stok
        saldo.berat_akhir !== 0;

      if (fail) {
        logMismatch("hancurbarang", {
          kode_barcode: barcode,
          reason: "saldo mismatch",
          expected: {
            stock_hancur: ">0",
            berat_hancur: beratHancur,
            stock_akhir: 0,
            berat_akhir: 0
          },
          found: saldo
        });
      }
    }

    console.log("   ✔ Hancur Barang Audit Complete");
  }
};
