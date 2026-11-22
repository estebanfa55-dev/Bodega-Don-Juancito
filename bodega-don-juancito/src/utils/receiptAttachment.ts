export const RECEIPT_ATTACHMENT_REGEX =
  /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,[A-Za-z0-9+/=]+$/;
export const RECEIPT_ATTACHMENT_MAX_LENGTH = 550000;

const MAX_RAW_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_RAW_PDF_BYTES = 380 * 1024;
const TARGET_MAX_DIMENSION = 1100;
const TARGET_DATA_URL_LIMIT = 450000;

export type ReceiptAttachmentMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';

export interface ProcessedReceiptAttachment {
  dataUrl: string;
  fileName: string;
  mimeType: ReceiptAttachmentMime;
}

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
      reject(new Error('No se pudo leer la imagen de la boleta.'));
    };
    img.src = objectUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('No se pudo leer el archivo seleccionado.'));
      }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
    reader.readAsDataURL(file);
  });
}

export async function processSupplierReceiptFile(
  file: File
): Promise<ProcessedReceiptAttachment> {
  if (!file) {
    throw new Error('No se seleccionó ningún archivo.');
  }

  const cleanName = (file.name || 'boleta').trim().slice(0, 120) || 'boleta';
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(cleanName);

  if (isPdf) {
    if (file.size > MAX_RAW_PDF_BYTES) {
      throw new Error(
        'El PDF supera los 380 KB. Tómale una foto o captura de pantalla a la boleta para guardarla.'
      );
    }
    const rawDataUrl = await readFileAsDataUrl(file);
    const normalized = rawDataUrl.replace(/^data:application\/pdf[^,]*,/, 'data:application/pdf;base64,');
    if (
      normalized.length > RECEIPT_ATTACHMENT_MAX_LENGTH ||
      !RECEIPT_ATTACHMENT_REGEX.test(normalized)
    ) {
      throw new Error('El archivo PDF no tiene un formato válido o es demasiado pesado.');
    }
    return {
      dataUrl: normalized,
      fileName: cleanName,
      mimeType: 'application/pdf',
    };
  }

  const looksLikeImage =
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(cleanName);

  if (!looksLikeImage) {
    throw new Error('Adjunta una foto/imagen (JPG, PNG, WEBP) o un archivo PDF de la boleta.');
  }

  if (file.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error('La foto pesa demasiado (máx. 20 MB).');
  }

  const img = await loadImageFromFile(file);
  const srcWidth = img.naturalWidth || img.width;
  const srcHeight = img.naturalHeight || img.height;

  if (!srcWidth || !srcHeight) {
    throw new Error('La imagen no tiene dimensiones válidas.');
  }

  const renderAtMaxSide = (
    maxSide: number,
    attempts: Array<[ReceiptAttachmentMime, number | undefined]>
  ): ProcessedReceiptAttachment | null => {
    const scale = Math.min(1, maxSide / Math.max(srcWidth, srcHeight));
    const width = Math.max(1, Math.round(srcWidth * scale));
    const height = Math.max(1, Math.round(srcHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    for (const [mime, quality] of attempts) {
      const dataUrl =
        typeof quality === 'number' ? canvas.toDataURL(mime, quality) : canvas.toDataURL(mime);
      if (
        dataUrl.startsWith(`data:${mime};base64,`) &&
        dataUrl.length <= TARGET_DATA_URL_LIMIT &&
        RECEIPT_ATTACHMENT_REGEX.test(dataUrl)
      ) {
        return {
          dataUrl,
          fileName: cleanName,
          mimeType: mime,
        };
      }
    }
    return null;
  };

  const firstPass = renderAtMaxSide(TARGET_MAX_DIMENSION, [
    ['image/webp', 0.88],
    ['image/jpeg', 0.86],
    ['image/webp', 0.76],
    ['image/jpeg', 0.74],
    ['image/jpeg', 0.6],
  ]);
  if (firstPass) return firstPass;

  const fallbackPass = renderAtMaxSide(760, [
    ['image/jpeg', 0.72],
    ['image/jpeg', 0.56],
  ]);
  if (fallbackPass) return fallbackPass;

  throw new Error('No se pudo comprimir la foto de la boleta. Intenta tomar una foto más cercana.');
}
