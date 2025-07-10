#!/usr/bin/node
/* eslint-disable no-underscore-dangle,
                  newline-per-chained-call,
                  import/no-extraneous-dependencies,
                  no-await-in-loop */
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
const CHUNK_SIZE = 40;

/**
 *
 * @param {(string|{path:string; preview?:number; publish?:number; error?:string;})[]} paths
 * @param {string} error
 * @param {number} preview
 * @param {number} publish
 * @returns {{path:string; preview?:number; publish?:number; error?:string;}[]}
 */
const arrToResults = (paths, error, preview = 500, publish = 500) => paths.map((d) => ({
  preview,
  publish,
  error,
  ...(typeof d === 'string' ? { path: d } : d),
}));

const pollJob = async (link) => {
  let body;
  let state;
  while (!state || state !== 'stopped') {
    const resp = await fetch(link);
    body = await resp.json();
    state = body.state;
    // eslint-disable-next-line no-promise-executor-return
    await new Promise((r) => setTimeout(r, 1000));
  }
  return body.links.details;
};

/**
 * Bulk preview and publish an array of paths.
 * @param {string[]} paths
 * @param {boolean} [previewOnly=false]
 */
async function publishDocs(paths, previewOnly = false) {
  let resources = paths;
  try {
    const previewResp = await fetch(API_URL('preview', '/*'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paths }),
    });
    const previewStatus = previewResp.status;
    if (!previewResp.ok) {
      return arrToResults(paths, previewResp.headers.get('x-error'), previewStatus);
    }

    // wait for job to complete
    let body = await previewResp.json();
    let { self: link } = body.links;
    if (!link) {
      return arrToResults(paths, 'No link in response', previewStatus);
    }
    let detailsLink = await pollJob(link);
    if (!detailsLink) {
      return arrToResults(paths, 'No details link in response', previewStatus);
    }

    let detailsResp = await fetch(detailsLink);
    let detailsBody = await detailsResp.json();
    resources = detailsBody.data.resources.map(
      (r) => JSON.parse(JSON.stringify({
        path: r.path,
        preview: r.status,
        error: r.error,
        errorCode: r.errorCode,
      })),
    );

    // filter paths to only include successful previews and non-examples
    const statusMap = resources.reduce((acc, r) => {
      acc[r.path] = r.preview;
      return acc;
    }, {});

    const filterFn = (path) => {
      const status = statusMap[path];
      return !previewOnly && status < 300 && !path.startsWith('/examples/');
    };
    const filteredPaths = paths.filter(filterFn);
    const publishResp = await fetch(API_URL('live', '/*'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ paths: filteredPaths }),
    });
    const publishStatus = publishResp.status;
    if (!publishResp.ok) {
      return arrToResults(resources, publishResp.headers.get('x-error'), undefined, publishStatus);
    }

    // wait for job to complete
    body = await publishResp.json();
    ({ self: link } = body.links);
    if (!link) {
      return arrToResults(resources, 'No link in response', undefined, publishStatus);
    }
    detailsLink = await pollJob(link);
    if (!detailsLink) {
      return arrToResults(paths, 'No details link in publish job response', undefined, publishStatus);
    }

    detailsResp = await fetch(detailsLink);
    detailsBody = await detailsResp.json();

    // combine preview and publish results
    const resultMap = resources.reduce((acc, r) => {
      acc[r.path] = r;
      return acc;
    }, {});
    detailsBody.data.resources.forEach((r) => {
      const resultEntry = resultMap[r.path] ?? {};
      resultMap[r.path] = JSON.parse(JSON.stringify({
        ...resultEntry,
        publish: r.status,
        error: r.error ?? resultEntry.error,
        errorCode: r.errorCode ?? resultEntry.errorCode,
      }));
    });
    resources = Object.values(resultMap);

    return arrToResults(resources);
  } catch (e) {
    return arrToResults(resources, e.message, 500, 500);
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
  let index = paths.indexOf('-f');
  if (index < 0) {
    index = paths.indexOf('--file');
  }
  if (index >= 0) {
    const data = fs.readFileSync(paths[index + 1]);
    const text = data.toString('utf8');
    paths = text.split(/\s+/);
  }

  index = paths.indexOf('-p');
  if (index < 0) {
    index = paths.indexOf('--preview');
  }
  const previewOnly = index >= 0;

  paths = paths.filter(isDocPath).map(cleanPath);
  const { length } = paths;

  // progress indicator
  process.stdout.write(`0/${length} (0.00%) paths processed`);
  const interval = setInterval(() => {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`${length - paths.length}/${length} (${(((length - paths.length) / length) * 100).toFixed(2)}%) paths processed`);
  }, 1000);

  const results = [];
  while (paths.length > 0) {
    const chunk = paths.splice(0, CHUNK_SIZE);
    const result = await publishDocs(chunk, previewOnly);
    results.push(...result);
  }
  clearInterval(interval);
  process.stdout.write('\n');
  return results;
}

batchPublish(process.argv.slice(2))
  .then((results) => console.info(
    JSON.stringify(results, undefined, 2),
    `\npreviewed ${results.filter((r) => r.preview < 300).length}/${results.length} resources`,
    `\npublished ${results.filter((r) => r.publish < 300).length}/${results.length} resources`,
  ))
  .catch(console.error);
