/**
 * ============================================
 *  LIB: STATE MANAGEMENT
 *  Menyimpan status audit ke file state.json
 * ============================================
 */

const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "..", "state.json");

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE));
}

function saveState(data) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
}

module.exports = {
  loadState,
  saveState
};
