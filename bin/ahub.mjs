#!/usr/bin/env node

import { main } from "../src/cli.mjs";

main(process.argv.slice(2)).catch((error) => {
  console.error(`ahub: ${error.message}`);
  if (process.env.AHUB_DEBUG) console.error(error.stack);
  process.exitCode = 1;
});
