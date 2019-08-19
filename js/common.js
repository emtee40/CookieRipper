/*
 *
 * This file contains functions that may be used by all the other js files.
 *
 */
/* for accessing variables from background page if not in private mode */
var bgPage = browser.extension.getBackgroundPage();
/* whether firstPartyIsolation is supported */
var firstPartyIsolationSupported = checkFirstPartyIsolationSupport();

function checkFirstPartyIsolationSupport() {
  // checks whether the first party domain cookie property is supported
  var getting = browser.cookies.get({
    name: '',
    url: '',
    firstPartyDomain: ''
  });
  getting.then(function() {
    return true
  }, function() {
    return false
  });
}
/*
 * functions for getting settings from background page
 * getting them from the background page is better than storing them in a variable because only the background page reloads the settings when changed by the user
 * it is also less limited and probably faster than reading from the disk even when using the messaging api
 * the functions either call a funtion in the background page directly or send a message to do their job
 */
function callGetDefaultBehaviour() {
  // gets default behaviour from background page
  var result = new Promise(async function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      resolve(bgPage.defaultBehaviour);
    } else {
      var getting = browser.runtime.sendMessage({
        type: 'getDefaultBehaviour'
      });
      getting.then(resolve, logError);
    }
  });
  return result;
}

function callGetEnableCookieCounter() {
  // gets default behaviour from background page
  var result = new Promise(async function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      resolve(bgPage.enableCookieCounter);
    } else {
      var getting = browser.runtime.sendMessage({
        type: 'getEnableCookieCounter'
      });
      getting.then(resolve, logError);
    }
  });
  return result;
}

function callLoadSettings() {
  // reloads settings in background page
  var result = new Promise(async function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      bgPage.loadSettings();
    } else {
      var getting = browser.runtime.sendMessage({
        type: 'loadSettings'
      });
      getting.then(resolve, logError);
    }
  });
  return result;
}
/*
 *cookie functions
 */
function getAllCookies(parameters) {
  // returns all cookies matching the given criteria
  if (firstPartyIsolationSupported) {
    parameters.firstPartyDomain = null;
  }
  return browser.cookies.getAll(parameters);
}

function addCookie(name, value, domain, path, session, date, time, hostOnly, secure, httpOnly, cookieStore, firstPartyDomain, overwriteCookie = null) {
  // creates a new cookie from the given data; also makes sure the provided overwrite-cookie gets actually overwritten or deleted
  var result = new Promise(async function(resolve, reject) {
    // delete overwriteCookie
    if (overwriteCookie !== null) {
      await deleteCookie(overwriteCookie);
    }
    // create new cookie
    var url = (domain.startsWith('.') ? `https://${domain.substr(1)}` : `https://${domain}`);
    var expirationDate = (session ? null : ((date.getTime() + time.getTime() + new Date().getTimezoneOffset() * 60000) / 1000));
    var parameters = {
      // url is mainly used for creating host only cookies (do this by specifying no domain) which are only accessible for the exact (sub-)domain
      url: url,
      // deal with host only --> do not supply domain if host only
      domain: (hostOnly ? null : domain),
      path: path,
      name: name,
      value: value,
      secure: secure,
      httpOnly: httpOnly,
      // if not a session cookie convert date to seconds since 1980
      expirationDate: expirationDate,
      storeId: cookieStore
    };
    if (firstPartyIsolationSupported) {
      parameters.firstPartyDomain = firstPartyDomain;
    }
    var setting = browser.cookies.set(parameters);
    setting.then(async function() {
      // make sure that if the cookie is unwanted, it is deleted before resolving to prevent the ui from refreshing too early with incorrect data
      // cookie.set returns a cookie object but seems to be unreliable in both chromium and ff so just use the input data instead
      if (!domain.startsWith(".")) {
        var newDomain = hostOnly ? domain : `.${domain}`;
      } else {
        newDomain = hostOnly ? domain.slice(1) : domain;
      }
      var newCookie = {
        url: url,
        // deal with host only --> do not supply domain if host only
        domain: newDomain,
        path: path,
        name: name,
        value: value,
        secure: secure,
        httpOnly: httpOnly,
        // if not a session cookie convert date to seconds since 1980
        expirationDate: expirationDate,
        storeId: cookieStore
      };
      var allowed = await getCookieAllowedState(newCookie);
      if (allowed) {
        resolve();
      } else {
        await callAddUnwantedCookie(newCookie);
        await deleteCookie(newCookie);
        resolve();
      }
    }, async function(error) {
      // restore overwriteCookie if new cookie could not be set
      if (overwriteCookie !== null) {
        await addCookieFromObject(overwriteCookie);
      }
      reject(error);
    });
  });
  return result;
}

function addCookieFromObject(cookie, cookieStore) {
  // creates a new cookie from the given cookie object
  var result = new Promise(async function(resolve, reject) {
    // create new cookie
    var parameters = {
      // url is mainly used for creating host only cookies (do this by specifying no domain) which are only accessible for the exact (sub-)domain
      // create url from domain (remove leading . first)
      url: (cookie.domain.startsWith('.') ? `https://${cookie.domain.substr(1)}` : `https://${cookie.domain}`),
      // deal with host only --> do not supply domain if host only
      domain: (cookie.hostOnly ? null : cookie.domain),
      path: cookie.path,
      name: cookie.name,
      value: cookie.value,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expirationDate,
      storeId: cookieStore
    };
    if (firstPartyIsolationSupported) {
      parameters.firstPartyDomain = cookie.firstPartyDomain;
    }
    var setting = browser.cookies.set(parameters);
    setting.then(resolve, logError);
  });
  return result;
}

function deleteCookie(cookie) {
  // deletes the provided cookie
  var result = new Promise(function(resolve, reject) {
    var parameters = {
      url: `https://${cookie.domain}${cookie.path}`,
      name: cookie.name,
      storeId: cookie.storeId
    };
    if (firstPartyIsolationSupported) {
      parameters.firstPartyDomain = cookie.firstPartyDomain;
    }
    var removing = browser.cookies.remove(parameters);
    removing.then(resolve, logError);
  });
  return result;
}

function deleteAllCookies(url, cookieStore) {
  // deletes all cookies from the given url
  var result = new Promise(function(resolve, reject) {
    var getting = getAllCookies({
      url: url,
      storeId: cookieStore
    });
    getting.then(async function(siteCookies) {
      var promises = siteCookies.map(function(cookie) {
        return deleteCookie(cookie);
      });
      // also remove unwanted cookies from memory
      promises.push(callClearUnwantedCookiesforHostname(url));
      await Promise.all(promises);
      resolve();
    }, logError);
  });
  return result;
}

function deleteExistingUnwantedCookies(url, cookieStore) {
  // deletes all existung but unwanted cookies from a given url
  var result = new Promise(async function(resolve, reject) {
    var hostname = trimSubdomains(url);
    var behaviour = await getSiteBehaviour(hostname);
    var getting = getAllCookies({
      url: url,
      storeId: cookieStore
    });
    getting.then(async function(siteCookies) {
      var promises = siteCookies.map(function(cookie) {
        if (behaviour == 0 || (behaviour == 1 && !cookie.session)) {
          return getObjectWhitelistedState(cookie.domain, cookie.name, 'c').then(async function(whitelisted) {
            if (!whitelisted) {
              await deleteCookie(cookie);
              await callAddUnwantedCookie(cookie);
            }
          });
        }
      });
      await Promise.all(promises);
      resolve();
    }, logError);
  });
  return result;
}

function deleteAllTabsExistingUnwantedCookies() {
  // deletes all existung but unwanted cookies from all open tabs
  var result = new Promise(function(resolve, reject) {
    var querying = browser.tabs.query({});
    querying.then(async function(tabs) {
      var promises = tabs.map(function(tab) {
        if (tab.url.startsWith('http')) {
          return getTabCookieStore(tab.id).then(async function(cookieStore) {
            await deleteExistingUnwantedCookies(tab.url, cookieStore);
          });
        }
      });
      await Promise.all(promises);
      resolve();
    }, logError);
  });
  return result;
}

function getCookieAllowedState(cookie) {
  // returns if a given cookie is allowed (should be accepted) or not
  var result = new Promise(async function(resolve, reject) {
    var hostname = trimSubdomains(`http://${cookie.domain}`);
    var caseBehaviour = await getSiteBehaviour(hostname);
    // allow if all cookies are allowed for that site
    if (caseBehaviour == 2) {
      return resolve(true);
    }
    // allow if the cookie is whitelisted
    var whitelisted = await getObjectWhitelistedState(cookie.domain, cookie.name, 'c');
    if (whitelisted) {
      return resolve(true);
    }
    switch (caseBehaviour) {
      case 0:
        // dont allow if cookies are not allowed for the site
        resolve(false);
        break;
      case 1:
        // allow session
        if (cookie.session) {
          // allow if session cookies are allowed and its a session cookie
          resolve(true);
        } else {
          // deny if session cookies are allowed and its not a session cookie
          resolve(false);
        }
        break;
      default:
        // invalid
        logError({
          message: `Error: invalid Behaviour: ${caseBehaviour}`
        });
    }
  });
  return result;
}
async function handleCookieEvent(changeInfo) {
  // is used when a cookie change event needs to be handled
  // determines the correct action to take and executes it
  // note: .removed is also true when overwriting as the cookie is removed completely first
  // exit if remove event (no cookie is added / changed)
  if (changeInfo.removed) {
    return;
  }
  var allowed = await getCookieAllowedState(changeInfo.cookie);
  if (!allowed) {
    callAddUnwantedCookie(changeInfo.cookie);
    await deleteCookie(changeInfo.cookie);
    updateActiveTabsCounts();
  }
}
/*
 * unwanted cookie functions
 * the functions either call a funtion in the background page directly or send a message to do their job
 */
function callGetUnwantedCookiesForHostname(hostname) {
  // returns the object that stores the cookies for the given hostname in unwanted list
  var result = new Promise(async function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      var getting = bgPage.getUnwantedCookiesForHostname({
        hostname: hostname
      });
    } else {
      getting = browser.runtime.sendMessage({
        type: 'getUnwantedCookiesForHostname',
        hostname: hostname
      });
    }
    getting.then(resolve, logError);
  });
  return result;
}

function callAddUnwantedCookie(cookie) {
  // adds a cookie to the list of unwanted cookies
  var result = new Promise(function(resolve, reject) {
    // only do it if the site is opened in a tab
    // stringify to prevent some weird ff dead object issue
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      var adding = bgPage.addUnwantedCookie({
        cookie: cookie
      });
    } else {
      adding = browser.runtime.sendMessage({
        type: 'addUnwantedCookie',
        cookie: cookie
      });
    }
    adding.then(resolve, logError);
  });
  return result;
}

function callRestoreUnwantedCookie(domain, name, cookieStore) {
  // re-creates a cookie from unwanted list in case the user whitelists it
  var result = new Promise(async function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      var getting = bgPage.restoreUnwantedCookie({
        domain: domain,
        name: name,
        cookieStore: cookieStore
      });
    } else {
      getting = browser.runtime.sendMessage({
        type: 'restoreUnwantedCookie',
        domain: domain,
        name: name,
        cookieStore: cookieStore
      });
    }
    getting.then(resolve, logError);
  });
  return result;
}

function callRestoreAllHostnamesUnwantedCookies() {
  // re-creates cookies from unwanted list in case the user changes the behaviour for a hostname
  var result = new Promise(async function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      var restoring = bgPage.restoreAllHostnamesUnwantedCookies();
    } else {
      restoring = browser.runtime.sendMessage({
        type: 'restoreAllHostnamesUnwantedCookies'
      });
    }
    restoring.then(resolve, logError);
  });
  return result;
}

function callDeleteUnwantedCookie(domain, name) {
  // deletes a cookie from the list of unwanted cookies
  var result = new Promise(function(resolve, reject) {
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      var adding = bgPage.deleteUnwantedCookie({
        domain: domain,
        name: name
      });
    } else {
      adding = browser.runtime.sendMessage({
        type: 'deleteUnwantedCookie',
        domain: domain,
        name: name
      });
    }
    adding.then(resolve, logError);
  });
  return result;
}

function callClearUnwantedCookiesforHostname(url) {
  // clears all unwanted cookies from the list of unwanted cookies for a hostname
  var result = new Promise(function(resolve, reject) {
    var hostname = trimSubdomains(url);
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      var deleting = bgPage.clearUnwantedCookiesforHostname({
        hostname: hostname
      });
    } else {
      deleting = browser.runtime.sendMessage({
        type: 'clearUnwantedCookiesforHostname',
        hostname: hostname
      });
    }
    deleting.then(resolve, logError);
  });
  return result;
}
/*
 * dom storage functions
 * the functions communicate with injected js in the tab in order to do their job
 */
function getTabDomStorage(tabId) {
  // returns both local and session storage from a given tab
  var result = new Promise(function(resolve, reject) {
    var sending = browser.tabs.sendMessage(tabId, {
      type: 'getStorage'
    });
    sending.then(function(result) {
      result.localStorage = JSON.parse(result.localStorage);
      result.sessionStorage = JSON.parse(result.sessionStorage);
      resolve(result);
    }, reject);
  });
  return result;
}

function getUnwantedDomStoregeEntries(tabId) {
  // the unwanted dom storage entries from a given tab
  var result = new Promise(function(resolve, reject) {
    var sending = browser.tabs.sendMessage(tabId, {
      type: 'getUnwantedStorage'
    });
    sending.then(function(result) {
      resolve(result);
    }, reject);
  });
  return result;
}

function addDomStorageEntry(tabId, persistent, name, value, overwriteEntry = null) {
  // adds a new dom storage entry to a given tab
  var result = new Promise(async function(resolve, reject) {
    // delete overwriteEntry
    if (overwriteEntry !== null) {
      await deleteDomStorageEntry(tabId, overwriteEntry);
    }
    var storage = (persistent ? 'local' : 'session');
    var sending = browser.tabs.sendMessage(tabId, {
      type: 'addEntry',
      storage: storage,
      name: name,
      value: value
    });
    sending.then(resolve, async function(error) {
      // restore overwriteEntry if new entry could not be set
      if (overwriteEntry !== null) {
        await addDomStorageEntry(tabId, overwriteEntry.permanence, overwriteEntry.name, overwriteEntry.value);
      }
      reject(error);
    });
  });
  return result;
}

function deleteDomStorageEntry(tabId, entry) {
  // deletes a given dom storage entry from a given tab
  var result = new Promise(function(resolve, reject) {
    var sending = browser.tabs.sendMessage(tabId, {
      type: 'deleteEntry',
      entry: entry
    });
    sending.then(resolve, logError);
  });
  return result;
}

function clearTabDomStorage(tabId) {
  // deletes all dom storage entries from a given tab
  var answer = new Promise(function(resolve, reject) {
    var sending = browser.tabs.sendMessage(tabId, {
      type: 'clearStorage'
    });
    sending.then(resolve, logError);
  });
  return answer;
}
/*
 * site exception functions
 */
function getSiteException(hostname, temporary) {
  // returns the exception for the given hostname; returns null if there is none
  var result = new Promise(function(resolve, reject) {
    if (temporary) {
      // use function directly or send message depending on the availability of bgPage
      if (bgPage !== null) {
        var getting = bgPage.getTempSiteException({
          hostname: hostname
        });
      } else {
        getting = browser.runtime.sendMessage({
          type: 'getTempSiteException',
          hostname: hostname
        });
      }
      getting.then(resolve, logError);
    } else {
      var key = `ex|${hostname}`;
      getting = browser.storage.local.get({
        [key]: null
      });
      getting.then(function(items) {
        resolve(items[key]);
      }, logError);
    }
  });
  return result;
}

function addSiteException(url, rule, temporary, overwriteException = null) {
  // adds a new site exception for the given domain
  var result = new Promise(async function(resolve, reject) {
    // delete overwriteException
    if (overwriteException !== null) {
      await deleteSiteException(`https://${overwriteException.domain}`, false);
    }
    var hostname = trimSubdomains(url);
    if (temporary) {
      // use function directly or send message depending on the availability of bgPage
      if (bgPage !== null) {
        var adding = bgPage.addTempSiteException({
          hostname: hostname,
          rule: rule
        });
      } else {
        adding = browser.runtime.sendMessage({
          type: 'addTempSiteException',
          hostname: hostname,
          rule: rule
        });
      }
      adding.then(function() {
        resolve();
      }, logError);
    } else {
      var saving = savePermSiteException(hostname, rule);
      saving.then(async function() {
        await deleteSiteException(`https://${hostname}`, true);
        await Promise.all([callRestoreAllHostnamesUnwantedCookies(),
          deleteAllTabsExistingUnwantedCookies()
        ]);
        resolve();
        updateAllTabsIcons();
        updateActiveTabsCounts();
      }, async function(error) {
        // restore overwriteException if new exception could not be set
        if (overwriteException !== null) {
          await addSiteException(`https://${overwriteException.domain}`, overwriteException.ruleId, false);
        }
        reject(error);
      });
    }
    return result;

    function savePermSiteException(hostname, rule) {
      // sets an exception for a given hostname
      var result = new Promise(function(resolve, reject) {
        try {
          // make sure the hostname is valid
          var url = new URL(`http://${hostname}`);
          // count . in hostname to reject subdomains
          var domainCount = url.hostname.split('.').length - 1;
          if (domainCount > 1) {
            reject(Error('Subdomains are not supportet.'));
            return;
          } else if (domainCount < 1) {
            reject(Error('Top-level domains only are not supported.'));
            return;
          }
        } catch (e) {
          reject(e);
          return;
        }
        var setting = browser.storage.local.set({
          // use prefix 'ex' for exceptions and hostname as key
          [`ex|${hostname}`]: rule
        });
        setting.then(resolve, logError);
      });
      return result;
    }
  });
  return result;
}

function deletePermSiteException(hostname) {
  // deletes the permanent exception for the given hostname (if there is any)
  var result = new Promise(function(resolve, reject) {
    var key = `ex|${encodeURI(hostname)}`;
    var removing = browser.storage.local.remove(key)
    removing.then(resolve, logError);
  });
  return result;
}

function deleteSiteException(url, temporary) {
  // deletes the permanent or temporary exception for the given hostname (if there is any)
  var result = new Promise(async function(resolve, reject) {
    var hostname = trimSubdomains(url);
    if (temporary) {
      // use function directly or send message depending on the availability of bgPage
      if (bgPage !== null) {
        var deleting = bgPage.deleteTempSiteException({
          hostname: hostname
        });
      } else {
        deleting = browser.runtime.sendMessage({
          type: 'deleteTempSiteException',
          hostname: hostname
        });
      }
      deleting.then(resolve, logError);
    } else {
      await deletePermSiteException(hostname);
      await Promise.all([callRestoreAllHostnamesUnwantedCookies(),
        deleteAllTabsExistingUnwantedCookies()
      ]);
      resolve();
      updateAllTabsIcons();
      updateActiveTabsCounts();
    }
  });
  return result;
}

function clearTempSiteExceptions(url) {
  // deletes all temp site exceptions
  var result = new Promise(async function(resolve, reject) {
    var hostname = trimSubdomains(url);
    // use function directly or send message depending on the availability of bgPage
    if (bgPage !== null) {
      var deleting = bgPage.deleteTempSiteException({
        hostname: hostname
      });
    } else {
      deleting = browser.runtime.sendMessage({
        type: 'clearTempSiteExceptions',
        hostname: hostname
      });
    }
    deleting.then(resolve, logError);
  });
  return result;
}

function getSiteBehaviour(hostname) {
  // returns the behaviour for a given hostname
  // takes temporary and permanent exceptions as well as whitelist entries into account
  var result = new Promise(async function(resolve, reject) {
    // first check if there is a temporary exception
    var tempException = await getSiteException(hostname, true);
    if (tempException !== null) {
      return resolve(tempException);
    } else {
      // if there is no temporary exception, check for a permanent one
      var permSiteException = await getSiteException(hostname, false);
      if (permSiteException !== null) {
        return resolve(permSiteException);
      } else {
        // if there is no permanent exception either, use default behaviour
        return resolve(await callGetDefaultBehaviour());
      }
    }
  });
  return result;
}
/*
 * whitelist functions
 */
function getObjectWhitelistedState(domain, name, type) {
  // returns wether a whitelist entry exists
  var result = new Promise(function(resolve, reject) {
    domain = domain.startsWith('.') ? domain.substr(1) : domain;
    var key = `wl|${encodeURI(domain)}|${encodeURI(name)}|${type}`;
    var getting = browser.storage.local.get({
      [key]: null
    });
    getting.then(function(items) {
      var whitelistedEntry = items[key];
      if (whitelistedEntry === null) {
        resolve(false);
      } else {
        resolve(true);
      }
    }, logError);
  });
  return result;
}

function addWhitelistEntry(domain, name, type, overwriteEntry = null) {
  // adds a new whitelist with the given data
  domain = domain.startsWith('.') ? domain.substr(1) : domain;
  var result = new Promise(async function(resolve, reject) {
    try {
      // make sure the domain is valid
      new URL(`http://${domain}`);
    } catch (e) {
      return reject(e);
    }
    // delete overwriteEntry
    if (overwriteEntry !== null) {
      await deleteWhitelistEntry(overwriteEntry.domain, overwriteEntry.name, overwriteEntry.type);
    }
    var setting = browser.storage.local.set({
      // use prefix 'wl' for whitelist entries and both domain and name as key
      // last letter is the type: d --> dom storage, c --> cookie
      //use '|' as separator and encode all the other stuff to prevent fuck ups
      [`wl|${encodeURI(domain)}|${encodeURI(name)}|${type}`]: ''
    });
    setting.then(resolve, async function(error) {
      // restore overwriteEntry if new entry could not be set
      if (overwriteEntry !== null) {
        await addWhitelistEntry(overwriteEntry.domain, overwriteEntry.name, overwriteEntry.type);
      }
      reject(error);
    });
  });
  return result;
}

function deleteWhitelistEntry(domain, name, type) {
  // removes a whitelist entry matching the given data
  domain = domain.startsWith('.') ? domain.substr(1) : domain;
  var result = new Promise(function(resolve, reject) {
    var key = `wl|${encodeURI(domain)}|${encodeURI(name)}|${type}`;
    browser.storage.local.remove(key).then(resolve, logError);
  });
  return result;
}

function getDomstorageEntryWhitelistedStateAsResponse(request) {
  // returns whether a dom storage entry from a request is whitelisted and also the name of the entry itself
  var answer = new Promise(async function(resolve, reject) {
    var whitelisted = await getObjectWhitelistedState(request.domain, request.name, 'd');
    resolve({
      name: request.name,
      whitelisted: whitelisted
    });
  });
  return answer;
}
/*
status icon functions
*/
function updateTabIcon(tabId) {
  // updates the icon for a specific tab (not overall) according to the tabs behaviour
  function setIcon(behaviour) {
    var iconPath = null;
    var badgeColor = null;
    var title = null;
    switch (behaviour) {
      case 0:
        // deny
        iconPath = {
          16: 'icons/cookieRipperDeny_16.png',
          32: 'icons/cookieRipperDeny_32.png',
          48: 'icons/cookieRipperDeny_48.png'
        }
        badgeColor = 'red';
        title = 'Cookie Ripper is blocking cookies from this site.';
        break;
      case 1:
        // allow session
        iconPath = {
          16: 'icons/cookieRipperAllowSession_16.png',
          32: 'icons/cookieRipperAllowSession_32.png',
          48: 'icons/cookieRipperAllowSession_48.png'
        }
        badgeColor = 'orange';
        title = 'Cookie Ripper is allowing session cookies from this site.';
        break;
      case 2:
        // allow
        iconPath = {
          16: 'icons/cookieRipperAllow_16.png',
          32: 'icons/cookieRipperAllow_32.png',
          48: 'icons/cookieRipperAllow_48.png'
        }
        badgeColor = 'limegreen';
        title = 'Cookie Ripper is allowing all cookies from this site.';
        break;
      case -1:
        // site is out of scope
        iconPath = {
          16: 'icons/cookieRipperDisabled_16.png',
          32: 'icons/cookieRipperDisabled_32.png',
          48: 'icons/cookieRipperDisabled_48.png'
        }
        badgeColor = 'blue';
        title = 'Cookie Ripper is not active on this site.';
        break;
      default:
        // invalid
        logError(Error(`invalid Behaviour: ${behaviour}`));
    }
    browser.browserAction.setIcon({
      path: iconPath,
      tabId: tabId
    });
    browser.browserAction.setBadgeBackgroundColor({
      color: badgeColor,
      tabId: tabId
    });
    browser.browserAction.setTitle({
      title: title,
      tabId: tabId
    });
  }
  var getting = browser.tabs.get(tabId);
  getting.then(function(tab) {
    if (tab.url.startsWith('http')) {
      var url = tab.url;
      var hostname = trimSubdomains(url);
      var getting = getSiteBehaviour(hostname);
      getting.then(setIcon, logError);
    } else {
      setIcon(-1);
    }
  }, logError);
}

function updateAllTabsIcons() {
  // updates icon for all open tabs
  var querying = browser.tabs.query({});
  querying.then(function(tabs) {
    tabs.forEach(function(tab) {
      updateTabIcon(tab.id);
    });
  }, logError);
}
async function updateActiveTabsCounts() {
  // sets cookie count on icon batch according to the behaviour for the active tab
  if (!await callGetEnableCookieCounter()) {
    // exit if feature is disabled
    return;
  }
  // get active tab in every window
  var querying = browser.tabs.query({
    active: true
  });
  querying.then(async function(tabs) {
    for (var tab of tabs) {
      if (typeof tab !== 'undefined') {
        if (tab.url.startsWith('http')) {
          var cookieStore = await getTabCookieStore(tab.id);
          // get cookies
          countCookies(await getAllCookies({
            url: tab.url,
            storeId: cookieStore
          }), tab);
        } else {
          setBadgeText(tab.id, '');
        }
      }
    }
  }, logError);

  function countCookies(cookies, tab) {
    // count cookies
    var count = cookies.length;
    // get dom storage
    var getting = getTabDomStorage(tab.id);
    getting.then(async function(response) {
        // count dom storage
        count = count + Object.keys(response.localStorage).length + Object.keys(response.sessionStorage).length;
        setBadgeText(tab.id, count);
      },
      function() {
        setBadgeText(tab.id, count);
      });
  }

  function setBadgeText(tabId, count) {
    browser.browserAction.setBadgeText({
      text: `${count}`,
      tabId: tabId
    });
  }
}

function removeAllTabsCounts() {
  // removes the cookie count from all tabs
  var querying = browser.tabs.query({});
  querying.then(function(tabs) {
    tabs.forEach(function(tab) {
      browser.browserAction.setBadgeText({
        text: '',
        tabId: tab.id
      });
    });
  }, logError);
}
/*
 * misc functions
 */
function trimSubdomains(url) {
  // takes an URI and only returns the domain.topleveldomain part of it
  if (!url.startsWith('http') && !url.startsWith('https')) {
    // return if not a http site
    return url;
  }
  var hostname = (new URL(url)).hostname;
  var trimmedDomain = hostname.split('.');
  return `${trimmedDomain[trimmedDomain.length - 2]}.${trimmedDomain[trimmedDomain.length - 1]}`;
}

function formatDate(date) {
  // formats a date for displaying in tables
  var month = `${(date.getMonth() + 1 < 10 ? '0' : '')}${date.getMonth() + 1}`;
  var day = `${(date.getDate() < 10 ? '0' : '')}${date.getDate()}`;
  var year = date.getFullYear();
  return `${year}/${month}/${day}`;
}

function logError(error) {
  // logs an error to the console
  console.log(`Cookie Ripper ${error}`);
  console.error(error);
}

function getActiveTab() {
  // returns the active Tab
  var result = new Promise(function(resolve, reject) {
    var querying = browser.tabs.query({
      active: true,
      currentWindow: true
    });
    querying.then(function(tabs) {
      resolve(tabs[0]);
    }, logError);
  });
  return result
}

function getTabCookieStore(tabId) {
  // returns the id of the cookie store which the given tab uses
  // chromium does not supply tab.cookieStoreId :(
  var result = new Promise(function(resolve, reject) {
    var getting = browser.cookies.getAllCookieStores();
    getting.then(function(cookieStores) {
      for (let store of cookieStores) {
        if (store.tabIds.includes(tabId)) {
          return resolve(store.id);
        }
      }
      logError(Error("This tab could not be found in any cookie store."));
    }, logError);
  });
  return result
}

function sendInfoMessage(message) {
  // sends a message to the user
  browser.notifications.create(null, {
    type: 'basic',
    message: message,
    title: "Cookie Ripper Info"
  });
}