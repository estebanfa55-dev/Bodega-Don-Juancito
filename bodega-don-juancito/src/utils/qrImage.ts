export const YAPE_QR_DATA_URL_REGEX = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
export const YAPE_QR_MAX_LENGTH = 500000;

const MAX_RAW_FILE_BYTES = 20 * 1024 * 1024;
const TARGET_MAX_DIMENSION = 720;
const PREFERRED_PNG_LIMIT = 240000;
const TARGET_DATA_URL_LIMIT = 360000;

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('No se pudo leer la imagen seleccionada.'));
    };
    img.src = objectUrl;
  });
}

export async function processYapeQrImageFile(file: File): Promise<string> {
  if (!file) {
    throw new Error('No se seleccionó ningún archivo.');
  }

  const looksLikeImage =
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.name);

  if (!looksLikeImage) {
    throw new Error('Selecciona una imagen válida (JPG, PNG o WEBP) con tu QR de Yape.');
  }

  if (file.size > MAX_RAW_FILE_BYTES) {
    throw new Error('La imagen pesa demasiado (máx. 20 MB).');
  }

  const img = await loadImageFromFile(file);
  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;

  if (!srcWidth || !srcHeight) {
    throw new Error('La imagen no tiene dimensiones válidas.');
  }

  const scale = Math.min(1, TARGET_MAX_DIMENSION / Math.max(srcWidth, srcHeight));
  const width = Math.max(1, Math.round(srcWidth * scale));
  const height = Math.max(1, Math.round(srcHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Tu navegador no pudo procesar la imagen.');
  }

  // Ensure crisp white background for QR codes with transparency
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);

  // Try lossless PNG first if compact enough
  const pngUrl = canvas.toDataURL('image/png');
  if (pngUrl.length <= PREFERRED_PNG_LIMIT && YAPE_QR_DATA_URL_REGEX.test(pngUrl)) {
    return pngUrl;
  }

  // Otherwise try high-quality WebP then JPEG at decreasing quality
  const candidates: Array<[string, number]> = [
    ['image/webp', 0.9],
    ['image/webp', 0.8],
    ['image/jpeg', 0.88],
    ['image/jpeg', 0.78],
    ['image/jpeg', 0.65],
    ['image/jpeg', 0.5],
  ];

  for (const [mime, quality] of candidates) {
    const dataUrl = canvas.toDataURL(mime, quality);
    if (
      dataUrl.startsWith(`data:${mime};base64,`) &&
      dataUrl.length <= TARGET_DATA_URL_LIMIT &&
      YAPE_QR_DATA_URL_REGEX.test(dataUrl)
    ) {
      return dataUrl;
    }
  }

  // Last resort: resize down to 480px JPEG
  const fallbackScale = Math.min(1, 480 / Math.max(srcWidth, srcHeight));
  canvas.width = Math.max(1, Math.round(srcWidth * fallbackScale));
  canvas.height = Math.max(1, Math.round(srcHeight * fallbackScale));
  const ctx2 = canvas.getContext('2d');
  if (ctx2) {
    ctx2.fillStyle = '#ffffff';
    ctx2.fillRect(0, 0, canvas.width, canvas.height);
    ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
    const fallbackUrl = canvas.toDataURL('image/jpeg', 0.65);
    if (fallbackUrl.length <= YAPE_QR_MAX_LENGTH && YAPE_QR_DATA_URL_REGEX.test(fallbackUrl)) {
      return fallbackUrl;
    }
  }

  throw new Error('No se pudo comprimir la imagen del QR. Prueba recortando solo el código QR.');
}
