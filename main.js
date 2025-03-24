const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

(async () => {
  try {
    const response = await axios.get('https://rate.bot.com.tw/xrt?Lang=zh-TW');
    const $ = cheerio.load(response.data);
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const rates = [];

    $('table tbody tr').each((i, el) => {
      const currencyText = $(el).find('td div.visible-phone.print_hide').text().trim();
      const currency = currencyText.split(' ')[0]; // 只取幣別代碼，例如 USD、JPY

      const cashBuying = $(el).find('td[data-table="本行現金買入"].rate-content-cash').text().trim() || '-';
      const cashSelling = $(el).find('td[data-table="本行現金賣出"].rate-content-cash').text().trim() || '-';
      const sightBuying = $(el).find('td[data-table="本行即期買入"].rate-content-sight').text().trim() || '-';
      const sightSelling = $(el).find('td[data-table="本行即期賣出"].rate-content-sight').text().trim() || '-';

      if (currency) {
        rates.push({
          currency,
          cashBuying,
          cashSelling,
          sightBuying,
          sightSelling,
        });
      }
    });

    const output = {
      date,
      rates,
    };

    fs.writeFileSync('./data.json', JSON.stringify(output, null, 2));
    console.log(`已更新所有匯率資料：${date}`);
  } catch (err) {
    console.error('抓取匯率失敗：', err);
    process.exit(1);
  }
})();
