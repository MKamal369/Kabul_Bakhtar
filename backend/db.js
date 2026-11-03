const path = require("path");
const { Pool } = require("pg");

require("dotenv").config({
    path: path.join(__dirname, ".env")
});

if (typeof process.env.DB_PASSWORD !== "string" ||
    process.env.DB_PASSWORD.length === 0) {
    throw new Error("DB_PASSWORD is missing or invalid in backend/.env");
}

const connection = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

connection.on("error", err => {
    console.error("Unexpected PostgreSQL pool error:", err.message);
});

module.exports = connection;