const { getSaldoCollection } = require("./_saldoSelector");

module.exports = {
  name: "pindahbarang",

  async run(db, auditDate, isClosedStore, logMismatch) {
    console.log("🔍 [PINDAH BARANG] Memulai pemeriksaan...");

    // ============================================================
    // Ambil hanya dokumen pindah terakhir per barcode
    // ============================================================
    const pindahList = await db.collection("tt_pindah_detail").aggregate([
      {
        $match: {
          tgl_system: auditDate,
          kode_group: { $ne: "ACC" }
        }
      },
      {
        $sort: {
          input_date: -1,   // urutan terbaru
          _id: -1           // fallback jika tidak ada input_date
        }
      },
      {
        $group: {
          _id: "$kode_barcode",
          latest: { $first: "$$ROOT" }
        }
      },
      { $replaceRoot: { newRoot: "$latest" } }
    ]).toArray();

    if (pindahList.length === 0) {
      console.log("   ➤ Tidak ada data pindah barang pada tanggal ini.");
      return;
    }

    // Tentukan saldo yang dipakai (tt_barang_saldo / th_barang_saldo)
    const saldoCol = await getSaldoCollection(db, isClosedStore);

    // ============================================================
    // Mulai validasi per record terbaru
    // ============================================================
    for (const p of pindahList) {
      const barcode = p.kode_barcode;
      const berat = p.berat || 0;

      // 1. Validasi lokasi tm_barang
      const tm = await db.collection("tm_barang").findOne(
        {
          kode_barcode: barcode,
          kode_gudang: p.kode_gudang,
          kode_toko: p.kode_baki
        },
        { sort: { _id: -1 } }
      );

      if (!tm) {
        logMismatch("pindahbarang", {
          kode_barcode: barcode,
          reason: "Lokasi di tm_barang tidak sesuai dengan tujuan pindah.",
          expected: {
            kode_gudang: p.kode_gudang,
            kode_toko: p.kode_baki
          }
        });
      }

      // 2. Validasi saldo baki ASAL
      const saldoOutQuery = isClosedStore
        ? { tanggal: auditDate, kode_barcode: barcode, kode_toko: p.kode_baki_asal }
        : { kode_barcode: barcode, kode_toko: p.kode_baki_asal };

      const saldoOut = await saldoCol.findOne(saldoOutQuery, { sort: { _id: -1 } });

      const outMismatch =
        !saldoOut ||
        !(saldoOut.stock_out > 0) ||
        Math.abs((saldoOut.berat_out || 0) - berat) > 0.001 ||
        saldoOut.stock_akhir !== 0 ||
        saldoOut.berat_akhir !== 0;

      if (outMismatch) {
        logMismatch("pindahbarang", {
          kode_barcode: barcode,
          reason: "Saldo baki asal (OUT) tidak sesuai.",
          found: saldoOut || null
        });
      }

      // -----------------------------------------
      // 3. Validasi saldo baki TUJUAN (IN)
      // -----------------------------------------
      const saldoInQuery = isClosedStore
        ? { tanggal: auditDate, kode_barcode: barcode, kode_toko: p.kode_baki }
        : { kode_barcode: barcode, kode_toko: p.kode_baki };

      const saldoIn = await saldoCol.findOne(saldoInQuery, { sort: { _id: -1 } });

      // Jika saldo tidak ditemukan → mismatch
      if (!saldoIn) {
        logMismatch("pindahbarang", {
          kode_barcode: barcode,
          reason: "Saldo baki tujuan tidak ditemukan.",
          query: saldoInQuery
        });
        continue;
      }

      // ================================
      //  SKIP KARNA STATUS BARANG SUDAH BERUBAH SETELAH PINDAH
      // ================================
      if (
        (saldoIn.stock_jual && saldoIn.stock_jual > 0) ||
        (saldoIn.stock_hancur && saldoIn.stock_hancur > 0) ||
        (saldoIn.stock_out && saldoIn.stock_out > 0)
      ) {
        // Barang sudah diproses status lain → saldo pindah tidak perlu diverifikasi
        continue;
      }

      // ================================
      //  Validasi saldo IN jika benar-benar status pindah terakhir
      // ================================
      const inMismatch =
        !(saldoIn.stock_in > 0) ||
        Math.abs((saldoIn.berat_in || 0) - berat) > 0.001 ||
        saldoIn.stock_akhir !== 1 ||
        Math.abs((saldoIn.berat_akhir || 0) - berat) > 0.001;

      if (inMismatch) {
        logMismatch("pindahbarang", {
          kode_barcode: barcode,
          reason: "Saldo baki tujuan tidak sesuai.",
          expected: {
            stock_in: ">0",
            berat_in: berat,
            stock_akhir: 1,
            berat_akhir: berat
          },
          found: saldoIn
        });
      }
    }

    console.log("   ✔ Pemeriksaan Pindah Barang selesai.");
  }
};
