const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const rateLimit = require("express-rate-limit");
const argon2 = require("argon2");
const path = require("path");
const db = require("./db");

if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is missing from the environment variables.");
}

const app = express();
const PORT = 3000;

// Trust proxy only when deployed behind a trusted reverse proxy.
// app.set("trust proxy", 1);


// ==========================================
// MIDDLEWARE
// ==========================================

// Parse incoming JSON requests
app.use(express.json());

// PostgreSQL-backed session configuration
app.use(session({
    store: new pgSession({
        pool: db,
        tableName: "user_sessions",
        createTableIfMissing: false
    }),

    name: "kabul_bakhtar_session",

    secret: process.env.SESSION_SECRET,

    resave: false,
    saveUninitialized: false,
    rolling: true,

    cookie: {
        httpOnly: true,
        secure: false, // Change to true when using HTTPS
        sameSite: "lax",
        maxAge: 1000 * 60 * 50
    }
}));


// ==========================================
// LOGIN RATE LIMITER
// ==========================================

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many login attempts. Please try again later."
    }
});

// Separate rate limiter for Developer login
const developerLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many developer login attempts. Please try again later."
    }
});
// ==========================================
// AUTHENTICATION ROUTES
// ==========================================

function requireAuth(req, res, next) {
    if (!req.session.manager) {
        return res.status(401).json({
            success: false,
            message: "Please log in to access this resource."
        });
    }

    next();
}

// Protect Developer-only resources
function requireDeveloper(req, res, next) {
    if (!req.session.developer) {
        return res.status(403).json({
            success: false,
            message: "Developer access required."
        });
    }

    next();
}

// Allow only system administrators
function requireSystemAdmin(req, res, next) {

    if (!req.session.manager) {
        return res.status(401).json({
            success: false,
            message: "Please log in first."
        });
    }

    if (req.session.manager.role !== "system_admin") {
        return res.status(403).json({
            success: false,
            message: "Administrator permission required."
        });
    }

    next();
}

//Too manu login attempts
// POST: Manager login
app.post("/api/auth/login"/* , loginLimiter*/, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (
            typeof username !== "string" ||
            typeof password !== "string" ||
            !username.trim() ||
            !password
        ) {
            return res.status(400).json({
                success: false,
                message: "Username and password are required."
            });
        }

        const result = await db.query(
            `SELECT id, username, display_name, role, password_hash
             FROM managers
             WHERE username = $1`,
            [username.trim()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password."
            });
        }

        const manager = result.rows[0];

        const passwordMatches = await argon2.verify(
            manager.password_hash,
            password
        );

        if (!passwordMatches) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password."
            });
        }

        // Regenerate session after successful authentication
        req.session.regenerate((err) => {
            if (err) {
                console.error("Session regeneration failed:", err);

                return res.status(500).json({
                    success: false,
                    message: "Unable to create login session."
                });
            }

            // Store manager information in the session
            req.session.manager = {
                id: manager.id,
                username: manager.username,
                display_name: manager.display_name,
                role: manager.role
            };

            // Save session in PostgreSQL
            req.session.save((saveErr) => {
                if (saveErr) {
                    console.error("Session save failed:", saveErr);

                    return res.status(500).json({
                        success: false,
                        message: "Unable to save login session."
                    });
                }

                return res.json({
                    success: true,
                    message: "Login successful.",
                    manager: req.session.manager
                });
            });
        });

    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            success: false,
            message: "An internal server error occurred."
        });
    }
});

// POST: Developer login
app.post(
    "/api/developer/login",
    developerLoginLimiter,
    async (req, res) => {
        try {
            const { username, password } = req.body;

            if (
                typeof username !== "string" ||
                typeof password !== "string" ||
                !username.trim() ||
                !password
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Username and password are required."
                });
            }

            const result = await db.query(
                `SELECT id, username, display_name, password_hash
                 FROM developers
                 WHERE username = $1`,
                [username.trim()]
            );

            if (result.rows.length === 0) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid username or password."
                });
            }

            const developer = result.rows[0];

            const passwordMatches = await argon2.verify(
                developer.password_hash,
                password
            );

            if (!passwordMatches) {
                return res.status(401).json({
                    success: false,
                    message: "Invalid username or password."
                });
            }

            req.session.regenerate((err) => {
                if (err) {
                    console.error("Developer session error:", err);

                    return res.status(500).json({
                        success: false,
                        message: "Unable to create developer session."
                    });
                }

                req.session.developer = {
                    id: developer.id,
                    username: developer.username,
                    display_name: developer.display_name
                };

                req.session.save((saveErr) => {
                    if (saveErr) {
                        console.error("Developer session save error:", saveErr);

                        return res.status(500).json({
                            success: false,
                            message: "Unable to save developer session."
                        });
                    }

                    return res.json({
                        success: true,
                        message: "Developer login successful.",
                        developer: req.session.developer
                    });
                });
            });

        } catch (error) {
            console.error("Developer login error:", error);

            res.status(500).json({
                success: false,
                message: "An internal server error occurred."
            });
        }
    }
);

// GET: Check Developer session
app.get("/api/developer/me", requireDeveloper, (req, res) => {
    res.json({
        success: true,
        developer: req.session.developer
    });
});


// POST: Developer logout
app.post("/api/developer/logout", requireDeveloper, (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Developer logout error:", err);

            return res.status(500).json({
                success: false,
                message: "Developer logout failed."
            });
        }

        res.clearCookie("kabul_bakhtar_session");

        res.json({
            success: true,
            message: "Developer logged out successfully."
        });
    });
});


// POST: Manager logout
app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Logout error:", err);

            return res.status(500).json({
                success: false,
                message: "Logout failed."
            });
        }

        res.clearCookie("kabul_bakhtar_session");

        res.json({
            success: true,
            message: "Logged out successfully."
        });
    });
});


// GET: Check current manager session
app.get("/api/auth/me", (req, res) => {
    if (!req.session.manager) {
        return res.status(401).json({
            success: false,
            message: "Not authenticated."
        });
    }

    res.json({
        success: true,
        manager: req.session.manager
    });
});


// ==========================================
// FRONTEND
// ==========================================

// Serve the frontend application
app.use(express.static(path.join(__dirname, "..")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "index.html"));
});


// ==========================================
// EXPENSE API ROUTES
// ==========================================

// GET: Retrieve active expenses
app.get("/api/expenses", requireAuth, async (req, res) => {
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
app.post("/api/expenses", requireAuth, async (req, res) => {

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
app.put("/api/expenses/:id", requireAuth, async (req, res) => {

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
app.delete("/api/expenses/:id", requireAuth, async (req, res) => {

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


// START SERVER
// ==========================================

async function startServer() {
    try {
        // Invalidate all previous sessions after every server restart
        await db.query("DELETE FROM user_sessions");

        app.listen(PORT, "0.0.0.0", () => {
            console.log(`Server is running on port ${PORT}`);
            console.log("Previous sessions have been cleared.");
        });

    } catch (error) {
        console.error("Failed to clear previous sessions:", error);
        process.exit(1);
    }
}

startServer();