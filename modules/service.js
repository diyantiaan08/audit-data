const { doEncrypt } = require("../lib/encryption");

module.exports = {
  name: "service",

  async run(db, auditDate, isClosedStore, logMismatch) {
    console.log("🔍 [SERVICE] Memulai pemeriksaan...");

    // ======================================================
    // Fungsi pengecekan kas berdasarkan kriteria tertentu
    // ======================================================
    async function validateCash(expected, dataInfo) {
      const kas = await db.collection("tt_cash_daily").findOne(expected);

      if (!kas) {
        logMismatch("service", {
          reason: "Data keuangan tidak ditemukan",
          detail: dataInfo,
          expected
        });
        return;
      }

      // Jika ditemukan, cocokkan jumlah_in atau jumlah_out
      if (expected.jumlah_in != null) {
        if (kas.jumlah_in !== expected.jumlah_in) {
          logMismatch("service", {
            reason: "jumlah_in tidak sesuai",
            expected: expected.jumlah_in,
            found: kas.jumlah_in,
            detail: dataInfo
          });
        }
      }

      if (expected.jumlah_out != null) {
        if (kas.jumlah_out !== expected.jumlah_out) {
          logMismatch("service", {
            reason: "jumlah_out tidak sesuai",
            expected: expected.jumlah_out,
            found: kas.jumlah_out,
            detail: dataInfo
          });
        }
      }
    }

    // ======================================================
    // 1️⃣ SERVICE MASUK
    // ======================================================
    const serviceMasuk = await db.collection("tt_service_detail").find({
      tgl_system: auditDate,
      status_valid: "OPEN",
      status_proses: "OPEN"
    }).toArray();

    for (const sv of serviceMasuk) {
      for (const pay of sv.pembayaran) {
        await validateCash(
          {
            tanggal: sv.tgl_system,
            status: "OPEN",
            deskripsi: sv.no_faktur_service,
            kategori: "B578C48ABCB3BA",
            jenis: doEncrypt(pay.jenis),
            jumlah_in: pay.jumlah_rp
          },
          {
            jenis: "SERVICE MASUK",
            no_faktur_service: sv.no_faktur_service,
            jenis_pembayaran: pay.jenis,
            jumlah_rp: pay.jumlah_rp
          }
        );
      }
    }

    // ======================================================
// 2️⃣ SERVICE AMBIL
// ======================================================
const serviceAmbil = await db.collection("tt_service_detail").find({
  tgl_system: auditDate,
  status_valid: "OPEN",
  status_proses: "CLOS"
}).toArray();

for (const sv of serviceAmbil) {

  // FILTER pembayaran yang TIDAK punya no_faktur_group
  const pembayaranAmbil = (sv.pembayaran || []).filter(p => !("no_faktur_group" in p));

  for (const pay of pembayaranAmbil) {
    await validateCash(
      {
        tanggal: sv.tgl_system,
        status: "OPEN",
        deskripsi: sv.no_faktur_service,
        kategori: "B578C48ABCB3BA9472B575BB80",
        jenis: doEncrypt(pay.jenis),
        jumlah_in: pay.jumlah_rp
      },
      {
        jenis: "SERVICE AMBIL",
        no_faktur_service: sv.no_faktur_service,
        jenis_pembayaran: pay.jenis,
        jumlah_rp: pay.jumlah_rp
      }
    );
  }
}

    // ======================================================
    // 3️⃣ BATAL SERVICE
    // ======================================================
    const serviceBatal = await db.collection("tt_service_detail").find({
      tgl_system: auditDate,
      status_valid: "OPEN",
      status_proses: "CANC"
    }).toArray();

    for (const sv of serviceBatal) {
      await validateCash(
        {
          tanggal: sv.tgl_system,
          status: "OPEN",
          deskripsi: sv.no_faktur_service,
          kategori: "A474C675BF90C8B983BE7CB579",
          jumlah_out: sv.total_bayar
        },
        {
          jenis: "BATAL SERVICE",
          no_faktur_service: sv.no_faktur_service,
          total_bayar: sv.total_bayar
        }
      );
    }

    console.log("   ✔ Pemeriksaan Service selesai.");
  }
};
