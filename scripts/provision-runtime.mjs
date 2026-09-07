import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const [version, source, expected] = process.argv.slice(2);
if (
  !/^(3\.[5678]|4\.[012])$/.test(version ?? "") ||
  !source ||
  !/^[a-f0-9]{64}$/i.test(expected ?? "")
)
  throw new Error(
    "Usage: npm run runtime:add -- 4.2 /reviewed/spine-4_2.js EXPECTED_SHA256",
  );
const bytes = await readFile(resolve(source));
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== expected.toLowerCase())
  throw new Error("Runtime checksum mismatch.");
const folder = new URL("../public/runtimes/", import.meta.url);
await mkdir(folder, { recursive: true });
const file = `spine-${version.replace(".", "_")}.js`;
let manifest = [];
try {
  manifest = JSON.parse(
    await readFile(new URL("manifest.json", folder), "utf8"),
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await copyFile(resolve(source), new URL(file, folder));
await writeFile(
  new URL("manifest.json", folder),
  JSON.stringify(
    [
      ...manifest.filter((e) => e.version !== version),
      { version, file, sha256, global: `spine_${version.replace(".", "_")}` },
    ],
    null,
    2,
  ),
);
console.log(
  `Provisioned ${version}; ensure provenance and Spine licensing are reviewed before distribution.`,
);
