const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const root = __dirname;
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "account-sync.json");
const port = Number(process.env.PORT || 8787);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function readDatabase() {
  try {
    return JSON.parse(await fs.readFile(dbPath, "utf8"));
  } catch {
    return { users: {}, sessions: {} };
  }
}

async function writeDatabase(db) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dbPath, JSON.stringify(db, null, 2));
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const attempt = hashPassword(password, user.passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(attempt.hash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  });
  res.end(body === null ? "" : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sessionEmail(req, db) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = db.sessions[token];
  return session?.email || "";
}

function publicLedger(user) {
  return user.ledger || null;
}

async function handleApi(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, null);
    return;
  }

  const db = await readDatabase();

  if (req.url === "/auth/session" && req.method === "POST") {
    const { email, password, name } = await readBody(req);
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password || String(password).length < 6) {
      sendJson(res, 400, { message: "Email and a 6+ character password are required." });
      return;
    }

    if (!db.users[normalizedEmail]) {
      const passwordRecord = hashPassword(password);
      db.users[normalizedEmail] = {
        email: normalizedEmail,
        name: String(name || normalizedEmail),
        passwordSalt: passwordRecord.salt,
        passwordHash: passwordRecord.hash,
        ledger: null,
        createdAt: new Date().toISOString(),
      };
    } else if (!verifyPassword(password, db.users[normalizedEmail])) {
      sendJson(res, 401, { message: "Incorrect email or password." });
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    db.sessions[token] = {
      email: normalizedEmail,
      createdAt: new Date().toISOString(),
    };
    await writeDatabase(db);
    sendJson(res, 200, { token, user: { email: normalizedEmail, name: db.users[normalizedEmail].name } });
    return;
  }

  if (req.url === "/ledger" && req.method === "GET") {
    const email = sessionEmail(req, db);
    if (!email || !db.users[email]) {
      sendJson(res, 401, { message: "Sign in again to sync this account." });
      return;
    }
    sendJson(res, 200, publicLedger(db.users[email]));
    return;
  }

  if (req.url === "/ledger" && req.method === "PUT") {
    const email = sessionEmail(req, db);
    if (!email || !db.users[email]) {
      sendJson(res, 401, { message: "Sign in again to sync this account." });
      return;
    }
    const ledger = await readBody(req);
    db.users[email].ledger = {
      ...ledger,
      profile: {
        ...(ledger.profile || {}),
        email,
      },
      updatedAt: new Date().toISOString(),
    };
    await writeDatabase(db);
    sendJson(res, 200, db.users[email].ledger);
    return;
  }

  sendJson(res, 404, { message: "Not found." });
}

async function serveStatic(req, res) {
  const requestPath = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${port}`).pathname);
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(root, safePath === "/" ? "index.html" : safePath);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(file);
  } catch {
    const index = await fs.readFile(path.join(root, "index.html"));
    res.writeHead(200, { "Content-Type": mimeTypes[".html"] });
    res.end(index);
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/auth/") || req.url === "/ledger") {
    handleApi(req, res).catch((error) => sendJson(res, 500, { message: error.message }));
    return;
  }
  serveStatic(req, res).catch((error) => {
    res.writeHead(500);
    res.end(error.message);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`GhostLabs account sync server running at http://127.0.0.1:${port}`);
});
