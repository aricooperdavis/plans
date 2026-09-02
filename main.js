var map = L.map("map").setView([51.505, -0.09], 13);
var searchIndex = [];
var polysGroup = L.featureGroup();
polysGroup.addTo(map);
var tilesGroup = L.featureGroup();
tilesGroup.addTo(map);

// Basemaps
var osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution:
    '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);
var otm = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  attribution:
    "Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)",
  maxZoom: 19,
});
var ewi = L.tileLayer(
  "http://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}.png",
  {
    attribution:
      "Powered by Esri | Esri, Vantor, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
  },
);
var baseMaps = {
  "Esri World Imagery": ewi,
  OpenStreetMap: osm,
  OpenTopoMap: otm,
};

// UI elements
L.control.layers(baseMaps, { "Bounding boxes": polysGroup }).addTo(map);
var notification = L.control
  .notifications({
    className: "modern",
    closable: true,
    dismissable: true,
    icon: "fa fa-info-circle",
    position: "bottomright",
    timeout: 600000,
  })
  .addTo(map);
notification.info(
  "MRA Plan Viewer",
  "Click on a polygon to load the plan. Right click for plan metadata.</br>Plans reproduced under <a href='https://www.gov.uk/government/publications/scanned-images-terms-and-conditions-mining-remediation-authority/terms-and-conditions-for-access-to-the-mining-remediations-scanned-images'>MRA terms</a>. Georeferencing by <a href='https://cooper-davis.net'>Ari Cooper-Davis</a>.",
);
L.control.locate().addTo(map);

var searchControl = L.Control.extend({
  options: { position: "bottomleft" },
  onAdd: function (map) {
    const container = L.DomUtil.create(
      "div",
      "leaflet-control-layers leaflet-control",
    );
    container.style.padding = "4px";

    const input = L.DomUtil.create("input", "", container);
    input.type = "text";
    input.placeholder = "Search plans...";
    input.style.display = "block";
    input.style.width = "180px";

    const resultsList = L.DomUtil.create("ul", "", container);
    resultsList.style.listStyle = "none";
    resultsList.style.margin = "4px 0 0 0";
    resultsList.style.padding = "0";
    resultsList.style.maxHeight = "220px";
    resultsList.style.overflowY = "auto";
    resultsList.style.display = "none";

    function selectPlan(entry) {
      map.fitBounds(entry.layer.getBounds());
      if (!tilesGroup.hasLayer(entry.tile)) {
        toggleTileLayer.call(entry.tile);
      }
      resultsList.style.display = "none";
      input.value = entry.title || entry.scanId;
    }

    function renderResults(entries) {
      resultsList.innerHTML = "";
      if (entries.length === 0) {
        resultsList.style.display = "none";
        return;
      }
      entries.forEach((entry) => {
        const li = L.DomUtil.create("li", "", resultsList);
        li.style.padding = "4px 6px";
        li.style.cursor = "pointer";
        li.style.borderBottom = "1px solid #eee";
        li.textContent = entry.title
          ? `${entry.title} (${entry.scanId})`
          : entry.scanId;
        L.DomEvent.on(li, "click", () => selectPlan(entry));
        L.DomEvent.on(li, "mouseover", () => (li.style.background = "#f0f0f0"));
        L.DomEvent.on(li, "mouseout", () => (li.style.background = ""));
      });
      resultsList.style.display = "block";
    }

    L.DomEvent.on(input, "input", () => {
      const q = input.value.trim();
      if (!q) {
        resultsList.style.display = "none";
        return;
      }
      renderResults(searchPlans(q));
    });

    // close dropdown when clicking elsewhere on the map or esc key
    map.on("click", () => (resultsList.style.display = "none"));
    L.DomEvent.on(input, "keydown", (e) => {
      if (e.key === "Escape") {
        resultsList.style.display = "none";
        input.blur();
      }
    });

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  },
});
map.addControl(new searchControl());

function fuzzyScore(query, target) {
  if (!target) return -1;
  query = query.toLowerCase().trim();
  target = target.toLowerCase();
  if (!query) return -1;

  const idx = target.indexOf(query);
  if (idx !== -1) return 1000 - idx; // substring match, earlier = better

  // subsequence fallback: every query char must appear in order
  let qi = 0, score = 0, last = -1;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      score += last === ti - 1 ? 5 : 1; // bonus for consecutive matches
      last = ti;
      qi++;
    }
  }
  return qi === query.length ? score : -1;
}

function searchPlans(query, limit = 8) {
  const results = [];
  for (const entry of searchIndex) {
    const s = Math.max(
      fuzzyScore(query, entry.title),
      fuzzyScore(query, entry.scanId),
      fuzzyScore(query, entry.featureId),
    );
    if (s > -1) results.push({ entry, score: s });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map((r) => r.entry);
}

async function populate() {
  // Load plans from remote
  const requestURL = "plans.json";
  const request = new Request(requestURL);

  const response = await fetch(request);
  const plans = await response.json();

  populateMap(plans);
}

function populateMap(obj) {
  const plans = obj.plans;
  map.createPane("planTiles");
  map.getPane("planTiles").style.zIndex = 450;
  map.getPane("planTiles").style.pointerEvents = "none";

  // Shoelace formula on raw [lat, lng] pairs — good enough for *relative* size ordering
  function polygonArea(latlngs) {
    let area = 0;
    const n = latlngs.length;
    for (let i = 0; i < n; i++) {
      const [y1, x1] = latlngs[i];
      const [y2, x2] = latlngs[(i + 1) % n];
      area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area / 2);
  }

  // Sort largest-area first, so smaller polygons are added later
  // and therefore rendered on top (Leaflet stacks layers in add order).
  const sortedPlans = [...plans].sort(
    (a, b) => polygonArea(b.wgs84Extent) - polygonArea(a.wgs84Extent),
  );

  for (const plan of sortedPlans) {
    var tile = L.tileLayer(
      "https://tiles.cooper-davis.net/mra/" +
        plan.scan_url_id +
        "/{z}/{x}/{y}.webp",
      {
        maxNativeZoom: 18,
        maxZoom: 19,
        pane: "planTiles",
      },
    );
    // tilesGroup.addLayer(tile);

    // Create polygon for map overview and handle events
    var polygon = L.polygon(
      plan.wgs84Extent.map((c) => c.toReversed()),
      {
        contextmenu: true,
        contextmenuItems: [
          {
            text: "Plan name: " + String(plan.plan_title),
            disabled: true,
          },
          {
            separator: true,
          },
          {
            text: "Copy XYZ URL",
            callback: (x) =>
              navigator.clipboard.writeText(
                "https://tiles.cooper-davis.net/mra/" +
                  String(plan.scan_url_id) +
                  "/{z}/{x}/{y}.webp",
              ),
          },
          {
            text: "Open scan (new tab)",
            callback: (x) =>
              window
                .open(
                  "https://largeimages.bgs.ac.uk/seadragon/mra-amps.html?id=" +
                    String(plan.scan_url_id),
                  "_blank",
                )
                .focus(),
          },
          {
            text: "Open plan details (new tab)",
            callback: (x) =>
              window
                .open(
                  "https://mine-plans.bgs.ac.uk/plan.html?id=" +
                    String(plan.feature_id),
                  "_blank",
                )
                .focus(),
          },
          {
            text: "Close",
            callback: () => map.contextmenu.hide(),
          },
        ],
        fillOpacity: 0,
        pane: "planTiles",
      },
    );

    polygon.on("click", toggleTileLayer, tile);
    polysGroup.addLayer(polygon);

    // Populate search index
    searchIndex.push({
      title: plan.plan_title || "",
      scanId: plan.scan_url_id || "",
      featureId: plan.feature_id || "",
      layer: polygon,
      tile: tile,
    });
  }

  // Render polygons and fit map
  map.fitBounds(polysGroup.getBounds());

  // Render controls
  var groupProxy = {
    _url: "proxy",
    options: { opacity: 1 },
    setOpacity: function (opacity) {
      tilesGroup.eachLayer(function (layer) {
        if (layer.setOpacity) layer.setOpacity(opacity);
      });
    },
  };
  L.control.opacity({ "Plan opacity": groupProxy }).addTo(map);
}

// Toggle plan tileLayers on polygon click
function toggleTileLayer() {
  if (tilesGroup.hasLayer(this)) {
    tilesGroup.removeLayer(this);
  } else {
    tilesGroup.addLayer(this);

  }
}

populate();
