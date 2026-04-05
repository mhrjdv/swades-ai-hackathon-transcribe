/**
 * Computes a SHA-256 hex digest of the given ArrayBuffer.
 * Uses the Web Crypto API (SubtleCrypto) which is available in all modern
 * browsers and in Node.js 16+.
 */
export async function computeChecksum(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
