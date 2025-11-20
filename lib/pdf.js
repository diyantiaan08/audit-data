const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

/**
 * Generate PDF detail mismatch per modul
 * @param {string} date - tanggal audit (YYYY-MM-DD)
 */
async function generateDetailPDF(date) {
  try {
    console.log(`[PDF] Membuat PDF untuk tanggal: ${date}`);

    const baseDir = path.join(__dirname, "..", "logs", date);
    const outputPath = path.join(baseDir, "mismatch_detail.pdf");

    // Jika folder tidak ada → jangan buat PDF
    if (!fs.existsSync(baseDir)) {
      console.warn("[PDF] Folder log tidak ditemukan:", baseDir);
      return;
    }

    // Ambil semua file modul
    const files = fs.readdirSync(baseDir).filter(f =>
      f.endsWith(".json") &&
      f !== "summary.json" &&
      f !== "mismatch.json"
    );

    const doc = new PDFDocument({
      margin: 40,
      bufferPages: true
    });

    const writeStream = fs.createWriteStream(outputPath);
    doc.pipe(writeStream);

    // Promise untuk menunggu PDF selesai ditulis
    const pdfFinished = new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    // ==========================
    // HEADER HALAMAN PERTAMA
    // ==========================
    doc.fontSize(22).text("NAGATECH DAILY AUDIT REPORT", {
      align: "center"
    });

    doc.moveDown(1);

    doc.fontSize(12).text(`Tanggal Audit : ${date}`);
    doc.text(`Waktu Cetak    : ${new Date().toLocaleString("id-ID")}`);
    doc.moveDown(2);

    doc.fontSize(16).text("Ringkasan Mismatch", { underline: true });
    doc.moveDown();

    // Ringkasan mismatch
    if (files.length === 0) {
      doc.fontSize(14).text("Tidak ada mismatch ditemukan.");
      doc.end();
      console.log("[PDF] (0 mismatch) PDF selesai dibuat.");
      return;
    }

    files.forEach(f => {
      const moduleName = f.replace(".json", "");
      const arr = JSON.parse(fs.readFileSync(path.join(baseDir, f)));

      doc.fontSize(12).text(
        `${moduleName.padEnd(20)} : ${arr.length} mismatch`
      );
    });

    // ==========================
    // DETAIL PER MODUL
    // ==========================
    for (const f of files) {
      const moduleName = f.replace(".json", "");
      const arr = JSON.parse(fs.readFileSync(path.join(baseDir, f)));

      doc.addPage();
      doc.fontSize(20).text(moduleName.toUpperCase(), { underline: true });
      doc.moveDown();

      doc.fontSize(12).text(`Total mismatch: ${arr.length}`);
      doc.moveDown(1.5);

      if (arr.length === 0) {
        doc.fontSize(12).text("✔ Tidak ada mismatch pada modul ini.");
        continue;
      }

      arr.forEach((item, index) => {
        doc.fontSize(14).text(`${index + 1}.`, { continued: true });
        doc.fontSize(14).text(
          ` ${item.kode_barcode || item.no_pesanan || item.no_faktur_group || "-"}`
        );

        doc.fontSize(11).text(`Waktu : ${item.waktu}`);
        doc.fontSize(11).text(`Alasan: ${item.reason || "-"}`);
        doc.moveDown(0.3);

        // extra detail
        const extra = { ...item };
        delete extra.waktu;
        delete extra.kategori;
        delete extra.reason;

        doc.fontSize(9).text(JSON.stringify(extra, null, 2));
        doc.moveDown(1);
      });
    }

    doc.end();
    
    // Tunggu hingga PDF benar-benar selesai ditulis
    await pdfFinished;
    
    console.log(`[PDF] PDF selesai dibuat → ${outputPath}`);

  } catch (err) {
    console.error("[PDF ERROR]", err.message);
    console.error("[PDF ERROR STACK]", err.stack);
    throw err; // Lempar error agar terlihat di log utama
  }
}

module.exports = { generateDetailPDF };
