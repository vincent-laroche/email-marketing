const API_ROOT = "https://api.hubapi.com";

export function hubspotClient(token) {
  async function request(path, { method = "GET", body, query } = {}) {
    const url = new URL(path, API_ROOT);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    if (!response.ok) {
      const error = new Error(`${method} ${url.pathname} failed with HTTP ${response.status}`);
      error.status = response.status;
      error.payload = json;
      throw error;
    }
    return { json, headers: Object.fromEntries(response.headers.entries()), url: url.toString() };
  }

  async function getAll(path, { resultKey = "results", limit = 100, extraQuery = {}, maxPages = 1000 } = {}) {
    const results = [];
    let after;
    let pageCount = 0;
    do {
      const { json } = await request(path, { query: { limit, after, ...extraQuery } });
      const pageResults = json?.[resultKey] ?? [];
      results.push(...pageResults);
      after = json?.paging?.next?.after;
      pageCount += 1;
      if (pageCount > maxPages) throw new Error(`Pagination safety limit exceeded for ${path}`);
    } while (after);
    return { results, pageCount };
  }

  return { request, getAll };
}
