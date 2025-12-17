(function () {
  const posBox = document.getElementById("posBox");
  const addrBox = document.getElementById("addrBox");
  const poiBox = document.getElementById("poiBox");

  // 建议：按 Nominatim 使用政策提供联系邮箱（你自己的）
  const NOMINATIM_EMAIL = "1181392662@qq.com";

  // POI 查询开关：如果你网络里 Overpass 很不稳定，可以先改成 false
  const ENABLE_POI = true;

  // ---------- Map (Leaflet) ----------
  const map = L.map("map", { zoomControl: true }).setView([31.2304, 121.4737], 12);

  // 使用 CARTO 底图（通常比 OSM 官方瓦片更容易访问）
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
  }).addTo(map);

  const marker = L.marker([31.2304, 121.4737]).addTo(map);

  function setMarker(lat, lng) {
    marker.setLatLng([lat, lng]);
    map.setView([lat, lng], 16);
  }

  function fmt(obj) {
    return JSON.stringify(obj, null, 2);
  }

  // ---------- Geolocation ----------
  function getCurrentPositionAsync() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("当前浏览器不支持 Geolocation"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0
      });
    });
  }

  // ---------- Fetch helpers ----------
  function fetchWithTimeout(url, { timeoutMs = 8000, ...opts } = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...opts, signal: controller.signal })
      .finally(() => clearTimeout(id));
  }

  // ---------- Nominatim reverse geocode ----------
  async function reverseGeocode(lat, lng) {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", "18");

    if (NOMINATIM_EMAIL && NOMINATIM_EMAIL !== "your_email@example.com") {
      url.searchParams.set("email", NOMINATIM_EMAIL);
    }

    // 先请求一次；失败则重试一次（更长超时）
    try {
      const res = await fetchWithTimeout(url.toString(), {
        timeoutMs: 8000,
        headers: { "Accept": "application/json" }
      });
      if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      const res2 = await fetchWithTimeout(url.toString(), {
        timeoutMs: 12000,
        headers: { "Accept": "application/json" }
      });
      if (!res2.ok) throw new Error(`Nominatim HTTP ${res2.status}`);
      return await res2.json();
    }
  }

  function pickAddress(nominatimJson) {
    const a = nominatimJson.address || {};
    // OSM 字段因地区会不同，这里尽量兼容
    const province = a.state || a.region || a.province;
    const city = a.city || a.town || a.village || a.county;
    const district = a.city_district || a.district || a.suburb;
    const street = a.road || a.street || a.residential;
    const number = a.house_number;

    return {
      display_name: nominatimJson.display_name,
      province,
      city,
      district,
      street,
      house_number: number,
      postcode: a.postcode,
      country: a.country
    };
  }

  // ---------- Overpass POI (optional) ----------
  async function queryPOIs(lat, lng, radiusMeters = 600) {
    const q = `
      [out:json][timeout:25];
      (
        node(around:${radiusMeters},${lat},${lng})["amenity"];
        node(around:${radiusMeters},${lat},${lng})["shop"];
        node(around:${radiusMeters},${lat},${lng})["tourism"];
        node(around:${radiusMeters},${lat},${lng})["leisure"];
      );
      out 60;
    `;

    const res = await fetchWithTimeout("https://overpass-api.de/api/interpreter", {
      method: "POST",
      timeoutMs: 12000,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: q
    });
    if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
    const data = await res.json();

    const named = (data.elements || [])
      .filter(e => e.type === "node" && e.tags && e.tags.name && typeof e.lat === "number" && typeof e.lon === "number")
      .map(e => ({
        name: e.tags.name,
        type: e.tags.amenity || e.tags.shop || e.tags.tourism || e.tags.leisure,
        lat: e.lat,
        lon: e.lon
      }));

    // 近似距离排序
    function dist(aLat, aLon, bLat, bLon) {
      const R = 6371000;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(bLat - aLat);
      const dLon = toRad(bLon - aLon);
      const x = dLat * dLat + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * dLon * dLon;
      return R * Math.sqrt(x);
    }

    named.sort((p1, p2) => dist(lat, lng, p1.lat, p1.lon) - dist(lat, lng, p2.lat, p2.lon));

    return named.slice(0, 5).map(p => ({
      name: p.name,
      type: p.type,
      location: { lat: p.lat, lng: p.lon },
      distance_m: Math.round(dist(lat, lng, p.lat, p.lon))
    }));
  }

  // ---------- Auto-run on load (split errors) ----------
  (async () => {
    try {
      posBox.textContent = "请求定位权限中...";
      const pos = await getCurrentPositionAsync();

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      posBox.textContent = fmt({
        lat, lng,
        accuracy_m: pos.coords.accuracy,  // 精度（米）
        altitude: pos.coords.altitude,
        heading: pos.coords.heading,
        speed: pos.coords.speed,
        timestamp: new Date(pos.timestamp).toISOString()
      });

      setMarker(lat, lng);

      // 1) 地址解析
      try {
        addrBox.textContent = "逆地理编码中（Nominatim）...";
        const regeo = await reverseGeocode(lat, lng);
        addrBox.textContent = fmt(pickAddress(regeo));
      } catch (e) {
        addrBox.textContent = "逆地理编码失败：" + (e?.message || String(e));
      }

      // 2) POI
      if (!ENABLE_POI) {
        poiBox.textContent = "已关闭 POI 查询（ENABLE_POI=false）";
      } else {
        try {
          poiBox.textContent = "查询附近 POI 中（Overpass）...";
          const pois = await queryPOIs(lat, lng, 600);
          poiBox.textContent = fmt(pois);
        } catch (e) {
          poiBox.textContent = "POI 查询失败：" + (e?.message || String(e));
        }
      }

    } catch (err) {
      // 只有定位失败会到这里（例如用户拒绝授权）
      posBox.textContent = "定位失败：" + (err?.message || String(err));
      addrBox.textContent = "未解析";
      poiBox.textContent = "未查询";
    }
  })();
})();