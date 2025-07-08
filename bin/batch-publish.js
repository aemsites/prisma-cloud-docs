#!/usr/bin/node
/* eslint-disable no-underscore-dangle,
                  newline-per-chained-call,
                  import/no-extraneous-dependencies */
import processQueue from '@adobe/helix-shared-process-queue';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { resolve, dirname, relative } from 'path';
import normalizePath from '../tools/normalize-path.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const OWNER = 'aemsites';
const REPO = 'prisma-cloud-docs';
const PATH_PREFIX = '';
const REPO_ROOT = resolve(__dirname, '..');
const ADMIN_API = process.env.ADMIN_API ?? 'https://admin.hlx.page';
const API_URL = (api, path) => `${ADMIN_API}/${api}/${OWNER}/${REPO}/main${path}`;

/**
 * This actually previews then publishes the resource,
 * since publish promotes the content in preview.
 * @param {string} path
 */
async function publishDoc(path) {
  try {
    const { status: preview } = await fetch(API_URL('preview', path), { method: 'POST' });
    if (preview === 429) {
      // throttle a bit
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (preview > 399 || path.startsWith('/examples/')) {
    // don't publish examples, missing, broken docs
      return { path, preview };
    }

    const { status: publish } = await fetch(API_URL('live', path), { method: 'POST' });
    return { path, preview, publish };
  } catch (e) {
    return {
      path,
      preview: 500,
      publish: 500,
      error: e.message,
    };
  }
}

function isDocPath(path) {
  if (!path) {
    return false;
  }

  const absPath = resolve(REPO_ROOT, path);
  const relPath = relative(REPO_ROOT, absPath);

  if (!relPath.startsWith('docs/') || relPath.startsWith('docs/api/') || relPath.startsWith('docs/.') || relPath.startsWith('docs/sitemaps')) {
    return false;
  }

  // if (!relPath.endsWith('.adoc')) { // only adocs
  // if (!relPath.endsWith('.yml')) { // only books
  if (!relPath.endsWith('.yml') && !relPath.endsWith('.adoc')) { // both
    return false;
  }

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) {
    return false;
  }
  return true;
}

function cleanPath(ppath) {
  let path = ppath;
  if (path.startsWith('.')) {
    path = path.substring(1);
  }
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }

  if (path.startsWith('/docs/')) {
    // remove docs prefix, worker remaps the path to the correct folder
    path = path.substring('/docs'.length);
  }

  if (path.endsWith('.yml')) {
    path = path.replace(/.yml$/, '.json');
  } else if (path.endsWith('.adoc')) {
    path = path.replace(/.adoc$/, '');
  }

  path = `${PATH_PREFIX}${normalizePath(path)}`;
  return path;
}

async function batchPublish(ppaths) {
  let paths = ppaths;

  // get file as array, whitespace delimited
  if (paths[0] === '-f' || paths[0] === '--file') {
    const data = fs.readFileSync(paths[1]);
    const text = data.toString('utf8');
    paths = text.split(/\s+/);
  }

  paths = paths.filter(isDocPath).map(cleanPath);
  const { length } = paths;
  process.stdout.write(`0/${length} (0.00%) paths processed`);
  const interval = setInterval(() => {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`${length - paths.length}/${length} (${(((length - paths.length) / length) * 100).toFixed(2)}%) paths processed`);
  }, 1000);
  const results = await processQueue(paths, publishDoc, 3);
  clearInterval(interval);
  process.stdout.write('\n');
  return results;
}

batchPublish(process.argv.slice(2))
  .then((results) => console.info(JSON.stringify(results, undefined, 2), `published ${results.length} docs`))
  .catch(console.error);
