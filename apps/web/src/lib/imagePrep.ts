/**
 * Chuẩn bị ảnh bài làm trước khi gửi: vẽ lại qua canvas (trình duyệt tự xoay theo EXIF), thu nhỏ cạnh dài
 * còn tối đa 2000 px, xuất JPEG. Ảnh mới không còn EXIF/GPS; API vẫn gỡ metadata lần nữa.
 */
const MAX_SIDE = 2000;

export async function prepareImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Không đọc được ảnh này. Hãy chọn ảnh JPEG, PNG hoặc WebP.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Không đọc được ảnh này. Hãy chọn ảnh JPEG, PNG hoặc WebP.");
  return blob;
}
