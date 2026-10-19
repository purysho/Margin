import { expect, test } from "vitest";
import { decryptSecret, encryptSecret, hashPassword, joinCode, verifyPassword } from "../worker/crypto";

const SECRET = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

test("password hashes verify only with the right password", async () => {
  const h = await hashPassword("correct horse battery");
  expect(h).toMatch(/^pbkdf2\$100000\$/);
  expect(await verifyPassword("correct horse battery", h)).toBe(true);
  expect(await verifyPassword("wrong password!", h)).toBe(false);
  expect(await verifyPassword("x", "garbage")).toBe(false);
});

test("API keys round-trip and are bound to their teacher and provider", async () => {
  const { ciphertext, iv } = await encryptSecret(SECRET, "sk-ant-secret-1234", "teacher1:anthropic");
  expect(ciphertext).not.toContain("secret");
  expect(await decryptSecret(SECRET, ciphertext, iv, "teacher1:anthropic")).toBe("sk-ant-secret-1234");
  await expect(decryptSecret(SECRET, ciphertext, iv, "teacher2:anthropic")).rejects.toThrow();
});

test("join codes are readable", () => {
  expect(joinCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
});
