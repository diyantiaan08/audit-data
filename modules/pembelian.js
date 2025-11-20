/**
 * ============================================
 *  MODULE PEMBELIAN (FINAL BARCODE LAST ONLY)
 * ============================================
 */

const { doEncrypt } = require("../lib/encryption");

module.exports = {
  name: "pembelian",

  async run(db, auditDate, isClosedStore, logMismatch) {
    console.log("🔍 [PEMBELIAN] Memulai pemeriksaan (FINAL)…");

    // ======================================================
    // Fungsi Validasi Kas
    // ======================================================
    async function validateCash(expected, extra) {
      const kas = await db.collection("tt_cash_daily").findOne(expected);

      if (!kas) {
        return logMismatch("pembelian", {
          reason: "Kas tidak ditemukan",
          expected,
          ...extra
        });
      }

      if (expected.jumlah_in != null && kas.jumlah_in !== expected.jumlah_in) {
        logMismatch("pembelian", {
          reason: "jumlah_in mismatch",
          expected: expected.jumlah_in,
          found: kas.jumlah_in,
          ...extra
        });
      }

      if (expected.jumlah_out != null && kas.jumlah_out !== expected.jumlah_out) {
        logMismatch("pembelian", {
          reason: "jumlah_out mismatch",
          expected: expected.jumlah_out,
          found: kas.jumlah_out,
          ...extra
        });
      }
    }

    // ======================================================
    // 1️⃣ AMBIL PEMBELIAN TERBARU PER BARCODE
    // ======================================================
    const beliFinal = await db.collection("tt_beli_detail").aggregate([
      { $match: { tgl_system: auditDate } },

      { $sort: { _id: -1 } }, // terbaru dulu

      {
        $group: {
          _id: "$kode_barcode",
          doc: { $first: "$$ROOT" } // ambil dokumen pembelian terbaru per barcode
        }
      },

      { $replaceRoot: { newRoot: "$doc" } }
    ]).toArray();

    // ==============================
    // 1A. IDENTIFIKASI SEMUA GROUP YANG ADA CANCEL (dari semua data di tanggal audit)
    // ==============================
    const allCancelGroups = await db.collection("tt_beli_detail").distinct("no_faktur_group", {
      tgl_system: auditDate,
      status_valid: "CANC"
    });
    
    const groupsWithCancel = new Set(allCancelGroups);

    // ==============================
    // 2️⃣ PISAHKAN DONE DAN CANCEL (dari data terbaru per barcode)
    // ==============================
    const doneList = beliFinal.filter((x) => x.status_valid === "DONE");
    const cancelList = beliFinal.filter((x) => x.status_valid === "CANC");

    // ==============================
    // 3️⃣ VALIDASI PEMBELIAN DONE (SKIP JIKA ADA CANCEL DALAM GROUP)
    // ==============================
    
    // Group per no_faktur_group dan sum harga
    const doneGroupMap = {};
    
    for (const trx of doneList) {
      // SKIP jika group ini memiliki cancel
      if (groupsWithCancel.has(trx.no_faktur_group)) {
        continue;
      }
      // --- 3A. VALIDASI status_tukar (hanya jika ada data jual) ---
      if (trx.kode_barcode !== "-") {
        const jualLast = await db.collection("tt_jual_detail").find({
          kode_barcode: trx.kode_barcode,
          tgl_system: trx.tgl_system
        })
        .sort({ _id: -1 })
        .limit(1)
        .toArray();

        // Jika ada data jual → cek status_tukar
        if (jualLast.length > 0 && jualLast[0].status_tukar !== true) {
          logMismatch("pembelian", {
            reason: "Pembelian DONE tetapi status_tukar != TRUE",
            kode_barcode: trx.kode_barcode,
            expected: true,
            found: jualLast[0].status_tukar
          });
        }
        // Jika tidak ada data jual → skip (no mismatch)
      }

      // Grouping per no_faktur_group
      const groupKey = trx.no_faktur_group;
      if (!doneGroupMap[groupKey]) {
        doneGroupMap[groupKey] = {
          totalHarga: 0,
          fakturs: []
        };
      }
      doneGroupMap[groupKey].totalHarga += trx.harga || 0;
      doneGroupMap[groupKey].fakturs.push(trx.no_faktur_beli);
    }

    // --- 3B. VALIDASI KAS PER NO_FAKTUR_GROUP (sum harga) ---
    for (const [groupKey, groupData] of Object.entries(doneGroupMap)) {
      await validateCash(
        {
          tanggal: auditDate,
          status: "OPEN",
          deskripsi: groupKey,
          kategori: "B278BF76B8BCBEB57F",
          jumlah_out: groupData.totalHarga
        },
        {
          jenis: "PEMBELIAN DONE",
          no_faktur_group: groupKey,
          no_faktur_beli_list: groupData.fakturs,
          totalHarga: groupData.totalHarga
        }
      );
    }

    // ==============================
    // 4️⃣ VALIDASI PEMBATALAN PEMBELIAN
    // ==============================
    for (const trx of cancelList) {
      // --- 4A. VALIDASI status_tukar (hanya jika ada data jual) ---
      if (trx.kode_barcode !== "-") {
        const jualLast = await db.collection("tt_jual_detail").find({
          kode_barcode: trx.kode_barcode,
          tgl_system: trx.tgl_system
        })
        .sort({ _id: -1 })
        .limit(1)
        .toArray();

        // Jika ada data jual → cek status_tukar
        if (jualLast.length > 0 && jualLast[0].status_tukar !== false) {
          logMismatch("pembelian", {
            reason: "Batal pembelian tetapi status_tukar != FALSE",
            kode_barcode: trx.kode_barcode,
            expected: false,
            found: jualLast[0].status_tukar
          });
        }
        // Jika tidak ada data jual → skip (no mismatch)
      }

      // --- 4B. VALIDASI KAS BATAL (jumlah_in = harga) ---
      await validateCash(
        {
          tanggal: auditDate,
          status: "OPEN",
          deskripsi: trx.no_faktur_beli, // ← batal pakai no_faktur_beli
          kategori: "A474C675BF90B7B97DB1",
          jumlah_in: trx.harga
        },
        {
          jenis: "BATAL PEMBELIAN",
          no_faktur_beli: trx.no_faktur_beli,
          harga: trx.harga
        }
      );
    }

    // ==============================
    // 5️⃣ VALIDASI HANCUR PEMBELIAN
    // ==============================
    const beliHancur = beliFinal.filter((x) => x.status_hancur === true);

    for (const trx of beliHancur) {
      const found = await db.collection("tt_hancur_saldo_beli").findOne(
        {
          tgl_system: auditDate,
          kode_dept: trx.kode_dept
        },
        { sort: { _id: -1 } }
      );

      if (!found) {
        logMismatch("pembelian", {
          reason: "Pembelian hancur tidak tercatat di tt_hancur_saldo_beli",
          kode_barcode: trx.kode_barcode,
          kode_dept: trx.kode_dept
        });
      }
    }

    console.log("   ✔ Pembelian selesai divalidasi (FINAL)");
  }
};
