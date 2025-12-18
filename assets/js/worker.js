export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 只允许 /reverse
    if (url.pathname !== "/reverse") {
      return new Response("Not Found", { status: 404 });
    }

    const target = new URL("https://nominatim.openstreetmap.org/reverse");

    // 原样转发 query 参数
    for (const [k, v] of url.searchParams) {
      target.searchParams.set(k, v);
    }

    // 强制满足 Nominatim 使用政策
    target.searchParams.set("format", "jsonv2");
    target.searchParams.set("email", "1181392662@qq.com");

    const res = await fetch(target.toString(), {
      headers: {
        "Accept": "application/json",
        "User-Agent": "cf-worker-nominatim-proxy (1181392662@qq.com)"
      }
    });

    // 透传响应
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
};
