// @vitest-environment jsdom
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/server";

/**
 * This exercises the real `signUploadRequest` + `wireUploadCompletion`
 * wiring attached to a real Uppy instance (see create-uppy.ts), driven via
 * the same events `@uppy/aws-s3`'s internal engine emits during a real
 * upload. It does NOT drive that internal engine itself — reproducing it
 * would require a real presigned "ListParts" URL, which this backend does
 * not provide (see `UnsupportedMultipartOperationError` in
 * sign-upload-request.ts). That gap is a separate, flagged finding; this
 * test proves our own glue code reacts correctly to Uppy's event stream.
 */
describe("create-uppy multipart completion wiring (integration)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("collects parts from s3-multipart:part-uploaded and calls POST /videos/:id/complete once Uppy's own completion is rejected", async () => {
    const received: Record<string, unknown>[] = [];
    server.use(
      http.post("/api/videos/video-1/complete", async ({ request }) => {
        received.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: "video-1", status: "processing" });
      }),
    );

    const { default: uppy } = await import("../create-uppy");
    const { UnsupportedMultipartOperationError } = await import(
      "../sign-upload-request"
    );

    const fileId = uppy.addFile({
      name: "sample.mp4",
      type: "video/mp4",
      data: new Blob(["fake video bytes"], { type: "video/mp4" }),
    });
    uppy.setFileState(fileId, {
      s3Multipart: { uploadId: "upload-1", key: "videos/video-1/original.mp4" },
    });
    const file = uppy.getFile(fileId);

    uppy.emit("s3-multipart:part-uploaded", file, {
      PartNumber: 1,
      ETag: "etag-1",
    });
    uppy.emit("s3-multipart:part-uploaded", file, {
      PartNumber: 2,
      ETag: "etag-2",
    });
    uppy.emit(
      "upload-error",
      file,
      new UnsupportedMultipartOperationError("complete"),
    );

    for (let i = 0; i < 20 && received.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      uploadId: "upload-1",
      parts: [
        { partNumber: 1, ETag: "etag-1" },
        { partNumber: 2, ETag: "etag-2" },
      ],
    });
  });
});
