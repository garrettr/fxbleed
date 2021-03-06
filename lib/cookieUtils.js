"use strict";

const { Cc, Ci, Cu } = require("chrome");

const cookieManager  = Cc["@mozilla.org/cookiemanager;1"]
                       .getService(Ci.nsICookieManager)
const cookieManager2 = Cc["@mozilla.org/cookiemanager;1"]
                      .getService(Ci.nsICookieManager2)

function hasCookies(host) {
  let cookieEnumerator = cookieManager2.getCookiesFromHost(host);
  if (cookieEnumerator.hasMoreElements()) {
    return true;
  }
  return false;
}

function clearCookiesForHost(host) {
  let cookieEnumerator = cookieManager2.getCookiesFromHost(host);
  while (cookieEnumerator.hasMoreElements()) {
    let cookie = cookieEnumerator.getNext().QueryInterface(Ci.nsICookie);
    cookieManager.remove(cookie.host, cookie.name, cookie.path, false);
  }
}

exports.hasCookies = hasCookies;
exports.clearCookiesForHost = clearCookiesForHost;
