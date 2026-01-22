/**
 * Safe error logging: avoid dumping pg Client / connection refs,
 * which can stringify entire TLS/socket trees and crash the process.
 */
export function safeLogError(prefix, err) {
  const msg = err?.message ?? String(err);
  const stack = err?.stack;
  console.error(prefix, msg);
  if (stack && stack !== msg) console.error(stack);
}
