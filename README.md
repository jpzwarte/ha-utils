# HA utils

Small Home Assistant dashboard helpers.

## Monthly energy card

Shows the kWh per month of the current year for any cumulative energy sensor, for example how
much a Zaptec charger delivered. The current month is highlighted, and the year's total is shown
below the chart.

It reads Home Assistant's long-term statistics, so the sensor needs
`state_class: total_increasing` (for Zaptec: the charger's *Energy meter* sensor). Months before
the sensor was recorded show 0. Statistics are compiled hourly, so the current month lags up to an
hour.

```yaml
type: custom:monthly-energy-card
entity: sensor.zaptec_go_2_energy_meter
title: Geladen per maand   # optional
```

Added from the card picker (**Energie per maand**), it preselects an energy sensor, preferring a
Zaptec one.

## Installation

In HACS, add this repository as a [custom repository](https://hacs.xyz/docs/faq/custom_repositories/)
(type: Dashboard) and install **HA utils**. HACS registers the dashboard resource.

Or copy `dist/monthly-energy-card.js` to `config/www/` and add `/local/monthly-energy-card.js`
(type: JavaScript module) under **Settings → Dashboards → ⋮ → Resources**.

## License

MIT
