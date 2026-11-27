export const PREVIEW_PNG_FILENAME = "voltonaut-garage.png";

export function downloadPreviewPng(blob: Readonly<Blob>): void {
  if (blob.type !== "image/png") throw new Error("Preview download must be a PNG");

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = PREVIEW_PNG_FILENAME;
  document.body.append(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }
}
