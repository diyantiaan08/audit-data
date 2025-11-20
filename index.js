/**
 * ============================================
 *  NAGATECH DAILY AUDIT ENGINE (WITH PROGRESS BAR)
 *  Tanggal Audit Terkunci (LOCKED)
 * ============================================
 */

const path = require("path");
const fs = require("fs");
const {generateDetailPDF} = require("./lib/pdf");

// Koneksi Mongo
const { MONGO_URI, DB_NAME } = require("./config");
const { connectMongo } = require("./lib/mongo");
const { formatDate } = require("./lib/utils");

// Modules
const modHancur = require("./modules/hancurbarang");
const modPindah = require("./modules/pindahbarang");
const modService = require("./modules/service");
const modPesanan = require("./modules/pesanan");
const modHutang = require("./modules/hutang");
const modTitipan = require("./modules/titipan");
const modPenjualan = require("./modules/penjualan");
const modPembelian = require("./modules/pembelian");
const modTambahBarang = require("./modules/tambahbarang");

/**
 * ============================================
 *  PROGRESS BAR
 * ============================================
 */
function updateProgress(current, total, moduleName) {
    const percent = Math.floor((current / total) * 100);
    const barLength = 30;
    const filled = Math.floor((percent / 100) * barLength);
    const bar = "█".repeat(filled) + "-".repeat(barLength - filled);

    process.stdout.write(
        `\r[${bar}] ${percent}%  | Modul: ${moduleName.padEnd(15)} (${current}/${total})`
    );

    if (current === total) {
        console.log("\n===========================================");
        console.log("🔥 SEMUA MODUL SUDAH SELESAI DIPROSES");
        console.log("===========================================\n");
    }
}

/**
 * ============================================
 *  LOGGER (ANTI FILE CORRUPT)
 * ============================================
 */
function createLogger(date) {
    const baseDir = path.join(__dirname, "logs", date);
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

    const globalFile = path.join(baseDir, "mismatch.json");
    if (!fs.existsSync(globalFile)) fs.writeFileSync(globalFile, "[]");

    function appendToFile(filePath, entry) {
        let arr = [];

        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, "utf8").trim();
                if (raw) arr = JSON.parse(raw);
            }
        } catch (err) {
            console.error("⚠️ File log corrupt, dibuat ulang:", filePath);
            arr = [];
        }

        arr.push(entry);
        fs.writeFileSync(filePath, JSON.stringify(arr, null, 2));
    }

    return function logMismatch(moduleName, detail) {
        const entry = {
            waktu: new Date().toISOString(),
            kategori: moduleName,
            ...detail
        };

        // log gabungan
        appendToFile(globalFile, entry);

        // log per-modul
        const moduleFile = path.join(baseDir, `${moduleName}.json`);
        appendToFile(moduleFile, entry);
    };
}

/**
 * ============================================
 *  ENGINE UTAMA (TANGGAL AUDIT LOCK)
 * ============================================
 */
(async () => {
    console.log("===========================================");
    console.log("🚀 MEMULAI NAGATECH DAILY AUDIT ENGINE");
    console.log("===========================================\n");

    const db = await connectMongo(MONGO_URI, DB_NAME);

    // =============================================
    // LOCK TANGGAL AUDIT SAAT SCRIPT DIMULAI
    // =============================================
    const auditDate = formatDate(new Date()); // tanggal audit = tanggal saat script dijalankan
    
    const tp = await db.collection("tp_system").findOne({});
    const tglSystem = tp?.tgl_system || auditDate; // tanggal terakhir di sistem

    // status tutup toko: jika tgl_system berbeda dengan tanggal audit
    const isClosedStore = tglSystem !== auditDate;

    console.log(`📌 Tanggal Audit Terkunci : ${auditDate}`);
    console.log(`📅 Tanggal System (DB)    : ${tglSystem}`);
    console.log(`🏪 Status Toko            : ${isClosedStore ? "TUTUP" : "BELUM TUTUP"}`);

    const logMismatch = createLogger(auditDate);

    console.log("\n🧪 Memulai proses audit...\n");

    // =============================================
    // REGISTER SEMUA MODUL
    // =============================================
    const modules = [
        { name: "hancurbarang", fn: modHancur.run },
        { name: "pindahbarang", fn: modPindah.run },
        { name: "service", fn: modService.run },
        { name: "pesanan", fn: modPesanan.run },
        { name: "hutang", fn: modHutang.run },
        { name: "titipan", fn: modTitipan.run },
        { name: "penjualan", fn: modPenjualan.run },
        { name: "pembelian", fn: modPembelian.run },
        { name: "tambahbarang", fn: modTambahBarang.run }
    ];

    let progress = 0;
    const total = modules.length;

    // =============================================
    // JALANKAN MODUL SATU-PER-SATU
    // =============================================
    for (const mod of modules) {
        if (typeof mod.fn !== "function") {
            console.error(`❌ Modul ${mod.name} tidak memiliki method run()`);
            continue;
        }

        await mod.fn(db, auditDate, isClosedStore, logMismatch);

        progress++;
        updateProgress(progress, total, mod.name);
    }

    // =============================================
    // BACA LOG → SUMMARY JSON
    // =============================================
    const logDir = path.join(__dirname, "logs", auditDate);
    const files = fs.readdirSync(logDir);

    const summary = {};

    for (const f of files) {
        if (f.endsWith(".json") && f !== "mismatch.json" && f !== "summary.json") {
            const moduleName = f.replace(".json", "");
            const arr = JSON.parse(fs.readFileSync(path.join(logDir, f)));
            summary[moduleName] = arr.length;
        }
    }

    summary["total_mismatch"] = Object.values(summary).reduce((a, b) => a + b, 0);

    fs.writeFileSync(
        path.join(logDir, "summary.json"),
        JSON.stringify(summary, null, 2)
    );

    // =============================================
    // GENERATE PDF
    // =============================================
    console.log("\n📄 Membuat PDF detail...");
    await generateDetailPDF(auditDate);
    console.log(`📄 PDF Detail dibuat : logs/${auditDate}/mismatch_detail.pdf`);

    // =============================================
    // RINGKASAN
    // =============================================
    console.log("\n===========================================");
    console.log("📊 RINGKASAN AUDIT");
    console.log("===========================================\n");

    for (const [mod, count] of Object.entries(summary)) {
        if (mod !== "total_mismatch") {
            console.log(`🔎 ${mod.padEnd(20)} : ${count} mismatch`);
        }
    }

    console.log("-------------------------------------------");
    console.log(`🧮 TOTAL MISMATCH     : ${summary.total_mismatch}`);
    console.log(`📝 Folder Log         : logs/${auditDate}/`);
    console.log("-------------------------------------------");

    console.log("\n🚀 Audit selesai.\n");
    process.exit(0);
})();
