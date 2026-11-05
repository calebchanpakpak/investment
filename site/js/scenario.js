import { nextMeeting, upcomingMeetings } from './market.js';
import { formatHelsinkiTime } from './format.js';

export const DISCLAIMER = '以下係一般規則考慮，按已公布日程同你已載入嘅持倉做條件判斷。呢個唔係人工智能研究，亦唔會估計未來股價或盈利。未設定人工智能後端。';

function holdingTicker(holding) {
  return String(holding?.ticker || holding?.name || '').trim().toUpperCase();
}

export function buildConsiderations({
  now = new Date(),
  portfolio = null,
  portfolioLoaded = false,
  symbol = null,
  schedule = null,
  newsState = null,
} = {}) {
  const items = [
    { id: 'disclaimer', tone: 'neutral', text: DISCLAIMER },
  ];

  if (!portfolioLoaded) {
    items.push({
      id: 'no-portfolio',
      tone: 'neutral',
      text: '未載入投資組合，所以呢份清單唔會按你嘅倉位調整。',
    });
  } else {
    const holdings = Array.isArray(portfolio?.holdings) ? portfolio.holdings : [];
    const total = holdings.reduce((sum, holding) => sum + (Number(holding.mvHkd) || 0), 0);
    if (symbol) {
      const match = holdings.find((holding) => holdingTicker(holding) === symbol.ticker);
      if (match) {
        items.push({
          id: 'held',
          tone: 'info',
          text: `已載入持倉包含 ${symbol.ticker}。數量同市值嚟自你嘅試算表，見上面嘅更新時間，唔係即時報價。`,
        });
      } else {
        items.push({
          id: 'not-held',
          tone: 'neutral',
          text: `已載入持倉入面未見 ${symbol.ticker}。`,
        });
      }
    }
    const concentrated = holdings
      .filter((holding) => total > 0 && (Number(holding.mvHkd) || 0) / total > 0.4)
      .sort((a, b) => (Number(b.mvHkd) || 0) - (Number(a.mvHkd) || 0))[0];
    if (concentrated) {
      const pct = ((Number(concentrated.mvHkd) || 0) / total) * 100;
      items.push({
        id: 'concentration',
        tone: 'warn',
        text: `單一持倉「${concentrated.name || concentrated.ticker}」約佔已載入市值 ${pct.toFixed(0)}%（超過 40%）。呢個只係集中度提示，唔係買賣建議。`,
      });
    }
  }

  const meetings = schedule?.meetings || [];
  const soon = upcomingMeetings(meetings, now, 14);
  const next = nextMeeting(meetings, now);
  if (soon.length) {
    const meeting = soon[0];
    const when = meeting.start === meeting.end ? meeting.start : `${meeting.start} 至 ${meeting.end}`;
    const fetched = schedule?.fetchedAt ? formatHelsinkiTime(schedule.fetchedAt) : '未知時間';
    items.push({
      id: 'fomc-soon',
      tone: 'info',
      text: `聯儲局日曆有已公布會議，日期 ${when}${meeting.sep ? '（附經濟預測摘要）' : ''}。快取擷取於 ${fetched}。呢個唔係利率預測。`,
    });
  } else if (next) {
    const when = next.start === next.end ? next.start : `${next.start} 至 ${next.end}`;
    items.push({
      id: 'fomc-next',
      tone: 'info',
      text: `下一場已公布 FOMC 日期係 ${when}${next.sep ? '（附經濟預測摘要）' : ''}。未來 14 日（紐約日期）未有更近嘅議息會議。呢個只係日曆，唔係利率預測。`,
    });
  } else if (schedule?.ok && Array.isArray(schedule.meetings)) {
    items.push({
      id: 'fomc-none',
      tone: 'neutral',
      text: '已載入嘅聯儲局日曆入面未見未結束嘅議息會議。請以官方頁面為準。',
    });
  }

  if (symbol?.cik) {
    items.push({
      id: 'filings',
      tone: 'info',
      text: `${symbol.ticker} 可對照 SEC 申報（例如 10-K、10-Q、8-K）。本頁唔會推算下一次業績日期或盈利數字。`,
    });
  } else if (symbol && symbol.unlisted) {
    items.push({
      id: 'unlisted',
      tone: 'neutral',
      text: 'SEC company_tickers 未收錄呢個代號。基金代號經常唔喺呢份名單。本頁仍然唔會編造業績日期。',
    });
  }

  items.push({
    id: 'no-earnings-calendar',
    tone: 'neutral',
    text: '未接上有來源嘅業績日曆，所以唔顯示業績日期，亦唔會填一個估計日期。',
  });

  if (newsState?.state === 'stale' || newsState?.state === 'error') {
    items.push({
      id: 'news-stale',
      tone: 'warn',
      text: '新聞快取而家係過期或更新失敗。請打開來源連結核對，唔好把快取標題當成即時消息。',
    });
  }

  return {
    title: '一般規則考慮',
    ai: false,
    items,
  };
}
