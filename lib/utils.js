/**
 * ============================================
 *  LIB: FUNGSI UTILITAS
 * ============================================
 */

// Format tanggal YYYY-MM-DD
function formatDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

module.exports = {
  formatDate
};
