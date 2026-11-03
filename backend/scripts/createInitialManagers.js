
require("dotenv").config({
    path: require("path").join(__dirname, "..", ".env")
});

require("dotenv").config();
const argon2 = require("argon2");
const readline = require("readline");
const db = require("../db");

const managers = [
    {
        username: "manager_a",
        display_name: "Manager A",
        role: "system_admin"
    },
    {
        username: "manager_b",
        display_name: "Manager B",
        role: "management_user"
    },
    {
        username: "manager_c",
        display_name: "Manager C",
        role: "management_user"
    }
];

function askHidden(question) {
    return new Promise((resolve, reject) => {
        const stdin = process.stdin;

        if (!stdin.isTTY) {
            return reject(new Error("A real terminal is required."));
        }

        const rl = readline.createInterface({
            input: stdin,
            output: process.stdout,
            terminal: false
        });

        process.stdout.write(question);

        stdin.setRawMode(true);
        stdin.resume();

        let answer = "";

        function onData(buffer) {
            for (const byte of buffer) {
                if (byte === 3) {
                    cleanup();
                    reject(new Error("Operation cancelled."));
                    return;
                }

                if (byte === 13 || byte === 10) {
                    cleanup();
                    process.stdout.write("\n");
                    resolve(answer);
                    return;
                }

                if (byte === 8 || byte === 127) {
                    answer = answer.slice(0, -1);
                    continue;
                }

                if (byte >= 32 && byte <= 126) {
                    answer += String.fromCharCode(byte);
                    process.stdout.write("*");
                }
            }
        }

        function cleanup() {
            stdin.removeListener("data", onData);
            stdin.setRawMode(false);
            rl.close();
        }

        stdin.on("data", onData);
    });
}

async function main() {
    const client = await db.connect();

    try {
        await client.query("BEGIN");

        await client.query(
            "LOCK TABLE public.managers IN EXCLUSIVE MODE"
        );

        const existing = await client.query(
            "SELECT COUNT(*) FROM public.managers"
        );

        if (Number(existing.rows[0].count) !== 0) {
            throw new Error("Managers table is not empty.");
        }

        const passwords = {};

        for (const manager of managers) {
            const password = await askHidden(
                `Enter password for ${manager.username}: `
            );

            if (password.length < 12) {
                throw new Error("Password must contain at least 12 characters.");
            }

            const confirmation = await askHidden(
                `Confirm password for ${manager.username}: `
            );

            if (password !== confirmation) {
                throw new Error("Passwords do not match.");
            }

            passwords[manager.username] = password;
        }

        for (const manager of managers) {
            const password_hash = await argon2.hash(
                passwords[manager.username],
                { type: argon2.argon2id }
            );

            await client.query(
                `INSERT INTO public.managers
                (username, display_name, role, password_hash)
                VALUES ($1, $2, $3, $4)`,
                [
                    manager.username,
                    manager.display_name,
                    manager.role,
                    password_hash
                ]
            );
        }

        await client.query("COMMIT");

        console.log("\nAll three manager accounts created successfully.");

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;

    } finally {
        client.release();
    }
}

main()
    .catch(error => {
        console.error("\nProvisioning failed:", error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.end();
    });