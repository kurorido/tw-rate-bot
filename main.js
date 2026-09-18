const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const CURRENCY_ZH = {
  USD: '美金',
  HKD: '港幣',
  GBP: '英鎊',
  AUD: '澳幣',
  CAD: '加拿大幣',
  SGD: '新加坡幣',
  CHF: '瑞士法郎',
  JPY: '日圓',
  ZAR: '南非幣',
  SEK: '瑞典幣',
  NZD: '紐元',
  THB: '泰幣',
  PHP: '菲國比索',
  IDR: '印尼幣',
  EUR: '歐元',
  KRW: '韓元',
  VND: '越南盾',
  MYR: '馬來幣',
  CNY: '人民幣',
};

const CURRENCY_ORDER = Object.keys(CURRENCY_ZH);

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/csv;q=0.8,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
};

function todayInTaipei() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

function formatRate(value) {
  if (value == null) return '-';
  const text = String(value).trim();
  if (!text || text === '-' || text === 'null' || text === 'undefined') return '-';
  const number = Number(text);
  return Number.isNaN(number) ? text : String(number);
}

function sortRates(rates) {
  const index = new Map(CURRENCY_ORDER.map((code, i) => [code, i]));
  return [...rates].sort((a, b) => {
    const ai = index.has(a.currency) ? index.get(a.currency) : 999;
    const bi = index.has(b.currency) ? index.get(b.currency) : 999;
    return ai - bi || a.currency.localeCompare(b.currency);
  });
}

function looksLikeChallenge(text) {
  return /Challenge Validation|sec-cpt-if|cp_clge_done/i.test(text);
}

function toText(data) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  return JSON.stringify(data);
}

async function fetchUrl(url) {
  const response = await axios.get(url, {
    headers: REQUEST_HEADERS,
    timeout: 20000,
    responseType: 'text',
    transformResponse: [(data) => data],
    validateStatus: () => true,
  });
  return {
    status: response.status,
    text: toText(response.data),
  };
}

function parseHtml(html) {
  if (looksLikeChallenge(html)) return [];

  const $ = cheerio.load(html);
  const rates = [];

  $('table tbody tr').each((_, el) => {
    const currencyText = $(el).find('td div.visible-phone.print_hide').text().trim();
    const currencyZhTw = currencyText.split(' ')[0];
    const currencyCode = currencyText.split(' ')[1];
    const currency = currencyCode ? currencyCode.replace(/[^a-zA-Z]/g, '') : '';
    const cashBuying = $(el).find('td[data-table="本行現金買入"].rate-content-cash').text().trim() || '-';
    const cashSelling = $(el).find('td[data-table="本行現金賣出"].rate-content-cash').text().trim() || '-';
    const sightBuying = $(el).find('td[data-table="本行即期買入"].rate-content-sight').text().trim() || '-';
    const sightSelling = $(el).find('td[data-table="本行即期賣出"].rate-content-sight').text().trim() || '-';

    if (currency) {
      rates.push({
        currency,
        currencyZhTw: CURRENCY_ZH[currency] || currencyZhTw,
        cashBuying: formatRate(cashBuying),
        cashSelling: formatRate(cashSelling),
        sightBuying: formatRate(sightBuying),
        sightSelling: formatRate(sightSelling),
      });
    }
  });

  return rates;
}

function parseCsv(text) {
  if (looksLikeChallenge(text)) return [];

  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const byCurrency = new Map();
  const ensure = (code) => {
    if (!byCurrency.has(code)) {
      byCurrency.set(code, {
        currency: code,
        currencyZhTw: CURRENCY_ZH[code] || code,
        cashBuying: '-',
        cashSelling: '-',
        sightBuying: '-',
        sightSelling: '-',
      });
    }
    return byCurrency.get(code);
  };

  for (const line of lines.slice(1)) {
    const cols = line.split(',').map((col) => col.trim());
    const code = (cols[0] || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) continue;

    const row = ensure(code);
    const kind = cols[1] || '';

    if (/買入|buying/i.test(kind)) {
      row.cashBuying = formatRate(cols[2]);
      row.sightBuying = formatRate(cols[3]);
    } else if (/賣出|selling/i.test(kind)) {
      row.cashSelling = formatRate(cols[2]);
      row.sightSelling = formatRate(cols[3]);
    } else if (cols.length > 13) {
      row.cashBuying = formatRate(cols[2]);
      row.sightBuying = formatRate(cols[3]);
      row.cashSelling = formatRate(cols[12]);
      row.sightSelling = formatRate(cols[13]);
    }
  }

  return [...byCurrency.values()];
}

function parseHaoRate(text) {
  if (looksLikeChallenge(text)) return [];

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return [];
  }

  const details = payload.details;
  if (!details || typeof details !== 'object') return [];

  return Object.entries(details).map(([currency, info]) => ({
    currency,
    currencyZhTw: CURRENCY_ZH[currency] || info.name || currency,
    cashBuying: formatRate(info.cash && info.cash.buy),
    cashSelling: formatRate(info.cash && info.cash.sell),
    sightBuying: formatRate(info.spot && info.spot.buy),
    sightSelling: formatRate(info.spot && info.spot.sell),
  }));
}

const SOURCES = [
  {
    name: 'BOT HTML',
    url: 'https://rate.bot.com.tw/xrt?Lang=zh-TW',
    parse: parseHtml,
  },
  {
    name: 'BOT CSV',
    url: 'https://rate.bot.com.tw/xrt/flcsv/0/day',
    parse: parseCsv,
  },
  {
    name: 'HaoRate CDN',
    url: 'https://cdn.jsdelivr.net/gh/haotool/app@data/public/rates/latest.json',
    parse: parseHaoRate,
  },
  {
    name: 'HaoRate GitHub',
    url: 'https://raw.githubusercontent.com/haotool/app/data/public/rates/latest.json',
    parse: parseHaoRate,
  },
];

(async () => {
  try {
    let rates = [];
    let sourceName = '';

    for (const source of SOURCES) {
      try {
        const { status, text } = await fetchUrl(source.url);
        const parsed = status >= 200 && status < 400 ? source.parse(text) : [];
        if (parsed.length > 0) {
          rates = parsed;
          sourceName = source.name;
          break;
        }
        console.warn(`${source.name} 沒有可用匯率（HTTP ${status}）`);
      } catch (err) {
        console.warn(`${source.name} 抓取失敗：${err.message}`);
      }
    }

    if (rates.length === 0) {
      throw new Error('所有來源都沒有抓到匯率，略過寫入以免覆蓋成空資料');
    }

    const output = {
      date: todayInTaipei(),
      rates: sortRates(rates),
    };

    fs.writeFileSync('./data.json', JSON.stringify(output, null, 2) + '\n');
    console.log(`已更新所有匯率資料：${output.date}（${sourceName}，${output.rates.length} 筆）`);
  } catch (err) {
    console.error('抓取匯率失敗：', err);
    process.exit(1);
  }
})();
