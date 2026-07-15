var map = L.map("map").setView([51.505, -0.09], 13);
var polysGroup = L.featureGroup();
var tilesGroup = L.featureGroup();
tilesGroup.addTo(map);
polysGroup.addTo(map);

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

// Add UI elements
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
    // polygon.bindTooltip(plan.scan_url_id);
    polygon.on("click", toggleTileLayer, tile);
    polysGroup.addLayer(polygon);
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
