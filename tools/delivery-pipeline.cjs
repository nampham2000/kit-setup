#!/usr/bin/env node
'use strict';

const { main } = require('./delivery-pipeline/delivery-cli.cjs');
process.exitCode = main();
