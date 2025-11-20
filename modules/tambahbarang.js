const { getSaldoCollection } = require("./_saldoSelector");

module.exports = {
  name: "tambahbarang",

  async run(db, auditDate, isClosedStore, logMismatch) {
    console.log("🔍 [TAMBAH BARANG] Checking...");

    // Ambil data tm_barang yang ditambahkan hari ini (tgl_last_beli)
    const barangBaru = await db.collection("tm_barang").find({
      tgl_last_beli: auditDate,
      kode_group: { $ne: "ACC" }   // selain aksesoris
    }).toArray();

    if (barangBaru.length === 0) {
      console.log("   ➤ Tidak ada barang baru hari ini.");
      return;
    }

    // Tentukan saldo collection (tt atau th)
    const saldoCol = await getSaldoCollection(db, isClosedStore);

    for (const item of barangBaru) {
      const barcode = item.kode_barcode;

      // Query saldo yang benar
      const saldoQuery = isClosedStore
        ? { tanggal: auditDate, kode_barcode: barcode }
        : { kode_barcode: barcode };

      const saldo = await saldoCol.findOne(saldoQuery, { sort: { _id: -1 } });

      if (!saldo) {
        logMismatch("tambahbarang", {
          kode_barcode: barcode,
          reason: "Saldo tidak ditemukan untuk barang baru",
          isClosedStore,
          expected: {
            stock_tambah: 1
          }
        });
        continue;
      }

      // Validasi stock_tambah = 1
      if (saldo.stock_tambah !== 1) {
        logMismatch("tambahbarang", {
          kode_barcode: barcode,
          reason: "stock_tambah tidak sesuai",
          expected: 1,
          actual: saldo.stock_tambah,
          saldo
        });
      }

      // ============================================================
      // VALIDASI TAMBAHAN: 
      // berat_tambah harus sama dengan berat di tm_barang
      // ============================================================
      if (Math.abs((saldo.berat_tambah || 0) - (item.berat || 0)) > 0.001) {
        logMismatch("tambahbarang", {
          kode_barcode: barcode,
          reason: "berat_tambah tidak sesuai dengan tm_barang",
          expected: item.berat,
          actual: saldo.berat_tambah,
          saldo
        });
      }
    }

    console.log("   ✔ Tambah Barang Audit Complete");
  }
};
