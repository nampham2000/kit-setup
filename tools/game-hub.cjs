#!/usr/bin/env node
'use strict';

const { main } = require('./game-hub/game-hub-cli.cjs');
process.exitCode = main();
