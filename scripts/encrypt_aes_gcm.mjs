#!/usr/bin/env node
/**
 * Zero-dependency gzip + AES-256-GCM + PBKDF2-HMAC-SHA256 helper.
 * Ciphertext layout (ciphertext || 16-byte GCM authTag) matches browser Web Crypto API bit-for-bit.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";

const ITERATIONS = 200000;
const KEY_LEN = 32; // 256-bit

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function deriveKey(password, salt, iterations = ITERATIONS) {
  return crypto.pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, KEY_LEN, "sha256");
}

function encryptText(plaintext, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt, ITERATIONS);
  const payload = zlib.gzipSync(Buffer.from(plaintext, "utf8"), { level: 9 });
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([enc, tag]);
  return JSON.stringify(
    {
      encrypted: true,
      v: 1,
      compressed: "gzip",
      kdf: "PBKDF2-SHA256",
      iterations: ITERATIONS,
      alg: "AES-256-GCM",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      ciphertext: combined.toString("base64"),
    },
    null,
    2
  );
}

function decryptText(envelopeJson, password) {
  const env = JSON.parse(envelopeJson);
  if (!env || !env.encrypted || !env.salt || !env.iv || !env.ciphertext) {
    throw new Error("Invalid encrypted envelope");
  }
  const salt = Buffer.from(env.salt, "base64");
  const iv = Buffer.from(env.iv, "base64");
  const combined = Buffer.from(env.ciphertext, "base64");
  if (combined.length < 17) throw new Error("Ciphertext too short");
  const ciphertext = combined.subarray(0, combined.length - 16);
  const tag = combined.subarray(combined.length - 16);
  const key = deriveKey(password, salt, Number(env.iterations) || ITERATIONS);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (env.compressed === "gzip") {
    return zlib.gunzipSync(dec).toString("utf8");
  }
  return dec.toString("utf8");
}

const mode = process.argv[2];
const password = process.env.CALENDAR_PASSWORD || "";
if (!password) {
  console.error("Missing CALENDAR_PASSWORD environment variable");
  process.exit(2);
}

const input = await readStdin();
try {
  if (mode === "encrypt") {
    process.stdout.write(encryptText(input, password) + "\n");
  } else if (mode === "decrypt") {
    process.stdout.write(decryptText(input, password));
  } else {
    console.error("Usage: encrypt_aes_gcm.mjs <encrypt|decrypt>");
    process.exit(2);
  }
} catch (err) {
  console.error(err.message || String(err));
  process.exit(1);
}
