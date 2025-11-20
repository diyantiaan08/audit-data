const { getSaldoCollection } = require("./_saldoSelector");
const { doEncrypt } = require("../lib/encryption");

module.exports = {
  name: "titipan",

  run: async (db, auditDate, isClosedStore, logMismatch) => {
    console.log("🔍 [TITIPAN] Memulai pemeriksaan...");

    const saldoCol = getSaldoCollection(db, isClosedStore);

    // ======================================================
    // Fungsi validasi kas
    // ======================================================
    async function validateCash(expected, detail) {
      const kas = await db.collection("tt_cash_daily").findOne(expected);

      if (!kas) {
        logMismatch("titipan", {
          reason: "Data keuangan tidak ditemukan",
          expected,
          detail
        });
        return;
      }

      if (expected.jumlah_in != null && kas.jumlah_in !== expected.jumlah_in) {
        logMismatch("titipan", {
          reason: "jumlah_in tidak sesuai",
          expected: expected.jumlah_in,
          found: kas.jumlah_in,
          detail
        });
      }

      if (expected.jumlah_out != null && kas.jumlah_out !== expected.jumlah_out) {
        logMismatch("titipan", {
          reason: "jumlah_out tidak sesuai",
          expected: expected.jumlah_out,
          found: kas.jumlah_out,
          detail
        });
      }
    }

    // ======================================================
    // 0️⃣ GET SEMUA DATA TT_TITIP → pilih yang terbaru per barcode
    // ======================================================
    const allTitip = await db.collection("tt_titip")
      .find({ tgl_system: auditDate })
      .sort({ _id: -1 })
      .toArray();

    if (allTitip.length === 0) {
      console.log("   ➤ Tidak ada data titipan hari ini.");
      return;
    }

    // Ambil dokumen terbaru per barcode
    const latest = {};
    for (const row of allTitip) {
      if (!latest[row.kode_barcode]) {
        latest[row.kode_barcode] = row;  // karena sorted -1
      }
    }

    // Hanya proses dokumen terbaru per barcode
    const titipFinalList = Object.values(latest);

    // ======================================================
    // 1️⃣ TITIPAN MASUK (OPEN)
    // ======================================================
    for (const tt of titipFinalList) {
      if (tt.status_valid === "CLOSE" && tt.status_titipan === "OPEN") {

        for (const pay of tt.pembayaran || []) {
          await validateCash(
            {
              tanggal: tt.tgl_system,
              status: "OPEN",
              deskripsi: tt.no_titip_group,
              kategori: {
                $in: [
                  "B67CC67DC3B1C3",      // kategori lama
                  "B674BF76B4B895B8818887BB88BCC0" // kategori baru
                ]
              },
              jenis: doEncrypt(pay.jenis),
              jumlah_in: pay.jumlah_rp
            },
            {
              jenis: "TITIPAN MASUK",
              no_titip_group: tt.no_titip_group,
              jenis_pembayaran: pay.jenis,
              jumlah_rp: pay.jumlah_rp
            }
          );
        }
      }
    }

    // ======================================================
    // 2️⃣ BATAL TITIP
    // ======================================================
    for (const tt of titipFinalList) {
      if (
        tt.status_valid === "CLOSE" &&
        tt.status_titipan === "CLOSE" &&
        tt.tgl_batal_titip === auditDate
      ) {
        // Cek tm_barang kembali ke stok
        const tm = await db.collection("tm_barang").findOne(
          {
            kode_barcode: tt.kode_barcode,
            kode_gudang: { $ne: "TITIP" },
            kode_toko: { $ne: "TITIP" }
          },
          { sort: { _id: -1 } }
        );

        if (!tm) {
          logMismatch("titipan", {
            reason: "Barang belum kembali ke stok di tm_barang",
            kode_barcode: tt.kode_barcode
          });
        }

        // Cek saldo
        const saldo = await saldoCol.findOne(
          {
            ...(isClosedStore ? { tanggal: tt.tgl_batal_titip } : {}),
            kode_barcode: tt.kode_barcode
          },
          { sort: { _id: -1 } }
        );

        if (!saldo) {
          logMismatch("titipan", {
            reason: "Saldo barang batal titip tidak ditemukan",
            kode_barcode: tt.kode_barcode
          });
        }

        // Cek kas
        await validateCash(
          {
            tanggal: tt.tgl_batal_titip,
            status: "OPEN",
            deskripsi: tt.no_titip_group,
            kategori: "A474C675BF90C9BD85B183",
            jumlah_out: tt.dp
          },
          {
            jenis: "BATAL TITIP",
            no_titip_group: tt.no_titip_group,
            dp: tt.dp
          }
        );
      }
    }

    // // ======================================================
    // // 3️⃣ AMBIL TITIPAN (FINISH)
    // // ======================================================
    // for (const tt of titipFinalList) {
    //   if (
    //     tt.status_valid === "CLOSE" &&
    //     tt.status_titipan === "FINISH"
    //   ) {
    //     const jual = await db.collection("tt_jual_detail").findOne({
    //       tgl_system: tt.tgl_system,
    //       kode_barcode: tt.kode_barcode
    //     });

    //     if (!jual) {
    //       logMismatch("titipan", {
    //         reason: "Transaksi penjualan tidak ditemukan untuk ambil titip",
    //         kode_barcode: tt.kode_barcode
    //       });
    //       continue;
    //     }

    //     // tm_barang harus 0 stok
    //     const tm = await db.collection("tm_barang").findOne({
    //       kode_barcode: tt.kode_barcode,
    //       stock_on_hand: 0
    //     });

    //     if (!tm) {
    //       logMismatch("titipan", {
    //         reason: "Barang masih ada di stok tm_barang setelah ambil titip",
    //         kode_barcode: tt.kode_barcode
    //       });
    //     }

    //     // saldo jual
    //     const saldo = await saldoCol.findOne({
    //       ...(isClosedStore ? { tanggal: tt.tgl_system } : {}),
    //       kode_barcode: tt.kode_barcode
    //     });

    //     if (!saldo || !(saldo.stock_jual > 0)) {
    //       logMismatch("titipan", {
    //         reason: "Saldo jual tidak sesuai untuk ambil titip",
    //         kode_barcode: tt.kode_barcode
    //       });
    //     }

    //     // validasi kas penjualan
    //     for (const pay of jual.pembayaran || []) {
    //       await validateCash(
    //         {
    //           tanggal: jual.tgl_system,
    //           status: "OPEN",
    //           deskripsi: jual.no_faktur_group,
    //           kategori: "B278C07EC8B1C1B57F",
    //           jenis: pay.jenis,
    //           jumlah_in: pay.jumlah_rp
    //         },
    //         {
    //           jenis: "AMBIL TITIP",
    //           kode_barcode: tt.kode_barcode,
    //           no_faktur_group: jual.no_faktur_group,
    //           jenis_pembayaran: pay.jenis,
    //           jumlah_rp: pay.jumlah_rp
    //         }
    //       );
    //     }
    //   }
    // }

    console.log("   ✔ Pemeriksaan Titipan selesai.");
  }
};
