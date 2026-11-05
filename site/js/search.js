export function companyLinks(row) {
  const [ticker, cik, name] = row;
  const query = encodeURIComponent(`${ticker} ${name}`);
  const symbol = encodeURIComponent(ticker);
  return [
    {
      label: 'SEC EDGAR 公司頁',
      url: `https://www.sec.gov/edgar/browse/?CIK=${cik}`,
      kind: 'filing',
    },
    {
      label: 'SEC 申報列表',
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&owner=include&count=40`,
      kind: 'filing',
    },
    {
      label: 'CNBC 報價頁（由 CNBC 提供，可能延遲）',
      url: `https://www.cnbc.com/quotes/${symbol}`,
      kind: 'quote-link',
    },
    {
      label: 'CNBC 搜尋（搜尋連結，唔係已擷取新聞）',
      url: `https://www.cnbc.com/search/?query=${query}&qsearchterm=${symbol}`,
      kind: 'search-link',
    },
    {
      label: 'Google 新聞搜尋（搜尋連結，唔係已擷取新聞）',
      url: `https://news.google.com/search?q=${encodeURIComponent(`${ticker} stock`)}&hl=en-US&gl=US&ceid=US:en`,
      kind: 'search-link',
    },
  ];
}

export function searchSymbols(rows, query, limit = 20) {
  const q = String(query || '').trim().toUpperCase();
  if (q.length < 1) return [];
  const prefix = [];
  const names = [];
  for (const row of rows || []) {
    const ticker = row[0];
    const name = String(row[2] || '').toUpperCase();
    if (ticker.startsWith(q)) prefix.push(row);
    else if (name.includes(q)) names.push(row);
    if (prefix.length >= limit) break;
  }
  return prefix.concat(names).slice(0, limit);
}
