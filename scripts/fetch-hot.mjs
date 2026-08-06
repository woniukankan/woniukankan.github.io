/**
 * 抓取蜗牛看看主站首页的「热门」片单，生成同源的 hot.json 供发布页读取。
 *
 * 之所以在 CI 里抓而不是浏览器里抓：主站没有下发 Access-Control-Allow-Origin，
 * 发布页（woniukankan.github.io）跨域 fetch 会被浏览器拦截。
 *
 * 用法：node scripts/fetch-hot.mjs
 */

import { writeFile, readFile } from 'node:fs/promises';

const SOURCE = 'https://woniukankan.com';
const OUT = new URL('../hot.json', import.meta.url);
const MAX_ITEMS = 40;

/** 详情页路径前缀 -> 中文频道名 */
const CATEGORY = {
    movie: '电影',
    tv: '电视剧',
    cartoon: '动漫',
    variety: '综艺',
    shortdrama: '短剧',
    sport: '体育',
};

/** 首页热搜块形如：<a href="/movie/32627" class="hotword-item" title="流浪地球2" ...>流浪地球2</a> */
const HOTWORD = /<a href="(\/[a-z]+\/\d+)"[^>]*class="hotword-item"[^>]*title="([^"]+)"/g;

function decodeEntities(s) {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

async function fetchHomepage() {
    const res = await fetch(SOURCE, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9',
        },
    });
    if (!res.ok) throw new Error(`主站返回 HTTP ${res.status}`);
    return res.text();
}

function parse(html) {
    const items = [];
    const seen = new Set();

    for (const [, path, rawTitle] of html.matchAll(HOTWORD)) {
        const title = decodeEntities(rawTitle).trim();
        const prefix = path.split('/')[1];
        if (!title || seen.has(title)) continue;
        seen.add(title);
        items.push({ title, path, cat: CATEGORY[prefix] || '热播' });
        if (items.length >= MAX_ITEMS) break;
    }

    return items;
}

async function main() {
    const html = await fetchHomepage();
    const items = parse(html);

    // 解析不到就直接失败，绝不用空片单覆盖掉仓库里已有的好数据
    if (items.length < 10) {
        throw new Error(`只解析到 ${items.length} 条，疑似主站结构变更，已放弃写入`);
    }

    const payload = {
        source: SOURCE,
        updated: new Date().toISOString(),
        count: items.length,
        items,
    };
    const next = JSON.stringify(payload, null, 2) + '\n';

    // 片单内容没变就不重写文件，避免 CI 每次都产生一个只改时间戳的提交
    try {
        const prev = JSON.parse(await readFile(OUT, 'utf8'));
        if (JSON.stringify(prev.items) === JSON.stringify(items)) {
            console.log(`片单无变化（${items.length} 条），跳过写入`);
            return;
        }
    } catch {
        /* 首次运行或文件损坏，正常写入 */
    }

    await writeFile(OUT, next);
    console.log(`已写入 hot.json：${items.length} 条`);
    console.log(items.slice(0, 5).map((i) => `  ${i.cat} · ${i.title} -> ${i.path}`).join('\n'));
}

main().catch((err) => {
    console.error('抓取失败：', err.message);
    process.exit(1);
});
