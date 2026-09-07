const supported = new Set([
  "3.5",
  "3.6",
  "3.7",
  "3.8",
  "4.0",
  "4.1",
  "4.2",
  "4.3",
]);
export function runtimeKey(version: string): string {
  const match = /^(\d+)\.(\d+)\.\d+(?:[-+][\w.]+)?$/.exec(version);
  if (!match)
    throw new Error(
      "Missing or malformed Spine version; re-export with version metadata.",
    );
  const key = `${match[1]}.${match[2]}`;
  if (!supported.has(key))
    throw new Error(
      `Spine ${version} is unsupported. A reviewed, exact-version runtime adapter is required.`,
    );
  return key;
}
export function jsonVersion(text: string): string {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== "object" || !("skeleton" in data))
    throw new Error("Not a Spine skeleton JSON.");
  const skeleton = data.skeleton;
  if (
    !skeleton ||
    typeof skeleton !== "object" ||
    !("spine" in skeleton) ||
    typeof skeleton.spine !== "string"
  )
    throw new Error("Missing skeleton.spine version.");
  return skeleton.spine;
}
export function binaryVersion(bytes: Uint8Array): string {
  // 3.x hash is a length-prefixed string; modern 4.x hash is two int32 values.
  const readString = (start: number): [string, number] => {
    let offset = start,
      length = 0,
      shift = 0;
    for (let i = 0; i < 5; i++) {
      const byte = bytes[offset++];
      if (byte === undefined) throw new Error("Truncated SKEL header.");
      length += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) {
        if (length === 0) return ["", offset];
        if (length > 1024 || offset + length - 1 > bytes.length)
          throw new Error("Invalid SKEL header length.");
        return [
          new TextDecoder("utf-8", { fatal: true }).decode(
            bytes.subarray(offset, offset + length - 1),
          ),
          offset + length - 1,
        ];
      }
      shift += 7;
    }
    throw new Error("Invalid SKEL varint.");
  };
  const candidates: string[] = [];
  try {
    const [, end] = readString(0);
    const [v] = readString(end);
    if (/^3\.\d+\.\d+(?:[-+][\w.]+)?$/.test(v)) candidates.push(v);
  } catch {
    /* Try the documented modern header layout. */
  }
  try {
    const [v] = readString(8);
    if (/^4\.\d+\.\d+(?:[-+][\w.]+)?$/.test(v)) candidates.push(v);
  } catch {
    /* Fail closed below. */
  }
  if (candidates.length !== 1)
    throw new Error(
      "Unsupported or ambiguous SKEL header; no byte scanning or runtime guessing is performed.",
    );
  return candidates[0]!;
}
