# Keamanan Encryption Key

## ✅ Yang Sudah Diterapkan:

### 1. Environment Variable (.env)
Key disimpan di file `.env` yang **tidak di-commit ke git**:
```
ENC_KEY=your_secret_key_here
```

### 2. .gitignore
File `.env` sudah ditambahkan ke `.gitignore` agar tidak ter-upload ke repository.

### 3. Fallback Key
Ada fallback key jika `.env` tidak tersedia (untuk development).

---

## 🔐 Best Practices:

### Untuk Production:
1. **Jangan commit** file `.env` ke git
2. Set environment variable di server:
   ```bash
   export ENC_KEY="your_secret_key_here"
   ```
3. Atau gunakan secret management:
   - AWS Secrets Manager
   - Azure Key Vault
   - HashiCorp Vault

### Untuk Development:
1. Copy `.env.example` ke `.env`:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` dengan key yang benar
3. **Jangan share** file `.env` ke siapapun

### Backup Key:
Simpan key di tempat aman:
- Password manager (1Password, LastPass)
- Encrypted file di secure storage
- Documentation yang ter-password

---

## 📝 Cara Menggunakan:

```javascript
// Otomatis load dari .env
const { doEncrypt } = require('./lib/encryption');

const encrypted = doEncrypt('CASH'); // A574C57C
```

## ⚠️ PENTING:
- **JANGAN** hardcode key di code
- **JANGAN** commit `.env` ke git
- **JANGAN** share key via chat/email
- **BACKUP** key di tempat aman
