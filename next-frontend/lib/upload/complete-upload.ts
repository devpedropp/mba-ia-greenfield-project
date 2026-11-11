import type Uppy from "@uppy/core";

import { UnsupportedMultipartOperationError } from "./sign-upload-request";
import { videoIdFromKey } from "./video-id-from-key";

interface CollectedPart {
  partNumber: number;
  ETag: string;
}

/**
 * Collects the parts Uppy reports as uploaded and, once Uppy's own
 * completion attempt is rejected (see `UnsupportedMultipartOperationError`
 * in sign-upload-request.ts), calls this backend's own
 * `POST /videos/:id/complete` with the collected parts — this backend, not
 * Uppy, performs the real S3 `CompleteMultipartUpload`.
 */
export function wireUploadCompletion(uppy: Uppy): void {
  const partsByFileId = new Map<string, CollectedPart[]>();

  uppy.on("s3-multipart:part-uploaded", (file, part) => {
    if (part.PartNumber === undefined || !part.ETag) {
      return;
    }
    const parts = partsByFileId.get(file.id) ?? [];
    parts.push({ partNumber: part.PartNumber, ETag: part.ETag });
    partsByFileId.set(file.id, parts);
  });

  uppy.on("upload-error", async (file, error) => {
    if (
      !file?.s3Multipart ||
      !(error instanceof UnsupportedMultipartOperationError) ||
      error.operation !== "complete"
    ) {
      return;
    }

    const parts = partsByFileId.get(file.id) ?? [];
    partsByFileId.delete(file.id);
    const videoId = videoIdFromKey(file.s3Multipart.key);

    await fetch(`/api/videos/${videoId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadId: file.s3Multipart.uploadId,
        parts,
      }),
    });
  });
}
