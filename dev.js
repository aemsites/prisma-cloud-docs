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

/**
 * @typedef {import('child_process').ChildProcess} ChildProcess
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const headHtml = fs.readFileSync(path.resolve(__dirname, 'head.html'), 'utf8');

const port = process.env.PORT || 3000;

// port used for the aem content
const aemPort = process.env.AEM_PORT || 3001;

// port used for miniflare dev server, ie. the doc worker origin
const mfPort = process.env.MF_PORT || 3002;

configEnv({ path: path.resolve(__dirname, '.env.dev') });
process.env.NODE_ENV = 'development';

express()
  .use('*', async (req, res) => {
    // simulate the overlay by attempting to fetch from there first, if it 404s fetch from aem cli
    let resp = await fetch(`http://localhost:${mfPort}${req.url}`);
    if (resp.status === 200) {
      // add the head.html to the response
      const text = await resp.text();
      const head = text.split('</head>')[0];
      const body = text.split('</head>')[1];
      resp.text = async () => `${head}${headHtml}${body}`;
    } else if (resp.status === 404) {
      resp = await fetch(`http://localhost:${aemPort}${req.url}`);
    }
    res.setHeaders(Object.fromEntries(resp.headers.entries()));
    res.status(resp.status);
    res.send(await resp.text());
  })
  .listen(port, () => {
    console.log(`Reverse proxy running on port ${port}`);
  });
