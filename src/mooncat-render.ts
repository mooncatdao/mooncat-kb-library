export type MooncatRenderRow = {
  catId: string;
  rescueOrder: number;
  width: number;
  height: number;
  palette: (string | null)[];
  pixels: string;
};

const CAT_ID_PATTERN = /^0x[0-9a-f]{10}$/;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function escapeSvgText(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        '"': "&quot;",
      })[char] ?? char,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function decodePixels(value: string, expectedCellCount: number) {
  if (!BASE64_PATTERN.test(value)) throw new Error("Render pixels are not valid base64");
  const packed = atob(value);
  const expectedByteCount = Math.ceil(expectedCellCount / 2);
  if (packed.length !== expectedByteCount) throw new Error("Render pixel length is invalid");
  const bytes = Uint8Array.from(packed, (char) => char.charCodeAt(0));
  if (expectedCellCount % 2 && (bytes.at(-1)! & 0x0f) !== 0)
    throw new Error("Render pixel padding nibble is not zero");
  return bytes;
}

function validateRow(value: unknown): MooncatRenderRow {
  if (!isRecord(value)) throw new Error("Render row is not an object");
  const { catId, rescueOrder, width, height, palette, pixels } = value;
  if (
    typeof catId !== "string" ||
    !CAT_ID_PATTERN.test(catId) ||
    typeof rescueOrder !== "number" ||
    !Number.isInteger(rescueOrder) ||
    rescueOrder < 0 ||
    rescueOrder > 25439 ||
    typeof width !== "number" ||
    !Number.isSafeInteger(width) ||
    width < 1 ||
    typeof height !== "number" ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    !Array.isArray(palette) ||
    palette.length < 1 ||
    palette.length > 16 ||
    palette[0] !== null ||
    typeof pixels !== "string"
  ) throw new Error("Render row metadata is invalid");
  const normalizedPalette = palette.map((color, index) => {
    if (index === 0) return null;
    if (typeof color !== "string" || !HEX_COLOR_PATTERN.test(color))
      throw new Error("Render palette contains an invalid color");
    return color.toLowerCase();
  });
  const cellCount = width * height;
  if (!Number.isSafeInteger(cellCount)) throw new Error("Render dimensions are too large");
  decodePixels(pixels, cellCount);
  return {
    catId,
    rescueOrder,
    width,
    height,
    palette: normalizedPalette,
    pixels,
  };
}

export function renderMooncatSvg(value: unknown, label: string) {
  const row = validateRow(value);
  const bytes = decodePixels(row.pixels, row.width * row.height);
  const cellsByColor = new Map<string, string[]>();
  for (let x = 0; x < row.width; x += 1) {
    for (let y = 0; y < row.height; y += 1) {
      const offset = x * row.height + y;
      const packed = bytes[Math.floor(offset / 2)];
      const paletteIndex = offset % 2 === 0 ? packed >> 4 : packed & 0x0f;
      if (paletteIndex >= row.palette.length) throw new Error("Render palette index is out of bounds");
      const color = row.palette[paletteIndex];
      if (color === null) continue;
      const cells = cellsByColor.get(color) ?? [];
      cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
      cellsByColor.set(color, cells);
    }
  }
  const groups = [...cellsByColor.entries()]
    .map(([color, cells]) => `<g fill="${color}">${cells.join("")}</g>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${row.width} ${row.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeSvgText(label)}" shape-rendering="crispEdges" width="${row.width}" height="${row.height}">${groups}</svg>`;
}
