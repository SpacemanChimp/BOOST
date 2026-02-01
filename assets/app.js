/*
  EVE Booster & Gas Calculator
  Static-site friendly: runs entirely in the browser.

  Data sources:
  - TypeID lookup: https://www.fuzzwork.co.uk/api/typeid2.php?typename=... (pipe-separated)
  - Blueprint materials: https://www.fuzzwork.co.uk/blueprint/api/blueprint.php?typeid=...
  - Hub prices: https://market.fuzzwork.co.uk/aggregates/?station=<stationId>&types=<comma-separated-typeIDs>
  - Trades/day estimate + price history: https://api.adam4eve.eu/

  Notes:
  - Adam4EVE has a published rate limit of 1 request / 5 seconds.
  - Browsers can’t set a custom User-Agent header; you’ll use the browser UA.
*/

(() => {
  // ---------------------------
  // Static config / data
  // ---------------------------
  const HUBS = [
    { key: "jita", name: "Jita (4-4)", stationId: 60003760 },
    { key: "amarr", name: "Amarr", stationId: 60008494 },
    { key: "dodixie", name: "Dodixie", stationId: 60011866 },
    { key: "rens", name: "Rens", stationId: 60004588 },
  ];

  const SHADE_TO_COLOR = {
    amber: "shade-amber",
    azure: "shade-azure",
    celadon: "shade-celadon",
    golden: "shade-golden",
    lime: "shade-lime",
    malachite: "shade-malachite",
    vermillion: "shade-vermillion",
    viridian: "shade-viridian",
  };

  const BOOSTER_FAMILIES = [
    { family: "Blue Pill", shade: "amber" },
    { family: "Exile", shade: "celadon" },
    { family: "Mindflood", shade: "malachite" },
    { family: "X-Instinct", shade: "vermillion" },
    { family: "Drop", shade: "viridian" },
    { family: "Frentix", shade: "lime" },
    { family: "Sooth Sayer", shade: "azure" },
    { family: "Crash", shade: "golden" },
  ];

  const TIERS = [
    { key: "synth", label: "Synth", prefix: "Synth", isPure: false },
    { key: "standard", label: "Standard", prefix: "Standard", isPure: false },
    { key: "improved", label: "Improved", prefix: "Improved", isPure: false },
    { key: "strong", label: "Strong", prefix: "Strong", isPure: false },
    { key: "pure_synth", label: "Pure Synth", prefix: "Pure Synth", isPure: true },
    { key: "pure_standard", label: "Pure Standard", prefix: "Pure Standard", isPure: true },
    { key: "pure_improved", label: "Pure Improved", prefix: "Pure Improved", isPure: true },
    { key: "pure_strong", label: "Pure Strong", prefix: "Pure Strong", isPure: true },
  ];

  // Ice yields (assuming perfect refining, 0% waste), per 1 block of ice.
  // Source values match the common EVE Uni reference table.
  // We keep this lightweight and static so the site stays GitHub Pages friendly.
  const ICE_YIELDS = {
    // Faction ice (includes one isotope type)
    "Clear Icicle": { heavyWater: 69, liquidOzone: 35, strontium: 1, isotope: "Helium Isotopes", isotopeQty: 414 },
    "White Glaze": { heavyWater: 69, liquidOzone: 35, strontium: 1, isotope: "Nitrogen Isotopes", isotopeQty: 414 },
    "Blue Ice": { heavyWater: 69, liquidOzone: 35, strontium: 1, isotope: "Oxygen Isotopes", isotopeQty: 414 },
    "Glacial Mass": { heavyWater: 69, liquidOzone: 35, strontium: 1, isotope: "Hydrogen Isotopes", isotopeQty: 414 },

    // Standard ice (no faction isotopes)
    "Glare Crust": { heavyWater: 1381, liquidOzone: 691, strontium: 35, isotope: null, isotopeQty: 0 },
    "Dark Glitter": { heavyWater: 691, liquidOzone: 1381, strontium: 69, isotope: null, isotopeQty: 0 },
    "Gelidus": { heavyWater: 345, liquidOzone: 691, strontium: 104, isotope: null, isotopeQty: 0 },
    "Krystallos": { heavyWater: 173, liquidOzone: 691, strontium: 173, isotope: null, isotopeQty: 0 },
  };

  const ICE_NAMES = Object.keys(ICE_YIELDS);

  const EVETECH_ICON = (typeId, size = 64) =>
    `https://images.evetech.net/types/${typeId}/icon?size=${size}`;

  // ---------------------------
  // DOM helpers
  // ---------------------------
  const $ = (sel) => document.querySelector(sel);

  function setText(id, txt) {
    const el = $(id);
    if (el) el.textContent = txt;
  }

  function esc(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------------------------
  // Formatting
  // ---------------------------
  function fmtISK(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    const abs = Math.abs(n);

    // Avoid scientific notation: always render as plain numbers or K/M/B/T.
    // ISK is effectively integer-valued for market use; show whole ISK below 1K.
    if (abs >= 1e12) return `${trimZeros((n / 1e12).toFixed(2))}T`;
    if (abs >= 1e9) return `${trimZeros((n / 1e9).toFixed(2))}B`;
    if (abs >= 1e6) return `${trimZeros((n / 1e6).toFixed(2))}M`;
    if (abs >= 1e3) return `${trimZeros((n / 1e3).toFixed(2))}K`;
    return Math.round(n).toLocaleString();
  }

  function fmtQty(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    const abs = Math.abs(n);
    if (abs >= 1e12) return `${trimZeros((n / 1e12).toFixed(2))}T`;
    if (abs >= 1e9) return `${trimZeros((n / 1e9).toFixed(2))}B`;
    if (abs >= 1e6) return `${trimZeros((n / 1e6).toFixed(2))}M`;
    if (abs >= 1e3) return `${trimZeros((n / 1e3).toFixed(2))}K`;
    return Math.round(n).toLocaleString();
  }

  function trimZeros(s) {
    // "12.00" -> "12", "12.30" -> "12.3"
    return String(s).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
  }

  function fmtInt(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    return Math.round(n).toLocaleString();
  }

  function fmtPct(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(1)}%`;
  }

  function toNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function isoDateUTC(d) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function getYesterdayUTC() {
    const now = new Date();
    const y = new Date(now.getTime() - 24 * 3600 * 1000);
    return isoDateUTC(y);
  }

  // ---------------------------
  // Fetch + caching
  // ---------------------------
  const memCache = new Map();

  async function fetchJson(url, { ttlMs = 0 } = {}) {
    const key = `json:${url}`;
    const now = Date.now();
    const hit = memCache.get(key);
    if (hit && (ttlMs <= 0 || now - hit.time < ttlMs)) return hit.data;

    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const txt = await res.text();

    // Some fuzzwork endpoints return JSON with content-type text/html; parse anyway.
    let data;
    try {
      data = JSON.parse(txt);
    } catch (e) {
      throw new Error(`Failed to parse JSON from ${url}`);
    }

    memCache.set(key, { time: now, data });
    return data;
  }

  // Adam4EVE throttling (1 request per 5 seconds)
  let adamQueue = Promise.resolve();
  let adamLastCallMs = 0;

  function adamFetchJson(url, { ttlMs = 0 } = {}) {
    adamQueue = adamQueue
      .catch(() => {}) // swallow previous errors to keep queue alive
      .then(async () => {
        const now = Date.now();
        const waitMs = Math.max(0, 5100 - (now - adamLastCallMs));
        if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
        const data = await fetchJson(url, { ttlMs });
        adamLastCallMs = Date.now();
        return data;
      });

    return adamQueue;
  }

  // ---------------------------
  // TypeID resolution (Fuzzwork)
  // ---------------------------
  const TYPEID_CACHE_KEY = "eve_typeid_cache_v1";

  function loadTypeIdCache() {
    try {
      const raw = localStorage.getItem(TYPEID_CACHE_KEY);
      if (!raw) return { savedAt: 0, map: {} };
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return { savedAt: 0, map: {} };
      return parsed;
    } catch {
      return { savedAt: 0, map: {} };
    }
  }

  function saveTypeIdCache(obj) {
    try {
      localStorage.setItem(TYPEID_CACHE_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function resolveTypeIDsByName(typeNames) {
    // Keep a fairly long cache; typeIDs are stable.
    const cacheObj = loadTypeIdCache();
    const map = cacheObj.map || {};
    const missing = typeNames.filter((n) => !map[n]);

    if (missing.length === 0) return map;

    // typeid2 uses pipe delimiters; avoid URL length issues by chunking
    const parts = chunk(missing, 20);

    for (const names of parts) {
      const q = names.map(encodeURIComponent).join("|");
      const url = `https://www.fuzzwork.co.uk/api/typeid2.php?typename=${q}`;
      const data = await fetchJson(url, { ttlMs: 24 * 3600 * 1000 }); // cache for the session too
      for (const row of data) {
        if (row && row.typeName && row.typeID) {
          map[row.typeName] = Number(row.typeID);
        }
      }
    }

    saveTypeIdCache({ savedAt: Date.now(), map });
    return map;
  }

  // ---------------------------
  // Fuzzworks market + blueprint
  // ---------------------------
  async function fuzzAggByStation(stationId, typeIds) {
    const ids = [...new Set(typeIds)].filter((x) => Number.isFinite(x));
    if (ids.length === 0) return {};
    const url = `https://market.fuzzwork.co.uk/aggregates/?station=${stationId}&types=${ids.join(",")}`;
    // Prices can move fast; keep short TTL.
    return fetchJson(url, { ttlMs: 60 * 1000 });
  }

  async function fuzzBlueprint(typeId) {
    const url = `https://www.fuzzwork.co.uk/blueprint/api/blueprint.php?typeid=${typeId}`;
    // Blueprint recipes are stable; cache longer.
    return fetchJson(url, { ttlMs: 24 * 3600 * 1000 });
  }

  function pickBlueprintActivity(bp) {
    // Prefer manufacturing (1), else reactions (11), else first key.
    const mats = bp?.activityMaterials;
    if (!mats || typeof mats !== "object") return null;
    if (mats["1"]) return "1";
    if (mats["11"]) return "11";
    const keys = Object.keys(mats);
    return keys.length ? keys[0] : null;
  }

  function getAggPrice(aggForStation, typeId, mode /* sell_min | buy_max */) {
    const rec = aggForStation?.[String(typeId)];
    if (!rec) return null;
    if (mode === "buy_max") return toNumber(rec.buy?.max, null);
    return toNumber(rec.sell?.min, null);
  }

  function getAggVolume(aggForStation, typeId, side /* sell | buy */) {
    const rec = aggForStation?.[String(typeId)];
    if (!rec) return null;
    return toNumber(rec?.[side]?.volume, null);
  }

  // ---------------------------
  // Materials expansion
  // ---------------------------
  function shouldExpandMaterial(name, depth, maxDepth) {
    if (depth >= maxDepth) return false;
    const n = String(name || "").toLowerCase();
    if (n.includes("booster")) return true; // boosters + pure compounds
    if (n.includes("fuel block")) return true; // to show isotopes
    return false;
  }

  async function expandToRawTotals(typeId, runs, maxDepth) {
    const totals = new Map(); // typeId -> {name, qty}
    const visited = new Set();

    async function walk(tid, runCount, depth) {
      if (!Number.isFinite(tid)) return;
      const guardKey = `${tid}@${depth}`;
      if (visited.has(guardKey)) {
        // break loops
        totals.set(tid, addQty(totals.get(tid), { name: `Type ${tid}`, qty: 0 }));
        return;
      }
      visited.add(guardKey);

      let bp;
      try {
        bp = await fuzzBlueprint(tid);
      } catch {
        // no blueprint; treat as leaf
        const existing = totals.get(tid);
        totals.set(tid, addQty(existing, { name: `Type ${tid}`, qty: 0 }));
        return;
      }

      const act = pickBlueprintActivity(bp);
      if (!act) {
        // no activities; leaf
        const existing = totals.get(tid);
        totals.set(tid, addQty(existing, { name: bp?.blueprintDetails?.productTypeName || `Type ${tid}`, qty: 0 }));
        return;
      }

      const mats = bp.activityMaterials[act] || [];
      const outPerRun = toNumber(bp?.blueprintDetails?.productQuantity, 1);

      // If somehow this blueprint has no mats, treat it as leaf
      if (!mats.length) {
        const existing = totals.get(tid);
        totals.set(tid, addQty(existing, { name: bp?.blueprintDetails?.productTypeName || `Type ${tid}`, qty: 0 }));
        return;
      }

      for (const m of mats) {
        const mid = toNumber(m.typeid, null);
        const mname = m.name || `Type ${mid}`;
        const perRun = toNumber(m.quantity, 0);
        const needed = perRun * runCount;

        if (shouldExpandMaterial(mname, depth, maxDepth)) {
          // Determine how many runs of the child blueprint are needed to cover needed units
          let childBp;
          try {
            childBp = await fuzzBlueprint(mid);
          } catch {
            childBp = null;
          }

          const childAct = childBp ? pickBlueprintActivity(childBp) : null;
          const childOut = childBp ? toNumber(childBp?.blueprintDetails?.productQuantity, 1) : 1;
          if (childBp && childAct) {
            const childRuns = Math.ceil(needed / Math.max(childOut, 1));
            await walk(mid, childRuns, depth + 1);
          } else {
            // leaf
            const existing = totals.get(mid);
            totals.set(mid, addQty(existing, { name: mname, qty: needed }));
          }
        } else {
          // leaf
          const existing = totals.get(mid);
          totals.set(mid, addQty(existing, { name: mname, qty: needed }));
        }
      }
    }

    function addQty(existing, add) {
      if (!existing) return { name: add.name, qty: add.qty };
      return { name: existing.name || add.name, qty: existing.qty + add.qty };
    }

    await walk(typeId, runs, 0);

    // Remove any zero-qty placeholders
    const out = [];
    for (const [tid, v] of totals.entries()) {
      if (v.qty > 0) out.push({ typeId: tid, name: v.name, qty: v.qty });
    }
    return out;
  }

  // ---------------------------
  // App state
  // ---------------------------
  const state = {
    boosterItems: [], // { key, name, shade, family, tierKey, isPure, typeId? }
    gasItems: [], // loaded from data/gases.json + typeId resolution
    typeNameToId: {},
    fuzzAgg: {
      // hubKey -> aggregates JSON
      // e.g., jita: {...}
    },
    gasTrends7d: new Map(), // typeId -> pct
    gasStats7d: new Map(), // typeId -> { first, last, min, max, avg, pct }
    gasTradesJita: new Map(), // typeId -> amount

    boosterStats7d: new Map(), // typeId -> { first, last, min, max, avg, pct }
    boosterTradesJita: new Map(), // typeId -> amount (Jita sell-side, yesterday)
  };

  // ---------------------------
  // Rendering helpers
  // ---------------------------
  function makeItemCell({ typeId, name, sub }) {
    const img = typeId ? `<img src="${EVETECH_ICON(typeId, 64)}" alt="">` : `<div style="width:28px;height:28px"></div>`;
    const subHtml = sub ? `<div class="item-sub">${esc(sub)}</div>` : "";
    return `
      <div class="item-cell">
        ${img}
        <div>
          <div class="item-name">${esc(name)}</div>
          ${subHtml}
        </div>
      </div>
    `;
  }

  function hubPriceLine(typeId, hubKey) {
    const agg = state.fuzzAgg[hubKey];
    if (!agg) return "—";
    const sell = getAggPrice(agg, typeId, "sell_min");
    const buy = getAggPrice(agg, typeId, "buy_max");
    return `${fmtISK(sell)} / ${fmtISK(buy)}`;
  }

  // ---------------------------
  // Build dropdown + boards
  // ---------------------------
  async function loadStaticData() {
    // gases.json
    const gases = await fetchJson("./data/gases.json", { ttlMs: 24 * 3600 * 1000 });
    state.gasItems = gases.map((g) => ({
      name: g.name,
      category: g.category,
      shade: g.shade,
      boosterFamily: g.boosterFamily,
      regions: g.regions || [],
      typeId: null,
    }));

    // boosters.json
    const boosters = await fetchJson("./data/boosters.json", { ttlMs: 24 * 3600 * 1000 });
    const families = boosters.families || BOOSTER_FAMILIES;
    const tiers = boosters.tiers || TIERS;

    state.boosterItems = [];
    for (const fam of families) {
      for (const t of tiers) {
        const typename = `${t.prefix} ${fam.family} Booster`;
        state.boosterItems.push({
          key: `${t.key}:${fam.family}`,
          name: typename,
          family: fam.family,
          shade: fam.shade,
          tierKey: t.key,
          tierLabel: t.tier || t.label,
          isPure: !!t.isPure,
          typeId: null,
        });
      }
    }

    // stations.json => populate hub dropdown
    const st = await fetchJson("./data/stations.json", { ttlMs: 24 * 3600 * 1000 });
    const hubs = st.hubs || HUBS;

    const hubSel = $("#costHub");
    hubSel.innerHTML = "";
    for (const h of hubs) {
      const opt = document.createElement("option");
      opt.value = h.key;
      opt.textContent = h.name;
      hubSel.appendChild(opt);
    }
    hubSel.value = "jita";
  }

  function populateBoosterSelect() {
    const sel = $("#boosterSelect");
    sel.innerHTML = "";

    const groups = new Map(); // tierKey -> items
    for (const item of state.boosterItems) {
      if (!groups.has(item.tierKey)) groups.set(item.tierKey, []);
      groups.get(item.tierKey).push(item);
    }

    const tierOrder = [
      "synth",
      "standard",
      "improved",
      "strong",
      "pure_synth",
      "pure_standard",
      "pure_improved",
      "pure_strong",
    ];

    for (const tierKey of tierOrder) {
      const items = groups.get(tierKey) || [];
      if (!items.length) continue;
      const og = document.createElement("optgroup");
      const label = TIERS.find((t) => t.key === tierKey)?.label || tierKey;
      og.label = label;
      // sort by family name
      items.sort((a, b) => a.family.localeCompare(b.family));
      for (const it of items) {
        const opt = document.createElement("option");
        opt.value = it.key;
        opt.textContent = it.name;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }

    sel.value = state.boosterItems[0]?.key || "";
  }

  // ---------------------------
  // Resolve all typeIDs (boosters + gases)
  // ---------------------------
  async function resolveAllTypeIDs() {
    const allNames = [
      ...state.boosterItems.map((b) => b.name),
      ...state.gasItems.map((g) => g.name),
      ...ICE_NAMES,
    ];

    const map = await resolveTypeIDsByName(allNames);
    state.typeNameToId = map;

    for (const b of state.boosterItems) b.typeId = map[b.name] || null;
    for (const g of state.gasItems) g.typeId = map[g.name] || null;

    const missing = [
      ...state.boosterItems.filter((b) => !b.typeId).map((b) => b.name),
      ...state.gasItems.filter((g) => !g.typeId).map((g) => g.name),
    ];
    if (missing.length) {
      $("#apiStatus").textContent = `APIs: typeID lookup missing ${missing.length} names (see console)`;
      console.warn("Missing typeIDs for:", missing);
    }
  }

  // ---------------------------
  // Fetch hub prices for a set of typeIDs
  // ---------------------------
  async function loadFuzzAggForAllHubs(typeIds) {
    const out = {};
    await Promise.all(
      HUBS.map(async (h) => {
        try {
          out[h.key] = await fuzzAggByStation(h.stationId, typeIds);
        } catch (e) {
          console.warn("Fuzzworks agg failed", h, e);
          out[h.key] = {};
        }
      })
    );
    state.fuzzAgg = out;
  }

  // ---------------------------
  // Gas board (prices + trends + trades/day in Jita)
  // ---------------------------
  function renderGasTable(tableId, category) {
    const tb = $(`${tableId} tbody`);
    tb.innerHTML = "";

    const items = state.gasItems.filter((g) => g.category === category && g.typeId);

    items.sort((a, b) => {
      const pa = getAggPrice(state.fuzzAgg.jita, a.typeId, "sell_min") ?? -1;
      const pb = getAggPrice(state.fuzzAgg.jita, b.typeId, "sell_min") ?? -1;
      return pb - pa;
    });

    for (const g of items) {
      const j = getAggPrice(state.fuzzAgg.jita, g.typeId, "sell_min");
      const a = getAggPrice(state.fuzzAgg.amarr, g.typeId, "sell_min");
      const d = getAggPrice(state.fuzzAgg.dodixie, g.typeId, "sell_min");
      const r = getAggPrice(state.fuzzAgg.rens, g.typeId, "sell_min");
      const pct = state.gasTrends7d.get(g.typeId) ?? null;
      const trades = state.gasTradesJita.get(g.typeId) ?? null;

      const allRegions = (g.regions || []).filter(Boolean);
      const shown = allRegions.slice(0, 6);
      const rest = allRegions.slice(6);
      const regionHtml =
        shown.length
          ? `<div class="tag-row">${shown
              .map((x) => `<span class="tag">${esc(x)}</span>`)
              .join("")}${rest.length ? `<span class="tag tag-more" title="${esc(rest.join(", "))}">+${rest.length} more</span>` : ""}</div>`
          : "—";

      const supplyAllHubs = HUBS.reduce((sum, h) => {
        const v = getAggVolume(state.fuzzAgg[h.key], g.typeId, "sell") ?? 0;
        return sum + v;
      }, 0);

      const tr = document.createElement("tr");
      tr.className = SHADE_TO_COLOR[g.shade] || "";
      tr.innerHTML = `
        <td>${makeItemCell({ typeId: g.typeId, name: g.name, sub: g.boosterFamily })}</td>
        <td>${regionHtml}</td>
        <td class="num">${fmtISK(j)}</td>
        <td class="num">${fmtISK(a)}</td>
        <td class="num">${fmtISK(d)}</td>
        <td class="num">${fmtISK(r)}</td>
        <td class="num">${pct === null ? "—" : fmtPct(pct)}</td>
        <td class="num">
          <div>${trades === null ? "—" : fmtInt(trades)}</div>
          <div class="muted small">supply: ${fmtQty(supplyAllHubs)}</div>
        </td>
      `;
      tb.appendChild(tr);
    }
  }

  async function loadGasTrends7d() {
    const typeIds = state.gasItems.filter((g) => g.typeId).map((g) => g.typeId);
    if (typeIds.length === 0) return;

    // Adam4EVE price history supports up to 20 typeIDs per request (we have 16).
    const end = new Date();
    const start = new Date(end.getTime() - 8 * 24 * 3600 * 1000); // ~7 days of deltas
    const url = `https://api.adam4eve.eu/v1/market_price_history?regionID=10000002&start=${isoDateUTC(start)}&end=${isoDateUTC(end)}&typeID=${typeIds.join(",")}`;

    try {
      const data = await adamFetchJson(url, { ttlMs: 10 * 60 * 1000 });
      // group by type_id
      const byType = new Map();
      for (const row of data) {
        const tid = Number(row.type_id);
        if (!byType.has(tid)) byType.set(tid, []);
        byType.get(tid).push(row);
      }
      for (const [tid, rows] of byType.entries()) {
        rows.sort((a, b) => String(a.price_date).localeCompare(String(b.price_date)));
        const first = rows[0];
        const last = rows[rows.length - 1];

        const prices = rows
          .map((r) => toNumber(r.sell_price_avg, null))
          .filter((p) => p !== null && Number.isFinite(p) && p > 0);

        const p0 = toNumber(first.sell_price_avg, null);
        const p1 = toNumber(last.sell_price_avg, null);

        if (prices.length) {
          const min = Math.min(...prices);
          const max = Math.max(...prices);
          const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
          const pct = (p0 !== null && p1 !== null && p0 > 0) ? ((p1 - p0) / p0) * 100 : null;
          if (pct !== null) state.gasTrends7d.set(tid, pct);
          state.gasStats7d.set(tid, { first: p0, last: p1, min, max, avg, pct });
        }
      }
    } catch (e) {
      console.warn("Gas trends unavailable", e);
    }
  }

  async function loadGasTradesJitaYesterday() {
    const typeIds = state.gasItems.filter((g) => g.typeId).map((g) => g.typeId);
    if (!typeIds.length) return;

    const date = getYesterdayUTC();
    const url = `https://api.adam4eve.eu/v1/tracker?date=${date}&isBuy=0&locationID=60003760&typeID=${typeIds.join(",")}&withGone=0`;

    try {
      const data = await adamFetchJson(url, { ttlMs: 10 * 60 * 1000 });
      for (const [tidStr, row] of Object.entries(data)) {
        const tid = Number(tidStr);
        const amt = toNumber(row.amount, null);
        if (amt !== null) state.gasTradesJita.set(tid, amt);
      }
    } catch (e) {
      console.warn("Gas trades unavailable", e);
    }
  }

  // ---------------------------
  // Booster trends + trades/day (Jita)
  // ---------------------------
  async function loadBoosterStats7d() {
    const typeIds = state.boosterItems.filter((b) => b.typeId).map((b) => b.typeId);
    if (typeIds.length === 0) return;

    const end = new Date();
    const start = new Date(end.getTime() - 8 * 24 * 3600 * 1000);

    // Adam4EVE: up to ~20 typeIDs per request, so chunk.
    const parts = chunk(typeIds, 20);

    for (const part of parts) {
      const url = `https://api.adam4eve.eu/v1/market_price_history?regionID=10000002&start=${isoDateUTC(start)}&end=${isoDateUTC(end)}&typeID=${part.join(",")}`;
      try {
        const data = await adamFetchJson(url, { ttlMs: 10 * 60 * 1000 });
        const byType = new Map();
        for (const row of data) {
          const tid = Number(row.type_id);
          if (!byType.has(tid)) byType.set(tid, []);
          byType.get(tid).push(row);
        }
        for (const [tid, rows] of byType.entries()) {
          rows.sort((a, b) => String(a.price_date).localeCompare(String(b.price_date)));
          const first = rows[0];
          const last = rows[rows.length - 1];

          const prices = rows
            .map((r) => toNumber(r.sell_price_avg, null))
            .filter((p) => p !== null && Number.isFinite(p) && p > 0);

          const p0 = toNumber(first.sell_price_avg, null);
          const p1 = toNumber(last.sell_price_avg, null);

          if (prices.length) {
            const min = Math.min(...prices);
            const max = Math.max(...prices);
            const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
            const pct = (p0 !== null && p1 !== null && p0 > 0) ? ((p1 - p0) / p0) * 100 : null;
            state.boosterStats7d.set(tid, { first: p0, last: p1, min, max, avg, pct });
          }
        }
      } catch (e) {
        console.warn("Booster trends chunk unavailable", e);
      }
    }
  }

  async function loadBoosterTradesJitaYesterday() {
    const typeIds = state.boosterItems.filter((b) => b.typeId).map((b) => b.typeId);
    if (!typeIds.length) return;

    const date = getYesterdayUTC();
    const parts = chunk(typeIds, 80); // keep URL length reasonable
    for (const part of parts) {
      const url = `https://api.adam4eve.eu/v1/tracker?date=${date}&isBuy=0&locationID=60003760&typeID=${part.join(",")}&withGone=0`;
      try {
        const data = await adamFetchJson(url, { ttlMs: 10 * 60 * 1000 });
        for (const [tidStr, row] of Object.entries(data)) {
          const tid = Number(tidStr);
          const amt = toNumber(row.amount, null);
          if (amt !== null) state.boosterTradesJita.set(tid, amt);
        }
      } catch (e) {
        console.warn("Booster trades chunk unavailable", e);
      }
    }
  }

  // ---------------------------
  // Booster price boards
  // ---------------------------
  function renderBoosterBoards() {
    const container = $("#boosterBoards");
    container.innerHTML = "";

    const tierOrder = [
      { tierKey: "strong", title: "Strong boosters" },
      { tierKey: "improved", title: "Improved boosters" },
      { tierKey: "standard", title: "Standard boosters" },
      { tierKey: "synth", title: "Synth boosters" },
      { tierKey: "pure_strong", title: "Pure strong compounds" },
      { tierKey: "pure_improved", title: "Pure improved compounds" },
      { tierKey: "pure_standard", title: "Pure standard compounds" },
      { tierKey: "pure_synth", title: "Pure synth compounds" },
    ];

    for (const tier of tierOrder) {
      const items = state.boosterItems.filter((b) => b.tierKey === tier.tierKey && b.typeId);
      items.sort((a, b) => {
        const pa = getAggPrice(state.fuzzAgg.jita, a.typeId, "sell_min") ?? -1;
        const pb = getAggPrice(state.fuzzAgg.jita, b.typeId, "sell_min") ?? -1;
        return pb - pa;
      });

      const details = document.createElement("details");
      details.open = tier.tierKey === "strong" || tier.tierKey === "improved" || tier.tierKey === "standard";
      details.className = "mt";
      details.innerHTML = `<summary><strong>${esc(tier.title)}</strong> <span class="muted small">(${items.length})</span></summary>`;

      const wrap = document.createElement("div");
      wrap.className = "table-wrap mt";
      wrap.innerHTML = `
        <table class="table">
          <thead>
            <tr>
              <th>Item</th>
              <th class="num">Jita</th>
              <th class="num">Amarr</th>
              <th class="num">Dodixie</th>
              <th class="num">Rens</th>
              <th class="num">Jita sell listed</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      `;
      const tbody = wrap.querySelector("tbody");

      for (const it of items) {
        const j = getAggPrice(state.fuzzAgg.jita, it.typeId, "sell_min");
        const a = getAggPrice(state.fuzzAgg.amarr, it.typeId, "sell_min");
        const d = getAggPrice(state.fuzzAgg.dodixie, it.typeId, "sell_min");
        const r = getAggPrice(state.fuzzAgg.rens, it.typeId, "sell_min");
        const sellVol = getAggVolume(state.fuzzAgg.jita, it.typeId, "sell");

        const tr = document.createElement("tr");
        tr.className = SHADE_TO_COLOR[it.shade] || "";
        tr.innerHTML = `
          <td>
            <a href="#" data-booster-key="${esc(it.key)}">
              ${makeItemCell({ typeId: it.typeId, name: it.name, sub: it.family })}
            </a>
          </td>
          <td class="num">${fmtISK(j)}</td>
          <td class="num">${fmtISK(a)}</td>
          <td class="num">${fmtISK(d)}</td>
          <td class="num">${fmtISK(r)}</td>
          <td class="num">${sellVol === null ? "—" : fmtInt(sellVol)}</td>
        `;
        tbody.appendChild(tr);
      }

      details.appendChild(wrap);
      container.appendChild(details);
    }

    // Click-to-select behavior
    container.addEventListener("click", (ev) => {
      const a = ev.target.closest("a[data-booster-key]");
      if (!a) return;
      ev.preventDefault();
      const key = a.getAttribute("data-booster-key");
      const sel = $("#boosterSelect");
      sel.value = key;
      sel.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  // ---------------------------
  // Opinion engine
  // ---------------------------
  function computeOpinionHtml() {
    const gases = state.gasItems.filter((g) => g.typeId);
    const boostersAll = state.boosterItems.filter((b) => b.typeId);
    const boosters = boostersAll.filter((b) => ["standard", "improved", "strong", "synth"].includes(b.tierKey));

    const gasTrendRows = gases
      .map((g) => ({ g, s: state.gasStats7d.get(g.typeId) || null }))
      .filter((x) => x.s && x.s.pct !== null);

    // Top price gases (Jita)
    const topGasByPrice = [...gases]
      .map((g) => ({ g, p: getAggPrice(state.fuzzAgg.jita, g.typeId, "sell_min") ?? -1 }))
      .sort((a, b) => b.p - a.p)
      .slice(0, 5);

    // Top trending up/down gases (7d)
    const topGasUp = [...gasTrendRows].sort((a, b) => (b.s.pct ?? 0) - (a.s.pct ?? 0)).slice(0, 5);
    const topGasDown = [...gasTrendRows].sort((a, b) => (a.s.pct ?? 0) - (b.s.pct ?? 0)).slice(0, 5);

    // "Thin" gas markets (Jita heuristic)
    const thinGas = [...gases]
      .map((g) => {
        const p = getAggPrice(state.fuzzAgg.jita, g.typeId, "sell_min") ?? 0;
        const v = getAggVolume(state.fuzzAgg.jita, g.typeId, "sell") ?? 0;
        const t = state.gasTradesJita.get(g.typeId) ?? 0;
        const score = p / ((v + 1) * (t + 1));
        const supplyAllHubs = HUBS.reduce((sum, h) => sum + (getAggVolume(state.fuzzAgg[h.key], g.typeId, "sell") ?? 0), 0);
        return { g, score, p, v, t, supplyAllHubs };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // "Thin" boosters (Jita listed depth heuristic)
    const thinBoosters = [...boosters]
      .map((b) => {
        const p = getAggPrice(state.fuzzAgg.jita, b.typeId, "sell_min") ?? 0;
        const v = getAggVolume(state.fuzzAgg.jita, b.typeId, "sell") ?? 0;
        const t = state.boosterTradesJita.get(b.typeId) ?? null;
        const score = p / (v + 1);
        return { b, score, p, v, t };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    function liRow(leftHtml, rightHtml) {
      return `<li class="li-row"><span>${leftHtml}</span><span class="right muted small">${rightHtml}</span></li>`;
    }

    function liGas(x) {
      return liRow(
        `<strong>${esc(x.g.name)}</strong> — Jita ${fmtISK(x.p)} ISK/u`,
        esc(x.g.boosterFamily || "")
      );
    }

    function liGasTrend(x) {
      return liRow(
        `<strong>${esc(x.g.name)}</strong> — 7d ${fmtPct(x.s.pct)}`,
        esc(x.g.boosterFamily || "")
      );
    }

    function liThinGas(x) {
      return liRow(
        `<strong>${esc(x.g.name)}</strong> — Jita ${fmtISK(x.p)} · listed ${fmtQty(x.v)} · sold/day ${fmtQty(x.t)} · supply ${fmtQty(x.supplyAllHubs)}`,
        esc(x.g.boosterFamily || "")
      );
    }

    function liThinBooster(x) {
      const t = x.t === null ? "—" : fmtQty(x.t);
      return `<li><strong>${esc(x.b.name)}</strong> — Jita ${fmtISK(x.p)} · listed ${fmtQty(x.v)} · sold/day ${t}</li>`;
    }

    // Flip ideas --------------------------------------------------
    function flipThreshold(stats, fallbackNow) {
      if (stats && Number.isFinite(stats.min) && stats.min > 0) {
        // Buy if we revisit (roughly) the lower end of the last 7 days.
        return stats.min * 1.10; // 10% above 7d low
      }
      if (fallbackNow && fallbackNow > 0) return fallbackNow * 0.90;
      return null;
    }

    function flipTarget(stats, fallbackNow) {
      if (stats && Number.isFinite(stats.max) && stats.max > 0) return stats.max * 0.95;
      if (fallbackNow && fallbackNow > 0) return fallbackNow * 1.10;
      return null;
    }

    function volatility(stats) {
      if (!stats || !Number.isFinite(stats.avg) || stats.avg <= 0) return 0;
      const range = (stats.max ?? 0) - (stats.min ?? 0);
      return range > 0 ? range / stats.avg : 0;
    }

    const gasFlip = gases
      .map((g) => {
        const now = getAggPrice(state.fuzzAgg.jita, g.typeId, "sell_min") ?? null;
        const stats = state.gasStats7d.get(g.typeId) || null;
        const vol = volatility(stats);
        const sold = state.gasTradesJita.get(g.typeId) ?? 0;
        const listed = getAggVolume(state.fuzzAgg.jita, g.typeId, "sell") ?? 0;
        const score = vol * Math.log1p(sold) / Math.log1p(listed + 1);
        return { kind: "gas", g, now, stats, vol, sold, listed, score };
      })
      .filter((x) => x.now && x.now > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const boosterFlipReady = state.boosterStats7d.size > 0;
    const boosterFlip = boosterFlipReady
      ? boosters
          .map((b) => {
            const now = getAggPrice(state.fuzzAgg.jita, b.typeId, "sell_min") ?? null;
            const stats = state.boosterStats7d.get(b.typeId) || null;
            const vol = volatility(stats);
            const sold = state.boosterTradesJita.get(b.typeId) ?? 0;
            const listed = getAggVolume(state.fuzzAgg.jita, b.typeId, "sell") ?? 0;
            const score = vol * Math.log1p(sold) / Math.log1p(listed + 1);
            return { kind: "booster", b, now, stats, vol, sold, listed, score };
          })
          .filter((x) => x.now && x.now > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 7)
      : [];

    function liFlipGas(x) {
      const buy = flipThreshold(x.stats, x.now);
      const sell = flipTarget(x.stats, x.now);
      const band = x.stats ? `7d low ${fmtISK(x.stats.min)} · high ${fmtISK(x.stats.max)}` : "7d stats —";
      return liRow(
        `<strong>${esc(x.g.name)}</strong> — now ${fmtISK(x.now)} ISK/u · buy ≤ ${buy === null ? "—" : fmtISK(buy)} · sell ~ ${sell === null ? "—" : fmtISK(sell)} · sold/day ${fmtQty(x.sold)}`,
        esc(x.g.boosterFamily || "")
      );
    }

    function liFlipBooster(x) {
      const buy = flipThreshold(x.stats, x.now);
      const sell = flipTarget(x.stats, x.now);
      const band = x.stats ? `7d low ${fmtISK(x.stats.min)} · high ${fmtISK(x.stats.max)}` : "7d stats —";
      return `<li><strong>${esc(x.b.name)}</strong> — now ${fmtISK(x.now)} · buy ≤ ${buy === null ? "—" : fmtISK(buy)} · sell ~ ${sell === null ? "—" : fmtISK(sell)} · sold/day ${fmtQty(x.sold)} · listed ${fmtQty(x.listed)}<div class="muted small">${band}</div></li>`;
    }

    const anyGasTrends = gasTrendRows.length > 0;

    return `
      <p>
        This section is generated from live hub prices (Fuzzworks) plus a 7‑day price history and trades/day estimates (Adam4EVE).
        If an item shows “—” for trend/sold-day, it means the API had no data for that item at the time of load.
      </p>

      <h3>Where effort may pay off</h3>
      ${anyGasTrends ? `<ul>${topGasUp.map(liGasTrend).join("")}</ul>` : `<p class="muted">Trend data unavailable right now.</p>`}

      <h3>Where a dip may be a buy</h3>
      ${anyGasTrends ? `<ul>${topGasDown.map(liGasTrend).join("")}</ul>` : `<p class="muted">Trend data unavailable right now.</p>`}

      <h3>Highest ISK/unit gasses (Jita)</h3>
      <ul>
        ${topGasByPrice.map(liGas).join("")}
      </ul>

      <h3>Most “movable” gas markets (heuristic)</h3>
      <ul>
        ${thinGas.map(liThinGas).join("")}
      </ul>

      <h3>Thin booster markets (listed depth heuristic)</h3>
      <ul>
        ${thinBoosters.map(liThinBooster).join("")}
      </ul>

      <details class="mt">
        <summary><strong>Flip watchlist (buy-the-dip)</strong> <span class="muted small">(rules-of-thumb)</span></summary>
        <p class="muted small">
          Heuristic: “buy” trigger is ~10% above the 7‑day low; “sell” target is ~5% below the 7‑day high.
          Use Jita sell min as the live signal. High sold/day is easier to exit; thin listed depth can be easier to push.
        </p>

        <h4 class="mt">Gasses</h4>
        <ul>
          ${gasFlip.map(liFlipGas).join("")}
        </ul>

        <h4 class="mt">Boosters</h4>
        ${boosterFlipReady ? `<ul>${boosterFlip.map(liFlipBooster).join("")}</ul>` : `<p class="muted">Booster history is still loading… (Adam4EVE rate limit)</p>`}
      </details>

      <p class="muted small">
        Interpretation: “thin” items are easier to push around with stockpiles because fewer units are listed and/or turning over.
        Strong trends can mean real demand — or a temporary spike that later mean-reverts.
      </p>
    `;
  }

  // ---------------------------
  // Calculator rendering
  // ---------------------------
  function renderSummaryCards(cards) {
    const wrap = $("#calcSummary");
    wrap.innerHTML = "";
    for (const c of cards) {
      const div = document.createElement("div");
      div.className = "summary-card";
      div.innerHTML = `
        <div class="k">${esc(c.k)}</div>
        <div class="v">${esc(c.v)}</div>
        ${c.s ? `<div class="s">${esc(c.s)}</div>` : ""}
      `;
      wrap.appendChild(div);
    }
  }

  function renderDirectMaterials(directMats, totalRuns) {
    const tb = $("#directMaterialsTable tbody");
    tb.innerHTML = "";
    for (const m of directMats) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${makeItemCell({ typeId: m.typeId, name: m.name })}</td>
        <td class="num">${fmtInt(m.qtyPerRun)}</td>
        <td class="num">${fmtInt(m.qtyPerRun * totalRuns)}</td>
        <td>
          <div class="muted small">
            Jita ${hubPriceLine(m.typeId, "jita")} ·
            Amarr ${hubPriceLine(m.typeId, "amarr")} ·
            Dodixie ${hubPriceLine(m.typeId, "dodixie")} ·
            Rens ${hubPriceLine(m.typeId, "rens")}
          </div>
        </td>
      `;
      tb.appendChild(tr);
    }
  }

  function renderRawMaterials(rawTotals, totalRuns, costHubKey, inputPriceMode) {
    const tb = $("#rawMaterialsTable tbody");
    tb.innerHTML = "";

    const agg = state.fuzzAgg[costHubKey] || {};
    const rows = [...rawTotals];

    rows.sort((a, b) => b.qty - a.qty);

    let totalCost = 0;

    for (const r of rows) {
      const unit = getAggPrice(agg, r.typeId, inputPriceMode);
      const cost = unit === null ? null : unit * r.qty;
      if (cost !== null) totalCost += cost;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${makeItemCell({ typeId: r.typeId, name: r.name })}</td>
        <td class="num">${fmtInt(r.qty)}</td>
        <td class="num">${fmtInt(r.qty / totalRuns)}</td>
        <td class="num">${fmtISK(unit)}</td>
        <td class="num">${fmtISK(cost)}</td>
      `;
      tb.appendChild(tr);
    }

    return totalCost;
  }

  function computeIceEquivalents(rawTotals) {
    // Goal: translate ice-products (isotopes / HW / LO / Stront) into an approximate
    // number of ice blocks to harvest, using a simple 2-step plan:
    // 1) Mine the faction ice required for each isotope type present (to cover isotopes).
    // 2) If HW/LO/Stront are still short after byproducts, top-up with the single best "standard" ice.

    const need = {
      heavyWater: 0,
      liquidOzone: 0,
      strontium: 0,
      isotopes: {
        "Helium Isotopes": 0,
        "Nitrogen Isotopes": 0,
        "Oxygen Isotopes": 0,
        "Hydrogen Isotopes": 0,
      },
    };

    for (const r of rawTotals || []) {
      const name = String(r.name || "").toLowerCase();
      const qty = toNumber(r.qty, 0);
      if (!qty) continue;
      if (name === "heavy water") need.heavyWater += qty;
      else if (name === "liquid ozone") need.liquidOzone += qty;
      else if (name === "strontium clathrates") need.strontium += qty;
      else if (name === "helium isotopes") need.isotopes["Helium Isotopes"] += qty;
      else if (name === "nitrogen isotopes") need.isotopes["Nitrogen Isotopes"] += qty;
      else if (name === "oxygen isotopes") need.isotopes["Oxygen Isotopes"] += qty;
      else if (name === "hydrogen isotopes") need.isotopes["Hydrogen Isotopes"] += qty;
    }

    const plan = [];
    let producedHW = 0;
    let producedLO = 0;
    let producedStront = 0;

    // Step 1: isotope ice
    for (const [iceName, y] of Object.entries(ICE_YIELDS)) {
      if (!y.isotope) continue;
      const req = need.isotopes[y.isotope] || 0;
      if (req <= 0) continue;
      const blocks = Math.ceil(req / Math.max(1, y.isotopeQty || 1));
      if (blocks <= 0) continue;
      producedHW += blocks * (y.heavyWater || 0);
      producedLO += blocks * (y.liquidOzone || 0);
      producedStront += blocks * (y.strontium || 0);
      plan.push({
        iceName,
        blocks,
        covers: y.isotope,
      });
    }

    // Step 2: top-up HW/LO/Stront with best standard ice (single choice)
    const remHW = Math.max(0, need.heavyWater - producedHW);
    const remLO = Math.max(0, need.liquidOzone - producedLO);
    const remStront = Math.max(0, need.strontium - producedStront);

    if (remHW > 0 || remLO > 0 || remStront > 0) {
      const standardNames = Object.entries(ICE_YIELDS)
        .filter(([_, y]) => !y.isotope)
        .map(([n]) => n);

      let best = null;
      for (const name of standardNames) {
        const y = ICE_YIELDS[name];
        const blocks = Math.max(
          remHW > 0 ? Math.ceil(remHW / Math.max(1, y.heavyWater || 1)) : 0,
          remLO > 0 ? Math.ceil(remLO / Math.max(1, y.liquidOzone || 1)) : 0,
          remStront > 0 ? Math.ceil(remStront / Math.max(1, y.strontium || 1)) : 0
        );
        if (best === null || blocks < best.blocks) best = { iceName: name, blocks };
      }
      if (best && best.blocks > 0) {
        plan.push({ iceName: best.iceName, blocks: best.blocks, covers: "HW/LO/Stront top‑up" });
      }
    }

    // Sort by blocks desc so the biggest requirement is first
    plan.sort((a, b) => b.blocks - a.blocks);
    return plan;
  }

  function renderIceEquivalents(rawTotals, totalRuns) {
    const details = document.getElementById("iceEquivalentsDetails");
    const tb = document.querySelector("#iceEquivalentsTable tbody");
    if (!details || !tb) return;

    tb.innerHTML = "";

    const plan = computeIceEquivalents(rawTotals);
    if (!plan.length) {
      details.style.display = "none";
      return;
    }

    details.style.display = "block";

    for (const row of plan) {
      const typeId = state.typeNameToId?.[row.iceName] || null;
      const perRun = row.blocks / Math.max(1, totalRuns);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${makeItemCell({ typeId, name: row.iceName })}</td>
        <td class="num">${fmtQty(row.blocks)}</td>
        <td class="num">${trimZeros(perRun.toFixed(2))}</td>
        <td>${esc(row.covers)}</td>
      `;
      tb.appendChild(tr);
    }
  }

  function renderMarketStats(typeId, tradesByHubKey) {
    const tb = $("#marketStatsTable tbody");
    tb.innerHTML = "";

    for (const h of HUBS) {
      const agg = state.fuzzAgg[h.key];
      const sell = getAggPrice(agg, typeId, "sell_min");
      const buy = getAggPrice(agg, typeId, "buy_max");
      const sellVol = getAggVolume(agg, typeId, "sell");
      const buyVol = getAggVolume(agg, typeId, "buy");

      const soldDay = tradesByHubKey?.[h.key] ?? null;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(h.name)}</td>
        <td class="num">${fmtISK(sell)}</td>
        <td class="num">${fmtISK(buy)}</td>
        <td class="num">${sellVol === null ? "—" : fmtInt(sellVol)}</td>
        <td class="num">${buyVol === null ? "—" : fmtInt(buyVol)}</td>
        <td class="num">${soldDay === null ? "<span class='muted'>loading…</span>" : fmtInt(soldDay)}</td>
      `;
      tb.appendChild(tr);
    }
  }

  function detectSisterInfo(rawTotals, selectedName) {
    const gasNames = rawTotals
      .filter((r) => /cytoserocin|mykoserocin/i.test(r.name))
      .map((r) => r.name);

    const pureOrBoosterNames = rawTotals
      .filter((r) => /booster/i.test(r.name))
      .map((r) => r.name);

    // Extract family names by stripping prefixes
    function familyFromBoosterName(n) {
      // Matches: Pure Standard Blue Pill Booster  -> Blue Pill
      //          Strong X-Instinct Booster       -> X-Instinct
      const m = n.match(/(?:Pure\s+)?(?:Synth|Standard|Improved|Strong)\s+(.+?)\s+Booster/i);
      return m ? m[1] : null;
    }

    const primaryFam = familyFromBoosterName(selectedName);
    const fams = new Set();
    for (const n of pureOrBoosterNames) {
      const f = familyFromBoosterName(n);
      if (f) fams.add(f);
    }
    if (primaryFam) fams.delete(primaryFam);
    const sisters = [...fams];

    return { primaryFam, sisters, gasNames };
  }

  // ---------------------------
  // Calculator main action
  // ---------------------------
  async function runCalculator() {
    const selKey = $("#boosterSelect").value;
    const item = state.boosterItems.find((x) => x.key === selKey);
    if (!item || !item.typeId) {
      $("#calcStatus").textContent = "Selected item does not have a resolved typeID.";
      return;
    }

    const bpcCost = toNumber($("#bpcCost").value, 0);
    const totalRuns = Math.max(1, Math.floor(toNumber($("#totalRuns").value, 1)));
    const maxDepth = toNumber($("#expansionDepth").value, 0);
    const costHubKey = $("#costHub").value || "jita";
    const inputPriceMode = $("#inputPriceMode").value;
    const outputPriceMode = $("#outputPriceMode").value;
    const showProfit = $("#showProfit").checked;

    $("#calcStatus").textContent = "Fetching blueprint + market data…";

    // Fetch blueprint for selected item
    let bp;
    try {
      bp = await fuzzBlueprint(item.typeId);
    } catch (e) {
      console.error(e);
      $("#calcStatus").textContent = "Failed to fetch blueprint data for the selected item.";
      return;
    }

    const act = pickBlueprintActivity(bp);
    if (!act) {
      $("#calcStatus").textContent = "No manufacturing/reaction materials found for this item.";
      return;
    }

    const outPerRun = toNumber(bp?.blueprintDetails?.productQuantity, 1);
    const productName = bp?.blueprintDetails?.productTypeName || item.name;

    const directMats = (bp.activityMaterials[act] || []).map((m) => ({
      typeId: toNumber(m.typeid, null),
      name: m.name || `Type ${m.typeid}`,
      qtyPerRun: toNumber(m.quantity, 0),
    })).filter((m) => m.typeId);

    // Expanded totals
    let rawTotals = [];
    if (maxDepth > 0) {
      try {
        rawTotals = await expandToRawTotals(item.typeId, totalRuns, maxDepth);
      } catch (e) {
        console.warn("Expansion failed", e);
        rawTotals = [];
      }
    }

    // Prices: collect all typeIDs we need (direct + raw + output)
    const neededTypeIds = new Set([item.typeId]);
    for (const m of directMats) neededTypeIds.add(m.typeId);
    for (const r of rawTotals) neededTypeIds.add(r.typeId);

    await loadFuzzAggForAllHubs([...neededTypeIds]);

    // Render tables
    renderDirectMaterials(directMats, totalRuns);

    let effectiveRawTotals = rawTotals;

    const totalMaterialCost = maxDepth > 0
      ? renderRawMaterials(rawTotals, totalRuns, costHubKey, inputPriceMode)
      : (() => {
          // if no expansion, cost direct mats
          const agg = state.fuzzAgg[costHubKey] || {};
          let sum = 0;
          for (const m of directMats) {
            const unit = getAggPrice(agg, m.typeId, inputPriceMode);
            if (unit !== null) sum += unit * (m.qtyPerRun * totalRuns);
          }
          // still show a raw table using direct mats
          const pseudoRaw = directMats.map((m) => ({ typeId: m.typeId, name: m.name, qty: m.qtyPerRun * totalRuns }));
          renderRawMaterials(pseudoRaw, totalRuns, costHubKey, inputPriceMode);
          effectiveRawTotals = pseudoRaw;
          return sum;
        })();

    // Ice equivalents (approx.) derived from expanded raw totals
    renderIceEquivalents(effectiveRawTotals, totalRuns);

    const totalCostAllIn = totalMaterialCost + bpcCost;

    // Output market price and profit estimate at costing hub
    const aggCostHub = state.fuzzAgg[costHubKey] || {};
    const outUnitPrice = getAggPrice(aggCostHub, item.typeId, outputPriceMode);
    const totalOutputUnits = totalRuns * outPerRun;
    const estRevenue = outUnitPrice === null ? null : outUnitPrice * totalOutputUnits;
    const estProfit = estRevenue === null ? null : estRevenue - totalCostAllIn;

    const bpcPerRun = bpcCost / totalRuns;
    const bpcPerUnit = bpcCost / Math.max(totalOutputUnits, 1);
    const costPerRun = totalCostAllIn / totalRuns;
    const costPerUnit = totalCostAllIn / Math.max(totalOutputUnits, 1);

    const sister = detectSisterInfo(rawTotals, productName);

    const cards = [
      { k: "Output", v: productName, s: `${fmtInt(outPerRun)} per run · ${fmtInt(totalOutputUnits)} total units` },
      { k: "Material cost (costing hub)", v: `${fmtISK(totalMaterialCost)} ISK`, s: `${fmtISK(totalMaterialCost / totalRuns)} / run` },
      { k: "BPC cost (input)", v: `${fmtISK(bpcCost)} ISK`, s: `${fmtISK(bpcPerRun)} / run · ${fmtISK(bpcPerUnit)} / unit` },
      { k: "All‑in cost", v: `${fmtISK(totalCostAllIn)} ISK`, s: `${fmtISK(costPerRun)} / run · ${fmtISK(costPerUnit)} / unit` },
    ];

    if (showProfit) {
      cards.push({
        k: `Est. revenue (${costHubKey.toUpperCase()}, ${outputPriceMode === "sell_min" ? "sell min" : "buy max"})`,
        v: estRevenue === null ? "—" : `${fmtISK(estRevenue)} ISK`,
        s: estProfit === null ? "—" : `Profit: ${fmtISK(estProfit)} ISK`,
      });
    }

    if (sister.primaryFam || sister.sisters.length || sister.gasNames.length) {
      const sisterLine = [
        sister.primaryFam ? `Primary booster: ${sister.primaryFam}` : null,
        sister.sisters.length ? `Sister boosters: ${sister.sisters.join(", ")}` : null,
        sister.gasNames.length ? `Gasses in chain: ${[...new Set(sister.gasNames)].join(", ")}` : null,
      ].filter(Boolean).join(" · ");

      cards.push({ k: "Supply focus hints", v: sisterLine || "—" });
    }

    renderSummaryCards(cards);

    // Market stats snapshot (Fuzzworks) + then fill trades/day (Adam4EVE)
    const trades = {}; // hubKey -> sold/day
    renderMarketStats(item.typeId, trades);

    $("#calcStatus").textContent = "Calculated. Fetching trades/day (Adam4EVE)…";

    // Fill trades/day per hub sequentially due to Adam rate limit
    const date = getYesterdayUTC();
    for (const h of HUBS) {
      const url = `https://api.adam4eve.eu/v1/tracker?date=${date}&isBuy=0&locationID=${h.stationId}&typeID=${item.typeId}&withGone=0`;
      try {
        const data = await adamFetchJson(url, { ttlMs: 10 * 60 * 1000 });
        const row = data?.[String(item.typeId)];
        const amt = row ? toNumber(row.amount, null) : null;
        trades[h.key] = amt;
      } catch (e) {
        trades[h.key] = null;
      }
      renderMarketStats(item.typeId, trades);
    }

    $("#calcStatus").textContent = "Done.";
  }

  // ---------------------------
  // Init
  // ---------------------------
  async function init() {
    setText("#lastUpdated", `Last update: ${new Date().toLocaleString()}`);

    try {
      await loadStaticData();
      populateBoosterSelect();

      // Resolve all typeIDs
      await resolveAllTypeIDs();

      // Initial price loads: gases + boosters (all)
      const allTypeIds = [
        ...state.gasItems.filter((g) => g.typeId).map((g) => g.typeId),
        ...state.boosterItems.filter((b) => b.typeId).map((b) => b.typeId),
      ];
      await loadFuzzAggForAllHubs(allTypeIds);

      // Adam4EVE: trends + gas trades (both optional)
      await loadGasTrends7d();
      await loadGasTradesJitaYesterday();

      renderGasTable("#cytoTable", "cytoserocin");
      renderGasTable("#mykoTable", "mykoserocin");

      renderBoosterBoards();

      $("#opinion").innerHTML = computeOpinionHtml();

      // Booster analytics (price history + trades/day) are more expensive (Adam4EVE rate limit).
      // Load them asynchronously after the initial page paint, then refresh the opinion panel.
      (async () => {
        try {
          await loadBoosterTradesJitaYesterday();
          await loadBoosterStats7d();
          $("#opinion").innerHTML = computeOpinionHtml();
        } catch (e) {
          console.warn("Booster analytics unavailable", e);
        }
      })();

      $("#apiStatus").textContent = "APIs: ready";
      $("#apiStatus").classList.remove("pill-warn");
    } catch (e) {
      console.error(e);
      $("#apiStatus").textContent = "APIs: init failed (see console)";
      $("#apiStatus").classList.add("pill-warn");
    }

    $("#calcBtn").addEventListener("click", (ev) => {
      ev.preventDefault();
      runCalculator().catch((e) => {
        console.error(e);
        $("#calcStatus").textContent = "Calculation failed. See console for details.";
      });
    });
  }

  window.addEventListener("DOMContentLoaded", init);
})();
