const { getSaldoCollection } = require("./_saldoSelector");

module.exports = {
  name: "penjualan",

  async run(db, auditDate, isClosedStore, logMismatch) {
    console.log("🔍 [PENJUALAN] Memulai pemeriksaan...");

    // Pilih saldo tt/th
    const saldoCol = getSaldoCollection(db, isClosedStore);

    // =====================================================================
    // Fungsi VALIDASI KAS
    // =====================================================================
    async function validateCash(expected, detail) {
      const kas = await db.collection("tt_cash_daily").findOne(expected);

      if (!kas) {
        return logMismatch("penjualan", {
          reason: "Data keuangan tidak ditemukan",
          expected,
          detail
        });
      }

      if (expected.jumlah_in != null && kas.jumlah_in !== expected.jumlah_in) {
        logMismatch("penjualan", {
          reason: "jumlah_in mismatch",
          expected: expected.jumlah_in,
          found: kas.jumlah_in,
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

      // Validasi kas
      for (const jenis of Object.keys(g.pembayaran)) {
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
          }
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
          detail: []
        };
      }
      groupBatal[j.no_faktur_group].totalHarga += j.harga_total || 0;
      groupBatal[j.no_faktur_group].detail.push(j);
    }

    // Validasi batal
    for (const groupId of Object.keys(groupBatal)) {
      const g = groupBatal[groupId];

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

      await validateCash(
        {
          tanggal: auditDate,
          status: "OPEN",
          deskripsi: groupId,
          kategori: "A474C675BF90C5B97FB288B380B4BE",
          jumlah_out: g.totalHarga
        },
        {
          jenis: "BATAL PENJUALAN",
          no_faktur_group: groupId,
          total_harga: g.totalHarga
        }
      );
    }

    console.log("   ✔ Pemeriksaan Penjualan selesai.");
  }
};
