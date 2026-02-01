# EVE Booster & Gas Calculator (GitHub Pages)

Static web app that:

- Calculates **booster / pure compound** build requirements from **Fuzzworks blueprint API**
- Pulls **live hub prices** (Jita / Amarr / Dodixie / Rens) from **Fuzzworks market aggregates**
- Shows a **gas price board** for Cytoserocin + Mykoserocin variants
- Adds a simple **“live opinion”** section based on 7‑day price trend + thin-market heuristics

> Intended for personal use. EVE Online and all related trademarks are the property of CCP hf.

---

## Deploy on GitHub Pages (no build step)

1. Create a GitHub repo (e.g. `eve-booster-calculator`)
2. Upload the contents of this folder to the repo root
3. In GitHub: **Settings → Pages**
   - Source: `Deploy from a branch`
   - Branch: `main` (or `master`), folder `/ (root)`
4. Visit the Pages URL GitHub gives you.

That’s it — it’s pure HTML/CSS/JS.

---

## Data sources used

- **TypeID lookup:** `https://www.fuzzwork.co.uk/api/typeid2.php?typename=...` (pipe-separated type names)
- **Blueprint materials:** `https://www.fuzzwork.co.uk/blueprint/api/blueprint.php?typeid=...`
- **Hub prices:** `https://market.fuzzwork.co.uk/aggregates/?station=<stationId>&types=<comma-separated-typeIDs>`
- **Trades/day + history:** `https://api.adam4eve.eu/`

Adam4EVE publishes a rate limit of **1 request per 5 seconds**, so the app queues those calls.

---

## Editing / extending

- Booster families + tiers are in `assets/app.js` (and mirrored in `data/boosters.json`).
- Gas rows (regions + shade) are in `data/gases.json`.
- Hub station IDs are in `data/stations.json`.

You can add additional hubs (e.g. Hek) by adding a station to both:
- `data/stations.json`
- `HUBS` array in `assets/app.js`

---

## Notes

- “Profit estimate” does **not** include sales tax, broker fees, hauling, reaction slots, structure bonuses, etc.
- “Trades/day” uses Adam4EVE’s tracker for **yesterday (UTC)** and the **sell-side** tracker.

---

## License

MIT — see `LICENSE`.
