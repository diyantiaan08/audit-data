const { getSaldoCollection } = require("./_saldoSelector");

module.exports = {
  name: "penjualan",

  async run(db, auditDate, isClosedStore, logMismatch) {
    console.log("🔍 [PENJUALAN] Memulai pemeriksaan...");

    // Pilih saldo tt/th
    const saldoCol = getSaldoCollection(db, isClosedStore);

    // =====================================================================
    // Fungsi VALIDASI KAS (dengan perhitungan fee dari pembayaran)
    // =====================================================================
    async function validateCash(expected, detail, feePercent = 0) {
      // Hitung jumlah yang diharapkan di tt_cash_daily (sudah termasuk fee)
      let queryExpected = { ...expected };
      
      if (feePercent > 0 && expected.jumlah_in != null) {
        const feeAmount = (expected.jumlah_in * feePercent) / 100;
        queryExpected.jumlah_in = expected.jumlah_in + feeAmount;
      }

      const kas = await db.collection("tt_cash_daily").findOne(queryExpected);

      if (!kas) {
        return logMismatch("penjualan", {
          reason: "Data keuangan tidak ditemukan",
          expected: queryExpected,
          original_amount: expected.jumlah_in || expected.jumlah_out,
          fee_percent: feePercent,
          detail
        });
      }

      if (expected.jumlah_out != null && kas.jumlah_out !== expected.jumlah_out) {
        logMismatch("penjualan", {
          reason: "jumlah_out mismatch",
          expected: expected.jumlah_out,
          found: kas.jumlah_out,
          detail
        });
      }
    }

    // =====================================================================
    // 1️⃣ PENJUALAN NORMAL
    // =====================================================================
    const jualNormal = await db.collection("tt_jual_detail").aggregate([
      { $match: { tgl_system: auditDate } },

      // Sort baru → lama
      { $sort: { _id: -1 } },

      // Ambil dokumen terakhir per barcode
      {
        $group: {
          _id: "$kode_barcode",
          doc: { $first: "$$ROOT" }
        }
      },

      { $replaceRoot: { newRoot: "$doc" } },

      // Ambil hanya yang status valid & tidak batal
      { $match: { status_valid: "DONE", status_kembali: "OPEN" } }
    ]).toArray();


    // ================================
    // GROUPING PER FAKTUR GROUP
    // ================================
    const groupNormal = {};
    for (const j of jualNormal) {
      if (!groupNormal[j.no_faktur_group]) {
        groupNormal[j.no_faktur_group] = {
          detail: [],
          pembayaran: {}
        };
      }
      groupNormal[j.no_faktur_group].detail.push(j);

      // Sum pembayaran
      for (const pay of j.pembayaran) {
        if (!groupNormal[j.no_faktur_group].pembayaran[pay.jenis]) {
          groupNormal[j.no_faktur_group].pembayaran[pay.jenis] = 0;
        }
        groupNormal[j.no_faktur_group].pembayaran[pay.jenis] += pay.jumlah_rp;
      }
    }


    // ======================================================
    // FILTER: jika dalam satu no_faktur_group ada status_kembali = "CANC", SKIP
    // ======================================================
    for (const groupId of Object.keys(groupNormal)) {
      const hasCancel = await db.collection("tt_jual_detail").findOne({
        no_faktur_group: groupId,
        tgl_system: auditDate,
        status_kembali: "CANC"
      });

      if (hasCancel) {
        delete groupNormal[groupId];
      }
    }


    // ================================
    // VALIDASI PENJUALAN NORMAL
    // ================================
    for (const groupId of Object.keys(groupNormal)) {
      const g = groupNormal[groupId];

      // Validasi stok per barcode
      for (const d of g.detail) {
        const tm = await db.collection("tm_barang").findOne(
          {
            kode_barcode: d.kode_barcode,
            stock_on_hand: 0
          },
          { sort: { _id: -1 } }
        );

        if (!tm) {
          logMismatch("penjualan", {
            reason: "Barang masih ada stok di tm_barang",
            kode_barcode: d.kode_barcode,
            no_faktur_group: groupId
          });
        }

        // Validasi saldo terbaru
        const saldo = await saldoCol.findOne(
          {
            ...(isClosedStore ? { tanggal: auditDate } : {}),
            kode_barcode: d.kode_barcode
          },
          { sort: { _id: -1 } }
        );

        if (!saldo || saldo.stock_jual !== 1) {
          logMismatch("penjualan", {
            reason: "Saldo jual tidak valid",
            kode_barcode: d.kode_barcode,
            no_faktur_group: groupId
          });
        }
      }

      // Validasi kas dengan fee dari pembayaran
      for (const jenis of Object.keys(g.pembayaran)) {
        // Cari fee dari pembayaran di detail penjualan
        let feePercent = 0;
        for (const d of g.detail) {
          const paymentWithFee = d.pembayaran?.find(p => p.jenis === jenis && p.fee > 0);
          if (paymentWithFee) {
            feePercent = paymentWithFee.fee;
            break;
          }
        }

        await validateCash(
          {
            tanggal: auditDate,
            status: "OPEN",
            deskripsi: groupId,
            kategori: "B278C07EC8B1C1B57F",
            jenis,
            jumlah_in: g.pembayaran[jenis]
          },
          {
            jenis: "TRANSAKSI PENJUALAN",
            no_faktur_group: groupId,
            jenis_pembayaran: jenis,
            total_jumlah_rp: g.pembayaran[jenis]
          },
          feePercent
        );
      }
    }


    // =====================================================================
    // 2️⃣ BATAL PENJUALAN (ambil data terakhir per barcode)
    // =====================================================================
    const jualBatal = await db.collection("tt_jual_detail").aggregate([
      { $match: { tgl_system: auditDate } },
      { $sort: { _id: -1 } },
      {
        $group: {
          _id: "$kode_barcode",
          doc: { $first: "$$ROOT" }
        }
      },
      { $replaceRoot: { newRoot: "$doc" } },
      { $match: { status_valid: "DONE", status_kembali: "CANC" } }
    ]).toArray();

    const groupBatal = {};
    for (const j of jualBatal) {
      if (!groupBatal[j.no_faktur_group]) {
        groupBatal[j.no_faktur_group] = {
          totalHarga: 0,
          detail: [],
          pembayaran: {} // Tambahkan tracking pembayaran per jenis
        };
      }
      groupBatal[j.no_faktur_group].totalHarga += j.harga_total || 0;
      groupBatal[j.no_faktur_group].detail.push(j);

      // Sum pembayaran per jenis (untuk batal penjualan)
      for (const pay of j.pembayaran) {
        if (!groupBatal[j.no_faktur_group].pembayaran[pay.jenis]) {
          groupBatal[j.no_faktur_group].pembayaran[pay.jenis] = 0;
        }
        groupBatal[j.no_faktur_group].pembayaran[pay.jenis] += pay.jumlah_rp;
      }
    }

    // Validasi batal
    for (const groupId of Object.keys(groupBatal)) {
      const g = groupBatal[groupId];

      // Skip jika ada pembayaran dengan fee > 0
      let hasFee = false;
      for (const d of g.detail) {
        const paymentWithFee = d.pembayaran?.find(p => p.fee && p.fee > 0);
        if (paymentWithFee) {
          hasFee = true;
          break;
        }
      }

      if (hasFee) {
        continue; // Skip validasi untuk group ini
      }

      for (const d of g.detail) {
        const tm = await db.collection("tm_barang").findOne(
          {
            kode_barcode: d.kode_barcode,
            stock_on_hand: 1
          },
          { sort: { _id: -1 } }
        );

        if (!tm) {
          logMismatch("penjualan", {
            reason: "Barang batal penjualan tidak kembali ke stok",
            kode_barcode: d.kode_barcode,
            no_faktur_group: groupId
          });
        }

        const saldo = await saldoCol.findOne(
          {
            ...(isClosedStore ? { tanggal: auditDate } : {}),
            kode_barcode: d.kode_barcode
          },
          { sort: { _id: -1 } }
        );

        if (!saldo || saldo.stock_jual !== 0) {
          logMismatch("penjualan", {
            reason: "Saldo batal jual tidak sesuai",
            kode_barcode: d.kode_barcode,
            no_faktur_group: groupId
          });
        }
      }

      // Validasi kas per jenis pembayaran
      for (const jenis of Object.keys(g.pembayaran)) {
        await validateCash(
          {
            tanggal: auditDate,
            status: "OPEN",
            deskripsi: groupId,
            kategori: "A474C675BF90C5B97FB288B380B4BE",
            jenis,
            jumlah_out: g.pembayaran[jenis]
          },
          {
            jenis: "BATAL PENJUALAN",
            no_faktur_group: groupId,
            jenis_pembayaran: jenis,
            total_harga: g.pembayaran[jenis]
          }
        );
      }
    }

    console.log("   ✔ Pemeriksaan Penjualan selesai.");
  }
};
