const KEY_TEXT = "xeNtBVqzDc6tuNTh";
const IV_TEXT = "MAAAYAAAAAAAAABg";

export async function encryptHuami(plainText) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(KEY_TEXT),
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: new TextEncoder().encode(IV_TEXT) },
    key,
    new TextEncoder().encode(plainText),
  );
  return new Uint8Array(cipher);
}
