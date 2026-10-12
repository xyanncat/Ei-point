import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
const key = (secret: string) =>
  createHash("sha256").update(`ei-oauth-vault:${secret}`).digest();
export function encryptToken(token: string, secret: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decryptToken(value: string, secret: string): string {
  const [iv, tag, data, extra] = value.split(".");
  if (!iv || !tag || !data || extra !== undefined) throw Error("invalid-token");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(secret),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    cipher.update(Buffer.from(data, "base64url")),
    cipher.final(),
  ]).toString("utf8");
}
