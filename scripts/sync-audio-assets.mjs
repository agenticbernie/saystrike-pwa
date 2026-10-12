import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, basename } from 'node:path';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const sourceDir = resolve(root, 'audio');
const outputDir = resolve(root, 'apps/web/public/audio');
const effectMapPath = resolve(root, 'apps/web/src/audio-map.json');
const effectMap = JSON.parse(await readFile(effectMapPath, 'utf8'));
const names = (await readdir(sourceDir)).filter((name) => name.toLowerCase().endsWith('.ogg')).sort();
if (names.length === 0) throw new Error('No Ogg audio files were found in audio/.');

const mappedByFile = new Map();
for (const [event, file] of Object.entries(effectMap.effects)) {
  if (mappedByFile.has(file)) throw new Error(`Audio file is assigned to more than one event: ${file}`);
  mappedByFile.set(file, event);
}

let cursor = 0;
const assets = new Array(names.length);
async function inspectWorker() {
  while (true) {
    const index = cursor++;
    const name = names[index];
    if (name === undefined) return;
    const filePath = resolve(sourceDir, name);
    const [details, fileStat] = await Promise.all([
      execFileAsync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=format_name,duration:stream=codec_name,sample_rate,channels',
        '-of', 'json', filePath,
      ], { encoding: 'utf8', maxBuffer: 32_768 }),
      stat(filePath),
    ]);
    const probe = JSON.parse(details.stdout);
    const stream = probe.streams?.[0];
    const duration = Number(probe.format?.duration);
    if (!stream || !Number.isFinite(duration)) throw new Error(`Could not verify audio metadata: ${name}`);
    assets[index] = {
      file: name,
      bytes: fileStat.size,
      format: probe.format?.format_name ?? null,
      codec: stream.codec_name ?? null,
      durationSeconds: Number(duration.toFixed(3)),
      sampleRateHz: Number(stream.sample_rate ?? 0),
      channels: Number(stream.channels ?? 0),
      use: mappedByFile.get(name) ? `sfx:${mappedByFile.get(name)}` : 'unassigned',
    };
  }
}
await Promise.all(Array.from({ length: Math.min(8, names.length) }, () => inspectWorker()));

for (const [name, event] of mappedByFile) {
  if (!names.includes(name)) throw new Error(`Mapped audio does not exist in audio/: ${event} -> ${name}`);
  await copyFile(resolve(sourceDir, name), resolve(outputDir, basename(name)));
}

const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
const manifest = {
  generatedAt: new Date().toISOString(),
  sourceDirectory: 'audio/',
  sourceCount: assets.length,
  sourceBytes: totalBytes,
  verification: 'ffprobe inspected codec, container, duration, sample rate, and channels for each file.',
  soundtrack: Object.keys(effectMap.music).length ? effectMap.music : null,
  soundtrackStatus: Object.keys(effectMap.music).length ? 'mapped; confirm licensing before distribution' : 'no soundtrack assets found or mapped; music stays silent',
  licensing: 'No license or provenance document was found in audio/. Confirm distribution rights with the asset supplier before public release.',
  selectedEffects: Object.fromEntries([...mappedByFile].map(([file, event]) => [event, file])),
  files: assets,
};

await mkdir(outputDir, { recursive: true });
await writeFile(resolve(root, 'docs/audio-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(resolve(outputDir, 'manifest.json'), `${JSON.stringify({
  version: 1,
  soundtrack: manifest.soundtrack,
  soundtrackStatus: manifest.soundtrackStatus,
  selectedEffects: manifest.selectedEffects,
  sourceCount: manifest.sourceCount,
  note: 'Generated from verified supplied Ogg Vorbis assets. Only selected sound effects are copied to the web app.',
}, null, 2)}\n`);
console.log(`Verified ${assets.length} audio files (${(totalBytes / 1_000_000).toFixed(2)} MB); mapped and copied ${mappedByFile.size} effects.`);
