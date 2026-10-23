const mongoose = require("mongoose");

// Connects to MongoDB using the connection string from the MONGODB_URI
// environment variable. The string itself is a secret: it lives only in the
// environment (locally in .env, in production in the host's settings) —
// never in code and never in this repository.
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set. Copy .env.example to .env and fill it in.");
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log("[foodie-server] MongoDB connected:", mongoose.connection.name);
  return mongoose.connection;
}

module.exports = connectDB;
