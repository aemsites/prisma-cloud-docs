/* eslint-disable no-underscore-dangle, import/no-extraneous-dependencies */

/**
 * This script starts dev mode for the project, this is a reverse proxy
 * that mimics how the overlay works. Docs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { config as configEnv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const META_SOURCE = 'https://main--prisma-cloud-docs--aemsites.aem.page/metadata.json';

const HEAD_HTML = fs.readFileSync(path.resolve(__dirname, 'head.html'), 'utf8');

// port the reverse proxy runs on, ie. used for local dev
const port = process.env.PORT || 3000;

// port used for the aem content
const aemPort = process.env.AEM_PORT || 3001;

// port used for miniflare dev server, ie. the doc worker origin
const mfPort = process.env.MF_PORT || 3002;

configEnv({ path: path.resolve(__dirname, '.env.dev') });
process.env.NODE_ENV = 'development';

let _pendingMeta;
const fetchMetadata = async () => {
  if (_pendingMeta) {
    return _pendingMeta;
  }

  _pendingMeta = fetch(META_SOURCE).then((res) => res.json());
  return _pendingMeta;
};

/**
 * @param {string} pagePath
 * @returns {Promise<Record<string, string>>}
 */
async function resolveMeta(pagePath) {
  const meta = await fetchMetadata();
  let resolved = {};
  meta.data.forEach((row) => {
    if (row.URL.endsWith('/*') || row.URL.endsWith('/**')) {
      const cropped = row.URL.split('/').slice(0, -1).join('/');
      if (pagePath.startsWith(cropped)) {
        resolved = {
          ...resolved,
          ...row,
        };
      }
    }
  });
  return resolved;
}

async function resolveMetaHTML(pagePath) {
  const meta = await resolveMeta(pagePath);
  return `
  ${Object.entries(meta).map(([key, value]) => `<meta name="${key}" content="${value}">`).join('\n')}
  `;
}

express()
  .use('*', async (req, res) => {
    const reqPath = req.originalUrl;
    const query = req.query && Object.keys(req.query) ? `?${new URLSearchParams(req.query)}` : '';
    const filename = reqPath.split('/').pop().split('?')[0];
    let body;
    let headers = new Map();

    // filename begins with media_ and ends with .png/.jpg/.jpeg/.gif/.svg
    // always goes directly to aem
    if (/^media_.*\.(png|jpg|jpeg|gif|svg)$/.test(filename)) {
      const resp = await fetch(`http://127.0.0.1:${aemPort}${reqPath}${query}`);
      // body = await resp.text();
      headers = new Map(
        [...resp.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
      );
      res.setHeaders(headers);
      res.status(resp.status);
      res.send(Buffer.from(await resp.arrayBuffer()));
      return;
    }

    // simulate the overlay by attempting to fetch from there first, if it 404s fetch from aem cli
    let resp = await fetch(`http://127.0.0.1:${mfPort}${reqPath}${query}`);
    if (resp.status === 200) {
      // add the head.html to the response, if it appears to be html
      headers = new Map(
        [...resp.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
      );
      const buf = await resp.arrayBuffer();
      if (headers.get('content-type')?.includes('text/html')) {
        const text = new TextDecoder().decode(buf);
        const headBefore = text.split('</head>')[0];
        const bodyHtml = text.split('</head>')[1];
        const resolvedMeta = await resolveMetaHTML(reqPath);
        body = `${headBefore}${resolvedMeta}${HEAD_HTML}${bodyHtml}`;
      } else {
        body = Buffer.from(buf);
      }
    } else if (resp.status === 404) {
      resp = await fetch(`http://127.0.0.1:${aemPort}${reqPath}${query}`);
      body = Buffer.from(await resp.arrayBuffer());
      headers = new Map(
        [...resp.headers.entries()].map(([key, value]) => [key.toLowerCase(), value]),
      );
    }

    headers.delete('content-encoding');
    res.setHeaders(headers);
    res.status(resp.status);
    res.send(body);
  })
  .listen(port, () => {
    console.log(`Reverse proxy running on port ${port}`);
  });
