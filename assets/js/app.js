(function () {
  const posBox = document.getElementById("posBox");
  const addrBox = document.getElementById("addrBox");
  const poiBox = document.getElementById("poiBox");

  // ===== 配置 =====
  const WORKER_BASE_URL = "https://nominatim-proxy.w1181392662.workers.dev"; // ← 改这里
  const ENABLE_POI = true;

  // ===== Map =====
  const map = L.map("map", { zoomControl: true })
    .setView([31.2304, 121.4737], 12);

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      subdomains: "abcd",
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
    }
  ).addTo(map);

  const marker = L.marker([31.2304, 121.4737]).addTo(map);

  function setMarker(lat, lng) {
    marker.setLatLng([lat, lng]);
    map.setView([lat, lng], 16);
  }

  function fmt(obj) {
    return JSON.stringify(obj, null, 2);
  }

  // ===== Geolocation =====
  function getCurrentPositionAsync() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("浏览器不支持 Geolocation"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
      });
    });
  }

  // ===== fetch + timeout =====
  function fetchWithTimeout(url, { timeoutMs = 20000, ...opts } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...opts, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  // ===== Nominatim via Worker =====
  async function reverseGeocode(lat, lng) {
    const url = new URL(WORKER_BASE_URL + "/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", "18");

    try {
      const res = await fetchWithTimeout(url.toString());
      if (!res.ok) {
        throw new Error(`Proxy HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      if (e.name === "AbortError") {
        throw new Error("地址解析超时（网络较慢）");
      }
      throw e;
    }
  }

  function pickAddress(json) {
    const a = json.address || {};
    return {
      provider: "Nominatim (via Cloudflare Worker)",
      display_name: json.display_name,
      province: a.state || a.region,
      city: a.city || a.town || a.village || a.county,
      district: a.city_district || a.suburb || a.district,
      street: a.road || a.residential,
      house_number: a.house_number,
      postcode: a.postcode,
      country: a.country
    };
  }

  // ===== Overpass POI =====
  async function queryPOIs(lat, lng, radiusMeters = 600) {
    const q = `
      [out:json][timeout:25];
      (
        node(around:${radiusMeters},${lat},${lng})["amenity"];
        node(around:${radiusMeters},${lat},${lng})["shop"];
        node(around:${radiusMeters},${lat},${lng})["tourism"];
        node(around:${radiusMeters},${lat},${lng})["leisure"];
      );
      out 50;
    `;

    const res = await fetchWithTimeout(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        timeoutMs: 15000,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: q
      }
    );

    if (!res.ok) {
      throw new Error(`Overpass HTTP ${res.status}`);
    }

    const data = await res.json();
    return (data.elements || [])
      .filter(e => e.tags?.name)
      .slice(0, 5)
      .map(e => ({
        name: e.tags.name,
        type: e.tags.amenity || e.tags.shop,
        lat: e.lat,
        lon: e.lon
      }));
  }

  // ===== Auto run =====
  (async () => {
    try {
      posBox.textContent = "请求定位权限中...";
      const pos = await getCurrentPositionAsync();
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      posBox.textContent = fmt({
        lat,
        lng,
        accuracy_m: pos.coords.accuracy,
        timestamp: new Date(pos.timestamp).toISOString()
      });

      setMarker(lat, lng);

      // 地址
      try {
        addrBox.textContent = "逆地理编码中（Nominatim）...";
        const regeo = await reverseGeocode(lat, lng);
        addrBox.textContent = fmt(pickAddress(regeo));
      } catch (e) {
        addrBox.textContent = "地址解析失败（公共服务不稳定）";
      }

      // POI
      if (!ENABLE_POI) {
        poiBox.textContent = "已关闭 POI 查询";
      } else {
        try {
          poiBox.textContent = "查询附近 POI 中...";
          const pois = await queryPOIs(lat, lng, 600);
          poiBox.textContent = fmt(pois);
        } catch (e) {
          poiBox.textContent = "POI 查询失败（公共服务不稳定）";
        }
      }
    } catch (err) {
      posBox.textContent = "定位失败：" + err.message;
      addrBox.textContent = "未解析";
      poiBox.textContent = "未查询";
    }
  })();
})();

