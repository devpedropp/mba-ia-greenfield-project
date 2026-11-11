import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';

jest.mock('@aws-sdk/s3-request-presigner');

const mockedGetSignedUrl = getSignedUrl as jest.MockedFunction<
  typeof getSignedUrl
>;

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    endpoint: 'http://minio:9000',
    region: 'us-east-1',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
    bucket: 'streamtube',
    forcePathStyle: true,
    signedUrlExpirationSeconds: 3600,
    ...overrides,
  };
}

function makeS3Client(sendImpl: jest.Mock = jest.fn()): S3Client {
  return { send: sendImpl } as unknown as S3Client;
}

function firstCallArg<T>(mockFn: jest.Mock): T {
  const calls = mockFn.mock.calls as unknown as unknown[][];
  return calls[0][0] as T;
}

describe('StorageService', () => {
  beforeEach(() => {
    mockedGetSignedUrl.mockReset();
  });

  describe('createMultipartUpload', () => {
    it('should return the UploadId from the S3 client response', async () => {
      const send = jest.fn().mockResolvedValue({ UploadId: 'upload-123' });
      const service = new StorageService(makeS3Client(send), makeConfig());

      const uploadId = await service.createMultipartUpload(
        'videos/abc/original.mp4',
      );

      expect(uploadId).toBe('upload-123');
      expect(send).toHaveBeenCalledWith(
        expect.any(CreateMultipartUploadCommand),
      );
      const command = firstCallArg<CreateMultipartUploadCommand>(send);
      expect(command.input).toEqual({
        Bucket: 'streamtube',
        Key: 'videos/abc/original.mp4',
      });
    });

    it('should throw when the S3 client does not return an UploadId', async () => {
      const send = jest.fn().mockResolvedValue({});
      const service = new StorageService(makeS3Client(send), makeConfig());

      await expect(
        service.createMultipartUpload('videos/abc/original.mp4'),
      ).rejects.toThrow();
    });
  });

  describe('signPartUrl', () => {
    it('should sign an UploadPartCommand and return the url', async () => {
      mockedGetSignedUrl.mockResolvedValue('https://signed.example/part-1');
      const service = new StorageService(makeS3Client(), makeConfig());

      const result = await service.signPartUrl({
        key: 'videos/abc/original.mp4',
        uploadId: 'upload-123',
        partNumber: 1,
      });

      expect(result).toEqual({ url: 'https://signed.example/part-1' });
      const [, command, options] = mockedGetSignedUrl.mock.calls[0];
      expect(command).toBeInstanceOf(UploadPartCommand);
      expect((command as UploadPartCommand).input).toEqual({
        Bucket: 'streamtube',
        Key: 'videos/abc/original.mp4',
        UploadId: 'upload-123',
        PartNumber: 1,
      });
      expect(options).toEqual({ expiresIn: 3600 });
    });
  });

  describe('listParts', () => {
    it('should map S3 Parts to { partNumber, ETag }', async () => {
      const send = jest.fn().mockResolvedValue({
        Parts: [
          { PartNumber: 1, ETag: '"etag-1"' },
          { PartNumber: 2, ETag: '"etag-2"' },
        ],
      });
      const service = new StorageService(makeS3Client(send), makeConfig());

      const parts = await service.listParts({
        key: 'videos/abc/original.mp4',
        uploadId: 'upload-123',
      });

      expect(parts).toEqual([
        { partNumber: 1, ETag: '"etag-1"' },
        { partNumber: 2, ETag: '"etag-2"' },
      ]);
      expect(send).toHaveBeenCalledWith(expect.any(ListPartsCommand));
    });

    it('should return an empty array when the response has no Parts', async () => {
      const send = jest.fn().mockResolvedValue({});
      const service = new StorageService(makeS3Client(send), makeConfig());

      const parts = await service.listParts({
        key: 'videos/abc/original.mp4',
        uploadId: 'upload-123',
      });

      expect(parts).toEqual([]);
    });
  });

  describe('completeMultipartUpload', () => {
    it('should send CompleteMultipartUploadCommand with mapped parts', async () => {
      const send = jest.fn().mockResolvedValue({});
      const service = new StorageService(makeS3Client(send), makeConfig());

      await service.completeMultipartUpload({
        key: 'videos/abc/original.mp4',
        uploadId: 'upload-123',
        parts: [{ partNumber: 1, ETag: '"etag-1"' }],
      });

      expect(send).toHaveBeenCalledWith(
        expect.any(CompleteMultipartUploadCommand),
      );
      const command = firstCallArg<CompleteMultipartUploadCommand>(send);
      expect(command.input).toEqual({
        Bucket: 'streamtube',
        Key: 'videos/abc/original.mp4',
        UploadId: 'upload-123',
        MultipartUpload: {
          Parts: [{ PartNumber: 1, ETag: '"etag-1"' }],
        },
      });
    });
  });

  describe('abortMultipartUpload', () => {
    it('should send AbortMultipartUploadCommand with key and uploadId', async () => {
      const send = jest.fn().mockResolvedValue({});
      const service = new StorageService(makeS3Client(send), makeConfig());

      await service.abortMultipartUpload({
        key: 'videos/abc/original.mp4',
        uploadId: 'upload-123',
      });

      expect(send).toHaveBeenCalledWith(
        expect.any(AbortMultipartUploadCommand),
      );
      const command = firstCallArg<AbortMultipartUploadCommand>(send);
      expect(command.input).toEqual({
        Bucket: 'streamtube',
        Key: 'videos/abc/original.mp4',
        UploadId: 'upload-123',
      });
    });
  });

  describe('getPresignedGetUrl', () => {
    it('should sign a GetObjectCommand without disposition by default', async () => {
      mockedGetSignedUrl.mockResolvedValue('https://signed.example/get');
      const service = new StorageService(makeS3Client(), makeConfig());

      const url = await service.getPresignedGetUrl('videos/abc/original.mp4');

      expect(url).toBe('https://signed.example/get');
      const [, command] = mockedGetSignedUrl.mock.calls[0];
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect((command as GetObjectCommand).input).toEqual({
        Bucket: 'streamtube',
        Key: 'videos/abc/original.mp4',
      });
    });

    it('should include ResponseContentDisposition when disposition is provided', async () => {
      mockedGetSignedUrl.mockResolvedValue('https://signed.example/download');
      const service = new StorageService(makeS3Client(), makeConfig());

      await service.getPresignedGetUrl('videos/abc/original.mp4', {
        disposition: 'attachment; filename="original.mp4"',
      });

      const [, command] = mockedGetSignedUrl.mock.calls[0];
      expect((command as GetObjectCommand).input).toEqual({
        Bucket: 'streamtube',
        Key: 'videos/abc/original.mp4',
        ResponseContentDisposition: 'attachment; filename="original.mp4"',
      });
    });
  });
});
