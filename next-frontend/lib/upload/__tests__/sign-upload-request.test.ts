// @vitest-environment jsdom
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/mocks/server";
import {
  signUploadRequest,
  UnsupportedMultipartOperationError,
} from "../sign-upload-request";

describe("signUploadRequest", () => {
  it("calls POST /videos/:id/parts/sign with { method, uploadId, partNumber } and returns { url, headers? }", async () => {
    const received: Record<string, unknown>[] = [];
    server.use(
      http.post("/api/videos/video-1/parts/sign", async ({ request }) => {
        received.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({
          url: "https://signed.example/part-1",
          headers: { "x-amz-foo": "bar" },
        });
      }),
    );

    const result = await signUploadRequest({
      method: "PUT",
      key: "videos/video-1/original.mp4",
      uploadId: "upload-123",
      partNumber: 1,
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      method: "PUT",
      uploadId: "upload-123",
      partNumber: 1,
    });
    expect(result).toEqual({
      url: "https://signed.example/part-1",
      headers: { "x-amz-foo": "bar" },
    });
  });

  it("derives the videoId from the storage key path", async () => {
    server.use(
      http.post("/api/videos/another-video/parts/sign", () =>
        HttpResponse.json({ url: "https://signed.example/part-2" }),
      ),
    );

    const result = await signUploadRequest({
      method: "PUT",
      key: "videos/another-video/original.mp4",
      uploadId: "upload-456",
      partNumber: 2,
    });

    expect(result.url).toBe("https://signed.example/part-2");
  });

  it("throws when the BFF response is not ok", async () => {
    server.use(
      http.post("/api/videos/video-1/parts/sign", () =>
        HttpResponse.json({ error: "VIDEO_NOT_FOUND" }, { status: 404 }),
      ),
    );

    await expect(
      signUploadRequest({
        method: "PUT",
        key: "videos/video-1/original.mp4",
        uploadId: "upload-123",
        partNumber: 1,
      }),
    ).rejects.toThrow();
  });

  it("rejects the 'complete' multipart operation instead of signing it (backend owns completion)", async () => {
    await expect(
      signUploadRequest({
        method: "POST",
        key: "videos/video-1/original.mp4",
        uploadId: "upload-123",
      }),
    ).rejects.toThrow(UnsupportedMultipartOperationError);
  });

  it("rejects the 'list parts' multipart operation (no presigned ListParts support yet)", async () => {
    await expect(
      signUploadRequest({
        method: "GET",
        key: "videos/video-1/original.mp4",
        uploadId: "upload-123",
      }),
    ).rejects.toThrow(UnsupportedMultipartOperationError);
  });
});
