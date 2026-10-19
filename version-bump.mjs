// Bump the plugin version to match package.json and update versions.json.
// Usage: `npm version patch|minor|major` (or set package.json version) then
// `node version-bump.mjs`.
import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// Update manifest.json version.
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// Update versions.json.
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));

console.log(`Bumped to ${targetVersion} (minAppVersion ${minAppVersion})`);
