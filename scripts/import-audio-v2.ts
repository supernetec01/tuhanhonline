import { parseArgs } from 'node:util';
import { resolve, sep } from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connectDb, migrate } from '../server/db.js';
import { CmsService } from '../server/cms.js';
import { MediaService } from '../server/media.js';
import { v2FileCues, audioMixSchema } from '../server/audio-config.js';
const { values } = parseArgs({
  options: {
    directory: { type: 'string' },
    manifest: { type: 'string', default: 'docs/audio/thien-tinh-v2/audio-manifest.json' },
    actor: { type: 'string' },
  },
});
if (!values.directory)
  throw new Error(
    'Usage: node --env-file-if-exists=.env --import tsx scripts/import-audio-v2.ts --directory /path/to/extracted-pack [--actor admin_username]',
  );
const directory = await realpath(values.directory),
  manifest = JSON.parse(await readFile(values.manifest!, 'utf8'));
const names = Object.keys(v2FileCues);
if (
  manifest.version !== '2.0' ||
  manifest.files?.length !== 14 ||
  new Set(manifest.files.map((f: { name: string }) => f.name)).size !== 14 ||
  names.some((name) => !manifest.files.some((f: { name: string }) => f.name === name))
)
  throw new Error('Manifest must contain all 14 named V2 files exactly once.');
const volumes = audioMixSchema.parse({ volumes: manifest.recommendedVolume }).volumes;
const run = promisify(execFile),
  files: { name: string; kind: 'music' | 'sfx'; data: string }[] = [];
// Validate the whole pack before creating any versions or changing the configuration draft.
for (const entry of manifest.files) {
  if (typeof entry.path !== 'string') throw new Error('Invalid asset path.');
  const path = await realpath(resolve(directory, entry.path));
  if (!path.startsWith(directory + sep)) throw new Error('Asset escapes pack directory.');
  const info = await stat(path);
  if (!info.isFile() || info.size > 2500000) throw new Error('Invalid size or type: ' + entry.name);
  const bytes = await readFile(path);
  if (bytes.subarray(0, 4).toString() !== 'OggS') throw new Error('Expected OGG: ' + entry.name);
  const metadata = JSON.parse(
    (
      await run(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration:stream=codec_name,codec_type',
          '-of',
          'json',
          path,
        ],
        { timeout: 10000, maxBuffer: 16384 },
      )
    ).stdout,
  );
  const duration = Number(metadata.format?.duration),
    cue = v2FileCues[entry.name],
    loop = cue === 'background' || cue === 'waitingBackground';
  if (
    entry.role !== (loop ? 'loop' : 'effect') ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > (loop ? 600 : 60) ||
    metadata.streams?.length !== 1 ||
    metadata.streams[0].codec_type !== 'audio' ||
    metadata.streams[0].codec_name !== 'opus'
  )
    throw new Error('Invalid Opus audio/role/duration: ' + entry.name);
  files.push({ name: entry.name, kind: loop ? 'music' : 'sfx', data: bytes.toString('base64') });
}
const pool = connectDb();
try {
  await migrate(pool);
  const actors = (
    await pool.query(
      "SELECT id FROM users WHERE role='ADMIN' AND NOT banned AND ($1::text IS NULL OR username=$1)",
      [values.actor ?? null],
    )
  ).rows;
  if (actors.length !== 1)
    throw new Error(
      'Select one existing ADMIN with --actor username. No account is created or promoted.',
    );
  const actor = actors[0].id,
    media = new MediaService(pool),
    mapping: Record<string, string> = {};
  for (const file of files) {
    const asset = await media.upload(actor, file.kind, file.name, file.data);
    mapping[v2FileCues[file.name]] = asset.id;
  }
  const cms = new CmsService(pool),
    state = await cms.state(),
    source = state.draft ?? state.published;
  const draft = await cms.save(
    actor,
    {
      ...source.config,
      audio: { ...source.config.audio, ...mapping },
      audioMix: { ...source.config.audioMix, volumes, duckFactor: 0.25, crossfadeSeconds: 2 },
    },
    state.draft?.id ?? null,
  );
  console.log(
    JSON.stringify({
      status: 'draft-saved',
      revision: draft.id,
      files: files.length,
      note: 'Review and audition the draft in Admin, then publish. Existing bindings remain published until then.',
    }),
  );
} finally {
  await pool.end();
}
