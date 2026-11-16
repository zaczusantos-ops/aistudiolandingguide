import { atlasTransferables, deriveRealNasaAtlas, type DecodedImagePixels } from './lunarTerrainEngine';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ urls: string[] }>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

async function decodeImage(url: string): Promise<DecodedImagePixels> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load NASA lunar asset: ${url}`);
  const bitmap = await createImageBitmap(await response.blob());
  let canvas: OffscreenCanvas | undefined;
  try {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(`Could not allocate 2D canvas context for ${url}`);
    ctx.drawImage(bitmap, 0, 0);
    const { width, height, data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width, height, data };
  } finally {
    bitmap.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}

scope.onmessage = async (event) => {
  try {
    const [albedo, globalDem, polarDem] = await Promise.all(event.data.urls.map(decodeImage));
    const atlas = deriveRealNasaAtlas(albedo, globalDem, polarDem);
    scope.postMessage({ atlas }, atlasTransferables(atlas));
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
