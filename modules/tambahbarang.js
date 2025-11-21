const { getSaldoCollection } = require("./_saldoSelector");

module.exports = {
  name: "tambahbarang",

  async run(db, auditDate, isClosedStore, logMismatch) {
    console.log("🔍 [TAMBAH BARANG] Checking...");

    // Ambil barang yang baru masuk hari ini
    const barangBaru = await db.collection("tm_barang").find({
      tgl_last_beli: auditDate,
      kode_group: { $ne: "ACC" }  // selain aksesoris
    }).toArray();

    if (barangBaru.length === 0) {
      console.log("   ➤ Tidak ada barang baru hari ini.");
      return;
    }

    // Pilih saldo tt/th otomatis
    const saldoCol = getSaldoCollection(db, isClosedStore);

    for (const item of barangBaru) {
      const barcode = item.kode_barcode;

      // Query saldo (ambil yang terbaru jika ada banyak)
      const saldoQuery = isClosedStore
        ? { tanggal: auditDate, kode_barcode: barcode }
        : { kode_barcode: barcode };

      const saldo = await saldoCol.findOne(
        saldoQuery,
        { sort: { _id: -1 } }
      );

      // ❌ Jika tidak ditemukan sama sekali → mismatch
      if (!saldo) {
        logMismatch("tambahbarang", {
          kode_barcode: barcode,
          reason: "Saldo barang tidak ditemukan di tt/th_barang_saldo",
          expected: "Ada saldo untuk barcode ini"
        });
        continue;
      }

      // ✔ Jika saldo ada → valid, tidak cek stock_tambah, berat, dll
    }

    console.log("   ✔ Tambah Barang Audit Complete");
  }
};
