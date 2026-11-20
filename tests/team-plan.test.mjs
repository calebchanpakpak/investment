import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { installDom } from './dom-shim.mjs';
import { renderApp } from '../site/js/render.js';
import { readPortfolioResponse } from '../site/js/portfolio.js';
import {
  instantFromWall,
  prepareTeamPlan,
  tradeSentence,
} from '../site/js/team-plan.js';

installDom();

const sheet = JSON.parse(readFileSync(new URL('./fixtures/portfolio.json', import.meta.url), 'utf8'));
const futu = JSON.parse(readFileSync(new URL('./fixtures/futu.json', import.meta.url), 'utf8'));
const teamPlan = JSON.parse(readFileSync(new URL('./fixtures/team-plan.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-11-19T12:00:00Z');

function render(portfolio, extra = {}) {
  const root = document.createElement('div');
  renderApp(root, {
    now: NOW,
    tab: 'team',
    holding: '',
    connection: { endpointHost: 'script.google.com' },
    portfolioStatus: 'ready',
    portfolio,
    portfolioFetchedAt: '2026-11-19T11:00:00Z',
    portfolioError: null,
    endpointDraft: '',
    tokenDraft: '',
    settingsMessage: '',
    ...extra,
  }, { reload() {}, save() {}, clear() {} });
  return root;
}

test('trade rows spell out side, size, limit and amount', () => {
  assert.equal(
    tradeSentence({ action: 'SELL', ticker: 'TSLA', qty: 3.3, limitPrice: 374, amountUsd: 1236 }),
    '賣出 TSLA 3.3 股 · 限價 $374 · 約 $1,236',
  );
  assert.equal(
    tradeSentence({ action: 'BUY', ticker: 'EXMP', qty: 2, priceRange: { low: 10, high: 11 } }),
    '買入 EXMP 2 股 · 區間 $10–$11',
  );
  assert.equal(tradeSentence({ action: 'CHECK', ticker: 'CASH' }), '檢查 CASH');
  assert.equal(tradeSentence({ action: 'SELL_TO_CLOSE', ticker: 'FAKE', qty: 1, limitPrice: 1.5 }), '平倉賣出 FAKE 1 股 · 限價 $1.50');
});

test('timetable instants are shown in Helsinki, including a New York wall clock', () => {
  const helsinki = instantFromWall('2026-11-20', '16:30', 'Europe/Helsinki');
  assert.equal(helsinki.toISOString(), '2026-11-20T14:30:00.000Z');
  const ny = instantFromWall('2026-11-24', '09:15', 'America/New_York');
  assert.equal(ny.toISOString(), '2026-11-24T14:15:00.000Z');
  assert.equal(instantFromWall('nope', '16:30', 'Europe/Helsinki'), null);
  assert.equal(instantFromWall('2026-11-20', '16:30', 'Not/AZone'), null);
});

test('the fake plan renders actions, overview, strategies, allocation, holdings, timetable, reports and team', () => {
  const portfolio = { ...sheet, futu, teamPlan };
  const view = prepareTeamPlan(portfolio, NOW);
  assert.equal(view.stale, false);
  assert.equal(view.status.label, '草稿 · 未批准');
  assert.deepEqual(view.actions.map((action) => action.priority), ['urgent', 'normal']);
  assert.equal(view.actions[0].needsApproval, true);
  assert.equal(view.timetable.groups[1].items.some((item) => item.next), true);

  const root = render(portfolio);
  const team = root.querySelector('#team');
  assert.equal(team.getAttribute('hidden'), null);
  assert.equal(root.querySelector('#overview').getAttribute('hidden'), '');
  const titles = [...team.querySelectorAll('h3')].map((el) => el.textContent);
  for (const [before, after] of [
    ['你要做嘅嘢', '策略總覽'],
    ['策略總覽', '策略'],
    ['策略', '配置'],
    ['配置', '團隊持倉'],
    ['團隊持倉', '時間表'],
    ['時間表', '團隊週報'],
    ['團隊週報', '團隊'],
  ]) {
    assert.ok(titles.indexOf(before) >= 0 && titles.indexOf(before) < titles.indexOf(after), `${before} before ${after}`);
  }
  assert.equal(team.querySelector('[data-status-badge="draft"]').textContent, '草稿 · 未批准');
  assert.match(team.textContent, /未寫明已批准之前/);
  assert.equal(team.querySelector('[data-plan-stale]'), null);
  assert.match(team.textContent, /版本 v9\.9-fake/);
  assert.match(team.textContent, /2026-11-19 14:00 EET（赫爾辛基）/);
  assert.match(team.textContent, /假策略：範例股減持，其餘留現金/);
  assert.equal(team.querySelector('.action-item').getAttribute('data-priority'), 'urgent');
  assert.equal(team.querySelector('[data-needs-approval="true"]').textContent, '等你批准');
  assert.match(team.textContent, /批準賣出假代號 EXMP/);
  assert.match(team.querySelector('[data-strategy="core"]').textContent, /預期利潤 \$40/);
  assert.match(team.querySelector('[data-strategy="core"]').textContent, /熊 −8% · 基本 4% · 牛 12%/);
  assert.match(team.querySelector('[data-strategy="core"]').textContent, /Amy-bot/);
  assert.match(team.querySelector('[data-bucket="core"]').textContent, /核心/);
  assert.match(team.querySelector('[data-alloc="SAMP"]').textContent, /衛星/);
  const planned = team.querySelector('[data-planned="true"]');
  assert.equal(planned.getAttribute('data-holding'), 'SAMP');
  assert.match(planned.textContent, /計劃買入/);
  assert.match(planned.textContent, /短線/);
  assert.equal(team.querySelector('[data-holding="EXMP"]').getAttribute('href'), '#team/h/0');
  assert.match(team.querySelector('[data-holding="EXMP"]').textContent, /長線/);
  assert.match(team.querySelector('[data-holding="EXMP"]').textContent, /止蝕 \$9/);
  assert.match(team.querySelector('[data-holding="EXMP"]').textContent, /止賺 \$15/);
  const sell = [...team.querySelectorAll('[data-ticker="EXMP"]')].find((el) => el.textContent.includes('賣出 EXMP'));
  assert.match(sell.textContent, /賣出 EXMP 3\.3 股 · 限價 \$12\.50 · 約 \$41\.25/);
  assert.match(sell.textContent, /2026-11-20 16:30 EET（赫爾辛基）/);
  assert.match(sell.textContent, /止蝕 \$9/);
  assert.match(sell.textContent, /止賺 \$15/);
  assert.match(sell.textContent, /假條件：只係示範/);
  assert.equal(sell.getAttribute('data-next'), 'false');
  const next = team.querySelector('[data-next="true"]');
  assert.match(next.textContent, /留意 EXMP/);
  assert.match(next.textContent, /2026-11-19 18:00 EET（赫爾辛基）/);
  assert.match(team.querySelector('[data-ticker="CASH"]').className, /\bpast\b/);
  assert.match(team.textContent, /2026-11-24 16:15 EET（赫爾辛基）/);
  assert.match(team.querySelector('.weekly summary').textContent, /Iris-bot/);
  assert.match(team.querySelector('[data-member="Kai-bot"]').textContent, /提醒方案仍然係草稿/);
  assert.match(team.textContent, /假風險：呢頁唔係真實持倉/);
  assert.match(team.textContent, /假問題：SAMP/);
  assert.equal(team.textContent.includes('CASHFUND'), false);
  assert.equal(root.querySelector('#portfolio').textContent.includes('試算表'), false);
});

test('opening a holding shows the team analysis and escapes it', () => {
  const portfolio = { ...sheet, futu, teamPlan: structuredClone(teamPlan) };
  portfolio.teamPlan.holdings[0].thesis.whyBuy = '<script>alert("xss")</script>';
  portfolio.teamPlan.holdings[0].name = '<img src=x onerror=alert(1)>';
  const root = render(portfolio, { holding: '0' });
  const detail = root.querySelector('[data-holding-detail]');
  assert.ok(detail);
  assert.equal(root.querySelector('#plan-holdings'), null);
  assert.match(detail.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(root.querySelector('#holding-thesis').textContent, /<script>alert\("xss"\)<\/script>/);
  assert.match(root.textContent, /點解買/);
  assert.match(root.textContent, /點解持/);
  assert.match(root.textContent, /點解賣/);
  assert.match(root.textContent, /第一目標 \$14/);
  assert.match(root.textContent, /假來源：內部備忘/);
  assert.equal(root.querySelector('.holding-detail a[href="#team"]').textContent, '返回方案');
  assert.equal(root.querySelectorAll('script').length, 0);
  assert.equal(root.querySelectorAll('img').length, 0);

  const missing = render(portfolio, { holding: '99' });
  assert.match(missing.querySelector('#team').textContent, /搵唔到呢個持倉/);
});

test('absent, null, and stale plans, plus an empty timetable', () => {
  const absent = render({ ...sheet, futu });
  const nulled = render({ ...sheet, futu, teamPlan: null });
  assert.equal(absent.querySelector('[data-team-plan="missing"]').querySelector('h3').textContent, '團隊方案未同步');
  assert.equal(nulled.querySelector('[data-team-plan="missing"]').querySelector('h3').textContent, '團隊方案未同步');
  assert.match(absent.querySelector('#overview').textContent, /Futu|實盤|最後同步|富途/);
  assert.equal(absent.querySelector('#portfolio').textContent.includes('團隊方案未同步'), false);

  const stalePlan = structuredClone(teamPlan);
  stalePlan.generatedAt = '2026-11-16T11:59:00Z';
  const stale = render({ ...sheet, futu, teamPlan: stalePlan });
  assert.equal(stale.querySelector('[data-plan-stale="true"]').textContent.includes('超過 3 日'), true);

  const edge = structuredClone(teamPlan);
  edge.generatedAt = '2026-11-16T12:00:00Z';
  assert.equal(prepareTeamPlan({ teamPlan: edge }, NOW).stale, false);

  const empty = structuredClone(teamPlan);
  empty.timetable = [];
  empty.generatedAt = '';
  empty.status = 'approved';
  const root = render({ ...sheet, futu, teamPlan: empty });
  assert.equal(root.querySelector('[data-empty-timetable="true"]').textContent, '未有時間表。');
  assert.equal(root.querySelector('[data-next]'), null);
  assert.equal(root.querySelector('[data-status-badge="approved"]').textContent, '已批准');
  assert.equal(root.querySelector('[data-status-badge="approved"]').textContent.includes('未批准'), false);
  assert.match(root.querySelector('.plan-meta').textContent, /未有產生時間/);
  assert.equal(root.querySelector('[data-plan-stale]'), null);

  const bare = render({ ...sheet, futu, teamPlan: { status: 'nope' } });
  assert.equal(bare.querySelector('[data-status-badge="nope"]').textContent, '未批准');
  assert.match(bare.querySelector('#team').textContent, /狀態碼：nope/);
  assert.match(bare.querySelector('#team').textContent, /暫時未有要你做嘅嘢/);
  assert.match(bare.querySelector('#team').textContent, /未有策略/);
  assert.equal(bare.querySelector('[data-empty-timetable]').textContent, '未有時間表。');
});

test('the adapter passes teamPlan through and the page does not build HTML from it', async () => {
  const kept = await readPortfolioResponse({
    type: 'basic',
    json: async () => ({ ok: true, error: null, data: { overview: { totalHkd: 1 }, teamPlan } }),
  });
  assert.equal(kept.teamPlan.planVersion, 'v9.9-fake');
  const cleared = await readPortfolioResponse({
    type: 'basic',
    json: async () => ({ ok: true, error: null, data: { overview: { totalHkd: 1 }, teamPlan: null } }),
  });
  assert.equal(cleared.teamPlan, null);
  assert.equal(prepareTeamPlan({ teamPlan: [] }), null);
  assert.equal(prepareTeamPlan({}), null);

  const files = ['team-plan.js', 'render.js', 'futu.js', 'dom.js'];
  for (const name of files) {
    const source = readFileSync(new URL(`../site/js/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  }
});
