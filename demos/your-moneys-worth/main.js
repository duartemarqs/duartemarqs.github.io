export {};
// full dataset (raw rows, one per country/year)
let fullData = [];
let fullDataMagnetNormalized = [];

// countries selected in the list widget
let selectedCountries = new Set();

let allCountries = [];
// per-country averages over the selected year interval (selected countries only)
let dataFiltered = [];
let magnetNodes = [];

// years with data (read from the dataset) and the selected interval (both inclusive)
let MIN_YEAR = 2014;
let MAX_YEAR = 2024;
let startYear = MIN_YEAR;
let endYear = MAX_YEAR;

// Variável global para armazenar o índice atual do eixo Y do line chart
let currentYAxisMetric = "Purchasing Power Index";

// shared animation settings
const ANIM_MS = 750;
const EASE = d3.easeCubicInOut;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// setup data
function setupData() {
    d3.csv("./final_dataset.csv")
        .then((data) => {
            fullData = data;

            const years = data.map((d) => +d.Year);
            MIN_YEAR = d3.min(years);
            MAX_YEAR = d3.max(years);
            startYear = MIN_YEAR;
            endYear = MAX_YEAR;

            allCountries = [...new Set(data.map((d) => d.Country))];
            selectedCountries = new Set(allCountries);
            magnetNodes = allCountries.map((c) => ({ country: c, isActive: true }));

            // * list widgets
            updateListWidget(allCountries);

            // * slider
            genTimeline(data);

            // * scatter plot (purchasing power index, wage) + line chart (year, metric)
            initScatterPlot();
            initLineChart();

            // * magnet chart
            genMagnetList();

            // * compute the averages for the whole interval and draw everything
            dataChange(startYear, endYear, true);
            updateLineChart(false);

            initializeInputListener();

            // * linked hover highlight
            bindHover("#scatter-plot", (el) => (el ? scatterTooltipHtml(el.__data__) : null));
            bindHover("#line-chart", lineChartTooltip);
            bindHover("#magnet-chart", (el) =>
                el ? magnetNodeTooltipHtml(el.__data__) : null
            );

            d3.select("#y-axis-selector").on("change", function () {
                updateYAxis(this.value);
            });

            // add btn evnts
            d3.select("#btn-selectAllCountries").on("click", selectAllCountries);
        })
        .catch((error) => {
            console.error("Error loading the CSV file:", error);
        });
}

setupData();

/* ------------------------------------------------------------------ */
/* Salary comparison (currency aware)                                  */
/* ------------------------------------------------------------------ */

// The dataset's "Wages" are average annual wages in USD PPP (2024 repeats 2023).
// To compare a salary with them we convert both sides to the country's own currency:
//  - average wage (local currency) = Wages (USD PPP) x PPP conversion factor
//  - your salary (local currency)  = salary / FX[your currency] x FX[country currency]
// Source: World Bank, 2023 - PPP conversion factor, private consumption
// (PA.NUS.PRVT.PP, local currency per international $) and official exchange
// rate (PA.NUS.FCRF, local currency per USD, period average).
const WAGE_YEAR = "2023";

const COUNTRY_CURRENCY = {
    Australia: { currency: "AUD", ppp: 1.395812 },
    Austria: { currency: "EUR", ppp: 0.718238 },
    Belgium: { currency: "EUR", ppp: 0.753203 },
    Canada: { currency: "CAD", ppp: 1.227161 },
    Chile: { currency: "CLP", ppp: 472.397681 },
    Colombia: { currency: "COP", ppp: 1520.222239 },
    Denmark: { currency: "DKK", ppp: 6.796948 },
    Estonia: { currency: "EUR", ppp: 0.642819 },
    Finland: { currency: "EUR", ppp: 0.797354 },
    France: { currency: "EUR", ppp: 0.719442 },
    Germany: { currency: "EUR", ppp: 0.702414 },
    Greece: { currency: "EUR", ppp: 0.552885 },
    Hungary: { currency: "HUF", ppp: 182.532916 },
    Iceland: { currency: "ISK", ppp: 151.201619 },
    Ireland: { currency: "EUR", ppp: 0.886291 },
    Israel: { currency: "ILS", ppp: 3.561296 },
    Italy: { currency: "EUR", ppp: 0.631546 },
    Japan: { currency: "JPY", ppp: 99.191165 },
    Latvia: { currency: "EUR", ppp: 0.532479 },
    Lithuania: { currency: "EUR", ppp: 0.534146 },
    Luxembourg: { currency: "EUR", ppp: 0.849427 },
    Mexico: { currency: "MXN", ppp: 10.501206 },
    Netherlands: { currency: "EUR", ppp: 0.744821 },
    "New Zealand": { currency: "NZD", ppp: 1.483022 },
    Norway: { currency: "NOK", ppp: 9.379813 },
    Poland: { currency: "PLN", ppp: 1.994416 },
    Portugal: { currency: "EUR", ppp: 0.555035 },
    Slovakia: { currency: "EUR", ppp: 0.541108 },
    Slovenia: { currency: "EUR", ppp: 0.576883 },
    Spain: { currency: "EUR", ppp: 0.581533 },
    Sweden: { currency: "SEK", ppp: 8.515827 },
    Switzerland: { currency: "CHF", ppp: 1.160727 },
    "United Kingdom": { currency: "GBP", ppp: 0.673649 },
    "United States": { currency: "USD", ppp: 1 },
};

// local currency units per USD (2023 average)
const FX_PER_USD = {
    EUR: 0.92484,
    USD: 1,
    GBP: 0.804539,
    CHF: 0.89849,
    JPY: 140.4911,
    AUD: 1.505191,
    CAD: 1.349909,
    NZD: 1.628433,
    DKK: 6.889703,
    SEK: 10.610161,
    NOK: 10.563333,
    ISK: 137.942952,
    PLN: 4.203667,
    HUF: 353.088333,
    ILS: 3.667375,
    MXN: 17.758717,
    CLP: 840.066527,
    COP: 4325.955,
};

// Monthly salaries paid per year. The wage data are *annual* averages, so the
// typical monthly paycheck is annual / payments. Only countries where extra
// months are statutory or set by near-universal collective agreements are
// listed; everywhere else it is 12 (bonuses may exist but are not standard).
const SALARY_PAYMENTS = {
    Austria: { n: 14, why: "13th and 14th month salaries (collective agreements)" },
    Belgium: { n: 13.92, why: "13th month (sector agreements) + double holiday pay (92%)" },
    Colombia: { n: 13, why: "prima de servicios, one extra month (statutory)" },
    Greece: { n: 14, why: "Christmas bonus + Easter bonus + holiday allowance (statutory)" },
    Italy: { n: 13, why: "tredicesima, 13th month salary (some sectors also pay a 14th)" },
    Mexico: { n: 12.5, why: "aguinaldo, at least 15 days of pay (statutory)" },
    Netherlands: { n: 12.96, why: "8% holiday allowance (statutory)" },
    Portugal: { n: 14, why: "holiday and Christmas subsidies (statutory)" },
    Spain: { n: 14, why: "two pagas extraordinarias (statutory, sometimes prorated)" },
};
const salaryPayments = (country) => SALARY_PAYMENTS[country]?.n ?? 12;
const fmtPayments = d3.format(".4~f");

let userSalary = 0;
let userCurrency = "EUR";
// how many monthly salaries the user receives per year
let userPayments = 12;

// a full bar = this many times the country's average wage
const METER_MAX_RATIO = 2;

const moneyFormatters = new Map();
function formatMoney(value, currency) {
    if (!moneyFormatters.has(currency)) {
        moneyFormatters.set(
            currency,
            new Intl.NumberFormat("en", {
                style: "currency",
                currency,
                maximumFractionDigits: 0,
            })
        );
    }
    return moneyFormatters.get(currency).format(value);
}

/**
 * Compares the user's yearly pay (monthly salary x payments per year) with a
 * country's average yearly wage, both expressed in that country's currency.
 * Comparing yearly totals keeps it fair between countries paying 12, 13 or 14
 * salaries a year.
 */
function salaryComparison(country) {
    const info = COUNTRY_CURRENCY[country];
    const row = fullData.find((d) => d.Country === country && d.Year === WAGE_YEAR);
    if (!info || !row) return null;

    const payments = salaryPayments(country);
    const avgAnnualLocal = +row.Wages * info.ppp;
    const result = {
        country,
        currency: info.currency,
        payments,
        avgAnnualLocal,
        avgMonthlyLocal: avgAnnualLocal / payments,
    };

    if (userSalary > 0) {
        const toLocal = FX_PER_USD[info.currency] / FX_PER_USD[userCurrency];
        result.userMonthlyLocal = userSalary * toLocal;
        result.userAnnualLocal = userSalary * userPayments * toLocal;
        result.ratio = result.userAnnualLocal / avgAnnualLocal;
    }
    return result;
}

// Event listeners for the salary input and its currency
function initializeInputListener() {
    const inputMoney = document.getElementById("input-money");
    const currencySelect = d3.select("#input-currency");

    currencySelect
        .selectAll("option")
        .data(Object.keys(FX_PER_USD).sort())
        .join("option")
        .attr("value", (d) => d)
        .text((d) => d)
        .property("selected", (d) => d === userCurrency);

    currencySelect.on("change", function () {
        userCurrency = this.value;
        updateSalaryBars();
    });

    d3.select("#input-payments")
        .selectAll("option")
        .data([12, 13, 14])
        .join("option")
        .attr("value", (d) => d)
        .text((d) => `${d}×`)
        .property("selected", (d) => d === userPayments);

    d3.select("#input-payments").on("change", function () {
        userPayments = +this.value;
        updateSalaryBars();
    });

    if (inputMoney) {
        inputMoney.addEventListener("input", function () {
            const value = parseFloat(this.value.replace(/\s/g, "").replace(",", "."));
            userSalary = !isNaN(value) && value > 0 ? value : 0;
            updateSalaryBars();
        });
    }

    updateSalaryBars();
}

function updateSalaryBars() {
    const hasSalary = userSalary > 0;
    d3.select(".country-lists").classed("has-salary", hasSalary);

    d3.selectAll(".country-list li").each(function (country) {
        const cmp = salaryComparison(country);
        if (!hasSalary || !cmp) return;

        const li = d3.select(this);
        const above = cmp.ratio >= 1;
        const pct = cmp.ratio * 100;

        li.select(".salary-fill")
            .classed("above", above)
            .style("width", `${Math.min(cmp.ratio / METER_MAX_RATIO, 1) * 100}%`);
        li.select(".salary-pct")
            .classed("above", above)
            .text(pct >= 1000 ? ">999%" : `${Math.round(pct)}%`);
    });

    const hint = d3.select("#salary-hint");
    if (!hasSalary) {
        hint.html(
            "Type your <b>gross monthly salary</b> and pick its currency to compare it with the average wage of each country."
        );
    } else {
        hint.html(
            `Each bar compares your <b>yearly gross pay</b> (${formatMoney(userSalary, userCurrency)} × ${userPayments} salaries ` +
                `= ${formatMoney(userSalary * userPayments, userCurrency)}) with the <b>average yearly gross wage</b> of that country ` +
                `(${WAGE_YEAR}), converting currencies at ${WAGE_YEAR} exchange rates. Yearly totals are used because some ` +
                `countries pay 13 or 14 salaries a year. ` +
                `<span class="hint-legend"><span class="hint-mark"></span> = 100% (the average)</span>. ` +
                `Hover a country for the amounts.`
        );
    }
}

function countryWageTooltipHtml(country) {
    const cmp = salaryComparison(country);
    const code = countryCodes[country];
    const flag = code ? `<img src="${getCountryFlagUrl(code)}" alt="">` : "";
    let html = `<div class="tt-title">${flag}${country}</div>`;
    if (!cmp) return html;

    const money = (v) => formatMoney(v, cmp.currency);
    html += ttRow(
        "Average gross pay",
        `${money(cmp.avgMonthlyLocal)}/month × ${fmtPayments(cmp.payments)}`
    );
    html += ttRow("Average per year", money(cmp.avgAnnualLocal));
    if (cmp.ratio !== undefined) {
        const converted =
            cmp.currency === userCurrency ? "" : ` ≈ ${money(cmp.userMonthlyLocal)}`;
        html += ttRow(
            "Your salary",
            `${formatMoney(userSalary, userCurrency)}${converted} × ${userPayments}`
        );
        html += ttRow("Your pay per year", money(cmp.userAnnualLocal));
        html += ttRow("Compared with the average", `${Math.round(cmp.ratio * 100)}%`, true);
        html +=
            `<div class="tt-note">` +
            (cmp.ratio >= 1
                ? `You would earn ${d3.format(".2~f")(cmp.ratio)}× the average wage here.`
                : `You would earn ${Math.round((1 - cmp.ratio) * 100)}% less than the average wage here.`) +
            `</div>`;
    } else {
        html += `<div class="tt-note">Type your salary above to compare.</div>`;
    }
    const extra = SALARY_PAYMENTS[country];
    html +=
        `<div class="tt-source">` +
        (extra
            ? `${fmtPayments(extra.n)} salaries a year: ${extra.why}. `
            : `12 salaries a year. `) +
        `OECD average annual wage, converted with World Bank ${WAGE_YEAR} PPP and exchange rates.</div>`;
    return html;
}

/* ------------------------------------------------------------------ */
/* Country list widget                                                 */
/* ------------------------------------------------------------------ */

/**
 * Update the list widget with new data.
 * @param {string[]} data The countries to display.
 */
function updateListWidget(data = allCountries) {
    // Divide os países em duas partes
    const midpoint = Math.ceil(data.length / 2);
    renderCountryList(d3.select("#list-widget-left"), data.slice(0, midpoint));
    renderCountryList(d3.select("#list-widget-right"), data.slice(midpoint));

    bindHover(".country-lists", (el) =>
        el ? countryWageTooltipHtml(el.getAttribute("data-country")) : null
    );
    refreshListSelection();
    updateSalaryBars();
}

// API Flag Icons
function getCountryFlagUrl(countryCode) {
    return `https://flagcdn.com/24x18/${countryCode}.png`;
}

const countryCodes = {
    Australia: "au",
    Austria: "at",
    Belgium: "be",
    Canada: "ca",
    Chile: "cl",
    Colombia: "co",
    Denmark: "dk",
    Estonia: "ee",
    Finland: "fi",
    France: "fr",
    Germany: "de",
    Greece: "gr",
    Hungary: "hu",
    Iceland: "is",
    Ireland: "ie",
    Israel: "il",
    Italy: "it",
    Japan: "jp",
    Latvia: "lv",
    Lithuania: "lt",
    Luxembourg: "lu",
    Mexico: "mx",
    Netherlands: "nl",
    "New Zealand": "nz",
    Norway: "no",
    Poland: "pl",
    Portugal: "pt",
    Slovakia: "sk",
    Slovenia: "si",
    Spain: "es",
    Sweden: "se",
    Switzerland: "ch",
    "United Kingdom": "gb",
    "United States": "us",
};

function renderCountryList(list, data) {
    list.selectAll("li")
        .data(data, (country) => country)
        .join((enter) => {
            const li = enter.append("li").attr("data-country", (c) => c);

            const name = li.append("span").attr("class", "country-name");
            name.append("img")
                .attr("src", (c) => (countryCodes[c] ? getCountryFlagUrl(countryCodes[c]) : ""))
                .attr("alt", "");
            name.append("span").attr("class", "country-label").text((c) => c);

            const meter = li.append("span").attr("class", "salary-meter");
            const track = meter.append("span").attr("class", "salary-track");
            track.append("span").attr("class", "salary-fill");
            track.append("span")
                .attr("class", "salary-avg-mark")
                .style("left", `${100 / METER_MAX_RATIO}%`);
            meter.append("span").attr("class", "salary-pct");

            li.on("click", onCountryClick);
            return li;
        });
}

/** Bold = part of the current filter (nothing is bold when every country is shown). */
function refreshListSelection() {
    const filtering = selectedCountries.size < allCountries.length;
    d3.selectAll(".country-list li").classed(
        "is-selected",
        (c) => filtering && selectedCountries.has(c)
    );
}

function onCountryClick(event, country) {
    // when every country is shown, the first click isolates the clicked one
    if (selectedCountries.size === allCountries.length) {
        selectedCountries.clear();
    }

    if (selectedCountries.has(country)) {
        selectedCountries.delete(country);
    } else {
        selectedCountries.add(country);
    }

    // deselecting the last country goes back to showing all of them
    if (selectedCountries.size === 0) {
        allCountries.forEach((c) => selectedCountries.add(c));
    }

    selectionChanged();
}

function selectionChanged() {
    // * magnet chart: keep its nodes in sync with the selected countries
    magnetNodes.forEach((n) => (n.isActive = selectedCountries.has(n.country)));

    refreshListSelection();
    dataChange(startYear, endYear);
    updateLineChart();
    applyHighlight();
}

/* ------------------------------------------------------------------ */
/* Linked hover highlight (one country at a time, across every view)   */
/* ------------------------------------------------------------------ */

let hoveredCountry = null;

function setHoveredCountry(country) {
    if (country === hoveredCountry) return;
    hoveredCountry = country;
    applyHighlight();
}

/**
 * Re-applies the hover highlight from the single `hoveredCountry` state, so
 * a missed mouseout can never leave several countries highlighted.
 */
function applyHighlight() {
    const h = hoveredCountry;

    d3.selectAll("#scatter-plot .dot")
        .classed("is-hovered", (d) => d.country === h)
        .filter((d) => d.country === h)
        .raise();

    d3.select("#line-chart .line-plot").classed(
        "has-hover",
        h !== null && selectedCountries.has(h)
    );
    d3.selectAll("#line-chart g.country-line")
        .classed("is-hovered", ([c]) => c === h)
        .filter(([c]) => c === h)
        .raise();

    d3.selectAll(".country-list li").classed("is-hovered", (c) => c === h);

    d3.selectAll("#magnet-chart .node")
        .classed("is-hovered", (d) => d.country === h)
        .filter((d) => d.country === h)
        .raise();
}

/**
 * Hover tracking by event delegation: whatever element is under the pointer
 * decides the hovered country (via its closest [data-country] ancestor).
 */
/**
 * @param {string} selector container to track
 * @param {((el: Element | null, event: any) => string | null) | null} [tooltipFn]
 *        builds the tooltip for the hovered [data-country] element (null = none)
 */
function bindHover(selector, tooltipFn = null) {
    const container = d3.select(selector);

    // the element really under the pointer (event.target can be stale right
    // after the hovered element is raised to the front)
    const countryElementAt = (event) => {
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        const el = hit && hit.closest ? hit.closest("[data-country]") : null;
        return el && container.node().contains(el) ? el : null;
    };

    const update = (event) => {
        const el = countryElementAt(event);
        setHoveredCountry(el ? el.getAttribute("data-country") : null);
        if (!tooltipFn) return;
        const html = el ? tooltipFn(el, event) : null;
        if (html) showTooltip(event, html);
        else hideTooltip();
    };

    container
        .on("mouseover.hover", update)
        .on("mousemove.hover", update)
        .on("mouseleave.hover", () => {
            setHoveredCountry(null);
            if (tooltipFn) tooltipFn(null, null);
            hideTooltip();
        });
}

/* ------------------------------------------------------------------ */
/* Shared tooltip                                                      */
/* ------------------------------------------------------------------ */

function getTooltip() {
    let tip = d3.select("body").select(".chart-tooltip");
    if (tip.empty()) {
        tip = d3.select("body").append("div").attr("class", "chart-tooltip");
    }
    return tip;
}

function showTooltip(event, html) {
    const tip = getTooltip().html(html).classed("visible", true);
    const box = tip.node().getBoundingClientRect();
    const pad = 14;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + box.width > window.innerWidth - 8) x = event.clientX - box.width - pad;
    if (y + box.height > window.innerHeight - 8) y = event.clientY - box.height - pad;
    tip.style("left", `${Math.max(8, x)}px`).style("top", `${Math.max(8, y)}px`);
}

function ttRow(label, value, active = false) {
    return `<div class="tt-row${active ? " tt-active" : ""}"><span>${label}</span><b>${value}</b></div>`;
}

function hideTooltip() {
    getTooltip().classed("visible", false);
}

/* ------------------------------------------------------------------ */
/* Scatter plot                                                        */
/* ------------------------------------------------------------------ */

const SCATTER = {
    width: 370,
    height: 337,
    margin: { top: 20, right: 15, bottom: 45, left: 67 },
};

function initScatterPlot() {
    const { width, height, margin } = SCATTER;

    const svg = d3
        .select("#scatter-plot")
        .append("svg")
        .attr("viewBox", [0, 0, width, height]);

    // each axis is clipped to its own strip, so ticks sliding in/out during
    // transitions never cross into the plot or outside the panel
    const defs = svg.append("defs");
    defs.append("clipPath")
        .attr("id", "scatter-clip-x")
        .append("rect")
        .attr("x", margin.left - 24)
        .attr("y", 0)
        .attr("width", width - margin.left + 24)
        .attr("height", 26);
    defs.append("clipPath")
        .attr("id", "scatter-clip-y")
        .append("rect")
        .attr("x", -margin.left)
        .attr("y", margin.top - 10)
        .attr("width", margin.left + 1)
        .attr("height", height - margin.top - margin.bottom + 20);

    svg.append("g")
        .attr("class", "xAxis")
        .attr("transform", `translate(0, ${height - margin.bottom})`)
        .attr("clip-path", "url(#scatter-clip-x)");
    svg.append("g")
        .attr("class", "yAxis")
        .attr("transform", `translate(${margin.left}, 0)`)
        .attr("clip-path", "url(#scatter-clip-y)");

    svg.append("text")
        .attr("class", "xLabel axis-label")
        .attr("transform", `translate(${(width + margin.left) / 2}, ${height - 6})`)
        .style("text-anchor", "middle")
        .text("Purchasing Power Index");
    svg.append("text")
        .attr("class", "yLabel axis-label")
        .attr("transform", "rotate(-90)")
        .attr("y", 0)
        .attr("x", -(height - margin.bottom) / 2)
        .attr("dy", "1em")
        .style("text-anchor", "middle")
        .text("Wages");

    svg.append("g").attr("class", "dots");
}

/**
 * Update the scatter plot with the current dataFiltered (animated).
 */
function genScatterPlot() {
    const svg = d3.select("#scatter-plot").select("svg");
    if (svg.empty()) return;

    const { width, height, margin } = SCATTER;

    const data = dataFiltered
        .map((d) => ({
            x: Number(d["Purchasing Power Index"]),
            y: Number(d.Wages),
            country: d.Country,
        }))
        .filter((d) => !isNaN(d.x) && !isNaN(d.y));

    const xScale = d3
        .scaleLinear()
        .domain([0, (d3.max(data, (d) => d.x) ?? 100) + 5])
        .nice()
        .range([margin.left, width - margin.right]);

    const yScale = d3
        .scaleLinear()
        .domain([0, d3.max(data, (d) => d.y) ?? 1])
        .nice()
        .range([height - margin.bottom, margin.top]);

    const t = svg.transition("scatter").duration(ANIM_MS).ease(EASE);

    svg.select(".xAxis").transition(t).call(d3.axisBottom(xScale).ticks(6));
    svg.select(".yAxis").transition(t).call(d3.axisLeft(yScale));

    svg.select(".dots")
        .selectAll(".dot")
        .data(data, (d) => d.country)
        .join(
            (enter) =>
                enter
                    .append("circle")
                    .attr("class", "dot")
                    .attr("data-country", (d) => d.country)
                    .attr("cx", (d) => xScale(d.x))
                    .attr("cy", (d) => yScale(d.y))
                    .attr("r", 5)
                    .attr("fill", "#ece7ca")
                    // newly selected countries fade in
                    .attr("opacity", 0),
            (update) => update,
            (exit) =>
                exit
                    // rename so a re-selected country gets a fresh dot instead of
                    // reusing one that is about to be removed
                    .attr("class", "dot-exit")
                    .style("pointer-events", "none")
                    // deselected countries fade out
                    .call((e) => e.transition(t).attr("opacity", 0).remove())
        )
        .transition(t)
        .attr("cx", (d) => xScale(d.x))
        .attr("cy", (d) => yScale(d.y))
        .attr("r", 5)
        .attr("opacity", 1);

    applyHighlight();
}

const yearsLabel = () =>
    startYear === endYear ? `${startYear}` : `${startYear}–${endYear}`;

function scatterTooltipHtml(d) {
    const code = countryCodes[d.country];
    const flag = code ? `<img src="${getCountryFlagUrl(code)}" alt="">` : "";
    return (
        `<div class="tt-title">${flag}${d.country}</div>` +
        ttRow("Purchasing Power Index", fmt2(d.x), true) +
        ttRow("Average annual wage", `${d3.format(",.0f")(d.y)} USD PPP`, true) +
        `<div class="tt-source">Averages over ${yearsLabel()}. Wages in US dollars at purchasing power parity.</div>`
    );
}

/* ------------------------------------------------------------------ */
/* Line chart                                                          */
/* ------------------------------------------------------------------ */

const LINE = {
    width: 700,
    height: 320,
    margin: { top: 25, right: 25, bottom: 50, left: 75 },
};
const LINE_METRIC_LABELS = {
    "Purchasing Power Index": "Purchasing Power Index",
    AvgInflation: "Avg. Inflation (%)",
};
let lineX = null;
let lineY = null;

const fmt2 = d3.format(".2f");

function lineTooltipHtml(country, row) {
    const code = countryCodes[country];
    const flag = code ? `<img src="${getCountryFlagUrl(code)}" alt="">` : "";
    const rowHtml = ttRow;
    return (
        `<div class="tt-title">${flag}${country}</div>` +
        rowHtml("Year", row.Year, false) +
        rowHtml(
            "Purchasing Power Index",
            fmt2(+row["Purchasing Power Index"]),
            currentYAxisMetric === "Purchasing Power Index"
        ) +
        rowHtml(
            "Avg. Inflation",
            `${fmt2(+row.AvgInflation)}%`,
            currentYAxisMetric === "AvgInflation"
        )
    );
}

function initLineChart() {
    const { width, height, margin } = LINE;
    const iw = width - margin.left - margin.right;
    const ih = height - margin.top - margin.bottom;

    d3.select("#line-chart").selectAll("*").remove();

    const svg = d3
        .select("#line-chart")
        .append("svg")
        .attr("viewBox", [0, 0, width, height]);

    // lines are clipped exactly to the plot area (years outside the interval are hidden),
    // dots get a little slack so the ones on the edges are not cut in half
    const defs = svg.append("defs");
    defs.append("clipPath")
        .attr("id", "line-clip-lines")
        .append("rect")
        .attr("x", 0)
        .attr("y", -10)
        .attr("width", iw)
        .attr("height", ih + 20);
    defs.append("clipPath")
        .attr("id", "line-clip-dots")
        .append("rect")
        .attr("x", -8)
        .attr("y", -10)
        .attr("width", iw + 16)
        .attr("height", ih + 20);

    const g = svg
        .append("g")
        .attr("class", "line-root")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

    // axes are clipped to their own strip so animated ticks stay inside the chart
    defs.append("clipPath")
        .attr("id", "line-clip-x")
        .append("rect")
        .attr("x", -24)
        .attr("y", 0)
        .attr("width", iw + 24 + margin.right)
        .attr("height", 26);
    defs.append("clipPath")
        .attr("id", "line-clip-y")
        .append("rect")
        .attr("x", -margin.left)
        .attr("y", -10)
        .attr("width", margin.left + 1)
        .attr("height", ih + 20);

    lineX = d3.scaleLinear().range([0, iw]);
    lineY = d3.scaleLinear().range([ih, 0]);

    g.append("g")
        .attr("class", "xAxis")
        .attr("transform", `translate(0, ${ih})`)
        .attr("clip-path", "url(#line-clip-x)");
    g.append("g").attr("class", "yAxis").attr("clip-path", "url(#line-clip-y)");

    g.append("text")
        .attr("class", "yLabel axis-label")
        .attr("text-anchor", "middle")
        .attr("transform", `translate(-55,${ih / 2})rotate(-90)`)
        .text(LINE_METRIC_LABELS[currentYAxisMetric]);
    g.append("text")
        .attr("class", "xLabel axis-label")
        .attr("text-anchor", "middle")
        .attr("transform", `translate(${iw / 2},${ih + 42})`)
        .text("Year");

    const byCountry = d3
        .groups(fullData, (d) => d.Country)
        .map(([country, rows]) => [
            country,
            rows.slice().sort((a, b) => +a.Year - +b.Year),
        ]);

    const groups = g
        .append("g")
        .attr("class", "line-plot")
        .selectAll("g.country-line")
        .data(byCountry, (d) => d[0])
        .join("g")
        .attr("class", "country-line")
        .attr("data-country", (d) => d[0]);

    groups.append("path")
        .attr("class", "line")
        .datum((d) => d[1])
        .attr("fill", "none")
        .attr("stroke", "#ece7ca")
        .attr("stroke-width", 2)
        .attr("clip-path", "url(#line-clip-lines)")
        .style("pointer-events", "none");

    // wide transparent path so a 2px line is easy to hover
    groups.append("path")
        .attr("class", "lineHit")
        .datum((d) => d[1])
        .attr("fill", "none")
        .attr("stroke", "transparent")
        .attr("stroke-width", 14)
        .attr("clip-path", "url(#line-clip-lines)");
    // (pointer-events for .lineHit are set in CSS, so hidden countries can turn them off)

    groups.append("g")
        .attr("clip-path", "url(#line-clip-dots)")
        .selectAll("circle")
        .data((d) => d[1])
        .join("circle")
        .attr("class", "lineDot")
        .attr("r", 4)
        .attr("fill", "#79a57f")
        .attr("opacity", 1);

}

/**
 * Tooltip for the line chart: the year nearest to the pointer on the hovered
 * country's line (el = its g.country-line, or null when nothing is hovered).
 */
function lineChartTooltip(el, event) {
    const dots = d3.select("#line-chart").selectAll(".lineDot");
    if (!el) {
        dots.classed("is-year", false);
        return null;
    }
    const [country, rows] = el.__data__;
    const [mx] = d3.pointer(event, el);
    const year = clamp(Math.round(lineX.invert(mx)), startYear, endYear);
    const row = rows.find((r) => +r.Year === year);

    dots.classed("is-year", (d) => d.Country === country && +d.Year === year);
    return row ? lineTooltipHtml(country, row) : null;
}

/**
 * Updates the line chart for the current year interval, metric and selected
 * countries. Lines morph to the new scales instead of being redrawn.
 * @param {boolean} animate whether to transition (false for the first draw)
 */
function updateLineChart(animate = true) {
    const svg = d3.select("#line-chart").select("svg");
    if (svg.empty() || !lineX) return;

    const metric = currentYAxisMetric;

    // a single year gets some room on both sides so its dots are centered
    lineX.domain(
        startYear === endYear ? [startYear - 0.5, endYear + 0.5] : [startYear, endYear]
    );

    const visible = fullData.filter(
        (d) =>
            selectedCountries.has(d.Country) &&
            +d.Year >= startYear &&
            +d.Year <= endYear
    );
    const [minY, maxY] = d3.extent(visible, (d) => +d[metric]);
    if (minY !== undefined) {
        lineY.domain(minY >= 0 ? [0, maxY] : [minY, maxY]).nice();
    }

    const t = svg.transition("line-update").duration(animate ? ANIM_MS : 0).ease(EASE);
    const apply = (sel) => (animate ? sel.transition(t) : sel);

    apply(svg.select(".xAxis")).call(
        d3
            .axisBottom(lineX)
            .tickValues(d3.range(startYear, endYear + 1))
            .tickFormat(d3.format("d"))
    );
    apply(svg.select(".yAxis")).call(d3.axisLeft(lineY).ticks(6));
    svg.select(".yLabel").text(LINE_METRIC_LABELS[metric] || metric);

    const lineGen = d3
        .line()
        .x((d) => lineX(+d.Year))
        .y((d) => lineY(+d[metric]));

    apply(svg.selectAll(".line, .lineHit")).attr("d", lineGen);
    apply(svg.selectAll(".lineDot"))
        .attr("cx", (d) => lineX(+d.Year))
        .attr("cy", (d) => lineY(+d[metric]));

    // visibility is handled per country group; reset anything the hover code changed
    svg.selectAll(".line").attr("opacity", 1);
    svg.selectAll(".lineDot").attr("opacity", 1);
    // deselected countries are hidden and cannot be hovered (see .is-hidden in CSS)
    svg.selectAll("g.country-line").classed("is-hidden", ([c]) => !selectedCountries.has(c));
    apply(svg.selectAll("g.country-line")).attr("opacity", ([c]) =>
        selectedCountries.has(c) ? 1 : 0
    );
}

// Função para atualizar o eixo Y e os dados com base no índice selecionado
function updateYAxis(metric) {
    currentYAxisMetric = metric;
    updateLineChart();
}

/* ------------------------------------------------------------------ */
/* Timeline (year interval selection)                                  */
/* ------------------------------------------------------------------ */

let timelineX = null;
let timelineBrush = null;
let timelineBrushG = null;

/**
 * Generates the time slider for the years in the dataset.
 * Each year is a band [year, year + 1); the brush snaps to whole years.
 * @param {*} data with the year attribute
 */
function genTimeline(data) {
    const margin = { top: 10, right: 15, bottom: 30, left: 50 };
    const W = 600;
    const H = 180;
    const width = W - margin.left - margin.right;
    const height = H - margin.top - margin.bottom;

    const root = d3
        .select("#timeline")
        .append("svg")
        .attr("viewBox", [0, 0, W, H]);

    const svg = root
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const avgByYear = d3
        .rollups(
            data,
            (v) => d3.mean(v, (d) => +d["Quality of Life Index"]),
            (d) => +d.Year
        )
        .sort((a, b) => a[0] - b[0]);

    // Y-Axis
    const y = d3
        .scaleLinear()
        .domain([5, d3.max(avgByYear, (d) => d[1]) + 0.5])
        .range([height, 0]);
    svg.append("g").call(d3.axisLeft(y).ticks(3).tickSizeOuter(0));

    // X-Axis: one band per year, labelled in the middle of the band
    timelineX = d3
        .scaleLinear()
        .domain([MIN_YEAR, MAX_YEAR + 1])
        .range([0, width]);

    svg.append("g")
        .attr("transform", `translate(0,${height})`)
        .call(
            d3
                .axisBottom(timelineX)
                .tickValues(d3.range(MIN_YEAR, MAX_YEAR + 1).map((yr) => yr + 0.5))
                .tickFormat((v) => String(Math.floor(v)))
                .tickSizeOuter(0)
        );

    // faint separators between years
    svg.append("g")
        .selectAll("line")
        .data(d3.range(MIN_YEAR + 1, MAX_YEAR + 1))
        .join("line")
        .attr("x1", (d) => timelineX(d))
        .attr("x2", (d) => timelineX(d))
        .attr("y1", 0)
        .attr("y2", height)
        .attr("stroke", "#ece7ca")
        .attr("stroke-opacity", 0.12);

    root.append("text")
        .attr("class", "yLabel axis-label")
        .attr("transform", `translate(14, ${margin.top + height / 2}) rotate(-90)`)
        .attr("text-anchor", "middle")
        .style("font-size", "15px")
        .text("Quality Of Life");

    svg.append("path")
        .datum(avgByYear)
        .attr("fill", "#edf8e9")
        .attr("stroke", "#006d2c")
        .attr("stroke-width", 1)
        .attr(
            "d",
            d3
                .area()
                .x((d) => timelineX(d[0] + 0.5))
                .y0(y(5))
                .y1((d) => y(d[1]))
        );

    const toYears = (selection) => {
        const a = clamp(Math.round(timelineX.invert(selection[0])), MIN_YEAR, MAX_YEAR);
        const b = clamp(Math.round(timelineX.invert(selection[1])), a + 1, MAX_YEAR + 1);
        return [a, b - 1];
    };

    timelineBrush = d3
        .brushX()
        .extent([
            [0, 0],
            [width, height],
        ])
        .on("brush", function (event) {
            if (!event.sourceEvent || !event.selection) return;
            updateYearLabel(...toYears(event.selection));
        })
        .on("end", function (event) {
            if (!event.sourceEvent) return; // programmatic move (snapping / reset)

            // clicking without dragging clears the brush -> all years
            if (!event.selection) {
                setYearRange(MIN_YEAR, MAX_YEAR);
                return;
            }

            const [a, b] = toYears(event.selection);
            timelineBrushG
                .transition()
                .duration(250)
                .call(timelineBrush.move, [timelineX(a), timelineX(b + 1)]);
            setYearRange(a, b);
        });

    timelineBrushG = svg.append("g").attr("class", "brush").call(timelineBrush);

    d3.select("#btn-resetYears").on("click", resetYears);
    updateYearLabel(startYear, endYear);
}

/** Clears the brush and goes back to every year with data. */
function resetYears() {
    if (timelineBrushG) {
        timelineBrushG.transition().duration(250).call(timelineBrush.move, null);
    }
    setYearRange(MIN_YEAR, MAX_YEAR);
}

function setYearRange(a, b) {
    const changed = a !== startYear || b !== endYear;
    startYear = a;
    endYear = b;
    updateYearLabel(a, b);
    if (!changed) return;

    dataChange(startYear, endYear);
    updateLineChart();
}

function updateYearLabel(a, b) {
    const all = a === MIN_YEAR && b === MAX_YEAR;
    d3.select("#year-range-label").text(
        (a === b ? `${a}` : `${a} – ${b}`) + (all ? " (all years)" : "")
    );
    d3.select("#btn-resetYears").property("disabled", all);
}

const MAGNET_WIDTH = 890;
const MAGNET_HEIGHT = 370;
const MAGNET_RADIUS = 32;
const norm = 800;
const magnets = [
        {id: "Safety Index", x: ((MAGNET_WIDTH-norm)/2)-350, y: -145, color: "#FFD1DC", isActive: false,
            description: "Higher is better: the country has more safety."},
        {id: "Health Care Index", x: ((MAGNET_WIDTH-norm)/2)+350, y: -145, color: "#C3B1E1", isActive: false,
            description: "Higher is better: the country provides better health care."},
        {id: "Property Price to Income Ratio", x: (MAGNET_WIDTH-norm)/2, y: -145, color: "#c2a9a1", isActive: true,
            description: "Lower is better: the country salary is more adequate to the property price."},
        {id: "Traffic Commute Time Index", x: ((MAGNET_WIDTH-norm)-350), y: -70, color: "#B2F2BB", isActive: false,
            description: "Lower is better: the country's population needs less commute time."},
        {id: "Pollution Index", x: ((MAGNET_WIDTH-norm)+350), y: -70, color: "#A2D2FF", isActive: false,
            description: "Lower is better: the country has less pollution."},
        {id: "Climate Index", x: ((MAGNET_WIDTH-norm)-350), y: 40, color: "#FFECB3", isActive: false,
            description: "Higher is better: the country has better climate."},
        {id: "Groceries Index", x: ((MAGNET_WIDTH-norm)/2)-350, y: 150, color: "#ffbf67", isActive: true,
            description: "Lower is better: the food basket cost in the country is lower."},
        {id: "Restaurant Price Index", x: ((MAGNET_WIDTH-norm)+350), y: 40, color: "#B3E5FC", isActive: false,
            description: "Lower is better: the index compares prices to New York City."},
        {id: "Crime Index", x: ((MAGNET_WIDTH-norm)/2)+350, y: 150, color: "#ff6961", isActive: true,
            description: "Lower is better: the country has an higher crime."},
    ];
function genMagnetList() {
    //const magnetList = d3.select("#list-widget-left");
    //const items = magnetList.selectAll("li").data(data, (country) => country)

    const list = d3.select("#magnet-list")
        .selectAll("div")
        .data(magnets)
        .enter()
        .append("div")
        .attr("class", "list-item")
        .classed("active", d => d.isActive)
        .on("click", function(event, d) {
            d.isActive = !d.isActive;

            // apply or remove the 'active' class
            d3.select(this).classed("active", d.isActive);
            
            // update the magnet chart with the new active state
            genMagnetChart();
        });

    //add a colored circle (span) for each item
    list.append("span")
        .attr("class", "color-circle")
        .style("background-color", d => d.color)
        .style("width", "12px")      
        .style("min-width", "12px")      
        .style("height", "12px")
        .style("min-height", "12px")
        .style("border-radius", "50%")
        .style("display", "inline-block")
        .style("margin-right", "5px");

    // add the text next to the colored circle
    list.append("span").text(d => d.id);
}

function computePointPosition(pointValues, magnets, exponent = 2) {
    let totalWeight = 0;
    let x = 0;
    let y = 0;

    pointValues.forEach((value, i) => {
        const weightedValue = Math.pow(Number.isFinite(value) ? value : 0, exponent);
        totalWeight += weightedValue;
        x += magnets[i].x * weightedValue;
        y += magnets[i].y * weightedValue;
    });

    // e.g. a country with the lowest value in every active attribute
    if (totalWeight === 0) {
        return { x: d3.mean(magnets, (m) => m.x), y: d3.mean(magnets, (m) => m.y) };
    }

    return { x: x / totalWeight, y: y / totalWeight };
}

/* ------------------------------------------------------------------ */
/* Magnet chart                                                        */
/* ------------------------------------------------------------------ */

const NODE_W = 24;
const NODE_H = 18;
let magnetSim = null;

/** Where a country should settle given the active magnets. */
function nodeTarget(node, activeMagnets) {
    if (activeMagnets.length === 0) return { x: 0, y: 0 };
    const row = fullDataMagnetNormalized.find((d) => d.Country === node.country);
    if (!row) return { x: 0, y: 0 };
    return computePointPosition(
        activeMagnets.map((m) => +row[m.id]),
        activeMagnets
    );
}

function updateMagnetTargets() {
    const activeMagnets = magnets.filter((m) => m.isActive);
    magnetNodes.forEach((n) => {
        const p = nodeTarget(n, activeMagnets);
        n.tx = p.x;
        n.ty = p.y;
    });
    if (magnetSim) {
        // re-evaluate the per-node targets
        magnetSim.force("x").x((d) => d.tx);
        magnetSim.force("y").y((d) => d.ty);
    }
}

// raw (not normalized) averages for the selected years, used by the tooltip
let magnetRawData = [];

function magnetNodeTooltipHtml(d) {
    const norm = fullDataMagnetNormalized.find((r) => r.Country === d.country);
    const raw = magnetRawData.find((r) => r.Country === d.country);
    const active = magnets.filter((m) => m.isActive);

    let html = `<div class="tt-title">${d.country}</div>`;
    if (!active.length) {
        return html + `<div class="tt-source">Turn on a magnet to compare attributes.</div>`;
    }
    active.forEach((m) => {
        const label = `<i class="tt-swatch" style="background:${m.color}"></i>${m.id}`;
        const value = raw ? d3.format(".1f")(+raw[m.id]) : "–";
        const score = norm ? (+norm[m.id]).toFixed(2) : "–";
        html += ttRow(label, `${value} <span class="tt-dim">(${score})</span>`);
    });
    html +=
        `<div class="tt-source">Averages over ${yearsLabel()}. In brackets: score from 0 (lowest) ` +
        `to 1 (highest) among all countries. Flags are pulled toward the magnets where they score highest.</div>`;
    return html;
}

function initMagnetChart() {
    const width = MAGNET_WIDTH;
    const height = MAGNET_HEIGHT;

    const svg = d3
        .select("#magnet-chart")
        .append("svg")
        .attr("viewBox", [-width / 2, -height / 2, width, height]);

    svg.append("g").attr("class", "magnet-layer");
    svg.append("g").attr("class", "node-layer");

    // nodes are pulled (smoothly) toward their target and pushed away from each other
    magnetSim = d3
        .forceSimulation([])
        .force("x", d3.forceX((d) => d.tx).strength(0.12))
        .force("y", d3.forceY((d) => d.ty).strength(0.12))
        .force("collide", d3.forceCollide(12).strength(0.8).iterations(2))
        .alphaDecay(0.025)
        .velocityDecay(0.4)
        .on("tick", () => {
            const hw = width / 2 - NODE_W / 2;
            const hh = height / 2 - NODE_H / 2;
            svg.select(".node-layer")
                .selectAll(".node")
                .each((d) => {
                    d.x = clamp(d.x, -hw, hw);
                    d.y = clamp(d.y, -hh, hh);
                })
                .attr("x", (d) => d.x - NODE_W / 2)
                .attr("y", (d) => d.y - NODE_H / 2);
        });
}

function magnetDrag() {
    const hw = MAGNET_WIDTH / 2 - MAGNET_RADIUS;
    const hh = MAGNET_HEIGHT / 2 - MAGNET_RADIUS;

    return d3
        .drag()
        .on("start", function () {
            d3.select(this).raise().attr("stroke-width", 3).style("cursor", "grabbing");
        })
        .on("drag", function (event, d) {
            d.x = clamp(event.x, -hw, hw);
            d.y = clamp(event.y, -hh + 10, hh);
            d3.select(this).attr("cx", d.x).attr("cy", d.y);

            // the countries follow the magnet while it is being dragged
            updateMagnetTargets();
            magnetSim.alpha(Math.max(magnetSim.alpha(), 0.5)).restart();
        })
        .on("end", function () {
            d3.select(this).attr("stroke-width", 2).style("cursor", null);
        });
}

/**
 * Draws/updates the magnet chart (animated).
 * Triggered when (1) a magnet is (de)activated, (2) the timeline changes,
 * or (3) the country selection changes.
 */
function genMagnetChart(isUpdate = true) {
    if (!magnetSim) initMagnetChart();

    const svg = d3.select("#magnet-chart").select("svg");
    const activeMagnets = magnets.filter((m) => m.isActive);
    const t = svg.transition("magnets").duration(ANIM_MS).ease(EASE);

    // * magnets
    svg.select(".magnet-layer")
        .selectAll(".magnet")
        .data(activeMagnets, (d) => d.id)
        .join(
            (enter) =>
                enter
                    .append("circle")
                    .attr("class", "magnet")
                    .attr("cx", (d) => d.x)
                    .attr("cy", (d) => d.y)
                    .attr("r", 0)
                    .attr("fill", (d) => d.color)
                    .attr("stroke", "#fff")
                    .attr("stroke-width", 2)
                    .call((e) =>
                        e.append("title").text((d) => `${d.id}\n${d.description}`)
                    )
                    .call(magnetDrag()),
            (update) => update,
            (exit) =>
                exit
                    .attr("class", "magnet-exit")
                    .style("pointer-events", "none")
                    .call((e) => e.transition(t).attr("r", 0).remove())
        )
        .transition(t)
        .attr("r", MAGNET_RADIUS);

    // * country nodes
    updateMagnetTargets();
    const activeNodes = magnetNodes.filter((n) => n.isActive);

    // first time a node is shown it starts at its target (with a little jitter)
    activeNodes.forEach((n) => {
        if (n.x === undefined) {
            n.x = n.tx + (Math.random() - 0.5) * 4;
            n.y = n.ty + (Math.random() - 0.5) * 4;
        }
    });

    svg.select(".node-layer")
        .selectAll(".node")
        .data(activeNodes, (d) => d.country)
        .join(
            (enter) =>
                enter
                    .append("image")
                    .attr("class", "node")
                    .attr("data-country", (d) => d.country)
                    .attr("href", (d) => {
                        const countryCode = countryCodes[d.country];
                        return countryCode ? getCountryFlagUrl(countryCode) : "";
                    })
                    .attr("width", NODE_W)
                    .attr("height", NODE_H)
                    .attr("x", (d) => d.x - NODE_W / 2)
                    .attr("y", (d) => d.y - NODE_H / 2)
                    .attr("opacity", 0),
            (update) => update,
            (exit) =>
                exit
                    .attr("class", "node-exit")
                    .style("pointer-events", "none")
                    .call((e) => e.transition(t).attr("opacity", 0).remove())
        )
        .transition(t)
        .attr("opacity", 1);

    magnetSim.nodes(activeNodes);
    magnetSim.alpha(isUpdate ? 1 : 0.6).restart();

    applyHighlight();
}

function dataChange(beg, end, isInit = false) {
    if (!fullData.length) return;

    const columnsToAverage = fullData.columns.slice(2);
    const inRange = fullData.filter((d) => +d.Year >= beg && +d.Year <= end);
    const rowsByCountry = d3.group(inRange, (d) => d.Country);

    const average = (country) => {
        const rows = rowsByCountry.get(country) || [];
        const obj = { Country: country };
        columnsToAverage.forEach((column) => {
            obj[column] = d3.mean(rows, (d) => Number(d[column]));
        });
        return obj;
    };

    // scatter plot: selected countries only
    dataFiltered = allCountries.filter((c) => selectedCountries.has(c)).map(average);
    genScatterPlot();

    // * magnet chart uses all countries (even if not selected) to normalize values
    magnetRawData = allCountries.map(average);
    fullDataMagnetNormalized = normalizeData(magnetRawData);
    genMagnetChart(!isInit);
}

// todo: take into account the timeline selection
function normalizeData(data) {
    //const manipulatedData = JSON.parse(JSON.stringify(data))
    const dataCopy = JSON.parse(JSON.stringify(data))
    const manipulatedData = dataCopy.filter(d => Object.keys(d).length != 1)
    //console.log('manipulatedData: ',manipulatedData)
    // get min/max for each magnet
    const safetyIndexes = [];
    const healthCareIndexes = [];
    const propertyPriceToIncomeRatios = [];
    const trafficCommuteTimeIndexes = [];
    const pollutionIndexes = [];
    const climateIndexes = [];
    const groceriesIndexes = [];
    const restaurantPriceIndexes = [];
    const crimeIndexes = [];

    manipulatedData.forEach((d) => {
        safetyIndexes.push(Number(d["Safety Index"]));
        healthCareIndexes.push(Number(d["Health Care Index"]));
        propertyPriceToIncomeRatios.push(Number(d["Property Price to Income Ratio"]));
        trafficCommuteTimeIndexes.push(Number(d["Traffic Commute Time Index"]));
        pollutionIndexes.push(Number(d["Pollution Index"]));
        climateIndexes.push(Number(d["Climate Index"]));
        groceriesIndexes.push(Number(d["Groceries Index"]));
        restaurantPriceIndexes.push(Number(d["Restaurant Price Index"]));
        crimeIndexes.push(Number(d["Crime Index"]));
    });
    //console.log('manipulatedData before normalization: ', manipulatedData)
    //console.log('safetyIndexes: ',safetyIndexes)
    //console.log('healthCareIndexes: ',healthCareIndexes)
    //console.log('propertyPriceToIncomeRatios: ', propertyPriceToIncomeRatios)
    //console.log('groceriesIndexes: ', groceriesIndexes)
    //console.log('restaurantPriceIndexes: ',restaurantPriceIndexes )
    //console.log('crimeIndexes: ',crimeIndexes)

    const safetyIndexMM = [Math.min(...safetyIndexes), Math.max(...safetyIndexes)];
    const healthCareIndexMM = [
        Math.min(...healthCareIndexes),
        Math.max(...healthCareIndexes),
    ];
    const propertyPriceToIncomeRatioMM = [
        Math.min(...propertyPriceToIncomeRatios),
        Math.max(...propertyPriceToIncomeRatios),
    ];
    const trafficCommuteTimeIndexMM = [
        Math.min(...trafficCommuteTimeIndexes),
        Math.max(...trafficCommuteTimeIndexes),
    ];
    const pollutionIndexMM = [
        Math.min(...pollutionIndexes),
        Math.max(...pollutionIndexes),
    ];
    const climateIndexMM = [Math.min(...climateIndexes), Math.max(...climateIndexes)];
    const groceriesIndexMM = [
        Math.min(...groceriesIndexes),
        Math.max(...groceriesIndexes),
    ];
    const restaurantPriceIndexMM = [
        Math.min(...restaurantPriceIndexes),
        Math.max(...restaurantPriceIndexes),
    ];
    const crimeIndexMM = [Math.min(...crimeIndexes), Math.max(...crimeIndexes)];

    //console.log(safetyIndexMM)
    //console.log(healthCareIndexMM)
    //console.log(propertyPriceToIncomeRatioMM)
    //console.log(groceriesIndexMM)
    //console.log(restaurantPriceIndexMM)
    //console.log(crimeIndexMM)

    // build the normalized values
    const normalizeValue = (val, featMM) => {
        return ((val - featMM[0]) / (featMM[1] - featMM[0]));
    }

    const normalizedData = manipulatedData.map((d) => {
        return {
            Country: d.Country,
            Year: d.Year,
            "Safety Index": normalizeValue(d["Safety Index"], safetyIndexMM),
            "Health Care Index": normalizeValue(
                d["Health Care Index"],
                healthCareIndexMM
            ),
            "Property Price to Income Ratio": normalizeValue(
                d["Property Price to Income Ratio"],
                propertyPriceToIncomeRatioMM
            ),
            "Traffic Commute Time Index": normalizeValue(
                d["Traffic Commute Time Index"],
                trafficCommuteTimeIndexMM
            ),
            "Pollution Index": normalizeValue(
                d["Pollution Index"],
                pollutionIndexMM
            ),
            "Climate Index": normalizeValue(d["Climate Index"], climateIndexMM),
            "Groceries Index": normalizeValue(
                d["Groceries Index"],
                groceriesIndexMM
            ),
            "Restaurant Price Index": normalizeValue(
                d["Restaurant Price Index"],
                restaurantPriceIndexMM
            ),
            "Crime Index": normalizeValue(d["Crime Index"], crimeIndexMM),
        };
    });
    //console.log('normalized data: ', normalizedData)
    return normalizedData;
}

function selectAllCountries() {
    if (selectedCountries.size !== allCountries.length) {
        selectedCountries = new Set(allCountries);
        selectionChanged();
    }
}
