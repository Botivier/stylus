/* global URLS getActiveTab */// toolbox.js
/* global tabMan */// tab-manager.js
'use strict';

/**
 * Common stuff that's loaded first so it's immediately available to all background scripts
 */

window.bgReady = {}; /* global bgReady */
bgReady.styles = new Promise(r => (bgReady._resolveStyles = r));
bgReady.all = new Promise(r => (bgReady._resolveAll = r));

const API = window.API = {};
const msg = window.msg = {
  bg: window,
  async broadcast(data, onlyStyled) {
    const jobs = [this.broadcastExtension(data, 'both')];
    const tabs = (await browser.tabs.query({})).sort((a, b) => b.active - a.active);
    for (const tab of tabs) {
      if ((onlyStyled ? tabMan.getStyleIds(tab.id) : !tab.discarded)
      && URLS.supported(tab.pendingUrl || tab.url, false)) {
        jobs.push(msg.sendTab(tab.id, data).catch(msg.ignoreError));
      }
    }
    return Promise.all(jobs);
  },
  broadcastExtension(...args) {
    return msg.send(...args).catch(msg.ignoreError);
  },
};
const uuidIndex = Object.assign(new Map(), {
  custom: {},
  /** `obj` must have a unique `id`, a UUIDv4 `_id`, and Date.now() for `_rev`. */
  addCustom(obj, {get = () => obj, set}) {
    Object.defineProperty(uuidIndex.custom, obj._id, {get, set});
  },
});

/* exported addAPI */
function addAPI(methods) {
  for (const [key, val] of Object.entries(methods)) {
    const old = API[key];
    if (old && Object.prototype.toString.call(old) === '[object Object]') {
      Object.assign(old, val);
    } else {
      API[key] = val;
    }
  }
}

/* exported broadcastInjectorConfig */
const broadcastInjectorConfig = ((cfg, promise) => (key, val) => {
  if (key) {
    if (!cfg) {
      cfg = {};
      promise = new Promise(setTimeout).then(broadcastInjectorConfig);
    }
    cfg[key] = val;
  } else {
    promise = msg.broadcast({method: 'injectorConfig', cfg}, true);
    cfg = null;
  }
  return promise;
})();

/* exported createCache */
/** Creates a FIFO limit-size map. */
function createCache({size = 1000, onDeleted} = {}) {
  const map = new Map();
  const buffer = Array(size);
  let index = 0;
  let lastIndex = 0;
  return {
    get(id) {
      const item = map.get(id);
      return item && item.data;
    },
    set(id, data) {
      if (map.size === size) {
        // full
        map.delete(buffer[lastIndex].id);
        if (onDeleted) {
          onDeleted(buffer[lastIndex].id, buffer[lastIndex].data);
        }
        lastIndex = (lastIndex + 1) % size;
      }
      const item = {id, data, index};
      map.set(id, item);
      buffer[index] = item;
      index = (index + 1) % size;
    },
    delete(id) {
      const item = map.get(id);
      if (!item) {
        return false;
      }
      map.delete(item.id);
      const lastItem = buffer[lastIndex];
      lastItem.index = item.index;
      buffer[item.index] = lastItem;
      lastIndex = (lastIndex + 1) % size;
      if (onDeleted) {
        onDeleted(item.id, item.data);
      }
      return true;
    },
    clear() {
      map.clear();
      index = lastIndex = 0;
    },
    has: id => map.has(id),
    *entries() {
      for (const [id, item] of map) {
        yield [id, item.data];
      }
    },
    *values() {
      for (const item of map.values()) {
        yield item.data;
      }
    },
    get size() {
      return map.size;
    },
  };
}

/* exported isVivaldi */
let isVivaldi;
/* exported detectVivaldi */
async function detectVivaldi() {
  // Note that modern Vivaldi isn't exposed in `navigator.userAgent` but it adds `extData` to tabs
  const tab = await getActiveTab() || (await browser.tabs.query({}))[0];
  return (isVivaldi = tab && !!(tab.extData || tab.vivExtData));
}
