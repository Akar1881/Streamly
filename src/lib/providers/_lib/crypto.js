// crypto.js — Hermes-safe encoding helpers (no Node `crypto`, no guaranteed atob).
// Used by 4KHDHub (base64+ROT13 fallback). Videasy's custom cipher lives in
// videasy.js because it's specific to that provider.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Decode base64 -> byte array. Maps url-safe (-_) to standard (+/) FIRST, then
// strips padding/whitespace. Videasy sends url-safe base64.
function base64Decode(str) {
  const clean = String(str).replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n0 = B64.indexOf(clean[i]);
    const n1 = B64.indexOf(clean[i + 1]);
    const n2 = clean[i + 2] ? B64.indexOf(clean[i + 2]) : -1;
    const n3 = clean[i + 3] ? B64.indexOf(clean[i + 3]) : -1;
    bytes.push((n0 << 2) | (n1 >> 4));
    if (n2 >= 0) bytes.push(((n1 & 15) << 4) | (n2 >> 2));
    if (n3 >= 0) bytes.push(((n2 & 3) << 6) | n3);
  }
  return bytes;
}

// base64 -> UTF-8 string.
function base64DecodeStr(str) {
  return utf8Decode(base64Decode(str));
}

// Encode a byte array (or ASCII/Latin1 string) to standard base64.
function base64Encode(input) {
  const bytes = typeof input === 'string' ? input.split('').map((c) => c.charCodeAt(0) & 255) : input;
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

// URL-safe base64 with padding stripped (for 111477 config tokens).
function base64UrlEncode(input) {
  return base64Encode(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function rot13(str) {
  return String(str).replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

// Minimal UTF-8 decoder (Hermes has no guaranteed TextDecoder).
function utf8Decode(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b >= 0xc0 && b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (b >= 0xe0 && b < 0xf0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    } else {
      let cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

module.exports = { base64Decode, base64DecodeStr, base64Encode, base64UrlEncode, rot13, utf8Decode };
