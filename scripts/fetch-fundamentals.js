#!/usr/bin/env node
'use strict';

/**
 * Fundamental Data Fetcher
 * Fetches economic calendar and news from multiple sources
 */

const https = require('https');
const http = require('http');

const SOURCES = {
  calendar: 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  investingNews: 'https://www.investing.com/rss/news.rss',
  forexliveNews: 'https://www.forexlive.com/feed/news'
};

function fetch(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { 
      headers: { 
        'User-Agent': 'Mozilla/5.0 (compatible; OpenClaw/1.0)',
        'Accept': '*/*'
      },
      timeout: 10000 
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

function parseRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const title = (itemXml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i) || [])[1] || '';
    const pubDate = (itemXml.match(/<pubDate>(.*?)<\/pubDate>/i) || [])[1] || '';
    const link = (itemXml.match(/<link>(.*?)<\/link>/i) || [])[1] || '';
    const author = (itemXml.match(/<author>(.*?)<\/author>/i) || itemXml.match(/<dc:creator>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/dc:creator>/i) || [])[1] || '';
    
    if (title) {
      items.push({
        title: title.replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
        pubDate,
        link,
        author: author.replace(/<!\[CDATA\[|\]\]>/g, '').trim()
      });
    }
  }
  
  return items;
}

function filterRelevantNews(items, symbols = []) {
  const keywords = [
    // Currencies
    'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD',
    'dollar', 'euro', 'pound', 'yen', 'franc',
    // Central banks
    'Fed', 'ECB', 'BOE', 'BOJ', 'SNB', 'RBA', 'BOC', 'RBNZ',
    'Federal Reserve', 'central bank', 'rate', 'hike', 'cut',
    // Economic
    'inflation', 'CPI', 'GDP', 'employment', 'jobs', 'NFP', 'payroll',
    'PMI', 'retail sales', 'trade balance',
    // Markets
    'forex', 'gold', 'XAUUSD', 'oil', 'risk', 'haven'
  ];
  
  const symbolKeywords = symbols.flatMap(s => [
    s,
    s.substring(0, 3),
    s.substring(3, 6)
  ]);
  
  const allKeywords = [...keywords, ...symbolKeywords];
  const pattern = new RegExp(allKeywords.join('|'), 'i');
  
  return items.filter(item => pattern.test(item.title));
}

function getUpcomingHighImpactEvents(events, hoursAhead = 24) {
  const now = new Date();
  const cutoff = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
  
  return events.filter(e => {
    if (e.impact !== 'High') return false;
    const eventDate = new Date(e.date);
    return eventDate >= now && eventDate <= cutoff;
  }).map(e => ({
    title: e.title,
    country: e.country,
    date: e.date,
    impact: e.impact,
    forecast: e.forecast,
    previous: e.previous
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'all';
  const results = { timestamp: new Date().toISOString() };
  
  try {
    if (command === 'calendar' || command === 'all') {
      try {
        const calRes = await fetch(SOURCES.calendar);
        if (calRes.status === 200) {
          const events = JSON.parse(calRes.data);
          results.calendar = {
            totalEvents: events.length,
            upcomingHighImpact: getUpcomingHighImpactEvents(events, 24)
          };
        }
      } catch (e) {
        results.calendarError = e.message;
      }
    }
    
    if (command === 'news' || command === 'all') {
      results.news = [];
      
      // Investing.com
      try {
        const invRes = await fetch(SOURCES.investingNews);
        if (invRes.status === 200) {
          const items = parseRSS(invRes.data);
          const relevant = filterRelevantNews(items.slice(0, 20));
          results.news.push(...relevant.map(n => ({ ...n, source: 'investing.com' })));
        }
      } catch (e) {
        results.investingError = e.message;
      }
      
      // ForexLive
      try {
        const flRes = await fetch(SOURCES.forexliveNews);
        if (flRes.status === 200) {
          const items = parseRSS(flRes.data);
          results.news.push(...items.slice(0, 10).map(n => ({ ...n, source: 'forexlive' })));
        }
      } catch (e) {
        results.forexliveError = e.message;
      }
      
      // Sort by date
      results.news.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    }
    
    console.log(JSON.stringify(results, null, 2));
    
  } catch (e) {
    console.error(JSON.stringify({ error: e.message }));
    process.exit(1);
  }
}

main();
