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



app.get("/api/expenses", (req, res) => {
    const sql = `
    SELECT * FROM expenses
    WHERE cancelled = FALSE
    ORDER BY expense_date DESC
`;

    db.query(sql, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({
                message: "Failed to retrieve expenses"
            });
        }

        res.json(results);
    });
});



app.post("/api/expenses", (req, res) => {

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
        VALUES (?, ?, ?, ?, ?)
    `;

    db.query(
        sql,
        [expense_date, category, currency, amount, description],
        (err, result) => {

            if (err) {
                console.error(err);

                return res.status(500).json({
                    message: "Failed to add expense"
                });
            }

            res.status(201).json({
                message: "Expense added successfully",
                id: result.insertId
            });
        }
    );
});

app.put("/api/expenses/:id", (req, res) => {

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
            expense_date = ?,
            category = ?,
            currency = ?,
            amount = ?,
            description = ?
        WHERE id = ? AND cancelled = FALSE
    `;

    db.query(
        sql,
        [expense_date, category, currency, amount, description, id],
        (err, result) => {

            if (err) {
                console.error(err);

                return res.status(500).json({
                    message: "Failed to update expense"
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    message: "Expense not found or already cancelled"
                });
            }

            res.json({
                message: "Expense updated successfully"
            });
        }
    );
});

app.delete("/api/expenses/:id", (req, res) => {

    const { id } = req.params;

    const sql = `
        UPDATE expenses
        SET
            cancelled = TRUE,
            cancelled_at = NOW()
        WHERE id = ? AND cancelled = FALSE
    `;

    db.query(sql, [id], (err, result) => {

        if (err) {
            console.error(err);

            return res.status(500).json({
                message: "Failed to cancel expense"
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: "Expense not found or already cancelled"
            });
        }

        res.json({
            message: "Expense cancelled successfully"
        });

    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
});