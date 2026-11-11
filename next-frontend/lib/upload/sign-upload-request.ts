import { videoIdFromKey } from "./video-id-from-key";

export interface SignUploadRequestParams {
  method: string;
  key: string;
  uploadId?: string;
  partNumber?: number;
}

export interface SignUploadRequestResult {
  url: string;
  headers?: Record<string, string>;
}

/**
 * This backend always creates the multipart upload (and its `uploadId`/`key`)
 * upfront via `POST /videos`, and owns `CompleteMultipartUpload` itself via
 * `POST /videos/:id/complete` (see `complete-upload.ts`) — never the client.
 * Only "sign one part" is implemented here; every other S3 multipart
 * operation Uppy's signRequest mode could ask for is deliberately rejected
 * rather than silently mis-signed.
 */
export class UnsupportedMultipartOperationError extends Error {
  constructor(public readonly operation: "create" | "list" | "complete" | "abort") {
    super(
      `signUploadRequest does not support the "${operation}" multipart operation — only part-signing is implemented.`,
    );
    this.name = "UnsupportedMultipartOperationError";
  }
}

export async function signUploadRequest(
  params: SignUploadRequestParams,
): Promise<SignUploadRequestResult> {
  if (params.partNumber === undefined) {
    if (params.method === "GET") {
      throw new UnsupportedMultipartOperationError("list");
    }
    if (params.method === "POST" && params.uploadId) {
      throw new UnsupportedMultipartOperationError("complete");
    }
    if (params.method === "DELETE") {
      throw new UnsupportedMultipartOperationError("abort");
    }
    throw new UnsupportedMultipartOperationError("create");
  }

  const videoId = videoIdFromKey(params.key);

  const response = await fetch(`/api/videos/${videoId}/parts/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: params.method,
      uploadId: params.uploadId,
      partNumber: params.partNumber,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to sign upload request (status ${response.status})`,
    );
  }

  return response.json();
}
