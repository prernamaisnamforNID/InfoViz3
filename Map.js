// ---------------------------------------------------------
// 1. LOAD YOUR CLEANED CSV
//    Place your cleaned file at: data/meteorites_clean.csv
//    Expected columns: name, year, lat, long, mass_g, class_group
//    d3.autoType automatically converts numeric columns for you.
// ---------------------------------------------------------
d3.csv("data/meteorites_clean.csv", d3.autoType).then(data => {
  const allMeteorites = data.filter(d =>
    d.lat != null && d.long != null &&
    !(d.lat === 0 && d.long === 0)
  );
  init(allMeteorites);
}).catch(err => {
  console.error("Could not load data/meteorites_clean.csv — using sample data instead.", err);
  init(generateSampleData(3456));
});

// ---------------------------------------------------------
// Fallback sample data generator, only used if the real CSV
// isn't found yet. Delete this once your real data is wired in.
// ---------------------------------------------------------
function generateSampleData(n) {
  const data = [];
  for (let i = 0; i < n; i++) {
    data.push({
      name: "Meteorite " + i,
      year: Math.floor(1890 + Math.random() * (2022 - 1890)),
      lat: (Math.random() * 140) - 70,
      long: (Math.random() * 340) - 170,
      mass_g: Math.exp(Math.random() * 12),
      // real dataset is ~98% "Found" / ~2% "Fell" — mirrored here
      // so the sample data behaves like the real thing
      fall: Math.random() < 0.02 ? "Fell" : "Found"
    });
  }
  return data;
}

// ---------------------------------------------------------
// 2. MAIN INIT — everything else happens after data is ready
// ---------------------------------------------------------
function init(allMeteorites) {

  const svg = d3.select("#map-svg");
  let width = window.innerWidth;
  let height = window.innerHeight;

  const projection = d3.geoNaturalEarth1();
  const path = d3.geoPath(projection);

  const g = svg.append("g");
  const countryLayer = g.append("g");
  const countryLabelLayer = g.append("g"); // country name text, above fills, below state lines/dots
  const stateBoundaryLayer = g.append("g"); // sits above countries, below meteorite dots
  const pointLayer = g.append("g");

  const slider = document.getElementById("year-slider");
  const countValue = document.getElementById("count-value");

  // ---------------------------------------------------------
  // LEGEND — click "Found" or "Fell" to toggle it out of the
  // map. Both start active (both shown). Filtering happens
  // alongside the existing year filter in updatePoints().
  // ---------------------------------------------------------
  const activeFallTypes = new Set(["Found", "Fell"]);

  const legendAll = document.getElementById("legend-all");

  // keeps "View All" looking active only when both filters
  // actually are — so it reflects real state, not just a button
  function syncLegendAll() {
    const bothActive = activeFallTypes.size === 2;
    legendAll.classList.toggle("active", bothActive);
  }

  legendAll.addEventListener("click", () => {
    activeFallTypes.add("Found");
    activeFallTypes.add("Fell");
    document.querySelectorAll(".legend-item[data-fall='Found'], .legend-item[data-fall='Fell']")
      .forEach(item => item.classList.add("active"));
    syncLegendAll();
    updatePoints(allMeteorites, +slider.value, projection);
  });

  document.querySelectorAll(".legend-item[data-fall='Found'], .legend-item[data-fall='Fell']").forEach(item => {
    item.addEventListener("click", () => {
      const fallType = item.dataset.fall;

      if (activeFallTypes.has(fallType)) {
        activeFallTypes.delete(fallType);
        item.classList.remove("active");
      } else {
        activeFallTypes.add(fallType);
        item.classList.add("active");
      }

      syncLegendAll();
      updatePoints(allMeteorites, +slider.value, projection);
    });
  });

  // ---------------------------------------------------------
  // STATE/PROVINCE BOUNDARIES ON HOVER
  //
  // Currently supports USA and India only — both confirmed
  // working directly. See buildStateBoundaryUrl() below for why
  // other countries aren't included yet, and how to add your own.
  // ---------------------------------------------------------

  // Verified working: world-geojson npm package (github.com/georgique/world-geojson).
  // Unlike geoBoundaries, this is distributed via npm (plain tarballs),
  // NOT Git LFS — confirmed by fetching a file directly and getting
  // real GeoJSON back, not a pointer stub. Currently covers state-level
  // data for only 6 countries; add more here as the source grows.
  const WORLD_GEOJSON_COUNTRY_SLUGS = {
    "Australia": "australia",
    "Canada": "canada",
    "India": "india",
    "Switzerland": "switzerland",
    "Thailand": "thailand"
    // USA intentionally excluded — already using us-atlas below
  };

  function buildStateBoundaryUrl(countryName) {
    // CONFIRMED WORKING — single file, not Git LFS.
    if (countryName === "United States of America") {
      return "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";
    }

    // LOCAL FILES — add a country by downloading its file into
    // data/states/ and adding one line here.
    if (LOCAL_STATE_FILES[countryName]) {
      return `data/states/${LOCAL_STATE_FILES[countryName]}`;
    }

    return null; // handled separately for world-geojson countries — see showStateBoundaries
  }

  // Map country name (as world-atlas spells it) -> filename you
  // saved under data/states/. Add one line per country you download.
  const LOCAL_STATE_FILES = {
    // "France": "fra.geojson",
  };

  // world-geojson stores one file per state rather than one file
  // per country — list the directory via GitHub's API, then fetch
  // and merge every state file into a single features array.
  // NOTE: GitHub's unauthenticated API allows 60 requests/hour per
  // IP — plenty for classroom/demo use, but don't hammer it in a loop.
  async function fetchWorldGeojsonStates(countrySlug) {
    const listUrl = `https://api.github.com/repos/georgique/world-geojson/contents/states/${countrySlug}`;
    const listing = await d3.json(listUrl);
    const files = listing.filter(item => item.type === "file" && item.name.endsWith(".json"));

    const featureArrays = await Promise.all(
      files.map(file => d3.json(file.download_url).then(fc => fc.features))
    );

    return featureArrays.flat();
  }

  // cache so re-hovering the same country doesn't re-fetch
  const stateDataCache = {};

  // set whenever a country with known state data is hovered —
  // used both for rendering the lines AND for the tooltip's
  // point-in-polygon hit test on mousemove
  let currentStateFeatures = null;
  let currentCountryName = null;

  function showStateBoundaries(countryName) {
    currentCountryName = countryName;

    if (stateDataCache[countryName]) {
      currentStateFeatures = stateDataCache[countryName];
      renderStateBoundaries(stateDataCache[countryName]);
      return;
    }

    // world-geojson countries: dynamic multi-file fetch + merge
    const slug = WORLD_GEOJSON_COUNTRY_SLUGS[countryName];
    if (slug) {
      fetchWorldGeojsonStates(slug).then(features => {
        stateDataCache[countryName] = features;
        currentStateFeatures = features;
        renderStateBoundaries(features);
      }).catch(err => {
        console.warn(`Could not load state boundaries for ${countryName}:`, err);
      });
      return;
    }

    // Single-file sources (USA, local files)
    const url = buildStateBoundaryUrl(countryName);
    if (!url) {
      currentStateFeatures = null;
      console.log(`No state boundary source mapped for "${countryName}" — add it to LOCAL_STATE_FILES if needed.`);
      return;
    }

    d3.json(url).then(raw => {
      let features;
      if (raw.type === "Topology") {
        const objectKey = Object.keys(raw.objects)[0];
        features = topojson.feature(raw, raw.objects[objectKey]).features;
      } else {
        features = raw.features;
      }
      stateDataCache[countryName] = features;
      currentStateFeatures = features;
      renderStateBoundaries(features);
    }).catch(err => {
      console.warn(`Could not load state boundaries for ${countryName}:`, err);
    });
  }

  function renderStateBoundaries(features) {
    stateBoundaryLayer.selectAll("path")
      .data(features)
      .join("path")
      .attr("class", "state-border")
      .attr("d", path)
      .attr("stroke-width", 0.6 / currentTransform.k);
  }

  function clearStateBoundaries() {
    stateBoundaryLayer.selectAll("path").remove();
    currentStateFeatures = null;
    currentCountryName = null;
    hideStateTooltip();
  }

  // ---------------------------------------------------------
  // STATE NAME TOOLTIP
  //    Rather than attaching hover listeners to the thin
  //    border LINES (unreliable — a 1px stroke is a poor
  //    mouse target), we find which state polygon contains
  //    the cursor's actual geographic position on every
  //    mousemove. This works correctly at any zoom/pan level.
  // ---------------------------------------------------------
  const tooltip = document.getElementById("state-tooltip");

  // tries several common property key names, since different
  // sources label the state name field differently
  function getStateName(feature) {
    const p = feature.properties || {};
    return p.ST_NM || p.shapeName || p.NAME_1 || p.name || p.NAME || "Unknown region";
  }

  function findStateAtPoint(event) {
    if (!currentStateFeatures) return null;

    const [mx, my] = d3.pointer(event, svg.node());
    const [gx, gy] = currentTransform.invert([mx, my]);
    const lonlat = projection.invert([gx, gy]);
    if (!lonlat) return null;

    for (const feature of currentStateFeatures) {
      if (d3.geoContains(feature, lonlat)) return feature;
    }
    return null;
  }

  function showStateTooltip(event) {
    const feature = findStateAtPoint(event);
    if (!feature) {
      tooltip.style.opacity = 0;
      return;
    }

    tooltip.textContent = `${getStateName(feature)}, ${currentCountryName}`;
    tooltip.style.left = (event.clientX + 14) + "px";
    tooltip.style.top = (event.clientY - 10) + "px";
    tooltip.style.opacity = 1;
  }

  function hideStateTooltip() {
    tooltip.style.opacity = 0;
  }

  // tracks the current zoom transform so newly-drawn circles
  // (e.g. after the slider changes) come in at the right size
  let currentTransform = d3.zoomIdentity;

  // ---------------------------------------------------------
  // 4. ZOOM BEHAVIOR — mouse scroll / trackpad pinch
  //    d3.zoom() listens to wheel events by default, so this
  //    covers both mouse scroll wheel and trackpad pinch/scroll
  //    with no extra setup needed.
  // ---------------------------------------------------------
  const zoom = d3.zoom()
      .scaleExtent([1, 20])                          // min 1x, max 20x
      .on("zoom", (event) => {
        currentTransform = event.transform;
        g.attr("transform", currentTransform);
        rescaleForZoom(currentTransform.k);
      });

  svg.call(zoom);

  // shrinks strokes and dot radii as you zoom in, so nothing
  // balloons in visual size — uses each circle's stored
  // "true" base radius (data-base-r) so the math never compounds
  function rescaleForZoom(k) {
    countryLayer.selectAll("path").attr("stroke-width", 0.5 / k);
    stateBoundaryLayer.selectAll("path").attr("stroke-width", 0.6 / k);

    pointLayer.selectAll("circle")
      .attr("stroke-width", 0.4 / k)
      .attr("r", function () {
        const baseR = +this.getAttribute("data-base-r");
        return baseR / Math.sqrt(k); // sqrt = dots shrink gently, don't vanish at high zoom
      });
  }

  // ---------------------------------------------------------
  // 5. LOAD WORLD MAP OUTLINE
  // ---------------------------------------------------------
  d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json").then(world => {
    const countries = topojson.feature(world, world.objects.countries);

    setupSlider(allMeteorites);
    resize(countries);

    window.addEventListener("resize", () => resize(countries));
  });

  // ---------------------------------------------------------
  // 6. SLIDER SETUP — decade-based, ticks generated from data
  //    Uses the "decade" column already in your CSV. Major
  //    ticks + labels at each decade, minor ticks every 2 years
  //    purely for visual rhythm (not separate stop points).
  // ---------------------------------------------------------
  function setupSlider(dataset) {
    // Prefer your existing "decade" column if present; falls back
    // to deriving it from year if the column is missing/misnamed.
    const hasDecadeCol = dataset.length > 0 && dataset[0].decade != null;

    const minDecade = hasDecadeCol
      ? d3.min(dataset, d => d.decade)
      : Math.floor(d3.min(dataset, d => d.year) / 10) * 10;

    const maxDecade = hasDecadeCol
      ? d3.max(dataset, d => d.decade)
      : Math.ceil(d3.max(dataset, d => d.year) / 10) * 10;

    slider.min = minDecade;
    slider.max = maxDecade;
    slider.step = 10;
    slider.value = minDecade;

    buildTicks(minDecade, maxDecade);

    // fires on drag AND on left/right arrow key presses —
    // arrow keys move by `step` (10 years) automatically
    slider.addEventListener("input", () => {
      updateThumbPosition(minDecade, maxDecade);
      updatePoints(allMeteorites, +slider.value, projection);
    });

    updateThumbPosition(minDecade, maxDecade);
  }

  // builds the visual tick axis: bold labeled tick per decade,
  // thin unlabeled ticks every 2 years in between
  function buildTicks(minDecade, maxDecade) {
    const ticksTrack = document.getElementById("ticks-track");
    ticksTrack.innerHTML = "";

    for (let year = minDecade; year <= maxDecade; year += 2) {
      const pct = ((year - minDecade) / (maxDecade - minDecade)) * 100;
      const isDecade = year % 10 === 0;

      const tick = document.createElement("div");
      tick.className = "tick " + (isDecade ? "tick-major" : "tick-minor");
      tick.style.left = pct + "%";
      ticksTrack.appendChild(tick);

      if (isDecade) {
        const label = document.createElement("div");
        label.className = "tick-label";
        label.style.left = pct + "%";
        label.textContent = year;
        ticksTrack.appendChild(label);
      }
    }
  }

  // no separate thumb element needed — the native slider's own
  // ::-webkit-slider-thumb / ::-moz-range-thumb (styled in CSS)
  // already tracks position automatically. This function is a
  // hook if you later want a custom thumb label (e.g. "1980"
  // floating above it) — left in place for easy extension.
  function updateThumbPosition(minDecade, maxDecade) {
    // intentionally empty for now
  }

  // ---------------------------------------------------------
  // 7. RESIZE — redraws map + points to fit the window
  // ---------------------------------------------------------
  function resize(countries) {
    width = window.innerWidth;
    height = window.innerHeight;

    svg.attr("viewBox", [0, 0, width, height]);
    projection.fitSize([width, height], countries);

    // keep pan/zoom from dragging the map off into empty space,
    // re-set on every resize since width/height can change
    zoom.translateExtent([[0, 0], [width, height]]);

    countryLayer.selectAll("path")
      .data(countries.features)
      .join("path")
      .attr("class", "country")
      .attr("d", path)
      .attr("stroke-width", 0.5 / currentTransform.k)
      .on("mouseover", (event, d) => showStateBoundaries(d.properties.name))
      .on("mousemove", showStateTooltip)
      .on("mouseout", clearStateBoundaries);

    // country name labels — positioned at each country's projected
    // centroid. Deliberately NOT compensated for zoom (unlike dot
    // radius/stroke-width elsewhere): letting labels grow as you
    // zoom in is normal, expected map behavior, not a bug to fix.
    countryLabelLayer.selectAll("text")
      .data(countries.features)
      .join("text")
      .attr("class", "country-label")
      .attr("x", d => path.centroid(d)[0])
      .attr("y", d => path.centroid(d)[1])
      .text(d => d.properties.name);

    updatePoints(allMeteorites, +slider.value, projection);
  }

  // ---------------------------------------------------------
  // FELL vs FOUND COLOR CODING
  //    "Fell" = the meteorite's fall was directly witnessed
  //    (~2% of records, scientifically more valuable).
  //    "Found" = discovered later, fall not observed (~98%).
  //    Fell gets a distinct, brighter color so the rare,
  //    witnessed events stand out against the much larger
  //    Found population rather than blending in.
  // ---------------------------------------------------------
  function colorForFall(d) {
    return d.fall === "Fell" ? "#FF4885" : "#B4FF82";
  }

  // ---------------------------------------------------------
  // 8. CUMULATIVE FILTER + REDRAW
  //    Re-filters the FULL dataset every call, so it stays
  //    correct even if the slider is dragged backward.
  //    Base radius is stored per-circle (data-base-r) so the
  //    zoom handler always has the "true" un-zoomed size to
  //    scale from, no matter how many times this re-runs.
  // ---------------------------------------------------------
  function updatePoints(dataset, currentYear, projection) {
    const filtered = dataset.filter(d =>
      d.year <= currentYear && activeFallTypes.has(d.fall)
    );
    const k = currentTransform.k;

    pointLayer.selectAll("circle")
      .data(filtered, d => d.name)
      .join(
        enter => enter.append("circle")
          .attr("class", "meteorite")
          .attr("cx", d => projection([d.long, d.lat])[0])
          .attr("cy", d => projection([d.long, d.lat])[1])
          .attr("data-base-r", d => Math.max(1.5, Math.log10(d.mass_g || 1) * 1.1))
          .attr("fill", colorForFall)
          .attr("stroke-width", 0.4 / k)
          .attr("r", 0)
          .call(enter => enter.transition().duration(150)
            .attr("r", function () {
              const baseR = +this.getAttribute("data-base-r");
              return baseR / Math.sqrt(k);
            })),
        update => update,
        exit => exit.remove()
      );

    countValue.textContent = filtered.length.toLocaleString();
  }
}