/**
 * ============================================
 *  LIB: KONEKSI MONGODB
 * ============================================
 */

const { MongoClient } = require("mongodb");

async function connectMongo(uri, dbName) {
  const client = new MongoClient(uri, {
    useUnifiedTopology: true,
    maxPoolSize: 50,
    serverSelectionTimeoutMS: 5000
  });

  await client.connect();
  console.log("🗄  Terhubung ke MongoDB");

  return client.db(dbName);
}

module.exports = { connectMongo };
