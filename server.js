// Foodie server — entry point. Loads environment variables, connects to
// MongoDB, then starts listening. The app itself is built in src/app.js so
// tests can import it without opening a port.
require("dotenv").config();
const app = require("./src/app");
const connectDB = require("./src/config/db");

const PORT = process.env.PORT || 4000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`[foodie-server] listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error("[foodie-server] failed to start:", err.message);
    process.exit(1);
  });
