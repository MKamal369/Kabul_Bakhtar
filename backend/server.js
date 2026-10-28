const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Serve the frontend application
app.use(express.static(path.join(__dirname, "..")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "index.html"));
});

// GET: Retrieve active expenses
app.get("/api/expenses", async (req, res) => {
    const sql = `
        SELECT * FROM expenses
        WHERE cancelled = 0
        ORDER BY expense_date DESC
    `;

    try {
        const result = await db.query(sql);
        res.json(result.rows);

    } catch (err) {
        console.error(err);

        res.status(500).json({
            message: "Failed to retrieve expenses"
        });
    }
});

// POST: Add a new expense
app.post("/api/expenses", async (req, res) => {

    const {
        expense_date,
        category,
        currency,
        amount,
        description
    } = req.body;

    const sql = `
        INSERT INTO expenses
        (expense_date, category, currency, amount, description)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
    `;

    try {
        const result = await db.query(sql, [
            expense_date,
            category,
            currency,
            amount,
            description
        ]);

        res.status(201).json({
            message: "Expense added successfully",
            id: result.rows[0].id
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            message: "Failed to add expense"
        });
    }
});

// PUT: Update an existing expense
app.put("/api/expenses/:id", async (req, res) => {

    const { id } = req.params;

    const {
        expense_date,
        category,
        currency,
        amount,
        description
    } = req.body;

    const sql = `
        UPDATE expenses
        SET
            expense_date = $1,
            category = $2,
            currency = $3,
            amount = $4,
            description = $5
        WHERE id = $6 AND cancelled = 0
    `;

    try {
        const result = await db.query(sql, [
            expense_date,
            category,
            currency,
            amount,
            description,
            id
        ]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                message: "Expense not found or already cancelled"
            });
        }

        res.json({
            message: "Expense updated successfully"
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            message: "Failed to update expense"
        });
    }
});

// DELETE: Soft-cancel an expense
app.delete("/api/expenses/:id", async (req, res) => {

    const { id } = req.params;

    const sql = `
        UPDATE expenses
        SET
            cancelled = 1,
            cancelled_at = NOW()
        WHERE id = $1 AND cancelled = 0
    `;

    try {
        const result = await db.query(sql, [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({
                message: "Expense not found or already cancelled"
            });
        }

        res.json({
            message: "Expense cancelled successfully"
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            message: "Failed to cancel expense"
        });
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
});