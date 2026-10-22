/** Canvas tạo ảnh mới, bỏ EXIF/GPS; hoạt động trên trang thử LAN HTTP. */
export async function prepareBoardImage(file: File): Promise<{ mimeType: string; dataURL: string; width: number; height: number }> {
  if (file.size > 10 * 1024 * 1024) throw new Error("Ảnh đầu vào tối đa 10 MiB.");
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Chỉ nhận ảnh JPEG, PNG hoặc WebP.");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error("Không đọc được ảnh này. Hãy chọn ảnh khác."); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40_000_000) throw new Error("Ảnh có kích thước điểm ảnh quá lớn.");
    const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Không đọc được ảnh này. Hãy chọn ảnh khác.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blobOf = (mime: string, quality?: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, quality));
    let blob = await blobOf("image/png");
    if (blob && blob.size > 2 * 1024 * 1024) {
      ctx.globalCompositeOperation = "destination-over"; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      blob = await blobOf("image/jpeg", 0.9);
    }
    if (!blob || blob.size > 2 * 1024 * 1024) throw new Error("Ảnh quá lớn. Hãy chọn ảnh khác.");
    const dataURL = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Không đọc được ảnh này. Hãy chọn ảnh khác.")); reader.readAsDataURL(blob);
    });
    return { mimeType: blob.type, dataURL, width: canvas.width, height: canvas.height };
  } finally { bitmap.close(); }
}
