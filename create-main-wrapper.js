#!/usr/bin/env node

// Create the wrapper main.js file in dist-electron root
const fs = require("fs");
const path = require("path");

const wrapperCode = `// Wrapper to load the actual main module
module.exports = require("./main/main.js");
`;

const wrapperPath = path.join(__dirname, "dist-electron", "main.js");
fs.writeFileSync(wrapperPath, wrapperCode);
console.log(`✓ Created ${wrapperPath}`);
