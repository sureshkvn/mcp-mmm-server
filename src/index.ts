import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseLevel } from './levels/index.js';
import { createServer } from './server.js';

// Level comes from --level N or MMM_LEVEL (default 4). Logs go to stderr: stdout is the protocol.
const argIndex = process.argv.indexOf('--level');
const levelId = parseLevel(argIndex >= 0 ? process.argv[argIndex + 1] : process.env.MMM_LEVEL);

const { server, level } = createServer(levelId);
await server.connect(new StdioServerTransport());
console.error(`[mmm] serving ${level.name} over stdio`);
