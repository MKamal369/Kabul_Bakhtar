require("dotenv").config({
    path: require("path").join(__dirname, "..", ".env")
});

const argon2 = require("argon2");
const readline = require("readline");
const db = require("../db");

function ask(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer);
        });
    });
}

function askHidden(question) {
    return new Promise((resolve, reject) => {
        const stdin = process.stdin;

        if (!stdin.isTTY) {
            return reject(new Error("Run this script in a real terminal."));
        }

        const rl = readline.createInterface({
            input: stdin,
            output: process.stdout,
            terminal: false
        });

        let password = "";

        process.stdout.write(question);
        stdin.setRawMode(true);
        stdin.resume();

        function cleanup() {
            stdin.removeListener("data", onData);
            stdin.setRawMode(false);
            rl.close();
        }

        function onData(buffer) {
            for (const byte of buffer) {
                if (byte === 3) {
                    cleanup();
                    process.stdout.write("\n");
                    reject(new Error("Operation cancelled."));
                    return;
                }

                if (byte === 13 || byte === 10) {
                    cleanup();
                    process.stdout.write("\n");
                    resolve(password);
                    return;
                }

                if (byte === 8 || byte === 127) {
                    password = password.slice(0, -1);
                    continue;
                }

                if (byte >= 32 && byte <= 126) {
                    password += String.fromCharCode(byte);
                    process.stdout.write("*");
                }
            }
        }

        stdin.on("data", onData);
    });
}

async function main() {
    const client = await db.connect();

    try {
        const existing = await client.query(
            "SELECT COUNT(*) FROM developers"
        );

        if (Number(existing.rows[0].count) > 0) {
            throw new Error(
                "A developer account already exists. Provisioning stopped."
            );
        }

        const username = (await ask("Developer username: ")).trim();
        const displayName = (await ask("Developer display name: ")).trim();

        if (!username || !displayName) {
            throw new Error("Username and display name are required.");
        }

        const password = await askHidden("Developer password: ");
        const confirmation = await askHidden("Confirm password: ");

        if (password.length < 12) {
            throw new Error("Password must contain at least 12 characters.");
        }

        if (password !== confirmation) {
            throw new Error("Passwords do not match.");
        }

        const passwordHash = await argon2.hash(password, {
            type: argon2.argon2id
        });

        await client.query("BEGIN");

        await client.query(
            `INSERT INTO developers
                (username, display_name, password_hash)
             VALUES ($1, $2, $3)`,
            [username, displayName, passwordHash]
        );

        await client.query("COMMIT");

        console.log("Developer account created successfully.");

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;

    } finally {
        client.release();
    }
}

main()
    .catch(error => {
        console.error("Developer provisioning failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.end();
    });