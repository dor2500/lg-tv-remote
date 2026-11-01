// Weekly codes and the encrypted session between a phone and a TV. Runs on old TV browsers, so it stays ES5.
// The relay only ever sees sealed messages. Needs tweetnacl (nacl) to be loaded.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('tweetnacl'));
  else root.TvSession = factory(root.nacl);
}(this, function (nacl) {
  var ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  var KDF_ROUNDS = 8000;

  function utf8(text) {
    var binary = unescape(encodeURIComponent(text));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function fromUtf8(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(binary));
  }

  function toBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function fromBase64(text) {
    var binary = atob(text);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function concat() {
    var size = 0;
    var i;
    for (i = 0; i < arguments.length; i += 1) size += arguments[i].length;
    var out = new Uint8Array(size);
    var at = 0;
    for (i = 0; i < arguments.length; i += 1) {
      out.set(arguments[i], at);
      at += arguments[i].length;
    }
    return out;
  }

  // The week number changes the codes, so old ones stop working by themselves. Weeks start on Monday, in UTC.
  function weekNumber(now) {
    var days = Math.floor(now.getTime() / 86400000);
    return Math.floor((days + 3) / 7);
  }

  function nextChange(now) {
    return new Date((weekNumber(now) + 1) * 7 * 86400000 - 3 * 86400000);
  }

  // 248 is the largest multiple of the alphabet size in a byte, which keeps every character equally likely.
  function weeklyCodes(secret, week, rotation) {
    var label = 'w' + week + 'r' + rotation;
    var idHash = nacl.hash(concat(secret, utf8('id:' + label)));
    var id = '';
    var i;
    for (i = 0; id.length < 9; i += 1) if (idHash[i] < 250) id += String(idHash[i] % 10);
    var passwordHash = nacl.hash(concat(secret, utf8('password:' + label)));
    var password = '';
    for (i = 0; password.length < 10; i += 1) {
      if (passwordHash[i] < 248) password += ALPHABET.charAt(passwordHash[i] % ALPHABET.length);
    }
    return { id: id, password: password };
  }

  function normalizeId(id) {
    return String(id).replace(/\D/g, '');
  }

  function normalizePassword(password) {
    return String(password).toUpperCase().replace(/[^0-9A-Z]/g, '');
  }

  function hmac(key, message) {
    var block = new Uint8Array(128);
    block.set(key.length > 128 ? nacl.hash(key) : key);
    var inner = new Uint8Array(128);
    var outer = new Uint8Array(128);
    for (var i = 0; i < 128; i += 1) {
      inner[i] = block[i] ^ 0x36;
      outer[i] = block[i] ^ 0x5c;
    }
    return nacl.hash(concat(outer, nacl.hash(concat(inner, message))));
  }

  // PBKDF2-HMAC-SHA512, first block. It slows down anyone guessing the password from a recorded session.
  function deriveKey(password, id) {
    var key = utf8(normalizePassword(password));
    var u = hmac(key, concat(utf8('tv-anywhere:' + normalizeId(id)), new Uint8Array([0, 0, 0, 1])));
    var out = new Uint8Array(u);
    for (var round = 1; round < KDF_ROUNDS; round += 1) {
      u = hmac(key, u);
      for (var i = 0; i < out.length; i += 1) out[i] ^= u[i];
    }
    return out.subarray(0, 32);
  }

  // Each direction has its own counter in the nonce, so a message can't be replayed, reordered or reflected.
  function Cipher(key, isClient) {
    this.key = key;
    this.sendPrefix = isClient ? 1 : 2;
    this.receivePrefix = isClient ? 2 : 1;
    this.sent = 0;
    this.received = 0;
  }

  function nonceFor(prefix, counter) {
    var nonce = new Uint8Array(24);
    nonce[0] = prefix;
    for (var i = 0, rest = counter; i < 6; i += 1) {
      nonce[23 - i] = rest % 256;
      rest = Math.floor(rest / 256);
    }
    return nonce;
  }

  Cipher.prototype.seal = function (object) {
    var nonce = nonceFor(this.sendPrefix, this.sent);
    this.sent += 1;
    return toBase64(nacl.secretbox(utf8(JSON.stringify(object)), nonce, this.key));
  };

  // Returns null for anything that fails authentication.
  Cipher.prototype.open = function (text) {
    var nonce = nonceFor(this.receivePrefix, this.received);
    var opened;
    try {
      opened = nacl.secretbox.open(fromBase64(text), nonce, this.key);
    } catch (err) {
      return null;
    }
    if (!opened) return null;
    this.received += 1;
    return JSON.parse(fromUtf8(opened));
  };

  function sessionCipher(key, clientNonce, agentNonce, isClient) {
    var material = nacl.hash(concat(key, fromBase64(clientNonce), fromBase64(agentNonce)));
    return new Cipher(material.subarray(0, 32), isClient);
  }

  function newNonce() {
    return toBase64(nacl.randomBytes(24));
  }

  return {
    weekNumber: weekNumber,
    nextChange: nextChange,
    weeklyCodes: weeklyCodes,
    normalizeId: normalizeId,
    normalizePassword: normalizePassword,
    deriveKey: deriveKey,
    sessionCipher: sessionCipher,
    newNonce: newNonce,
    randomSecret: function () { return toBase64(nacl.randomBytes(32)); },
    secretBytes: fromBase64,
    toBase64: toBase64,
  };
}));
