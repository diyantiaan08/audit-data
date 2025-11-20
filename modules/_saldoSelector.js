/**
 * ============================================================
 *  saldoSelector.js
 *  Memilih collection saldo berdasarkan status tutup toko
 *  Jika toko belum tutup → gunakan: tt_barang_saldo
 *  Jika toko sudah tutup → gunakan: th_barang_saldo
 * ============================================================
 */

module.exports = {
  /**
   * Mengembalikan collection saldo
   * @param {Db} db - Koneksi database MongoDB
   * @param {Boolean} isClosedStore - True jika tgl_system != hari ini
   * @returns {Collection} tt_barang_saldo atau th_barang_saldo
   */
  getSaldoCollection(db, isClosedStore) {
    const colName = isClosedStore
      ? "th_barang_saldo"
      : "tt_barang_saldo";

    return db.collection(colName);
  },

  /**
   * Membuat query saldo berdasarkan status tutup toko
   * @param {String} auditDate - Tanggal audit (YYYY-MM-DD)
   * @param {String} kode_barcode - Barcode
   * @param {Boolean} isClosedStore - Status tutup toko
   */
  buildSaldoQuery(auditDate, kode_barcode, isClosedStore) {
    if (isClosedStore) {
      return {
        tanggal: auditDate,
        kode_barcode
      };
    }

    return {
      kode_barcode
    };
  }
};
