/**
 * Monthly energy card: kWh per month of the current year, from Home Assistant's long-term
 * statistics of a cumulative energy sensor (such as a Zaptec charger's energy meter).
 *
 *   type: custom:monthly-energy-card
 *   entity: sensor.zaptec_go_2_energy_meter   # a sensor with state_class total_increasing
 *   offsets:                                  # optional: kWh missing from the statistics, per month
 *     "2026-04": 171.023
 */

const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
// Statistics are compiled hourly, so refreshing more often gains nothing.
const REFRESH_MS = 10 * 60e3;

const STYLE = `
  :host {
    --me-text: #1d1d1b;
    --me-muted: #6b6b66;
    --me-bar: #d0e8c8;
    --me-bar-current: #3f6e3a;
  }
  :host([dark]) {
    --me-text: var(--primary-text-color, #e8ece9);
    --me-muted: var(--secondary-text-color, #a3aaa5);
    --me-bar: rgba(160, 210, 150, 0.35);
    --me-bar-current: #7fbf73;
  }
  ha-card { padding: 28px 28px 24px; color: var(--me-text); }
  .subtitle { font-size: 15px; color: var(--me-muted); }
  .chart { display: flex; align-items: stretch; gap: 4px; height: 240px; margin-top: 24px; }
  .month { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; }
  .amount, .name {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 15px;
    color: var(--me-muted); text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .amount { height: 18px; line-height: 18px; margin-bottom: 10px; }
  .bar { height: calc((100% - 28px) * var(--f)); min-height: 4px; background: var(--me-bar); border-radius: 5px 5px 0 0; }
  .current .bar { background: var(--me-bar-current); }
  .names { display: flex; gap: 4px; margin-top: 12px; }
  .name { flex: 1; min-width: 0; text-transform: uppercase; }
  .empty { color: var(--me-muted); line-height: 1.5; }
  @media (max-width: 480px) {
    ha-card { padding: 20px; }
    .chart { height: 180px; gap: 2px; }
    .names { gap: 2px; }
    .amount, .name { font-size: 11px; }
    .amount { height: 14px; line-height: 14px; margin-bottom: 6px; }
    .bar { height: calc((100% - 20px) * var(--f)); }
  }
`;

class MonthlyEnergyCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._months = null; // kWh per month, January up to the current month
    this._error = null;
    this._fetchedAt = 0;
    this._fetching = false;
    this._dark = null;
  }

  static getStubConfig(hass) {
    const energy = Object.values(hass?.states || {}).filter(
      (s) =>
        s.entity_id.startsWith("sensor.") &&
        s.attributes.device_class === "energy" &&
        ["total", "total_increasing"].includes(s.attributes.state_class)
    );
    // Session sensors reset after every session and can miss the last reading of one, so the
    // charger's cumulative meter is the better source.
    const notSession = energy.filter((s) => !s.entity_id.includes("session"));
    const pick =
      notSession.find((s) => s.entity_id.includes("energy_meter")) ||
      notSession.find((s) => s.entity_id.includes("zaptec")) ||
      notSession[0] ||
      energy[0];
    return { entity: pick?.entity_id || "" };
  }

  setConfig(config) {
    if (!config.entity) throw new Error("Kies een energiesensor (entity).");
    for (const [key, kwh] of Object.entries(config.offsets || {})) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key) || !Number.isFinite(kwh)) {
        throw new Error(`Ongeldige offset ${key}: gebruik "JJJJ-MM": kWh.`);
      }
    }
    this._config = config;
    this._months = null;
    this._error = null;
    this._fetchedAt = 0;
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  _update() {
    if (!this._config) return;
    const dark = Boolean(this._hass.themes?.darkMode);
    if (dark !== this._dark) {
      this._dark = dark;
      this.toggleAttribute("dark", dark);
      this._render();
    }
    if (!this._fetching && Date.now() - this._fetchedAt > REFRESH_MS) this._fetch();
  }

  // --- data ---------------------------------------------------------------

  _monthOf(date) {
    // The statistics are grouped by month in Home Assistant's time zone.
    const tz = this._hass.config?.time_zone;
    const parts = new Intl.DateTimeFormat("en", { year: "numeric", month: "numeric", timeZone: tz }).formatToParts(date);
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    return { year: get("year"), month: get("month") - 1 };
  }

  async _fetch() {
    this._fetching = true;
    this._fetchedAt = Date.now();
    const id = this._config.entity;
    const now = this._monthOf(new Date());
    try {
      const result = await this._hass.callWS({
        type: "recorder/statistics_during_period",
        start_time: new Date(now.year, 0, 1).toISOString(),
        end_time: new Date(now.year + 1, 0, 1).toISOString(),
        statistic_ids: [id],
        period: "month",
        types: ["change"],
        units: { energy: "kWh" },
      });
      const rows = result[id] || [];
      const months = Array(now.month + 1).fill(0);
      for (const row of rows) {
        const { year, month } = this._monthOf(new Date(row.start));
        if (year === now.year && month < months.length) months[month] += row.change || 0;
      }
      for (const [key, kwh] of Object.entries(this._config.offsets || {})) {
        const [year, month] = key.split("-").map(Number);
        if (year === now.year && month <= months.length) months[month - 1] += kwh;
      }
      this._months = rows.length ? months : [];
      this._year = now.year;
      this._error = null;
    } catch (err) {
      this._error = err?.message || String(err);
    } finally {
      this._fetching = false;
      this._render();
    }
  }

  // --- rendering ----------------------------------------------------------

  _kwh(value) {
    return Math.round(value).toLocaleString("nl-NL");
  }

  _render() {
    if (!this._config || !this._hass) return;
    let body;

    if (this._error) {
      body = `<div class="empty">Statistieken konden niet worden geladen: ${this._error}</div>`;
    } else if (this._months === null) {
      body = `<div class="empty">Laden…</div>`;
    } else if (!this._months.length) {
      const state = this._hass.states[this._config.entity];
      body = `<div class="empty">${
        state
          ? `Geen statistieken voor ${this._config.entity} dit jaar. De sensor heeft state_class total_increasing nodig.`
          : `Entiteit ${this._config.entity} niet gevonden.`
      }</div>`;
    } else {
      const months = this._months;
      const last = months.length - 1;
      const top = Math.max(...months, 1);
      const bars = months
        .map(
          (value, i) => `
          <div class="month${i === last ? " current" : ""}" title="${MONTHS[i]}: ${value.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} kWh">
            <div class="amount">${this._kwh(value)}</div>
            <div class="bar" style="--f:${(value / top).toFixed(3)}"></div>
          </div>`
        )
        .join("");
      const names = months.map((_, i) => `<div class="name">${MONTHS[i]}</div>`).join("");
      const range = last === 0 ? MONTHS[0] : `${MONTHS[0]} t/m ${MONTHS[last]}`;
      body = `
        <div class="subtitle">${range} ${this._year}, in kWh</div>
        <div class="chart">${bars}</div>
        <div class="names">${names}</div>`;
    }

    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card>${body}</ha-card>`;
  }
}

customElements.define("monthly-energy-card", MonthlyEnergyCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "monthly-energy-card",
  name: "Energie per maand",
  description: "kWh per maand van dit jaar, bijvoorbeeld geladen door een laadpaal.",
  preview: true,
});
