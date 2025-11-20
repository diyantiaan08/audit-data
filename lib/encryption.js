/**
 * ============================================================
 *  NAGATECH ENCRYPTION / DECRYPTION (ASCII-based)
 *  - Compatible dengan sistem enkripsi existing
 *  - Reversible (bisa di-decrypt kembali)
 * ============================================================
 */

const crypto = require("crypto");
require("dotenv").config();

// Encryption Key dari environment variable (lebih aman)
// Fallback ke default jika .env tidak ada
const ENC_KEY = process.env.ENC_KEY || "b3r4sput"; 

/**
 * Convert number to hex string
 */
function hexEncode(num) {
  return num.toString(16);
}

/**
 * Convert hex string to number
 */
function hexDec(hex) {
  return parseInt(hex, 16);
}

/**
 * Convert ASCII code to character
 */
function chr(ascii) {
  return String.fromCharCode(ascii);
}

/**
 * Encrypt string using ASCII-based encryption
 * Compatible dengan Encryptor.encryptascii()
 */
function encryptAscii(str) {
  if (!str) return str;
  
  try {
    const key = ENC_KEY;
    const dataKey = {};
    
    // Build key array
    for (let i = 0; i < key.length; i++) {
      dataKey[i] = key.substr(i, 1);
    }

    let strEnc = "";
    let nkey = 0;
    const jml = str.length;

    for (let i = 0; i < jml; i++) {
      strEnc += hexEncode(
        str[i].charCodeAt(0) + dataKey[nkey].charCodeAt(0)
      );

      if (nkey === Object.keys(dataKey).length - 1) {
        nkey = 0;
      }
      nkey = nkey + 1;
    }
    
    return strEnc.toUpperCase();
  } catch (err) {
    console.error("Encrypt ASCII error:", err);
    return str; // fallback
  }
}

/**
 * Decrypt string using ASCII-based decryption
 * Compatible dengan Encryptor.decryptascii()
 */
function decryptAscii(str) {
  if (!str) return str;

  try {
    const key = ENC_KEY;
    const dataKey = {};
    
    // Build key array
    for (let i = 0; i < key.length; i++) {
      dataKey[i] = key.substr(i, 1);
    }

    let strDec = "";
    let nkey = 0;
    const jml = str.length;
    let i = 0;
    
    while (i < jml) {
      strDec += chr(
        hexDec(str.substr(i, 2)) - dataKey[nkey].charCodeAt(0)
      );
      
      if (nkey === Object.keys(dataKey).length - 1) {
        nkey = 0;
      }
      nkey = nkey + 1;
      i = i + 2;
    }
    
    return strDec;
  } catch (err) {
    console.error("Decrypt ASCII error:", err);
    return str; // fallback
  }
}

// ============================================================
// SIMPLE AES ENCRYPTION (untuk backup/alternative)
// ============================================================
const SECRET_KEY = "NAGATECH-AUDIT-SECRET-KEY-2024!!!"; // 32 chars
const IV = Buffer.alloc(16, 0);

function doEncryptAES(text) {
  if (!text) return text;

  try {
    const cipher = crypto.createCipheriv("aes-256-cbc", SECRET_KEY.slice(0, 32), IV);
    let encrypted = cipher.update(String(text), "utf8", "hex");
    encrypted += cipher.final("hex");
    return encrypted;
  } catch (err) {
    console.error("Encrypt AES error:", err);
    return text;
  }
}

function doDecryptAES(text) {
  if (!text) return text;

  try {
    const decipher = crypto.createDecipheriv("aes-256-cbc", SECRET_KEY.slice(0, 32), IV);
    let decrypted = decipher.update(String(text), "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    return text;
  }
}

// ============================================================
// EXPORT - Gunakan ASCII encryption sebagai default
// ============================================================
module.exports = {
  // ASCII-based encryption (compatible dengan sistem)
  doEncrypt: encryptAscii,
  doDecrypt: decryptAscii,
  
  // Alternative AES encryption
  doEncryptAES,
  doDecryptAES,
  
  // Export individual functions jika diperlukan
  encryptAscii,
  decryptAscii
};
