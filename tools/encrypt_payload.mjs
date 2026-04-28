#!/usr/bin/env node
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const password = process.env.M2M_APP_PASSWORD;

if (!password) {
  throw new Error("Set M2M_APP_PASSWORD before encrypting the script payload.");
}

function parseAssignedJson(filename, globalName) {
  const raw = readFileSync(resolve(appDir, filename), "utf8").trim();
  const prefix = `window.${globalName} = `;
  if (!raw.startsWith(prefix)) throw new Error(`Unexpected ${filename} format`);
  return JSON.parse(raw.slice(prefix.length).replace(/;$/, ""));
}

const script = parseAssignedJson("script-data.js", "M2M_SCRIPT");
const sourceMd = parseAssignedJson("source-md.js", "M2M_SOURCE_MD");
const clear = Buffer.from(JSON.stringify({ script, sourceMd }), "utf8");
const salt = randomBytes(16);
const iv = randomBytes(12);
const iterations = 210000;
const key = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const cipher = createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([cipher.update(clear), cipher.final(), cipher.getAuthTag()]);

const payload = {
  version: 1,
  algorithm: "AES-GCM",
  kdf: "PBKDF2",
  hash: "SHA-256",
  iterations,
  salt: salt.toString("base64"),
  iv: iv.toString("base64"),
  ciphertext: encrypted.toString("base64"),
};

writeFileSync(
  resolve(appDir, "encrypted-data.js"),
  `window.M2M_ENCRYPTED_PAYLOAD = ${JSON.stringify(payload, null, 2)};\n`,
  "utf8",
);

console.log("Encrypted script payload written to encrypted-data.js");
