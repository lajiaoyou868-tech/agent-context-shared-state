import { resolve } from 'node:path';

export function parseOptions(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--db', '--input'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || args[i] in options) {
      throw new Error('INVALID_OPTIONS');
    }
    options[args[i]] = args[i + 1];
  }
  return {
    dbPath: resolve(options['--db'] ?? process.env.SHARED_STATE_DB ?? 'project-control/state.db'),
    inputPath: options['--input'] ? resolve(options['--input']) : undefined,
  };
}
