const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(process.cwd()).filter(f => f.endsWith('.html'));
const base = 'https://reditgrab.com';

files.forEach(f => {
  const fp = path.join(process.cwd(), f);
  let txt = fs.readFileSync(fp, 'utf8');

  if (txt.includes('property="og:title"')) {
    return;
  }

  const titleMatch = txt.match(/<title>([^<]+)<\/title>/i);
  const descMatch = txt.match(/<meta\s+name="description"\s+content="([^"]*)"\s*\/?>(?![\s\S]*property="og:title")/i);

  const title = titleMatch ? titleMatch[1].trim() : 'ReditGrab';
  const description = descMatch ? descMatch[1].trim() : 'Download Reddit videos and images fast with ReditGrab.';
  const url = f === 'index.html' ? base : `${base}/${f}`;

  const ogBlock = `    <meta property="og:type" content="website" />\n` +
                  `    <meta property="og:url" content="${url}" />\n` +
                  `    <meta property="og:title" content="${title}" />\n` +
                  `    <meta property="og:description" content="${description}" />\n` +
                  `    <meta property="og:image" content="https://reditgrab.com/og-image.png" />\n` +
                  `    <meta name="twitter:card" content="summary_large_image" />\n` +
                  `    <meta name="twitter:site" content="@ReditGrab" />\n`;

  let insertPos = -1;
  if (descMatch) {
    insertPos = txt.indexOf(descMatch[0]) + descMatch[0].length;
  } else if (titleMatch) {
    insertPos = txt.indexOf(titleMatch[0]) + titleMatch[0].length;
  }

  if (insertPos <= 0) {
    console.log('skipping', f, 'no insertion point');
    return;
  }

  txt = txt.slice(0, insertPos) + '\n' + ogBlock + txt.slice(insertPos);
  fs.writeFileSync(fp, txt, 'utf8');
  console.log('updated', f);
});
