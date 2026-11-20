/**
 * Optional CI source-format probe. This is intentionally not in the normal
 * product build: the shipped game must not depend on Hugging Face uptime.
 * It inspects only the JSON chunk of the requested binary GLBs.
 */
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/game/cmu-mocap-pilot.ts", import.meta.url), "utf8");
const files = [...source.matchAll(/file: "([^"]+)"/g)].map((match) => match[1]);
if (files.length !== 3) throw new Error("CMU clip manifest changed unexpectedly");

function unpackGLB(buffer) {
  const data = new DataView(buffer);
  if (buffer.byteLength < 20 || data.getUint32(0, true) !== 0x46546c67 || data.getUint32(4, true) !== 2) {
    throw new Error("Not a valid glTF 2.0 GLB");
  }
  let cursor = 12;
  while (cursor + 8 <= buffer.byteLength) {
    const length = data.getUint32(cursor, true);
    const type = data.getUint32(cursor + 4, true);
    cursor += 8;
    if (cursor + length > buffer.byteLength) throw new Error("Truncated GLB chunk");
    if (type === 0x4e4f534a) {
      return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, cursor, length)).replace(/\u0000+$/, ""));
    }
    cursor += length;
  }
  throw new Error("Missing glTF JSON chunk");
}

let failed = 0;
for (const file of files) {
  const url = `https://huggingface.co/datasets/codepawl/cmu-mocap-glb/resolve/main/skeleton/${file}/${file}_skeleton.glb`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const gltf = unpackGLB(bytes);
    const targets = (gltf.animations ?? []).flatMap((animation) =>
      (animation.channels ?? []).map((channel) => channel.target?.node));
    const names = [...new Set(targets.filter((id) => Number.isInteger(id))
      .map((id) => gltf.nodes?.[id]?.name ?? `unnamed_${id}`))];
    if (names.length < 6) throw new Error(`Only ${names.length} animated joints found`);
    console.log(JSON.stringify({
      file, downloadedBytes: bytes.byteLength,
      animations: gltf.animations?.length ?? 0,
      animatedJointCount: names.length,
      animatedJointNames: names,
    }));
  } catch (error) {
    failed++;
    console.error(`CMU probe failed for ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (failed) process.exitCode = 1;
