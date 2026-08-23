import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'vendor', 'PowerMapV2', 'src', 'styles', 'global.css');
const dest = path.join(root, 'apps', 'web', 'src', 'powermap', 'powermap.css');

const PREFIX = '.pm-root';

function prefixSelectors(selectorBlock) {
  return selectorBlock
    .split(',')
    .map((raw) => {
      let sel = raw.trim();
      if (!sel) return sel;
      if (sel === ':root' || sel === 'html' || sel === 'body' || sel === '#root') return PREFIX;
      sel = sel.replace(/^html\s+/, `${PREFIX} `).replace(/^body\s+/, `${PREFIX} `);
      if (sel.includes(PREFIX)) return sel;
      return `${PREFIX} ${sel}`;
    })
    .filter(Boolean)
    .join(', ');
}

function transform(css) {
  let i = 0;
  let out = '';
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      out += css.slice(i, end < 0 ? css.length : end + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    if (css[i] === '@') {
      const brace = css.indexOf('{', i);
      if (brace < 0) {
        out += css.slice(i);
        break;
      }
      const header = css.slice(i, brace);
      if (/^@(keyframes|font-face|import)\b/i.test(header.trim())) {
        let depth = 0;
        let j = brace;
        for (; j < css.length; j++) {
          if (css[j] === '{') depth++;
          else if (css[j] === '}') {
            depth--;
            if (depth === 0) {
              j++;
              break;
            }
          }
        }
        out += css.slice(i, j);
        i = j;
        continue;
      }
      out += header + '{';
      i = brace + 1;
      continue;
    }
    const brace = css.indexOf('{', i);
    const close = css.indexOf('}', i);
    if (close >= 0 && (brace < 0 || close < brace)) {
      out += css.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    if (brace < 0) {
      out += css.slice(i);
      break;
    }
    const selectors = css.slice(i, brace);
    if (selectors.trim()) out += prefixSelectors(selectors) + '{';
    else out += '{';
    i = brace + 1;
  }
  return out;
}

const css = fs.readFileSync(src, 'utf8');
const wrapped = `/* Auto-generated from vendor/PowerMapV2/src/styles/global.css — scoped to .pm-root */\n${transform(css)}\n`;
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, wrapped);
console.log('Wrote', path.relative(root, dest), `(${wrapped.length} bytes)`);
