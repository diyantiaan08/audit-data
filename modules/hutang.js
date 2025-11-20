module.exports = {
    name: "hutang",

    async run(db, auditDate, isClosedStore, logMismatch) {
        console.log("🔍 [HUTANG] Memulai pemeriksaan...");

        // ======================================================
        // Fungsi validasi data kas
        // ======================================================
        async function validateCash(expected, detail) {
            const kas = await db.collection("tt_cash_daily").findOne(expected);

            if (!kas) {
                logMismatch("hutang", {
                    reason: "Data keuangan tidak ditemukan",
                    expected,
                    detail
                });
                return;
            }

            if (expected.jumlah_in != null && kas.jumlah_in !== expected.jumlah_in) {
                logMismatch("hutang", {
                    reason: "jumlah_in tidak sesuai",
                    expected: expected.jumlah_in,
                    found: kas.jumlah_in,
                    detail
                });
            }

            if (expected.jumlah_out != null && kas.jumlah_out !== expected.jumlah_out) {
                logMismatch("hutang", {
                    reason: "jumlah_out tidak sesuai",
                    expected: expected.jumlah_out,
                    found: kas.jumlah_out,
                    detail
                });
            }
        }

        // ======================================================
        // 1️⃣ HUTANG MASUK
        // ======================================================
        const hutangMasuk = await db.collection("tt_hutang_detail").find({
            tgl_hutang: auditDate,
            status_valid: "DONE",
            status_hutang: "OPEN"
        }).toArray();

        for (const ht of hutangMasuk) {
            await validateCash(
                {
                    tanggal: ht.tgl_hutang,
                    status: "OPEN",
                    deskripsi: ht.no_faktur_hutang,
                    kategori: "AA88C675C1B7",
                    jumlah_out: ht.jumlah_hutang
                },
                {
                    jenis: "HUTANG MASUK",
                    no_faktur_hutang: ht.no_faktur_hutang,
                    jumlah_hutang: ht.jumlah_hutang
                }
            );
        }

        // ======================================================
        // 2️⃣ BATAL HUTANG
        // ======================================================
        const batalHutang = await db.collection("tt_hutang_detail").find({
            tgl_system: auditDate,
            status_valid: "DONE",
            status_hutang: "CANC"
        }).toArray();

        for (const ht of batalHutang) {
            await validateCash(
                {
                    tanggal: ht.tgl_system,
                    status: "OPEN",
                    deskripsi: ht.no_faktur_hutang,
                    kategori: "AA88C675C1B795B672BC74BE",
                    jumlah_in: ht.jumlah_hutang
                },
                {
                    jenis: "BATAL HUTANG",
                    no_faktur_hutang: ht.no_faktur_hutang,
                    jumlah_hutang: ht.jumlah_hutang
                }
            );
        }

        // ======================================================
        // 3️⃣ PELUNASAN HUTANG
        // ======================================================
        const hutangLunas = await db.collection("tt_hutang_detail").find({
            tgl_lunas: auditDate,
            status_valid: "DONE",
            status_hutang: "CLOS"
        }).toArray();

        for (const ht of hutangLunas) {

            const list = await db.collection("tt_cash_daily").find({
                tanggal: ht.tgl_lunas,
                status: "OPEN",
                deskripsi: ht.no_faktur_hutang,
                kategori: "AA88C675C1B795C086B674C5",
            }).toArray();

            const totalKas = list.reduce((a, b) => a + (b.jumlah_in || 0), 0);

            if (totalKas !== ht.total_bayar) {
                logMismatch("hutang", {
                    jenis: "PELUNASAN HUTANG",
                    no_faktur_hutang: ht.no_faktur_hutang,
                    expected_total: ht.total_bayar,
                    actual_total: totalKas,
                    rincian_kas: list.map(i => ({
                        jenis: i.jenis,
                        jumlah_in: i.jumlah_in
                    }))
                });
            }
        }


        // ======================================================
        // 4️⃣ BATAL PELUNASAN HUTANG
        // ======================================================
        const batalLunas = await db.collection("tt_hutang_detail").find({
            tgl_system: auditDate,
            status_valid: "DONE",
            status_hutang: "OPEN",
            tgl_lunas: "-" 
        }).toArray();

        for (const ht of batalLunas) {
            await validateCash(
                {
                    tanggal: ht.tgl_hutang,
                    status: "OPEN",
                    deskripsi: ht.no_faktur_hutang,
                    kategori: "A474C675BF90BDC985A981B954BFC5C3B584",
                },
                {
                    jenis: "BATAL PELUNASAN HUTANG",
                    no_faktur_hutang: ht.no_faktur_hutang,
                }
            );
        }

        console.log("   ✔ Pemeriksaan Hutang selesai.");
    }
};
