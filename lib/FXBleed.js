"use strict";

const { Cc, Ci } = require("chrome");
const { uuid } = require("sdk/util/uuid");
const timers = require("sdk/timers");
const ui = require("./ui.js");

const prefs = require("sdk/preferences/service")
const oldPref = prefs.get("dom.mozTCPSocket.enabled", false);

// create a TCPSocket then reset the pref
prefs.set("dom.mozTCPSocket.enabled", true);
const TCPSocket = Cc["@mozilla.org/tcp-socket;1"]
                      .createInstance(Ci.nsIDOMTCPSocket);

prefs.set("dom.mozTCPSocket.enabled", oldPref);

const CIPHER_SUITES = [
  0xc014, // TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA
  0xc00a, // TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA
  0xc022, // TLS_SRP_SHA_DSS_WITH_AES_256_CBC_SHA
  0xc021, // TLS_SRP_SHA_RSA_WITH_AES_256_CBC_SHA
  0x0039, // TLS_DHE_RSA_WITH_AES_256_CBC_SHA
  0x0038, // TLS_DHE_DSS_WITH_AES_256_CBC_SHA
  0x0088, // TLS_DHE_RSA_WITH_CAMELLIA_256_CBC_SHA
  0x0087, // TLS_DHE_DSS_WITH_CAMELLIA_256_CBC_SHA
  0x0087, // TLS_ECDH_RSA_WITH_AES_256_CBC_SHA
  0xc00f, // TLS_ECDH_ECDSA_WITH_AES_256_CBC_SHA
  0x0035, // TLS_RSA_WITH_AES_256_CBC_SHA
  0x0084, // TLS_RSA_WITH_CAMELLIA_256_CBC_SHA
  0xc012, // TLS_ECDHE_RSA_WITH_3DES_EDE_CBC_SHA
  0xc008, // TLS_ECDHE_ECDSA_WITH_3DES_EDE_CBC_SHA
  0xc01c, // TLS_SRP_SHA_DSS_WITH_3DES_EDE_CBC_SHA
  0xc01b, // TLS_SRP_SHA_RSA_WITH_3DES_EDE_CBC_SHA
  0x0016, // TLS_DHE_RSA_WITH_3DES_EDE_CBC_SHA
  0x0013, // TLS_DHE_DSS_WITH_3DES_EDE_CBC_SHA
  0xc00d, // TLS_ECDH_RSA_WITH_3DES_EDE_CBC_SHA
  0xc003, // TLS_ECDH_ECDSA_WITH_3DES_EDE_CBC_SHA
  0x000a, // TLS_RSA_WITH_3DES_EDE_CBC_SHA
  0xc013, // TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA
  0xc009, // TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA
  0xc01f, // TLS_SRP_SHA_DSS_WITH_AES_128_CBC_SHA
  0xc01e, // TLS_SRP_SHA_RSA_WITH_AES_128_CBC_SHA
  0x0033, // TLS_DHE_RSA_WITH_AES_128_CBC_SHA
  0x0032, // TLS_DHE_DSS_WITH_AES_128_CBC_SHA
  0x009a, // TLS_DHE_RSA_WITH_SEED_CBC_SHA
  0x0099, // TLS_DHE_DSS_WITH_SEED_CBC_SHA
  0x0045, // TLS_DHE_RSA_WITH_CAMELLIA_128_CBC_SHA
  0x0044, // TLS_DHE_DSS_WITH_CAMELLIA_128_CBC_SHA
  0xc00e, // TLS_ECDH_RSA_WITH_AES_128_CBC_SHA
  0xc004, // TLS_ECDH_ECDSA_WITH_AES_128_CBC_SHA
  0x002f, // TLS_RSA_WITH_AES_128_CBC_SHA
  0x0096, // TLS_RSA_WITH_SEED_CBC_SHA
  0x0041, // TLS_RSA_WITH_CAMELLIA_128_CBC_SHA
  0xc011, // TLS_ECDHE_RSA_WITH_RC4_128_SHA
  0xc007, // TLS_ECDHE_ECDSA_WITH_RC4_128_SHA
  0xc00c, // TLS_ECDH_RSA_WITH_RC4_128_SHA
  0xc002, // TLS_ECDH_ECDSA_WITH_RC4_128_SHA
  0x0005, // TLS_RSA_WITH_RC4_128_SHA
  0x0004, // TLS_RSA_WITH_RC4_128_MD5
  0x0015, // TLS_DHE_RSA_WITH_DES_CBC_SHA
  0x0012, // TLS_DHE_DSS_WITH_DES_CBC_SHA
  0x0009, // TLS_RSA_WITH_DES_CBC_SHA
  0x0014, // TLS_DHE_RSA_EXPORT_WITH_DES40_CBC_SHA
  0x0011, // TLS_DHE_DSS_EXPORT_WITH_DES40_CBC_SHA
  0x0008, // TLS_RSA_EXPORT_WITH_DES40_CBC_SHA
  0x0006, // TLS_RSA_EXPORT_WITH_RC2_CBC_40_MD5
  0x0003, // TLS_RSA_EXPORT_WITH_RC4_40_MD5
  0x00ff // Unknown
]

const HANDSHAKE_RECORD_TYPE = 0x16
const HEARTBEAT_RECORD_TYPE = 0x18
const ALERT_RECORD_TYPE = 0x15
const TLS_VERSION = {
  "1.0": 0x0301,
  "1.1": 0x0302,
  "1.2": 0x0303
}

// hardcode version for now
const VERSION = TLS_VERSION["1.1"];

// Use large enough packet so that OS doesn't buffer
const HB_LENGTH = 5000;


let HOSTNAME_CACHE = {};

function heartbeat(host) {
  let payload = new Uint8Array(HB_LENGTH + 3);
  let pos = 0;

  payload[pos++] = 0x01;
  payload[pos++] = (HB_LENGTH >> 8) & 0xFF;
  payload[pos++] = (HB_LENGTH >> 0) & 0xFF;

  // store host so we can identify
  for (let i = 0; i < host.length; i++) {
    payload[pos++] = host.charCodeAt(i);
  }

  // dummy data
  for (let i = 0; i < HB_LENGTH - host.length; i++) {
    payload[pos++] = 1;
  }

  console.log(payload.byteLength);
  return ssl_record(HEARTBEAT_RECORD_TYPE, payload);
}

function client_hello() {
  // larger than needed
  let hello_data = new Uint8Array(1024);
  let pos = 0;

  //version
  hello_data[pos++] = (VERSION >> 8) & 0xFF;
  hello_data[pos++] = (VERSION >> 0) & 0xFF;

  // time
  let time_epoch = parseInt(new Date().getTime());
  hello_data[pos++] = (time_epoch >> 24) & 0xFF;
  hello_data[pos++] = (time_epoch >> 16) & 0xFF;
  hello_data[pos++] = (time_epoch >> 8) & 0xFF;
  hello_data[pos++] = (time_epoch >> 0) & 0xFF;

  // "random" data
  let rand = uuid()["number"].substring(0, 28);
  for (let i = 0; i < rand.length; i++) {
    hello_data[pos++] = rand[i];
  }

  // session ID length
  hello_data[pos++] = 0x00;

  // Cipher suite length
  let c_length = CIPHER_SUITES.length * 2;
  hello_data[pos++] = (c_length >> 8) & 0xFF;
  hello_data[pos++] = (c_length >> 0) & 0xFF;

  // Cipher Suites
  for (let i = 0; i < CIPHER_SUITES.length; i++) {
    hello_data[pos++] = (CIPHER_SUITES[i] >> 8) & 0xFF;
    hello_data[pos++] = (CIPHER_SUITES[i] >> 0) & 0xFF;
  }

  hello_data[pos++] = 0x01; // Compression methods length
  hello_data[pos++] = 0x00; // Compression method: null

  hello_data[pos++] = 0x00; // extension data length
  hello_data[pos++] = 0x05;

  hello_data[pos++] = 0x00; // Extension type (Heartbeat)
  hello_data[pos++] = 0x0F;
  hello_data[pos++] = 0x00; // Extension length
  hello_data[pos++] = 0x01;
  hello_data[pos++] = 0x01; // Extension data

  let data = new Uint8Array(4 + pos);
  data[0] = 0x01;           // Handshake Type: Client Hello
  data[1] = 0x00;
  data[2] = (pos >> 8) & 0xFF; // Length
  data[3] = (pos >> 0) & 0xFF;
  data.set(hello_data.subarray(0, pos), 4);

  return ssl_record(HANDSHAKE_RECORD_TYPE, data);
}

function ssl_record(type, data) {
  let record = new Uint8Array(5 + data.byteLength);
  record[0] = type;
  record[1] = (VERSION >> 8) & 0xFF;
  record[2] = (VERSION >> 0) & 0xFF;
  record[3] = (data.byteLength >> 8) & 0xFF;
  record[4] = (data.byteLength >> 0) & 0xFF;
  record.set(data, 5);
  return record.buffer;
}

function connect(url) {
  let host = url.host;
  let server = url.hostname;
  let port = url.port || 443;
  console.log("Connecting to " + host);
  try {
    let sock = TCPSocket.open(server, port, {binaryType: "arraybuffer"});
    let t;

    sock.ondata = function (evt) {
      let view = new Uint8Array(evt.data);

      switch (view[0]) {
        case HANDSHAKE_RECORD_TYPE:
          if (!t) {
            console.log("Sending HB");
            sock.send(heartbeat(host));
            t = timers.setTimeout(function() {
                  console.log("No response, assuming safe");
                  sock.close();
            }, 2000);
          }
          break;
        case HEARTBEAT_RECORD_TYPE:
          sock.close();
          if (String.fromCharCode.apply(null, view).indexOf(host) !== -1) {
            console.log("Received a HB response!");
            HOSTNAME_CACHE[host] = true;
            ui.notify(host);
          } else {
            console.log("Heartbeat missing hostname!");
          }
          break;
        // alert
        case 0x15:
        default:
          console.log("Unhandled record type: " + view[0]);
          break;
      }
    }

    sock.onerror = function (evt) {
      console.log("Received an error: " + evt.data.name);
    }

    sock.onclose = function () {
      timers.clearTimeout(t);
      console.log("Socket closed");
    }

    sock.onopen = function () {
      console.log("Sending ClientHello");
      sock.send(client_hello());
    }

  } catch (e) {
    console.log("Error: " + e.name);
  }
}

exports.connect = connect;
exports.HOSTNAME_CACHE = HOSTNAME_CACHE;